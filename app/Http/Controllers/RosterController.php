<?php

namespace App\Http\Controllers;

use App\Models\Department;
use App\Models\Hospital;
use App\Models\Shift;
use App\Models\ShiftTemplate;
use App\Models\Staff;
use App\Services\RosterService;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class RosterController extends Controller
{
    public function __construct(private RosterService $roster) {}

    // GET /api/hospitals/{hospital}/departments/{department}/roster?from=&to=
    public function show(Request $request, Hospital $hospital, Department $department)
    {
        $range = $this->range($request);

        return $this->roster->roster($department, ...$range);
    }

    // POST /api/hospitals/{hospital}/departments/{department}/roster/generate {from, to}
    public function generate(Request $request, Hospital $hospital, Department $department)
    {
        $range = $this->range($request);

        return $this->roster->generate($department, ...$range);
    }

    // POST /api/hospitals/{hospital}/shifts {staff_id, shift_template_id, date}
    public function store(Request $request, Hospital $hospital)
    {
        $data = $request->validate([
            'staff_id' => 'required|integer',
            'shift_template_id' => 'required|integer',
            'date' => 'required|date_format:Y-m-d',
        ]);

        $staff = $hospital->staff()->findOrFail($data['staff_id']);
        $template = ShiftTemplate::whereIn('department_id', $hospital->departments()->select('id'))
            ->findOrFail($data['shift_template_id']);

        $errors = $this->roster->violations($staff, $template, $data['date']);
        if ($errors) {
            throw ValidationException::withMessages(['shift' => $errors]);
        }

        return response()->json($this->roster->assign($staff, $template, $data['date']), 201);
    }

    // DELETE /api/hospitals/{hospital}/shifts/{shift}
    public function destroy(Hospital $hospital, Shift $shift)
    {
        $shift->delete();

        return response()->noContent();
    }

    // GET /api/hospitals/{hospital}/staff/{staff}/unavailabilities
    // ?from=&to= สำหรับปฏิทิน · ไม่ส่งมา = ตั้งแต่ 7 วันก่อนเป็นต้นไป
    public function unavailabilities(Request $request, Hospital $hospital, Staff $staff)
    {
        $data = $request->validate(['from' => 'nullable|date_format:Y-m-d', 'to' => 'nullable|date_format:Y-m-d']);

        return $staff->unavailabilities()
            ->where('date', '>=', $data['from'] ?? now()->subDays(7)->toDateString())
            ->when($data['to'] ?? null, fn ($q, $to) => $q->where('date', '<=', $to))
            ->orderBy('date')
            ->get(['id', 'date', 'reason']);
    }

    // POST /api/hospitals/{hospital}/staff/{staff}/unavailabilities {date, reason}
    public function addUnavailability(Request $request, Hospital $hospital, Staff $staff)
    {
        $user = $request->user();
        abort_unless(
            $user->can('leave.manage.any') || ($user->can('leave.manage.own') && $user->staff_id === $staff->id),
            403,
            'บันทึกวันลาได้เฉพาะของตัวเอง',
        );

        $data = $request->validate([
            'date' => 'required|date_format:Y-m-d',
            'reason' => 'nullable|string|max:100',
        ]);

        if ($staff->shifts()->whereDate('shift_date', $data['date'])->exists()) {
            throw ValidationException::withMessages(['date' => ['แพทย์มีเวรในวันนี้อยู่แล้ว ต้องลบเวรออกก่อน']]);
        }

        return response()->json($staff->unavailabilities()->firstOrCreate(['date' => $data['date']], $data), 201);
    }

    private function range(Request $request): array
    {
        $data = $request->validate([
            'from' => 'required|date_format:Y-m-d',
            'to' => 'required|date_format:Y-m-d|after_or_equal:from',
        ]);

        // 42 วัน = ปฏิทิน 6 สัปดาห์ที่คร่อมต้น/ปลายเดือน
        abort_if(now()->parse($data['from'])->diffInDays($data['to']) > 42, 422, 'Range is limited to 42 days.');

        return [$data['from'], $data['to']];
    }
}
