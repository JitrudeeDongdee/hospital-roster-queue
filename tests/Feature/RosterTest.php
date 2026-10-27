<?php

namespace Tests\Feature;

use App\Models\Department;
use App\Models\Hospital;
use App\Models\QueueTicket;
use App\Models\ShiftTemplate;
use App\Models\Skill;
use App\Models\Staff;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RosterTest extends TestCase
{
    use RefreshDatabase;

    private Hospital $hospital;
    private Department $opd;
    private ShiftTemplate $morning;
    private ShiftTemplate $evening;
    private ShiftTemplate $night;

    protected function setUp(): void
    {
        parent::setUp();

        $this->hospital = Hospital::create(['code' => 'H001', 'name' => 'Hospital 1', 'min_rest_hours' => 8, 'max_weekly_hours' => 40]);
        $this->opd = Department::create(['hospital_id' => $this->hospital->id, 'code' => 'OPD', 'name' => 'Outpatient']);
        [$this->morning, $this->evening, $this->night] = collect([['M', '08:00', '16:00'], ['A', '16:00', '00:00'], ['N', '00:00', '08:00']])
            ->map(fn ($t, $i) => ShiftTemplate::create([
                'department_id' => $this->opd->id, 'code' => $t[0], 'name' => $t[0],
                'start_time' => $t[1], 'end_time' => $t[2], 'min_staff' => 1, 'sort_order' => $i,
            ]))->all();
        $this->actingAsRole('admin', $this->hospital);
    }

    private function doctor(string $name = 'Dr. A', ?Department $department = null): Staff
    {
        $department ??= $this->opd;

        return Staff::create(['hospital_id' => $department->hospital_id, 'department_id' => $department->id, 'name' => $name]);
    }

    private function assign(Staff $doctor, ShiftTemplate $template, string $date)
    {
        $this->actingAsRole('admin', $this->hospital);

        return $this->postJson("/api/hospitals/{$this->hospital->id}/shifts", [
            'staff_id' => $doctor->id, 'shift_template_id' => $template->id, 'date' => $date,
        ]);
    }

    public function test_evening_shift_ends_at_midnight_of_the_next_day(): void
    {
        $this->assign($this->doctor(), $this->evening, '2026-11-02')
            ->assertCreated()
            // API ส่งเวลาเป็น UTC (ISO 8601) — เทียบเป็นเวลาไทย
            ->assertJsonPath('ends_at', fn ($v) => now()->parse($v)->setTimezone('Asia/Bangkok')->format('Y-m-d H:i') === '2026-11-03 00:00');
    }

    public function test_overlapping_shift_is_rejected(): void
    {
        $doctor = $this->doctor();
        $this->assign($doctor, $this->morning, '2026-11-02')->assertCreated();

        $this->assign($doctor, $this->morning, '2026-11-02')->assertUnprocessable()
            ->assertJsonPath('errors.shift.0', fn ($m) => str_contains($m, 'เวรซ้อน'));
    }

    public function test_short_rest_is_allowed_with_a_warning_on_both_shifts(): void
    {
        $doctor = $this->doctor();
        $morning = $this->assign($doctor, $this->morning, '2026-11-02')->assertCreated()->assertJsonPath('warnings', [])->json('id'); // 08–16

        // บ่ายวันเดียวกัน 16–24 = พัก 0 ชม. → แอดมินลงได้ แต่ได้คำเตือนกลับมา
        $evening = $this->assign($doctor, $this->evening, '2026-11-02')->assertCreated()
            ->assertJsonPath('warnings.0', fn ($m) => str_contains($m, 'พักน้อยกว่า 8'))->json('id');
        // ดึกคืนถัดไป 00–08 = พักพอดี 8 ชม. → ไม่มีคำเตือน
        $night = $this->assign($doctor, $this->night, '2026-11-04')->assertCreated()->assertJsonPath('warnings', [])->json('id');

        // ตารางเวรติดคำเตือนทั้งเวรก่อนและเวรหลัง (ชิปสีแดง) ส่วนเวรที่ไม่เกี่ยวไม่ติด
        $warnings = collect($this->getJson("/api/hospitals/{$this->hospital->id}/departments/{$this->opd->id}/roster?from=2026-11-01&to=2026-11-30")->json('shifts'))
            ->mapWithKeys(fn ($s) => [$s['id'] => $s['warnings']]);
        $this->assertStringContainsString('พักน้อยกว่า 8', $warnings[$morning][0]);
        $this->assertStringContainsString('พักน้อยกว่า 8', $warnings[$evening][0]);
        $this->assertSame([], $warnings[$night]);
    }

    public function test_weekly_hour_limit_is_allowed_with_a_warning_on_that_week(): void
    {
        $doctor = $this->doctor(); // max 40 ชม./สัปดาห์ = 5 เวร
        foreach (['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'] as $date) {
            $this->assign($doctor, $this->morning, $date)->assertCreated()->assertJsonPath('warnings', []);
        }

        $this->assign($doctor, $this->morning, '2026-11-07')->assertCreated()
            ->assertJsonPath('warnings.0', fn ($m) => str_contains($m, 'เกิน 40'));
        $this->assign($doctor, $this->morning, '2026-11-09')->assertCreated()->assertJsonPath('warnings', []); // สัปดาห์ใหม่

        $shifts = collect($this->getJson("/api/hospitals/{$this->hospital->id}/departments/{$this->opd->id}/roster?from=2026-11-01&to=2026-11-30")->json('shifts'));
        $this->assertSame(6, $shifts->filter(fn ($s) => $s['warnings'])->count()); // ทั้ง 6 เวรของสัปดาห์ที่เกิน
        $this->assertSame([], $shifts->firstWhere('shift_date', '2026-11-09')['warnings']);
    }

    public function test_unavailable_day_is_respected(): void
    {
        $doctor = $this->doctor();
        $this->postJson("/api/hospitals/{$this->hospital->id}/staff/{$doctor->id}/unavailabilities", ['date' => '2026-11-04', 'reason' => 'ลาพักร้อน'])
            ->assertCreated();

        $this->assign($doctor, $this->morning, '2026-11-04')->assertUnprocessable()
            ->assertJsonPath('errors.shift.0', fn ($m) => str_contains($m, 'ลา'));
        $this->getJson("/api/hospitals/{$this->hospital->id}/staff/{$doctor->id}/unavailabilities?from=2026-11-01&to=2026-11-30")
            ->assertOk()->assertJsonCount(1)->assertJsonPath('0.reason', 'ลาพักร้อน');
    }

    public function test_roster_reports_missing_staff_and_missing_skill(): void
    {
        $cardio = Skill::create(['code' => 'CARD', 'name' => 'Cardiology']);
        $this->morning->update(['min_staff' => 2, 'required_skill_id' => $cardio->id]);
        $this->assign($this->doctor('Dr. A'), $this->morning, '2026-11-02')->assertCreated();

        $gaps = collect($this->getJson("/api/hospitals/{$this->hospital->id}/departments/{$this->opd->id}/roster?from=2026-11-02&to=2026-11-02")
            ->assertOk()->json('gaps'));

        $this->assertStringContainsString('อย่างน้อย 2 คน', $gaps->firstWhere('shift_template_id', $this->morning->id)['problem']);
        $this->assertCount(3, $gaps); // เช้า (ขาด 1 คน) + บ่าย + ดึก ยังว่าง

        $this->getJson("/api/hospitals/{$this->hospital->id}/departments/{$this->opd->id}/roster?from=2026-10-26&to=2026-12-06")
            ->assertOk()->assertJsonPath('rules.max_weekly_hours', 40); // ช่วงปฏิทิน 6 สัปดาห์ (42 วัน) ได้
        $this->getJson("/api/hospitals/{$this->hospital->id}/departments/{$this->opd->id}/roster?from=2026-10-01&to=2026-12-31")
            ->assertStatus(422);
    }

    public function test_generate_fills_every_slot_within_the_rules_and_covers_skills(): void
    {
        $cardio = Skill::create(['code' => 'CARD', 'name' => 'Cardiology']);
        $this->morning->update(['required_skill_id' => $cardio->id]);
        $this->hospital->update(['max_weekly_hours' => 60]);
        $doctors = collect(range(1, 5))->map(fn ($i) => $this->doctor("Dr. {$i}"));
        $doctors[4]->skills()->attach($cardio);

        $result = $this->postJson("/api/hospitals/{$this->hospital->id}/departments/{$this->opd->id}/roster/generate", ['from' => '2026-11-02', 'to' => '2026-11-08'])
            ->assertOk()->json();

        $this->assertSame(21, $result['created']); // 7 วัน x 3 เวร
        $this->assertSame([], $result['gaps']);
        // ทุกเวรเช้ามีหมอหัวใจ (มีคนเดียว จึงต้องเป็น Dr. 5) และเวรรวมกระจายกัน ไม่มีใครเกิน 60 ชม.
        $mornings = collect($result['shifts'])->where('shift_template_id', $this->morning->id);
        $this->assertTrue($mornings->every(fn ($s) => $s['staff_id'] === $doctors[4]->id));
        $perDoctor = collect($result['shifts'])->countBy('staff_id');
        $this->assertLessThanOrEqual(7, $perDoctor->max());
    }

    public function test_generate_fills_a_whole_month_without_breaking_any_rule(): void
    {
        $this->hospital->update(['max_weekly_hours' => 60]);
        $this->morning->update(['min_staff' => 2]);
        $doctors = collect(range(1, 6))->map(fn ($i) => $this->doctor("Dr. {$i}"));
        $this->postJson("/api/hospitals/{$this->hospital->id}/staff/{$doctors[0]->id}/unavailabilities", ['date' => '2026-11-10'])->assertCreated();

        $result = $this->postJson("/api/hospitals/{$this->hospital->id}/departments/{$this->opd->id}/roster/generate", ['from' => '2026-11-01', 'to' => '2026-11-30'])
            ->assertOk()->json();

        $this->assertSame(30 * 4, $result['created']); // เช้า 2 + บ่าย 1 + ดึก 1 ต่อวัน
        $this->assertSame([], $result['gaps']);

        $shifts = \App\Models\Shift::orderBy('starts_at')->get();
        foreach ($shifts->groupBy('staff_id') as $own) {
            // พักอย่างน้อย 8 ชม. ระหว่างเวรต่อเนื่อง และไม่เกิน 60 ชม. ในทุกสัปดาห์
            $own->sliding(2)->each(fn ($pair) => $this->assertGreaterThanOrEqual(8 * 60, $pair->first()->ends_at->diffInMinutes($pair->last()->starts_at)));
            $own->groupBy(fn ($s) => $s->starts_at->startOfWeek()->toDateString())
                ->each(fn ($week) => $this->assertLessThanOrEqual(60, $week->count() * 8));
        }
        $this->assertFalse($shifts->contains(fn ($s) => $s->staff_id === $doctors[0]->id && $s->shift_date->toDateString() === '2026-11-10'));
        // กระจายชั่วโมงใกล้เคียงกัน: ห่างกันไม่เกิน 2 เวร
        $perDoctor = $shifts->countBy('staff_id');
        $this->assertLessThanOrEqual(2, $perDoctor->max() - $perDoctor->min());
    }

    public function test_generate_keeps_manual_shifts_and_leaves_gaps_when_rules_cannot_be_met(): void
    {
        $doctor = $this->doctor();
        $this->assign($doctor, $this->morning, '2026-11-02')->assertCreated();

        $result = $this->postJson("/api/hospitals/{$this->hospital->id}/departments/{$this->opd->id}/roster/generate", ['from' => '2026-11-02', 'to' => '2026-11-02'])
            ->assertOk()->json();

        $this->assertSame(0, $result['created']); // หมอคนเดียว พักไม่พอสำหรับบ่าย และดึกวันนั้นอยู่ก่อนเวรเช้า
        $this->assertCount(1, $result['shifts']);
        $this->assertCount(2, $result['gaps']);
    }

    public function test_doctor_sees_only_tickets_they_can_take(): void
    {
        $cardio = Skill::create(['code' => 'CARD', 'name' => 'Cardiology']);
        $pediatrics = Skill::create(['code' => 'PED', 'name' => 'Pediatrics']);
        $doctor = $this->doctor();
        $doctor->skills()->attach($cardio);
        $this->actingAsRole('nurse', $this->hospital);
        $issue = fn ($skill) => $this->postJson("/api/hospitals/{$this->hospital->id}/departments/{$this->opd->id}/tickets",
            ['patient_ref' => 'P1', 'required_skill_id' => $skill?->id])->json('id');

        $general = $issue(null);
        $heart = $issue($cardio);
        $issue($pediatrics);

        $this->actingAsDoctor($doctor);
        $this->getJson("/api/hospitals/{$this->hospital->id}/staff/{$doctor->id}/my-queue")
            ->assertOk()
            ->assertJsonCount(2, 'waiting')
            ->assertJsonPath('waiting.0.id', $general)
            ->assertJsonPath('waiting.1.id', $heart);
    }

    public function test_shifts_cannot_cross_hospitals(): void
    {
        $other = Hospital::create(['code' => 'H002', 'name' => 'Hospital 2']);
        $otherOpd = Department::create(['hospital_id' => $other->id, 'code' => 'OPD', 'name' => 'Outpatient']);
        $outsider = $this->doctor('Dr. X', $otherOpd);

        $this->assign($outsider, $this->morning, '2026-11-02')->assertNotFound();
        $shift = $this->assign($this->doctor(), $this->morning, '2026-11-02')->json('id');

        $this->actingAsRole('admin', $other); // แอดมินของโรงพยาบาลอื่น ใส่ id ของเราใน URL ของเขา → 404
        $this->deleteJson("/api/hospitals/{$other->id}/shifts/{$shift}")->assertNotFound();
        $this->getJson("/api/hospitals/{$other->id}/departments/{$this->opd->id}/roster?from=2026-11-02&to=2026-11-02")->assertNotFound();
        $this->getJson("/api/hospitals/{$this->hospital->id}/departments/{$this->opd->id}/roster?from=2026-11-02&to=2026-11-02")->assertForbidden();
    }
}
