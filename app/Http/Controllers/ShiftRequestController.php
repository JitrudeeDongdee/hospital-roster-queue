<?php

namespace App\Http\Controllers;

use App\Models\Hospital;
use App\Models\Shift;
use App\Models\ShiftChangeRequest as ChangeRequest;
use App\Models\ShiftTemplate;
use App\Services\ShiftChangeService;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

// ขอย้าย/แลกเวร: ย้ายไปช่องอื่น หรือแลกกับเวรของเพื่อน (เพื่อนตอบรับ)
// ไม่ผิดกติกาและช่องเวรไม่ขาดคน = เปลี่ยนให้ทันที · ไม่อย่างนั้นส่งให้แอดมินเคลียร์
class ShiftRequestController extends Controller
{
    private const WITH = ['requester:id,name', 'targetStaff:id,name', 'fromTemplate', 'toTemplate', 'decider:id,name'];

    public function __construct(private ShiftChangeService $changes) {}

    // GET /api/hospitals/{hospital}/shift-requests — ของฉัน / รอฉันตอบ / รอแอดมินเคลียร์ ตามสิทธิ์
    public function index(Request $request, Hospital $hospital)
    {
        $user = $request->user();
        $own = $user->can('shift.request.own') && $user->staff_id;
        $resolve = $user->can('shift.request.resolve');
        abort_unless($own || $resolve, 403);

        $query = fn () => ChangeRequest::with(self::WITH)->where('hospital_id', $hospital->id);

        return [
            'mine' => $own ? $query()->where('requester_staff_id', $user->staff_id)->latest()->limit(50)->get()->map($this->present(...)) : [],
            'incoming' => $own ? $query()->where('target_staff_id', $user->staff_id)->where('status', ChangeRequest::PENDING_PEER)->oldest()->get()->map($this->present(...)) : [],
            'needs_admin' => $resolve ? $query()->where('status', ChangeRequest::NEEDS_ADMIN)->oldest()->get()->map($this->present(...)) : [],
            'recent' => $resolve ? $query()->whereNotIn('status', [ChangeRequest::PENDING_PEER, ChangeRequest::NEEDS_ADMIN])->latest('updated_at')->limit(30)->get()->map($this->present(...)) : [],
        ];
    }

    // POST /api/hospitals/{hospital}/shift-requests {shift_id, type, to_date + to_template_id | target_shift_id, reason}
    public function store(Request $request, Hospital $hospital)
    {
        $user = $request->user();
        $data = $request->validate([
            'shift_id' => 'required|integer',
            'type' => 'required|in:move,swap',
            'to_date' => 'required_if:type,move|nullable|date_format:Y-m-d|after_or_equal:today',
            'to_template_id' => 'required_if:type,move|nullable|integer',
            'target_shift_id' => 'required_if:type,swap|nullable|integer',
            'reason' => 'nullable|string|max:200',
        ]);

        $shift = Shift::where('hospital_id', $hospital->id)->findOrFail($data['shift_id']);
        abort_unless($user->staff_id === $shift->staff_id, 403, 'ขอย้าย/แลกได้เฉพาะเวรของตัวเอง');
        $this->ensureUpcoming($shift, 'shift_id', 'เวรนี้เริ่มไปแล้ว ขอย้าย/แลกไม่ได้');
        if (ChangeRequest::where('shift_id', $shift->id)->whereIn('status', [ChangeRequest::PENDING_PEER, ChangeRequest::NEEDS_ADMIN])->exists()) {
            throw ValidationException::withMessages(['shift_id' => ['เวรนี้มีคำขอที่ยังไม่จบอยู่แล้ว']]);
        }

        $attributes = [
            'hospital_id' => $hospital->id,
            'department_id' => $shift->department_id,
            'type' => $data['type'],
            'requester_staff_id' => $shift->staff_id,
            'shift_id' => $shift->id,
            'from_date' => $shift->shift_date->toDateString(),
            'from_template_id' => $shift->shift_template_id,
            'reason' => $data['reason'] ?? null,
        ];

        if ($data['type'] === ChangeRequest::MOVE) {
            $template = ShiftTemplate::where('department_id', $shift->department_id)->findOrFail($data['to_template_id']);
            $change = new ChangeRequest($attributes + ['to_date' => $data['to_date'], 'to_template_id' => $template->id]);
        } else {
            $target = Shift::where('department_id', $shift->department_id)->findOrFail($data['target_shift_id']);
            if ($target->staff_id === $shift->staff_id) {
                throw ValidationException::withMessages(['target_shift_id' => ['เลือกเวรของแพทย์คนอื่น']]);
            }
            $this->ensureUpcoming($target, 'target_shift_id', 'เวรของเพื่อนเริ่มไปแล้ว');
            $change = new ChangeRequest($attributes + [
                'target_shift_id' => $target->id,
                'target_staff_id' => $target->staff_id,
                'to_date' => $target->shift_date->toDateString(),
                'to_template_id' => $target->shift_template_id,
            ]);
        }

        $result = $this->changes->evaluate($change);

        if ($change->type === ChangeRequest::MOVE) {
            // ย้ายไปช่องที่ผิดกติกา = ไม่รับคำขอเลย · ช่องเดิมจะขาดคน = ให้แอดมินตัดสิน · นอกนั้นย้ายทันที
            if ($result['blocking']) {
                throw ValidationException::withMessages(['to_date' => $result['blocking']]);
            }
            $change->fill(['status' => ChangeRequest::NEEDS_ADMIN, 'problems' => $result['coverage'] ?: null])->save();
            if (! $result['coverage']) {
                $this->changes->apply($change, ['problems' => null]);
            }
        } else {
            // แลกเวร: รอเพื่อนตอบก่อน · เก็บปัญหาที่ตรวจเจอไว้ให้เพื่อนเห็นตอนตัดสินใจ
            $change->fill(['status' => ChangeRequest::PENDING_PEER, 'problems' => array_merge($result['blocking'], $result['coverage']) ?: null])->save();
        }

        return response()->json($this->present($change->fresh(self::WITH)), 201);
    }

