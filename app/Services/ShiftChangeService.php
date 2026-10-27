<?php

namespace App\Services;

use App\Models\Shift;
use App\Models\ShiftChangeRequest as ChangeRequest;
use App\Models\ShiftTemplate;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * ย้าย/แลกเวร: ตรวจผลก่อนเปลี่ยนจริง แล้วค่อยเปลี่ยนใน transaction
 *
 * - blocking = ผิดกติกาเวร (ซ้อน, พักไม่พอ, ชั่วโมงเกิน, ตรงวันลา) — ห้ามเปลี่ยนจนกว่าตารางจะถูกเคลียร์
 * - coverage = ช่องเวรจะขาดคนหรือขาดความเชี่ยวชาญ — แอดมินเลือกยอมรับได้
 */
class ShiftChangeService
{
    public function __construct(private RosterService $roster) {}

    /** @return array{blocking: list<string>, coverage: list<string>} */
    public function evaluate(ChangeRequest $request): array
    {
        $requester = $request->requester;
        $from = $request->fromTemplate;
        $to = $request->toTemplate;
        $fromDate = $request->from_date->toDateString();
        $toDate = $request->to_date->toDateString();
        $blocking = [];
        $coverage = [];

        $shift = $request->shift()->first();
        if (! $shift || $shift->staff_id !== $requester->id || $shift->shift_template_id !== $from->id || $shift->shift_date->toDateString() !== $fromDate) {
            return ['blocking' => ['เวรเดิมของผู้ขอถูกเปลี่ยนไปแล้ว'], 'coverage' => []];
        }

        if ($request->type === ChangeRequest::MOVE) {
            if ($from->id === $to->id && $fromDate === $toDate) {
                return ['blocking' => ['ช่องใหม่ต้องไม่ใช่ช่องเดิม'], 'coverage' => []];
            }
            $blocking = $this->roster->violations($requester, $to, $toDate, [$shift->id]);
            $coverage[] = $this->slot($from, $fromDate, $this->roster->coverageAfter($from, $fromDate, $requester->id, null));
        } else {
            $friend = $request->targetStaff;
            $target = $request->targetShift()->first();
            if (! $target || $target->staff_id !== $friend->id || $target->shift_template_id !== $to->id || $target->shift_date->toDateString() !== $toDate) {
                return ['blocking' => ["เวรของ {$friend->name} ถูกเปลี่ยนไปแล้ว"], 'coverage' => []];
            }
            $ignore = [$shift->id, $target->id];
            foreach ($this->roster->violations($requester, $to, $toDate, $ignore) as $error) {
                $blocking[] = "{$requester->name}: {$error}";
            }
            foreach ($this->roster->violations($friend, $from, $fromDate, $ignore) as $error) {
                $blocking[] = "{$friend->name}: {$error}";
            }
            $coverage[] = $this->slot($from, $fromDate, $this->roster->coverageAfter($from, $fromDate, $requester->id, $friend));
            $coverage[] = $this->slot($to, $toDate, $this->roster->coverageAfter($to, $toDate, $friend->id, $requester));
        }

        return ['blocking' => $blocking, 'coverage' => array_values(array_filter($coverage))];
    }

    /**
     * เปลี่ยนตารางจริง: ล็อกเวรที่เกี่ยวข้องแล้วตรวจซ้ำในล็อก — กันสองคำขอเปลี่ยนเวรเดียวกันพร้อมกัน
     */
    public function apply(ChangeRequest $request, array $attributes): void
    {
        DB::transaction(function () use ($request, $attributes) {
            $shift = Shift::lockForUpdate()->find($request->shift_id);
            $request->target_shift_id && Shift::lockForUpdate()->find($request->target_shift_id);

            $blocking = $this->evaluate($request)['blocking'];
            if (! $shift || $blocking) {
                throw ValidationException::withMessages(['request' => $blocking ?: ['เวรเดิมของผู้ขอถูกเปลี่ยนไปแล้ว']]);
            }

            if ($request->type === ChangeRequest::MOVE) {
                [$start, $end] = $request->toTemplate->window($request->to_date->toDateString());
                $shift->update([
                    'shift_template_id' => $request->to_template_id,
                    'shift_date' => $request->to_date->toDateString(),
                    'starts_at' => $start,
                    'ends_at' => $end,
                ]);
            } else {
                $target = Shift::lockForUpdate()->findOrFail($request->target_shift_id);
                $shift->update(['staff_id' => $request->target_staff_id]);
                $target->update(['staff_id' => $request->requester_staff_id]);
            }

            $request->update(['status' => ChangeRequest::APPROVED, 'decided_at' => now()] + $attributes);
        });
    }

    private function slot(ShiftTemplate $template, string $date, ?string $problem): ?string
    {
        return $problem ? "{$template->name} ".date('d/m', strtotime($date)).": {$problem}" : null;
    }
}
