<?php

namespace App\Services;

use App\Models\Department;
use App\Models\Hospital;
use App\Models\Shift;
use App\Models\ShiftPreference;
use App\Models\ShiftTemplate;
use App\Models\Staff;
use Carbon\CarbonImmutable;
use Carbon\CarbonPeriod;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class RosterService
{
    /**
     * กติกาที่ห้ามผิด (ผิดแล้วลงเวรไม่ได้): เวรซ้อน, พักไม่พอ, เกินชั่วโมงต่อสัปดาห์, ตรงวันลา
     *
     * @param  list<int>  $ignoreShiftIds  เวรที่จะถูกย้าย/สลับออกไป — ไม่นับเป็นเวรเดิมของแพทย์
     * @return list<string> ข้อความที่ผิดกติกา — ว่าง = ลงเวรได้
     */
    public function violations(Staff $staff, ShiftTemplate $template, string $date, array $ignoreShiftIds = []): array
    {
        [$start] = $template->window($date);
        [$from, $to] = $this->contextRange($start, $staff->hospital);

        // โหลดเฉพาะเวรของแพทย์คนนี้ในช่วงที่กติกาต้องใช้ (สัปดาห์นั้น ± เวลาพัก) — ใช้ index (staff_id, starts_at)
        $shifts = $staff->shifts()->whereBetween('starts_at', [$from, $to])->whereNotIn('id', $ignoreShiftIds)->get(['starts_at', 'ends_at'])
            ->map(fn (Shift $s) => [CarbonImmutable::instance($s->starts_at), CarbonImmutable::instance($s->ends_at)]);
        // บังคับเฉพาะวันลาที่อนุมัติแล้ว (คำขอที่รออนุมัติ แอดมินยังลงเวรเองได้)
        $leave = $staff->unavailabilities()->where('status', 'approved')->whereDate('date', $date)->exists() ? [$date] : [];

        return $this->check($staff, $template, $date, $shifts->all(), $leave, $staff->hospital);
    }

    public function assign(Staff $staff, ShiftTemplate $template, string $date): Shift
    {
        [$start, $end] = $template->window($date);

        return Shift::create([
            'hospital_id' => $staff->hospital_id,
            'department_id' => $template->department_id,
            'shift_template_id' => $template->id,
            'staff_id' => $staff->id,
            'shift_date' => $date,
            'starts_at' => $start,
            'ends_at' => $end,
        ]);
    }

    /**
     * ช่องเวรนี้จะขาดคนหรือขาดความเชี่ยวชาญไหม ถ้าเอา $leaving ออกและใส่ $joining เข้าแทน
     */
    public function coverageAfter(ShiftTemplate $template, string $date, ?int $leaving, ?Staff $joining): ?string
    {
        $doctors = Staff::query()
            ->whereIn('id', Shift::where('shift_template_id', $template->id)->whereDate('shift_date', $date)->select('staff_id'))
            ->with('skills:id')
            ->get()
            ->reject(fn (Staff $d) => $d->id === $leaving);

        return $this->coverageProblem($template, $joining ? $doctors->push($joining->loadMissing('skills:id')) : $doctors);
    }

    /**
     * ตารางเวรของแผนก + ช่องที่ยังขาด (คนไม่ครบ หรือยังไม่มีหมอที่มีความเชี่ยวชาญที่เวรนั้นต้องการ)
     */
    public function roster(Department $department, string $from, string $to): array
    {
        $templates = $department->shiftTemplates()->get();
        $shifts = Shift::query()
            ->where('department_id', $department->id)
            ->whereBetween('shift_date', [$from, $to])
            ->with('staff:id,name', 'staff.skills:id')
            ->orderBy('starts_at')
            ->get();
        $bySlot = $shifts->groupBy(fn (Shift $s) => $s->shift_template_id.'|'.$s->shift_date->toDateString());

        $gaps = [];
        foreach (CarbonPeriod::create($from, $to) as $day) {
            $date = $day->toDateString();
            foreach ($templates as $template) {
                $problem = $this->coverageProblem($template, ($bySlot["{$template->id}|{$date}"] ?? collect())->pluck('staff'));
                if ($problem) {
                    $gaps[] = ['date' => $date, 'shift_template_id' => $template->id, 'problem' => $problem];
                }
            }
        }

        $hospital = $department->hospital;
        $preferences = ShiftPreference::query()
            ->whereIn('shift_template_id', $templates->pluck('id'))
            ->whereBetween('date', [$from, $to])
            ->get(['staff_id', 'shift_template_id', 'date', 'kind']);

        return [
            'rules' => ['min_rest_hours' => $hospital->min_rest_hours, 'max_weekly_hours' => $hospital->max_weekly_hours],
            'templates' => $templates,
            'shifts' => $shifts->map(fn (Shift $s) => [
                'id' => $s->id,
                'shift_template_id' => $s->shift_template_id,
                'shift_date' => $s->shift_date->toDateString(),
                'staff_id' => $s->staff_id,
                'staff_name' => $s->staff->name,
            ])->values(),
            'gaps' => $gaps,
            // เวรที่แพทย์อยากลง/ไม่สะดวก — ให้แอดมินเห็นในตารางก่อนจัดร่าง
            'preferences' => $preferences->map(fn (ShiftPreference $p) => [
                'staff_id' => $p->staff_id,
                'shift_template_id' => $p->shift_template_id,
                'date' => $p->date->toDateString(),
                'kind' => $p->kind,
            ])->values(),
        ];
    }

    /**
     * สร้างตารางเวรอัตโนมัติทั้งเดือน (greedy): เติมเฉพาะช่องที่ยังขาด ไม่ลบเวรที่แอดมินลงไว้แล้ว
     * ลำดับเลือกหมอ: ผ่านกติกา → มีความเชี่ยวชาญที่ช่องนั้นยังขาด → อยากลงช่องนี้ก่อน ไม่สะดวกไว้ท้ายสุด
     * → ไม่ไปกันช่องอื่นที่ตัวเองอยากลง → ชั่วโมงสะสมในช่วงนี้น้อยสุด (กระจายเวรให้เท่า ๆ กัน)
     *
     * โหลดเวรและวันลาของทุกคนมาครั้งเดียว แล้วตรวจกติกาใน memory ด้วย check() ตัวเดียวกับตอนลงเวรเอง
     * — จัดทั้งเดือนจึงใช้ query คงที่ ไม่ได้ยิงฐานข้อมูลทุกครั้งที่ลองหมอแต่ละคน
     */
    public function generate(Department $department, string $from, string $to): array
    {
        $hospital = $department->hospital;
        $templates = $department->shiftTemplates()->get();
        $doctors = $department->staff()->where('is_active', true)->with('skills:id')->get();
        $doctorById = $doctors->keyBy('id');

        [$loadFrom] = $this->contextRange(CarbonImmutable::parse($from), $hospital);
        [, $loadTo] = $this->contextRange(CarbonImmutable::parse($to)->addDay(), $hospital);

        $existing = Shift::whereIn('staff_id', $doctors->pluck('id'))->whereBetween('starts_at', [$loadFrom, $loadTo])->get();
        $shiftsOf = $doctors->mapWithKeys(fn (Staff $d) => [$d->id => $existing->where('staff_id', $d->id)
            ->map(fn (Shift $s) => [CarbonImmutable::instance($s->starts_at), CarbonImmutable::instance($s->ends_at)])->values()->all()])->all();
        // จัดอัตโนมัติเว้นทั้งวันลาที่อนุมัติแล้วและคำขอที่ยังรออนุมัติ — ไม่สร้างเวรที่จะชนกับคำขอลา
        $leaveOf = DB::table('staff_unavailabilities')->whereIn('staff_id', $doctors->pluck('id'))->whereIn('status', ['approved', 'pending'])->whereBetween('date', [$from, $to])->get()
            ->groupBy('staff_id')->map(fn ($rows) => $rows->map(fn ($r) => substr($r->date, 0, 10))->all())->all();
        $slots = Shift::where('department_id', $department->id)->whereBetween('shift_date', [$from, $to])->get()
            ->groupBy(fn (Shift $s) => $s->shift_template_id.'|'.$s->shift_date->toDateString())
            ->map(fn ($group) => $group->map(fn (Shift $s) => $doctorById[$s->staff_id] ?? $s->staff)->filter()->values());
        $hours = $doctors->mapWithKeys(fn (Staff $d) => [$d->id => $existing->where('staff_id', $d->id)
            ->filter(fn (Shift $s) => $s->shift_date->between($from, $to))
            ->sum(fn (Shift $s) => $s->starts_at->diffInMinutes($s->ends_at) / 60)])->all();
        // ความต้องการของแพทย์: "staff|template|date" => prefer/avoid
        $wish = ShiftPreference::query()
            ->whereIn('staff_id', $doctors->pluck('id'))
            ->whereBetween('date', [$from, $to])
            ->get()
            ->mapWithKeys(fn (ShiftPreference $p) => ["{$p->staff_id}|{$p->shift_template_id}|{$p->date->toDateString()}" => $p->kind])
            ->all();
        $templateById = $templates->keyBy('id');
        $preferOf = [];
        foreach ($wish as $key => $kind) {
            [$staffId, $templateId, $date] = explode('|', $key);
            if ($kind === ShiftPreference::PREFER) {
                $preferOf[$staffId][] = $templateById[$templateId]->window($date);
            }
        }
        // ลงช่องนี้แล้วจะชนหรือพักไม่พอกับช่องอื่นที่หมอคนนี้อยากลงไหม — ถ้าชน ให้คนอื่นที่ไม่ชนได้ช่องนี้ก่อน
        $blocksWish = function (Staff $d, ShiftTemplate $template, string $date) use ($preferOf, $hospital) {
            [$start, $end] = $template->window($date);
            foreach ($preferOf[$d->id] ?? [] as [$wishStart, $wishEnd]) {
                $same = $wishStart->equalTo($start);
                if (! $same && $wishStart < $end->addHours($hospital->min_rest_hours) && $wishEnd > $start->subHours($hospital->min_rest_hours)) {
                    return 1;
                }
            }

            return 0;
        };
        $created = 0;

        DB::transaction(function () use ($templates, $doctors, $from, $to, $hospital, $wish, &$shiftsOf, $leaveOf, &$slots, &$hours, &$created, $blocksWish) {
            foreach (CarbonPeriod::create($from, $to) as $day) {
                $date = $day->toDateString();
                foreach ($templates as $template) {
                    $assigned = $slots["{$template->id}|{$date}"] ?? collect();

                    while ($this->coverageProblem($template, $assigned)) {
                        $needSkill = $template->required_skill_id && ! $this->hasSkill($assigned, $template->required_skill_id);

                        $pick = $doctors
                            ->reject(fn (Staff $d) => $assigned->contains('id', $d->id))
                            ->filter(fn (Staff $d) => $this->check($d, $template, $date, $shiftsOf[$d->id], $leaveOf[$d->id] ?? [], $hospital) === [])
                            ->sortBy(fn (Staff $d) => [
                                $needSkill && ! $d->skills->contains('id', $template->required_skill_id) ? 1 : 0,
                                match ($wish["{$d->id}|{$template->id}|{$date}"] ?? null) {
                                    ShiftPreference::PREFER => 0,
                                    ShiftPreference::AVOID => 2,
                                    default => 1,
                                },
                                $blocksWish($d, $template, $date),
                                $hours[$d->id],
                                $d->id,
                            ])
                            ->first();

                        if (! $pick) {
                            break; // ไม่มีหมอที่ลงได้โดยไม่ผิดกติกา — เหลือเป็นช่องขาดให้แอดมินจัดการ
                        }

                        $shift = $this->assign($pick, $template, $date);
                        $shiftsOf[$pick->id][] = [CarbonImmutable::instance($shift->starts_at), CarbonImmutable::instance($shift->ends_at)];
                        $hours[$pick->id] += $shift->starts_at->diffInMinutes($shift->ends_at) / 60;
                        $assigned = $assigned->push($pick);
                        $created++;
                    }

                    $slots["{$template->id}|{$date}"] = $assigned;
                }
            }
        });

        // สรุปให้แอดมินเห็นว่าตารางร่างตรงกับความต้องการแค่ไหน
        $stats = ['prefer_total' => 0, 'prefer_met' => 0, 'avoid_total' => 0, 'avoid_used' => 0];
        foreach ($wish as $key => $kind) {
            [$staffId, $templateId, $date] = explode('|', $key);
            $got = ($slots["{$templateId}|{$date}"] ?? collect())->contains('id', (int) $staffId);
            $stats["{$kind}_total"]++;
            $stats[$kind === ShiftPreference::PREFER ? 'prefer_met' : 'avoid_used'] += $got ? 1 : 0;
        }

        return ['created' => $created, 'preference_stats' => $stats] + $this->roster($department, $from, $to);
    }

    /**
     * ตรวจกติกาจากข้อมูลที่โหลดมาแล้ว (ไม่ query) — ใช้ทั้งตอนลงเวรเองและตอนจัดอัตโนมัติ
     *
     * @param  list<array{0: CarbonImmutable, 1: CarbonImmutable}>  $shifts  เวรของแพทย์คนนี้ (อย่างน้อยช่วงสัปดาห์นั้น ± เวลาพัก)
     * @param  list<string>  $leaveDates
     */
    private function check(Staff $staff, ShiftTemplate $template, string $date, array $shifts, array $leaveDates, Hospital $hospital): array
    {
        [$start, $end] = $template->window($date);
        $rest = $hospital->min_rest_hours;
        $errors = [];

        if ($template->department_id !== $staff->department_id) {
            $errors[] = 'แพทย์ไม่ได้อยู่ในแผนกของเวรนี้';
        }

        if (in_array($date, $leaveDates, true)) {
            $errors[] = 'แพทย์แจ้งลา/ไม่สะดวกในวันนี้';
        }

        $weekStart = $start->startOfWeek();
        $weekEnd = $weekStart->endOfWeek();
        $total = $start->diffInMinutes($end) / 60;

        foreach ($shifts as [$otherStart, $otherEnd]) {
            if ($otherStart < $end && $otherEnd > $start) {
                $errors[] = "เวรซ้อนกับเวร {$otherStart->format('d/m H:i')}–{$otherEnd->format('H:i')}";
            } elseif ($otherStart < $end->addHours($rest) && $otherEnd > $start->subHours($rest)) {
                $errors[] = "พักน้อยกว่า {$rest} ชม. ก่อน/หลังเวร {$otherStart->format('d/m H:i')}";
            }

            if ($otherStart->between($weekStart, $weekEnd)) {
                $total += $otherStart->diffInMinutes($otherEnd) / 60;
            }
        }

        if ($total > $hospital->max_weekly_hours) {
            $errors[] = "ชั่วโมงสัปดาห์นี้จะเป็น {$total} ชม. เกิน {$hospital->max_weekly_hours} ชม.";
        }

        return $errors;
    }

    /** ช่วงเวลาที่ต้องรู้เวรเดิมเพื่อตรวจกติกาของเวรที่เริ่ม $start: ทั้งสัปดาห์ + เผื่อเวลาพักและเวรข้ามคืน */
    private function contextRange(CarbonImmutable $start, Hospital $hospital): array
    {
        $margin = max(24, $hospital->min_rest_hours + 16);

        return [$start->startOfWeek()->subHours($margin), $start->endOfWeek()->addHours($margin)];
    }

    private function coverageProblem(ShiftTemplate $template, Collection $doctors): ?string
    {
        if ($doctors->count() < $template->min_staff) {
            return "ต้องมีแพทย์อย่างน้อย {$template->min_staff} คน (มี {$doctors->count()})";
        }

        if ($template->required_skill_id && ! $this->hasSkill($doctors, $template->required_skill_id)) {
            return 'ยังไม่มีแพทย์ที่มีความเชี่ยวชาญที่เวรนี้ต้องการ';
        }

        return null;
    }

    private function hasSkill(Collection $doctors, int $skillId): bool
    {
        return $doctors->contains(fn (Staff $d) => $d->skills->contains('id', $skillId));
    }
}
