<?php

namespace Tests\Feature;

use App\Models\Department;
use App\Models\Hospital;
use App\Models\ShiftTemplate;
use App\Models\Staff;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuthorizationTest extends TestCase
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

    public function test_guests_are_rejected(): void
    {
        $this->getJson($this->url('tickets'))->assertUnauthorized();
        $this->getJson('/api/me')->assertUnauthorized();
    }

    public function test_users_cannot_open_another_hospitals_routes(): void
    {
        $other = Hospital::create(['code' => 'H002', 'name' => 'Hospital 2']);
        $this->actingAsRole('admin', $other);

        $this->getJson($this->url('tickets'))->assertForbidden();
        $this->getJson($this->url('departments'))->assertForbidden();
    }

    public function test_registration_issues_plain_tickets_but_cannot_triage(): void
    {
        $this->actingAsRole('registration', $this->hospital);

        $this->postJson($this->url("departments/{$this->opd->id}/tickets"), ['patient_ref' => 'P1'])->assertCreated();
        $this->postJson($this->url("departments/{$this->opd->id}/tickets"), ['patient_ref' => 'P2', 'priority' => 2])->assertForbidden();
        $this->getJson($this->url('tickets'))->assertForbidden(); // ไม่มีสิทธิ์ดูรายการคิว

        $this->actingAsRole('nurse', $this->hospital);
        $this->postJson($this->url("departments/{$this->opd->id}/tickets"), ['patient_ref' => 'P2', 'priority' => 2])->assertCreated();
    }

    public function test_only_admins_manage_the_roster(): void
    {
        $range = 'from=2026-11-01&to=2026-11-30';
        $assign = ['staff_id' => $this->drA->id, 'shift_template_id' => $this->morning->id, 'date' => '2026-11-02'];

        foreach (['nurse', 'registration'] as $role) {
            $this->actingAsRole($role, $this->hospital);
            $this->postJson($this->url("departments/{$this->opd->id}/roster/generate"), ['from' => '2026-11-01', 'to' => '2026-11-30'])->assertForbidden();
            $this->postJson($this->url('shifts'), $assign)->assertForbidden();
        }
        $this->actingAsDoctor($this->drA);
        $this->postJson($this->url('shifts'), $assign)->assertForbidden();
        $this->getJson($this->url("departments/{$this->opd->id}/roster?{$range}"))->assertOk(); // แพทย์ดูตารางได้

        $this->actingAsRole('admin', $this->hospital);
        $this->postJson($this->url('shifts'), $assign)->assertCreated();
    }

    public function test_doctors_call_and_view_only_their_own_queue(): void
    {
        $this->actingAsRole('nurse', $this->hospital);
        $this->postJson($this->url("departments/{$this->opd->id}/tickets"), ['patient_ref' => 'P1'])->assertCreated();

        $this->actingAsDoctor($this->drA);
        $this->postJson($this->url("staff/{$this->drB->id}/call-next"))->assertForbidden();
        $this->getJson($this->url("staff/{$this->drB->id}/my-queue"))->assertForbidden();
        $ticket = $this->postJson($this->url("staff/{$this->drA->id}/call-next"))->assertOk()->json('id');

        $this->actingAsDoctor($this->drB);
        $this->postJson($this->url("tickets/{$ticket}/complete"))->assertForbidden(); // คิวของ Dr. A

        $this->actingAsRole('nurse', $this->hospital);
        $this->postJson($this->url("staff/{$this->drA->id}/call-next"))->assertForbidden(); // พยาบาลเรียกคิวไม่ได้
        $this->getJson($this->url("staff/{$this->drA->id}/my-queue"))->assertOk(); // แต่ดูคิวของแพทย์ได้
    }

    public function test_leave_days_own_for_doctors_any_for_admins(): void
    {
        $this->actingAsDoctor($this->drA);
        $this->postJson($this->url("staff/{$this->drA->id}/unavailabilities"), ['date' => '2026-11-05'])->assertCreated();
        $this->postJson($this->url("staff/{$this->drB->id}/unavailabilities"), ['date' => '2026-11-05'])->assertForbidden();

        $this->actingAsRole('admin', $this->hospital);
        $this->postJson($this->url("staff/{$this->drB->id}/unavailabilities"), ['date' => '2026-11-05'])->assertCreated();
    }

    public function test_stats_are_admin_only(): void
    {
        $this->actingAsDoctor($this->drA);
        $this->getJson($this->url('stats?from=2026-11-01&to=2026-11-30'))->assertForbidden();

        $this->actingAsRole('admin', $this->hospital);
        $this->getJson($this->url('stats?from=2026-11-01&to=2026-11-30'))->assertOk();
    }

    public function test_demo_login_issues_a_token_that_carries_the_role(): void
    {
        $user = User::create(['name' => 'Nurse', 'email' => 'n@test.local', 'password' => 'x', 'role' => 'nurse', 'hospital_id' => $this->hospital->id]);

        $token = $this->postJson('/api/demo-login', ['user_id' => $user->id])->assertOk()->json('token');

        $this->withToken($token)->getJson('/api/me')
            ->assertOk()
            ->assertJsonPath('role', 'nurse')
            ->assertJsonPath('hospital.id', $this->hospital->id)
            ->assertJsonPath('permissions', fn ($p) => in_array('ticket.triage', $p) && ! in_array('roster.manage', $p));
    }

    public function test_demo_login_is_off_unless_enabled(): void
    {
        config(['app.demo_login' => false]);

        $this->getJson('/api/demo-users')->assertNotFound();
        $this->postJson('/api/demo-login', ['user_id' => 1])->assertNotFound();
    }
}
