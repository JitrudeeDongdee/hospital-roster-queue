<?php

namespace App\Services;

use App\Models\Department;
use App\Models\Shift;
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
     * @return list<string> ข้อความที่ผิดกติกา — ว่าง = ลงเวรได้
     */
    public function violations(Staff $staff, ShiftTemplate $template, string $date): array
    {
        $hospital = $staff->hospital;
        [$start, $end] = $template->window($date);
        $rest = $hospital->min_rest_hours;
        $errors = [];

        if ($template->department_id !== $staff->department_id) {
            $errors[] = 'แพทย์ไม่ได้อยู่ในแผนกของเวรนี้';
        }

        if ($staff->unavailabilities()->whereDate('date', $date)->exists()) {
            $errors[] = 'แพทย์แจ้งลา/ไม่สะดวกในวันนี้';
        }

        // เวรที่อยู่ใกล้กันในช่วง ±เวลาพัก — ใช้ index (staff_id, starts_at)
        $nearby = $staff->shifts()
            ->where('starts_at', '<', $end->addHours($rest))
            ->where('ends_at', '>', $start->subHours($rest))
            ->get();

        foreach ($nearby as $other) {
            if ($other->starts_at < $end && $other->ends_at > $start) {
                $errors[] = "เวรซ้อนกับเวร {$other->starts_at->format('d/m H:i')}–{$other->ends_at->format('H:i')}";
            } else {
                $errors[] = "พักน้อยกว่า {$rest} ชม. ก่อน/หลังเวร {$other->starts_at->format('d/m H:i')}";
            }
        }

        $weekStart = $start->startOfWeek();
        $weekHours = $staff->shifts()
            ->whereBetween('starts_at', [$weekStart, $weekStart->endOfWeek()])
            ->get()
            ->sum(fn (Shift $s) => $s->starts_at->diffInMinutes($s->ends_at) / 60);
        $total = $weekHours + $start->diffInMinutes($end) / 60;

        if ($total > $hospital->max_weekly_hours) {
            $errors[] = "ชั่วโมงสัปดาห์นี้จะเป็น {$total} ชม. เกิน {$hospital->max_weekly_hours} ชม.";
        }

        return $errors;
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

        $gaps = [];
        foreach (CarbonPeriod::create($from, $to) as $day) {
            $date = $day->toDateString();
            foreach ($templates as $template) {
                $assigned = $shifts->filter(fn ($s) => $s->shift_template_id === $template->id && $s->shift_date->toDateString() === $date);
                $problem = $this->coverageProblem($template, $assigned->pluck('staff'));
                if ($problem) {
                    $gaps[] = ['date' => $date, 'shift_template_id' => $template->id, 'problem' => $problem];
                }
            }
        }

        return [
            'templates' => $templates,
            'shifts' => $shifts->map(fn (Shift $s) => [
                'id' => $s->id,
                'shift_template_id' => $s->shift_template_id,
                'shift_date' => $s->shift_date->toDateString(),
                'staff_id' => $s->staff_id,
                'staff_name' => $s->staff->name,
            ])->values(),
            'gaps' => $gaps,
        ];
    }

    /**
     * สร้างตารางเวรอัตโนมัติ (greedy): เติมเฉพาะช่องที่ยังขาด ไม่ลบเวรที่แอดมินลงไว้แล้ว
     * ลำดับเลือกหมอ: ผ่านกติกา → มีความเชี่ยวชาญที่ช่องนั้นยังขาด → ชั่วโมงสะสมน้อยสุด (กระจายเวรให้เท่า ๆ กัน)
     */
    public function generate(Department $department, string $from, string $to): array
    {
        $templates = $department->shiftTemplates()->get();
        $doctors = $department->staff()->where('is_active', true)->with('skills:id', 'hospital')->get();
        $hours = $doctors->mapWithKeys(fn (Staff $d) => [$d->id => $this->hoursBetween($d, $from, $to)]);
        $created = 0;

        DB::transaction(function () use ($templates, $doctors, $from, $to, &$hours, &$created) {
            foreach (CarbonPeriod::create($from, $to) as $day) {
                $date = $day->toDateString();
                foreach ($templates as $template) {
                    $assigned = Shift::where('shift_template_id', $template->id)->whereDate('shift_date', $date)->with('staff.skills:id')->get()->pluck('staff');

                    while ($this->coverageProblem($template, $assigned)) {
                        $needSkill = $template->required_skill_id && ! $this->hasSkill($assigned, $template->required_skill_id);

                        $pick = $doctors
                            ->reject(fn (Staff $d) => $assigned->contains('id', $d->id))
                            ->filter(fn (Staff $d) => $this->violations($d, $template, $date) === [])
                            ->sortBy(fn (Staff $d) => [
                                $needSkill && ! $d->skills->contains('id', $template->required_skill_id) ? 1 : 0,
                                $hours[$d->id],
                                $d->id,
                            ])
                            ->first();

                        if (! $pick) {
                            break; // ไม่มีหมอที่ลงได้โดยไม่ผิดกติกา — เหลือเป็นช่องขาดให้แอดมินจัดการ
                        }

                        $shift = $this->assign($pick, $template, $date);
                        $hours[$pick->id] += $shift->starts_at->diffInMinutes($shift->ends_at) / 60;
                        $assigned->push($pick);
                        $created++;
                    }
                }
            }
        });

        return ['created' => $created] + $this->roster($department, $from, $to);
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

    private function hoursBetween(Staff $staff, string $from, string $to): float
    {
        return $staff->shifts()->whereBetween('shift_date', [$from, $to])->get()
            ->sum(fn (Shift $s) => $s->starts_at->diffInMinutes($s->ends_at) / 60);
    }
}
