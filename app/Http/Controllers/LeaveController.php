<?php

namespace App\Http\Controllers;

use App\Models\Hospital;
use App\Models\Shift;
use App\Models\Staff;
use App\Models\StaffUnavailability as Leave;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

// คำขอลา: แพทย์ขอ (รออนุมัติ) → แอดมินอนุมัติ/ไม่อนุมัติ · แอดมินบันทึกให้เอง = อนุมัติทันที
class LeaveController extends Controller
{
    // GET /api/hospitals/{hospital}/leave-requests?status=pending — กล่องคำขอของแอดมิน
    public function index(Request $request, Hospital $hospital)
    {
        $status = $request->validate(['status' => 'nullable|in:pending,approved,rejected'])['status'] ?? Leave::PENDING;

        $leaves = $hospital->leaves()
            ->with('staff:id,name,department_id', 'decider:id,name')
            ->where('staff_unavailabilities.status', $status)
            ->orderBy('staff_unavailabilities.date', $status === Leave::PENDING ? 'asc' : 'desc')
            ->limit(200)
            ->get(['staff_unavailabilities.*']);

        // คำขอที่วันนั้นแพทย์มีเวรอยู่แล้ว — ต้องย้ายเวรก่อนจึงอนุมัติได้
        $conflicts = Shift::query()
            ->whereIn('staff_id', $leaves->pluck('staff_id'))
            ->whereIn('shift_date', $leaves->pluck('date')->map->toDateString())
            ->get(['staff_id', 'shift_date'])
            ->map(fn ($s) => $s->staff_id.'|'.$s->shift_date->toDateString())
            ->flip();

        $counts = $hospital->leaves()->toBase()
            ->selectRaw('staff_unavailabilities.status, COUNT(*) AS total')
            ->groupBy('staff_unavailabilities.status')
            ->pluck('total', 'status');

        return [
            'counts' => ['pending' => (int) ($counts['pending'] ?? 0), 'approved' => (int) ($counts['approved'] ?? 0), 'rejected' => (int) ($counts['rejected'] ?? 0)],
            'data' => $leaves->map(fn (Leave $l) => $this->present($l) + [
                'staff_name' => $l->staff->name,
                'department_id' => $l->staff->department_id,
                'has_shift' => $conflicts->has($l->staff_id.'|'.$l->date->toDateString()),
            ])->values(),
        ];
    }

    // POST /api/hospitals/{hospital}/staff/{staff}/unavailabilities {date, reason}
    public function store(Request $request, Hospital $hospital, Staff $staff)
    {
        $user = $request->user();
        $direct = $user->can('leave.manage.any');
        abort_unless($direct || ($user->can('leave.manage.own') && $user->staff_id === $staff->id), 403, 'ขอลาได้เฉพาะของตัวเอง');

        $data = $request->validate([
            'date' => 'required|date_format:Y-m-d',
            'reason' => 'nullable|string|max:100',
        ]);

        // แอดมินบันทึกเอง = อนุมัติทันที จึงต้องไม่มีเวรวันนั้น · แพทย์ขอได้แม้มีเวร (แอดมินจะจัดการก่อนอนุมัติ)
        if ($direct && $staff->shifts()->whereDate('shift_date', $data['date'])->exists()) {
            throw ValidationException::withMessages(['date' => ['แพทย์มีเวรในวันนี้อยู่แล้ว ต้องลบเวรออกก่อน']]);
        }

        $leave = $staff->unavailabilities()->whereDate('date', $data['date'])->first();
        if ($leave && $leave->status !== Leave::REJECTED) {
            throw ValidationException::withMessages(['date' => [$leave->status === Leave::PENDING ? 'มีคำขอลาวันนี้รออนุมัติอยู่แล้ว' : 'วันนี้ลาอยู่แล้ว']]);
        }

        $attributes = [
            'reason' => $data['reason'] ?? null,
            'status' => $direct ? Leave::APPROVED : Leave::PENDING,
            'requested_by' => $user->id,
            'decided_by' => $direct ? $user->id : null,
            'decided_at' => $direct ? now() : null,
            'decision_note' => null,
        ];

        // เคยถูกปฏิเสธแล้วขอใหม่ = เปิดคำขอเดิมใหม่ (unique staff_id + date)
        $leave = $leave ? tap($leave)->update($attributes) : $staff->unavailabilities()->create(['date' => $data['date']] + $attributes);

        return response()->json($this->present($leave), 201);
    }

    // POST /api/hospitals/{hospital}/leave-requests/{leave}/approve
    public function approve(Request $request, Hospital $hospital, Leave $leave)
    {
        $this->ensurePending($leave);

        if (Shift::where('staff_id', $leave->staff_id)->whereDate('shift_date', $leave->date)->exists()) {
            throw ValidationException::withMessages(['leave' => ['แพทย์มีเวรวันนี้ ต้องย้าย/ลบเวรก่อนจึงอนุมัติได้']]);
        }

        $leave->update(['status' => Leave::APPROVED, 'decided_by' => $request->user()->id, 'decided_at' => now(), 'decision_note' => $request->input('note')]);

        return $this->present($leave);
    }

    // POST /api/hospitals/{hospital}/leave-requests/{leave}/reject {note}
    public function reject(Request $request, Hospital $hospital, Leave $leave)
    {
        $this->ensurePending($leave);
        $note = $request->validate(['note' => 'nullable|string|max:200'])['note'] ?? null;

        $leave->update(['status' => Leave::REJECTED, 'decided_by' => $request->user()->id, 'decided_at' => now(), 'decision_note' => $note]);

        return $this->present($leave);
    }

    // DELETE /api/hospitals/{hospital}/leave-requests/{leave} — แพทย์ยกเลิกคำขอที่ยังรออนุมัติ · แอดมินลบได้ทุกสถานะ
    public function destroy(Request $request, Hospital $hospital, Leave $leave)
    {
        $user = $request->user();
        $own = $user->can('leave.manage.own') && $user->staff_id === $leave->staff_id && $leave->status === Leave::PENDING;
        abort_unless($own || $user->can('leave.manage.any'), 403, 'ยกเลิกได้เฉพาะคำขอของตัวเองที่ยังรออนุมัติ');

        $leave->delete();

        return response()->noContent();
    }

    private function ensurePending(Leave $leave): void
    {
        abort_unless($leave->status === Leave::PENDING, 422, 'คำขอนี้ตัดสินไปแล้ว');
    }

    private function present(Leave $leave): array
    {
        return [
            'id' => $leave->id,
            'staff_id' => $leave->staff_id,
            'date' => $leave->date->toDateString(),
            'reason' => $leave->reason,
            'status' => $leave->status,
            'decided_at' => $leave->decided_at,
            'decided_by_name' => $leave->decider?->name,
            'decision_note' => $leave->decision_note,
        ];
    }
}
