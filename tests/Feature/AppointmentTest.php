<?php

namespace Tests\Feature;

use App\Models\Appointment;
use App\Models\Department;
use App\Models\Hospital;
use App\Models\ShiftTemplate;
use App\Models\Staff;
use App\Services\RosterService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AppointmentTest extends TestCase
{
    use RefreshDatabase;

    private Hospital $hospital;
    private Department $opd;
    private Staff $a;
    private Staff $b;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo('2026-11-02 07:00'); // วันจันทร์ ก่อนเปิดรับนัด
        $this->hospital = Hospital::create(['code' => 'H001', 'name' => 'Hospital 1', 'appointments_per_doctor' => 2]);
        $this->opd = Department::create(['hospital_id' => $this->hospital->id, 'code' => 'OPD', 'name' => 'ผู้ป่วยนอก', 'queue_prefix' => 1]);
        $morning = ShiftTemplate::create(['department_id' => $this->opd->id, 'code' => 'M', 'name' => 'เวรเช้า', 'start_time' => '08:00', 'end_time' => '16:00', 'min_staff' => 1, 'sort_order' => 0]);
        $this->a = Staff::create(['hospital_id' => $this->hospital->id, 'department_id' => $this->opd->id, 'name' => 'Dr. A']);
        $this->b = Staff::create(['hospital_id' => $this->hospital->id, 'department_id' => $this->opd->id, 'name' => 'Dr. B']);
        app(RosterService::class)->assign($this->a, $morning, '2026-11-02');
        app(RosterService::class)->assign($this->b, $morning, '2026-11-02');
    }

    private function book(array $data = []): \Illuminate\Testing\TestResponse
    {
        return $this->postJson("/api/hospitals/{$this->hospital->id}/departments/{$this->opd->id}/appointments", $data + ['patient_ref' => 'HN0001', 'slot_start' => '2026-11-02 09:00']);
    }

    public function test_slots_follow_the_roster_and_capacity_is_doctors_times_quota(): void
    {
        $this->actingAsRole('registration', $this->hospital);
        $slots = collect($this->getJson("/api/hospitals/{$this->hospital->id}/departments/{$this->opd->id}/appointment-slots?date=2026-11-02")->assertOk()->json());

        $this->assertCount(16, $slots); // 08:00–16:00 ทุก 30 นาที
        $this->assertSame(4, $slots->firstWhere('start', '2026-11-02 09:00')['capacity']); // แพทย์ 2 คน × 2 นัด
        // วันที่ไม่มีใครอยู่เวร = ความจุ 0
        $this->assertSame(0, collect($this->getJson("/api/hospitals/{$this->hospital->id}/departments/{$this->opd->id}/appointment-slots?date=2026-11-03")->json())->sum('capacity'));
    }

    public function test_booking_respects_slot_capacity_per_doctor_and_the_roster(): void
    {
        $this->actingAsRole('registration', $this->hospital);
        $this->book(['staff_id' => $this->a->id])->assertCreated()->assertJsonPath('status', 'booked')->assertJsonPath('staff_name', 'Dr. A');
        $this->book(['staff_id' => $this->a->id])->assertCreated();
        $this->book(['staff_id' => $this->a->id])->assertUnprocessable()->assertJsonPath('errors.slot_start.0', fn ($m) => str_contains($m, 'ครบ 2 คน'));
        $this->book()->assertCreated();
        $this->book()->assertCreated();
        $this->book()->assertUnprocessable()->assertJsonPath('errors.slot_start.0', fn ($m) => str_contains($m, 'นัดเต็ม'));

        $this->book(['slot_start' => '2026-11-03 09:00'])->assertUnprocessable()->assertJsonPath('errors.slot_start.0', fn ($m) => str_contains($m, 'ไม่มีแพทย์อยู่เวร'));
        $this->book(['slot_start' => '2026-11-02 09:10'])->assertUnprocessable();
        $this->book(['slot_start' => '2026-11-02 17:00'])->assertUnprocessable();
    }

    public function test_check_in_issues_a_ticket_and_due_appointments_go_before_walk_ins(): void
    {
        $this->actingAsRole('registration', $this->hospital);
        $appt = $this->book(['slot_start' => '2026-11-02 08:30'])->json('id');

        $this->travelTo('2026-11-02 08:05');
        $walkIn = $this->postJson("/api/hospitals/{$this->hospital->id}/departments/{$this->opd->id}/tickets", ['patient_ref' => 'W1'])->json('id');
        $checkIn = $this->postJson("/api/hospitals/{$this->hospital->id}/appointments/{$appt}/check-in")->assertOk()
            ->assertJsonPath('late', false)->assertJsonPath('appointment.status', 'checked_in')->json();
        $this->assertSame(2, $checkIn['ticket']['number']); // เลขคิวชุดเดียวกับ walk-in

        // 08:05 นัด 08:30 ยังไม่ถึงเวลา (ก่อนไม่เกิน 15 นาที) → walk-in ที่มาก่อนได้ก่อน
        $this->actingAsDoctor($this->a);
        $call = "/api/hospitals/{$this->hospital->id}/staff/{$this->a->id}/call-next";
        $this->postJson($call)->assertOk()->assertJsonPath('id', $walkIn);
        $this->postJson("/api/hospitals/{$this->hospital->id}/tickets/{$walkIn}/complete")->assertOk();

        // 08:20 นัดถึงเวลาแล้ว → มาก่อน walk-in คนใหม่ที่ออกบัตรก่อนหน้า
        $this->actingAsRole('registration', $this->hospital);
        $walkIn2 = $this->postJson("/api/hospitals/{$this->hospital->id}/departments/{$this->opd->id}/tickets", ['patient_ref' => 'W2'])->json('id');
        $this->travelTo('2026-11-02 08:20');
        $this->actingAsDoctor($this->a);
        $this->postJson($call)->assertOk()->assertJsonPath('id', $checkIn['ticket']['id']);
    }

    public function test_urgent_walk_in_still_goes_first_and_a_named_doctor_appointment_waits_for_that_doctor(): void
    {
        $this->actingAsRole('nurse', $this->hospital);
        $appt = $this->book(['slot_start' => '2026-11-02 08:00', 'staff_id' => $this->b->id])->json('id');
        $this->travelTo('2026-11-02 08:00');
        $this->postJson("/api/hospitals/{$this->hospital->id}/appointments/{$appt}/check-in")->assertOk();
        $urgent = $this->postJson("/api/hospitals/{$this->hospital->id}/departments/{$this->opd->id}/tickets", ['patient_ref' => 'U1', 'priority' => 2])->json('id');

        // แพทย์ A: ได้เคสเร่งด่วน แล้วไม่มีคิวอื่น (นัดนี้เป็นของแพทย์ B)
        $this->actingAsDoctor($this->a);
        $this->postJson("/api/hospitals/{$this->hospital->id}/staff/{$this->a->id}/call-next")->assertOk()->assertJsonPath('id', $urgent);
        $this->postJson("/api/hospitals/{$this->hospital->id}/tickets/{$urgent}/complete")->assertOk();
        $this->postJson("/api/hospitals/{$this->hospital->id}/staff/{$this->a->id}/call-next")->assertNotFound();
        $this->actingAsDoctor($this->b);
        $this->postJson("/api/hospitals/{$this->hospital->id}/staff/{$this->b->id}/call-next")->assertOk()->assertJsonPath('appointment_at', fn ($v) => $v !== null);
    }

    public function test_late_check_in_becomes_walk_in_and_missed_appointments_become_no_show(): void
    {
        $this->actingAsRole('registration', $this->hospital);
        $late = $this->book(['slot_start' => '2026-11-02 08:00'])->json('id');
        $missed = $this->book(['slot_start' => '2026-11-02 08:30'])->json('id');
        $cancel = $this->book(['slot_start' => '2026-11-02 10:00'])->json('id');

        $this->travelTo('2026-11-02 09:15'); // สายเกิน 08:30 + 30 นาที
        $this->postJson("/api/hospitals/{$this->hospital->id}/appointments/{$late}/check-in")->assertOk()
            ->assertJsonPath('late', true)->assertJsonPath('ticket.appointment_at', null);
        $this->postJson("/api/hospitals/{$this->hospital->id}/appointments/{$cancel}/cancel")->assertOk()->assertJsonPath('status', 'cancelled');
        $this->postJson("/api/hospitals/{$this->hospital->id}/appointments/{$cancel}/check-in")->assertUnprocessable();

        $this->travelTo('2026-11-02 09:31');
        $this->artisan('appointments:mark-no-shows')->assertSuccessful();
        $this->assertSame(Appointment::NO_SHOW, Appointment::find($missed)->status);
        $this->getJson("/api/hospitals/{$this->hospital->id}/appointments?date=2026-11-02")->assertOk()
            ->assertJsonPath('counts.no_show', 1)->assertJsonPath('counts.checked_in', 1)->assertJsonPath('counts.cancelled', 1);
    }

    public function test_doctors_cannot_book(): void
    {
        $this->actingAsDoctor($this->a);
        $this->book()->assertForbidden();
        $this->getJson("/api/hospitals/{$this->hospital->id}/appointments")->assertForbidden();
    }
}
