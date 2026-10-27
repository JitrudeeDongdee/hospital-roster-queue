<?php

namespace App\Http\Controllers;

use App\Models\Hospital;
use App\Models\Shift;
use App\Models\ShiftPreference;
use App\Models\Staff;
use App\Models\StaffUnavailability;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

// เวรที่แพทย์อยากลง/ไม่สะดวกของเดือนหน้า — ส่งได้จนกว่าแผนกจะมีเวรของเดือนนั้นแล้ว
class ShiftPreferenceController extends Controller
{
    // GET /api/hospitals/{hospital}/staff/{staff}/preferences/months — ประวัติ: เดือนที่เคยส่ง พร้อมจำนวนช่อง และจัดเวรแล้วหรือยัง
    public function months(Request $request, Hospital $hospital, Staff $staff)
    {
        $this->ensureCanView($request, $staff);

        return $staff->preferences()->orderByDesc('date')->get(['date', 'kind'])
            ->groupBy(fn (ShiftPreference $p) => $p->date->format('Y-m'))
            ->map(function ($items, $month) use ($staff) {
                $from = CarbonImmutable::parse("{$month}-01");

                return [
                    'month' => $month,
                    'prefer' => $items->where('kind', ShiftPreference::PREFER)->count(),
                    'avoid' => $items->where('kind', ShiftPreference::AVOID)->count(),
                    'locked' => $this->locked($staff, $from, $from->endOfMonth()->startOfDay()),
                ];
            })->values();
    }

    // GET /api/hospitals/{hospital}/staff/{staff}/preferences?month=YYYY-MM
    public function show(Request $request, Hospital $hospital, Staff $staff)
    {
        $this->ensureCanView($request, $staff);
        [$from, $to] = $this->month($request);

        return [
            'month' => $from->format('Y-m'),
            'locked' => $this->locked($staff, $from, $to),
            // ใช้คิดชั่วโมงที่อยากลงต่อสัปดาห์เทียบเพดาน (เกินได้ แต่หน้าเว็บเตือน)
            'max_weekly_hours' => $hospital->max_weekly_hours,
            // วันลา (อนุมัติแล้ว + รออนุมัติ) — ห้ามเลือกเวรวันนั้น กันลืม
            'leave' => $this->leaveDays($staff, $from, $to)->map(fn ($status, $date) => ['date' => $date, 'status' => $status])->values(),
            'items' => $staff->preferences()->whereBetween('date', [$from->toDateString(), $to->toDateString()])->orderBy('date')
                ->get(['date', 'shift_template_id', 'kind'])
                ->map(fn (ShiftPreference $p) => ['date' => $p->date->toDateString(), 'shift_template_id' => $p->shift_template_id, 'kind' => $p->kind]),
        ];
    }

    // PUT /api/hospitals/{hospital}/staff/{staff}/preferences {month, items: [{date, shift_template_id, kind}]} — แทนที่ทั้งเดือน
    public function update(Request $request, Hospital $hospital, Staff $staff)
    {
        $user = $request->user();
        abort_unless($user->can('shift.request.own') && $user->staff_id === $staff->id, 403, 'ส่งได้เฉพาะของตัวเอง');
        [$from, $to] = $this->month($request);
        $data = $request->validate([
            'items' => 'present|array|max:200',
            'items.*.date' => "required|date_format:Y-m-d|after_or_equal:{$from->toDateString()}|before_or_equal:{$to->toDateString()}",
            'items.*.shift_template_id' => 'required|integer|exists:shift_templates,id,department_id,'.$staff->department_id,
            'items.*.kind' => 'required|in:prefer,avoid',
        ]);

        if ($this->locked($staff, $from, $to)) {
            throw ValidationException::withMessages(['month' => ['เดือนนี้แผนกจัดเวรแล้ว ถ้าต้องการเปลี่ยนให้ขอย้าย/แลกเวรแทน']]);
        }

        $leave = $this->leaveDays($staff, $from, $to);
        $onLeave = collect($data['items'])->pluck('date')->unique()->filter(fn ($date) => $leave->has($date))->values();
        if ($onLeave->isNotEmpty()) {
            throw ValidationException::withMessages(['items' => ['วันที่ลาไว้แล้วเลือกเวรไม่ได้: '.$onLeave->implode(', ')]]);
        }

        DB::transaction(function () use ($staff, $from, $to, $data) {
            $staff->preferences()->whereBetween('date', [$from->toDateString(), $to->toDateString()])->delete();
            $rows = collect($data['items'])->unique(fn ($i) => $i['date'].'|'.$i['shift_template_id'])
                ->map(fn ($i) => $i + ['staff_id' => $staff->id, 'created_at' => now(), 'updated_at' => now()]);
            ShiftPreference::insert($rows->values()->all());
        });

        return $this->show($request, $hospital, $staff);
    }

    private function ensureCanView(Request $request, Staff $staff): void
    {
        $user = $request->user();
        abort_unless($user->can('roster.manage') || ($user->can('shift.request.own') && $user->staff_id === $staff->id), 403);
    }

    /** @return \Illuminate\Support\Collection<string, string> date => approved|pending */
    private function leaveDays(Staff $staff, CarbonImmutable $from, CarbonImmutable $to)
    {
        return $staff->unavailabilities()->whereIn('status', [StaffUnavailability::APPROVED, StaffUnavailability::PENDING])
            ->whereBetween('date', [$from->toDateString(), $to->toDateString()])->orderBy('date')->get(['date', 'status'])
            ->mapWithKeys(fn (StaffUnavailability $u) => [$u->date->toDateString() => $u->status]);
    }

    private function month(Request $request): array
    {
        $month = $request->validate(['month' => 'required|date_format:Y-m'])['month'];
        $from = CarbonImmutable::parse("{$month}-01");

        return [$from, $from->endOfMonth()->startOfDay()];
    }

    private function locked(Staff $staff, CarbonImmutable $from, CarbonImmutable $to): bool
    {
        return Shift::where('department_id', $staff->department_id)->whereBetween('shift_date', [$from->toDateString(), $to->toDateString()])->exists();
    }
}
