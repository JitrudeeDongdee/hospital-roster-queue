<?php

namespace Tests\Feature;

use App\Models\Department;
use App\Models\Hospital;
use App\Models\Shift;
use App\Models\ShiftTemplate;
use App\Models\Skill;
use App\Models\Staff;
use App\Services\RosterService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ShiftRequestTest extends TestCase
{
    use RefreshDatabase;

    private Hospital $hospital;
    private Department $opd;
    private ShiftTemplate $morning;
    private ShiftTemplate $evening;
    private ShiftTemplate $night;
    private Staff $a;
    private Staff $b;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo('2026-10-27 09:00');

        $this->hospital = Hospital::create(['code' => 'H001', 'name' => 'Hospital 1', 'min_rest_hours' => 8, 'max_weekly_hours' => 60]);
        $this->opd = Department::create(['hospital_id' => $this->hospital->id, 'code' => 'OPD', 'name' => 'Outpatient']);
        [$this->morning, $this->evening, $this->night] = collect([['M', '08:00', '16:00'], ['A', '16:00', '00:00'], ['N', '00:00', '08:00']])
            ->map(fn ($t, $i) => ShiftTemplate::create([
                'department_id' => $this->opd->id, 'code' => $t[0], 'name' => $t[0],
                'start_time' => $t[1], 'end_time' => $t[2], 'min_staff' => 1, 'sort_order' => $i,
            ]))->all();
        $this->a = $this->doctor('Dr. A');
        $this->b = $this->doctor('Dr. B');
    }

    private function doctor(string $name): Staff
    {
        return Staff::create(['hospital_id' => $this->hospital->id, 'department_id' => $this->opd->id, 'name' => $name]);
    }

    private function shift(Staff $doctor, ShiftTemplate $template, string $date): Shift
    {
        return app(RosterService::class)->assign($doctor, $template, $date);
    }

    private function url(string $path = ''): string
    {
        return "/api/hospitals/{$this->hospital->id}/shift-requests{$path}";
    }

    public function test_move_to_a_free_slot_applies_at_once_when_nothing_breaks(): void
    {
        $shift = $this->shift($this->a, $this->morning, '2026-11-02');
        $this->shift($this->b, $this->morning, '2026-11-02'); // ช่องเดิมยังเหลือ B ครบขั้นต่ำ 1 คน
        $this->actingAsDoctor($this->a);

        $this->postJson($this->url(), ['shift_id' => $shift->id, 'type' => 'move', 'to_date' => '2026-11-04', 'to_template_id' => $this->evening->id])
            ->assertCreated()
            ->assertJsonPath('status', 'approved')
            ->assertJsonPath('from.date', '2026-11-02')
            ->assertJsonPath('to.date', '2026-11-04');

        $shift->refresh();
        $this->assertSame([$this->evening->id, '2026-11-04'], [$shift->shift_template_id, $shift->shift_date->toDateString()]);
    }

    public function test_move_that_leaves_the_old_slot_short_waits_for_admin(): void
    {
        $shift = $this->shift($this->a, $this->morning, '2026-11-02'); // A คนเดียว ย้ายออกแล้วช่องว่าง
        $this->actingAsDoctor($this->a);

        $id = $this->postJson($this->url(), ['shift_id' => $shift->id, 'type' => 'move', 'to_date' => '2026-11-04', 'to_template_id' => $this->morning->id])
            ->assertCreated()
            ->assertJsonPath('status', 'needs_admin')
            ->assertJsonPath('problems.0', fn ($m) => str_contains($m, 'ต้องมีแพทย์อย่างน้อย 1 คน'))
            ->json('id');
        $this->assertSame('2026-11-02', $shift->fresh()->shift_date->toDateString());

        // แอดมินยอมรับช่องที่ขาดคนได้
        $this->actingAsRole('admin', $this->hospital);
        $this->postJson($this->url("/{$id}/approve"), ['note' => 'หาคนแทนเอง'])->assertOk()->assertJsonPath('status', 'approved');
        $this->assertSame('2026-11-04', $shift->fresh()->shift_date->toDateString());
    }

    public function test_move_into_a_slot_that_breaks_the_rules_is_refused(): void
    {
        $shift = $this->shift($this->a, $this->morning, '2026-11-02');
        $this->shift($this->a, $this->morning, '2026-11-03');
        $this->actingAsDoctor($this->a);

        // บ่าย 2 พ.ย. 16–24 แล้วเช้า 3 พ.ย. 08:00 = พัก 8 ชม. พอดี (ผ่าน) · ดึก 3 พ.ย. 00–08 ชนเช้า 3 พ.ย. = พัก 0 ชม.
        $this->postJson($this->url(), ['shift_id' => $shift->id, 'type' => 'move', 'to_date' => '2026-11-03', 'to_template_id' => $this->night->id])
            ->assertUnprocessable()
            ->assertJsonPath('errors.to_date.0', fn ($m) => str_contains($m, 'พักน้อยกว่า'));
        $this->assertDatabaseCount('shift_change_requests', 0);
    }

    public function test_swap_applies_when_the_colleague_accepts(): void
    {
        $mine = $this->shift($this->a, $this->morning, '2026-11-02');
        $theirs = $this->shift($this->b, $this->morning, '2026-11-05');
        $this->actingAsDoctor($this->a);
        $id = $this->postJson($this->url(), ['shift_id' => $mine->id, 'type' => 'swap', 'target_shift_id' => $theirs->id, 'reason' => 'ติดธุระ'])
            ->assertCreated()->assertJsonPath('status', 'pending_peer')->assertJsonPath('target_staff.name', 'Dr. B')->json('id');

        // คนที่ไม่ใช่เพื่อนที่ถูกขอ ตอบแทนไม่ได้
        $this->actingAsDoctor($this->doctor('Dr. C'));
        $this->postJson($this->url("/{$id}/accept"))->assertForbidden();

        $this->actingAsDoctor($this->b);
        $this->getJson($this->url())->assertOk()->assertJsonCount(1, 'incoming');
        $this->postJson($this->url("/{$id}/accept"))->assertOk()->assertJsonPath('status', 'approved');

        $this->assertSame($this->b->id, $mine->fresh()->staff_id);
        $this->assertSame($this->a->id, $theirs->fresh()->staff_id);
    }

    public function test_swap_that_breaks_a_rule_goes_to_admin_who_must_clear_it_first(): void
    {
        $mine = $this->shift($this->a, $this->morning, '2026-11-02');
        $theirs = $this->shift($this->b, $this->morning, '2026-11-05');
        $clash = $this->shift($this->a, $this->evening, '2026-11-04'); // บ่าย 4 พ.ย. 16–24 → เช้า 5 พ.ย. พักแค่ 8 ชม. ผ่าน
        $clash->update(['ends_at' => '2026-11-05 03:00:00']); // ขยายให้ชน → พักไม่พอ
        $this->actingAsDoctor($this->a);
        $id = $this->postJson($this->url(), ['shift_id' => $mine->id, 'type' => 'swap', 'target_shift_id' => $theirs->id])
            ->assertJsonPath('problems.0', fn ($m) => str_contains($m, 'Dr. A: พักน้อยกว่า'))->json('id');

        $this->actingAsDoctor($this->b);
        $this->postJson($this->url("/{$id}/accept"))->assertOk()->assertJsonPath('status', 'needs_admin');
        $this->assertSame($this->a->id, $mine->fresh()->staff_id); // ยังไม่สลับ

        $this->actingAsRole('admin', $this->hospital);
        $this->getJson($this->url())->assertJsonCount(1, 'needs_admin');
        $this->postJson($this->url("/{$id}/approve"))->assertUnprocessable(); // ยังผิดกติกา

        $clash->delete(); // แอดมินเคลียร์ตาราง
        $this->postJson($this->url("/{$id}/approve"))->assertOk()->assertJsonPath('status', 'approved');
        $this->assertSame($this->a->id, $theirs->fresh()->staff_id);
    }

    public function test_swap_that_drops_a_required_skill_needs_admin(): void
    {
        $card = Skill::create(['code' => 'CARD', 'name' => 'Cardiology']);
        $this->morning->update(['required_skill_id' => $card->id]);
        $this->a->skills()->attach($card);
        $mine = $this->shift($this->a, $this->morning, '2026-11-02');
        $theirs = $this->shift($this->b, $this->evening, '2026-11-05');

        $this->actingAsDoctor($this->a);
        $id = $this->postJson($this->url(), ['shift_id' => $mine->id, 'type' => 'swap', 'target_shift_id' => $theirs->id])->json('id');
        $this->actingAsDoctor($this->b);
        $this->postJson($this->url("/{$id}/accept"))
            ->assertJsonPath('status', 'needs_admin')
            ->assertJsonPath('problems.0', fn ($m) => str_contains($m, 'ความเชี่ยวชาญ'));
    }

    public function test_declined_and_cancelled_requests(): void
    {
        $mine = $this->shift($this->a, $this->morning, '2026-11-02');
        $theirs = $this->shift($this->b, $this->morning, '2026-11-05');
        $this->actingAsDoctor($this->a);
        $first = $this->postJson($this->url(), ['shift_id' => $mine->id, 'type' => 'swap', 'target_shift_id' => $theirs->id])->json('id');
        // เวรเดียวกันมีคำขอค้างได้ทีละอัน
        $this->postJson($this->url(), ['shift_id' => $mine->id, 'type' => 'swap', 'target_shift_id' => $theirs->id])->assertUnprocessable();

        $this->actingAsDoctor($this->b);
        $this->postJson($this->url("/{$first}/decline"))->assertOk()->assertJsonPath('status', 'declined');

        $this->actingAsDoctor($this->a);
        $second = $this->postJson($this->url(), ['shift_id' => $mine->id, 'type' => 'swap', 'target_shift_id' => $theirs->id])->assertCreated()->json('id');
        $this->deleteJson($this->url("/{$second}"))->assertNoContent();
        $this->assertSame($this->a->id, $mine->fresh()->staff_id);
    }

    public function test_doctor_cannot_request_for_someone_elses_or_a_past_shift(): void
    {
        $theirs = $this->shift($this->b, $this->morning, '2026-11-02');
        $past = $this->shift($this->a, $this->morning, '2026-10-20');
        $this->actingAsDoctor($this->a);

        $this->postJson($this->url(), ['shift_id' => $theirs->id, 'type' => 'move', 'to_date' => '2026-11-04', 'to_template_id' => $this->morning->id])->assertForbidden();
        $this->postJson($this->url(), ['shift_id' => $past->id, 'type' => 'move', 'to_date' => '2026-11-04', 'to_template_id' => $this->morning->id])
            ->assertUnprocessable()->assertJsonValidationErrors('shift_id');

        // พยาบาลไม่มีสิทธิ์ขอ · แอดมินไม่มีสิทธิ์ตอบแทนเพื่อน
        $this->actingAsRole('nurse', $this->hospital);
        $this->getJson($this->url())->assertForbidden();
    }

    public function test_preferences_are_saved_per_month_and_locked_once_the_roster_exists(): void
    {
        $url = "/api/hospitals/{$this->hospital->id}/staff/{$this->a->id}/preferences";
        $this->actingAsDoctor($this->a);

        $this->putJson("{$url}?month=2026-12", ['items' => [
            ['date' => '2026-12-01', 'shift_template_id' => $this->morning->id, 'kind' => 'prefer'],
            ['date' => '2026-12-02', 'shift_template_id' => $this->night->id, 'kind' => 'avoid'],
        ]])->assertOk()->assertJsonPath('locked', false)->assertJsonCount(2, 'items');

        // ส่งวันนอกเดือน / ของคนอื่น ไม่ได้
        $this->putJson("{$url}?month=2026-12", ['items' => [['date' => '2027-01-01', 'shift_template_id' => $this->morning->id, 'kind' => 'prefer']]])->assertUnprocessable();
        $this->actingAsDoctor($this->b);
        $this->putJson("{$url}?month=2026-12", ['items' => []])->assertForbidden();

        $this->shift($this->b, $this->morning, '2026-12-10'); // แผนกเริ่มจัดเวรเดือนนี้แล้ว
        $this->actingAsDoctor($this->a);
        $this->getJson("{$url}?month=2026-12")->assertJsonPath('locked', true);
        $this->putJson("{$url}?month=2026-12", ['items' => []])->assertUnprocessable()->assertJsonValidationErrors('month');
    }

    public function test_generator_puts_doctors_on_shifts_they_prefer_and_avoids_the_others(): void
    {
        $c = $this->doctor('Dr. C');
        $wish = function (Staff $doctor, array $items) {
            $this->actingAsDoctor($doctor);
            $this->putJson("/api/hospitals/{$this->hospital->id}/staff/{$doctor->id}/preferences?month=2026-12", ['items' => $items])->assertOk();
        };
        $wish($this->b, [['date' => '2026-12-01', 'shift_template_id' => $this->morning->id, 'kind' => 'prefer']]);
        $wish($c, [['date' => '2026-12-01', 'shift_template_id' => $this->night->id, 'kind' => 'prefer']]);
        $wish($this->a, [['date' => '2026-12-01', 'shift_template_id' => $this->evening->id, 'kind' => 'avoid']]);

        $this->actingAsRole('admin', $this->hospital);
        $roster = $this->postJson("/api/hospitals/{$this->hospital->id}/departments/{$this->opd->id}/roster/generate", ['from' => '2026-12-01', 'to' => '2026-12-01'])
            ->assertOk()
            ->assertJsonPath('preference_stats.prefer_met', 2)
            ->assertJsonPath('preference_stats.avoid_used', 0)
            ->json('shifts');

        $who = collect($roster)->mapWithKeys(fn ($s) => [$s['shift_template_id'] => $s['staff_id']]);
        $this->assertSame($this->b->id, $who[$this->morning->id]);
        $this->assertSame($c->id, $who[$this->night->id]);
        $this->assertNotSame($this->a->id, $who[$this->evening->id]);
    }

    public function test_generator_keeps_a_doctor_free_for_the_shift_they_asked_for(): void
    {
        // A อยากลงดึก 2 ธ.ค. (00–08) · เวรเช้า 1 ธ.ค. ไม่ชน แต่เวรบ่าย 1 ธ.ค. (16–24) จะทำให้พักไม่พอ
        // ถ้าไม่ระวัง A (id น้อยสุด ชั่วโมงเท่ากัน) จะได้บ่าย 1 ธ.ค. ไปก่อน แล้วลงดึกที่อยากได้ไม่ได้
        $this->doctor('Dr. C');
        $this->actingAsDoctor($this->a);
        $this->putJson("/api/hospitals/{$this->hospital->id}/staff/{$this->a->id}/preferences?month=2026-12", ['items' => [
            ['date' => '2026-12-02', 'shift_template_id' => $this->night->id, 'kind' => 'prefer'],
        ]])->assertOk();

        $this->actingAsRole('admin', $this->hospital);
        $this->postJson("/api/hospitals/{$this->hospital->id}/departments/{$this->opd->id}/roster/generate", ['from' => '2026-12-01', 'to' => '2026-12-02'])
            ->assertOk()
            ->assertJsonPath('preference_stats.prefer_met', 1)
            ->assertJsonCount(0, 'gaps');
    }
}
