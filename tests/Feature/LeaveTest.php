<?php

namespace Tests\Feature;

use App\Models\Department;
use App\Models\Hospital;
use App\Models\ShiftTemplate;
use App\Models\Staff;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class LeaveTest extends TestCase
{
    use RefreshDatabase;

    private Hospital $hospital;
    private Department $opd;
    private Staff $drA;
    private Staff $drB;
    private ShiftTemplate $morning;

    protected function setUp(): void
    {
        parent::setUp();

        $this->hospital = Hospital::create(['code' => 'H001', 'name' => 'Hospital 1']);
        $this->opd = Department::create(['hospital_id' => $this->hospital->id, 'code' => 'OPD', 'name' => 'Outpatient']);
        $this->drA = Staff::create(['hospital_id' => $this->hospital->id, 'department_id' => $this->opd->id, 'name' => 'Dr. A']);
        $this->drB = Staff::create(['hospital_id' => $this->hospital->id, 'department_id' => $this->opd->id, 'name' => 'Dr. B']);
        $this->morning = ShiftTemplate::create(['department_id' => $this->opd->id, 'code' => 'M', 'name' => 'M', 'start_time' => '08:00', 'end_time' => '16:00']);
    }

    private function url(string $path): string
    {
        return "/api/hospitals/{$this->hospital->id}/{$path}";
    }

    private function request(Staff $doctor, string $date): int
    {
        $this->actingAsDoctor($doctor);

        return $this->postJson($this->url("staff/{$doctor->id}/unavailabilities"), ['date' => $date, 'reason' => 'ประชุมวิชาการ'])
            ->assertCreated()->assertJsonPath('status', 'pending')->json('id');
    }

    private function assign(Staff $doctor, string $date)
    {
        $this->actingAsRole('admin', $this->hospital);

        return $this->postJson($this->url('shifts'), ['staff_id' => $doctor->id, 'shift_template_id' => $this->morning->id, 'date' => $date]);
    }

    public function test_doctor_request_waits_for_approval_and_only_approved_leave_blocks_shifts(): void
    {
        $leave = $this->request($this->drA, '2026-11-05');

        $this->assign($this->drA, '2026-11-05')->assertCreated(); // ยังรออนุมัติ แอดมินลงเวรเองได้
        $this->deleteJson($this->url('shifts/'.\App\Models\Shift::value('id')))->assertNoContent();

        $this->postJson($this->url("leave-requests/{$leave}/approve"))->assertOk()->assertJsonPath('status', 'approved');
        $this->assign($this->drA, '2026-11-05')->assertUnprocessable()
            ->assertJsonPath('errors.shift.0', fn ($m) => str_contains($m, 'ลา'));
    }

    public function test_cannot_approve_while_the_doctor_still_has_a_shift_that_day(): void
    {
        $leave = $this->request($this->drA, '2026-11-05');
        $this->assign($this->drA, '2026-11-05')->assertCreated();

        $inbox = $this->getJson($this->url('leave-requests'))->assertOk();
        $inbox->assertJsonPath('counts.pending', 1)->assertJsonPath('data.0.has_shift', true);

        $this->postJson($this->url("leave-requests/{$leave}/approve"))->assertUnprocessable();
    }

    public function test_reject_with_a_note_and_doctor_can_request_again(): void
    {
        $leave = $this->request($this->drA, '2026-11-05');

        $this->actingAsRole('admin', $this->hospital);
        $this->postJson($this->url("leave-requests/{$leave}/reject"), ['note' => 'คนไม่พอวันนั้น'])
            ->assertOk()->assertJsonPath('status', 'rejected')->assertJsonPath('decision_note', 'คนไม่พอวันนั้น');
        $this->postJson($this->url("leave-requests/{$leave}/approve"))->assertStatus(422); // ตัดสินไปแล้ว

        $this->actingAsDoctor($this->drA);
        $this->getJson($this->url("staff/{$this->drA->id}/unavailabilities?from=2026-11-01&to=2026-11-30"))
            ->assertJsonPath('0.status', 'rejected')->assertJsonPath('0.decision_note', 'คนไม่พอวันนั้น');
        $this->assertSame($leave, $this->request($this->drA, '2026-11-05')); // ขอใหม่ = เปิดคำขอเดิมอีกครั้ง
    }

    public function test_admin_recorded_leave_is_approved_immediately(): void
    {
        $this->actingAsRole('admin', $this->hospital);

        $this->postJson($this->url("staff/{$this->drB->id}/unavailabilities"), ['date' => '2026-11-06'])
            ->assertCreated()->assertJsonPath('status', 'approved');
    }

    public function test_doctors_cancel_only_their_own_pending_requests_and_cannot_approve(): void
    {
        $leaveA = $this->request($this->drA, '2026-11-05');
        $leaveB = $this->request($this->drB, '2026-11-06');

        $this->actingAsDoctor($this->drA);
        $this->postJson($this->url("leave-requests/{$leaveA}/approve"))->assertForbidden();
        $this->getJson($this->url('leave-requests'))->assertForbidden();
        $this->deleteJson($this->url("leave-requests/{$leaveB}"))->assertForbidden();
        $this->deleteJson($this->url("leave-requests/{$leaveA}"))->assertNoContent();

        $this->actingAsRole('admin', $this->hospital);
        $this->postJson($this->url("leave-requests/{$leaveB}/approve"))->assertOk();
        $this->actingAsDoctor($this->drB);
        $this->deleteJson($this->url("leave-requests/{$leaveB}"))->assertForbidden(); // อนุมัติแล้ว ยกเลิกเองไม่ได้
    }

    public function test_auto_generate_leaves_pending_requests_free(): void
    {
        $this->request($this->drA, '2026-11-05');
        $this->actingAsRole('admin', $this->hospital);

        $result = $this->postJson($this->url("departments/{$this->opd->id}/roster/generate"), ['from' => '2026-11-05', 'to' => '2026-11-05'])->assertOk()->json();

        $this->assertSame([$this->drB->id], array_column($result['shifts'], 'staff_id'));
    }

    public function test_leave_requests_of_another_hospital_are_not_reachable(): void
    {
        $leave = $this->request($this->drA, '2026-11-05');
        $other = Hospital::create(['code' => 'H002', 'name' => 'Hospital 2']);
        $this->actingAsRole('admin', $other);

        $this->postJson("/api/hospitals/{$other->id}/leave-requests/{$leave}/approve")->assertNotFound();
        $this->getJson("/api/hospitals/{$other->id}/leave-requests")->assertOk()->assertJsonCount(0, 'data');
    }
}