    // POST /api/hospitals/{hospital}/shift-requests/{shiftRequest}/accept — เพื่อนตอบรับการแลก
    public function accept(Request $request, Hospital $hospital, ChangeRequest $shiftRequest)
    {
        $this->ensurePeer($request, $shiftRequest);
        $shiftRequest->update(['responded_at' => now()]);

        $result = $this->changes->evaluate($shiftRequest);
        $problems = array_merge($result['blocking'], $result['coverage']);

        if ($problems) {
            $shiftRequest->update(['status' => ChangeRequest::NEEDS_ADMIN, 'problems' => $problems]);
        } else {
            $this->changes->apply($shiftRequest, ['problems' => null]);
        }

        return $this->present($shiftRequest->fresh(self::WITH));
    }

    // POST /api/hospitals/{hospital}/shift-requests/{shiftRequest}/decline
    public function decline(Request $request, Hospital $hospital, ChangeRequest $shiftRequest)
    {
        $this->ensurePeer($request, $shiftRequest);
        $shiftRequest->update(['status' => ChangeRequest::DECLINED, 'responded_at' => now()]);

        return $this->present($shiftRequest->fresh(self::WITH));
    }

    // POST /api/hospitals/{hospital}/shift-requests/{shiftRequest}/approve {note} — แอดมินยอมรับช่องที่ขาดคนได้ แต่ต้องเคลียร์กติกาที่ผิดก่อน
    public function approve(Request $request, Hospital $hospital, ChangeRequest $shiftRequest)
    {
        abort_unless($shiftRequest->status === ChangeRequest::NEEDS_ADMIN, 422, 'คำขอนี้ไม่ได้รอแอดมินเคลียร์');
        $note = $request->validate(['note' => 'nullable|string|max:200'])['note'] ?? null;

        $this->changes->apply($shiftRequest, ['decided_by' => $request->user()->id, 'decision_note' => $note]);

        return $this->present($shiftRequest->fresh(self::WITH));
    }

    // POST /api/hospitals/{hospital}/shift-requests/{shiftRequest}/reject {note}
    public function reject(Request $request, Hospital $hospital, ChangeRequest $shiftRequest)
    {
        abort_unless($shiftRequest->isOpen(), 422, 'คำขอนี้จบไปแล้ว');
        $note = $request->validate(['note' => 'nullable|string|max:200'])['note'] ?? null;

        $shiftRequest->update(['status' => ChangeRequest::REJECTED, 'decided_by' => $request->user()->id, 'decided_at' => now(), 'decision_note' => $note]);

        return $this->present($shiftRequest->fresh(self::WITH));
    }

    // DELETE /api/hospitals/{hospital}/shift-requests/{shiftRequest} — ผู้ขอยกเลิกคำขอที่ยังไม่จบ
    public function destroy(Request $request, Hospital $hospital, ChangeRequest $shiftRequest)
    {
        abort_unless($request->user()->staff_id === $shiftRequest->requester_staff_id && $shiftRequest->isOpen(), 403, 'ยกเลิกได้เฉพาะคำขอของตัวเองที่ยังไม่จบ');
        $shiftRequest->delete();

        return response()->noContent();
    }

    private function ensurePeer(Request $request, ChangeRequest $shiftRequest): void
    {
        abort_unless($request->user()->staff_id === $shiftRequest->target_staff_id, 403, 'ตอบได้เฉพาะคำขอที่ส่งถึงคุณ');
        abort_unless($shiftRequest->status === ChangeRequest::PENDING_PEER, 422, 'คำขอนี้ตอบไปแล้ว');
    }

    private function ensureUpcoming(Shift $shift, string $field, string $message): void
    {
        if ($shift->starts_at->isPast()) {
            throw ValidationException::withMessages([$field => [$message]]);
        }
    }

    private function present(ChangeRequest $r): array
    {
        $slot = fn ($template, $date) => [
            'date' => $date->toDateString(),
            'shift_template_id' => $template->id,
            'name' => $template->name,
            'start_time' => substr($template->start_time, 0, 5),
            'end_time' => substr($template->end_time, 0, 5),
        ];

        return [
            'id' => $r->id,
            'type' => $r->type,
            'status' => $r->status,
            'department_id' => $r->department_id,
            'requester' => ['id' => $r->requester->id, 'name' => $r->requester->name],
            'target_staff' => $r->targetStaff ? ['id' => $r->targetStaff->id, 'name' => $r->targetStaff->name] : null,
            'from' => $slot($r->fromTemplate, $r->from_date),
            'to' => $slot($r->toTemplate, $r->to_date),
            'reason' => $r->reason,
            'problems' => $r->problems ?? [],
            'decided_by_name' => $r->decider?->name,
            'decision_note' => $r->decision_note,
            'created_at' => $r->created_at,
            'decided_at' => $r->decided_at,
        ];
    }
}
