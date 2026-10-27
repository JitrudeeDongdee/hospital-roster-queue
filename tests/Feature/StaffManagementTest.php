<?php

namespace Tests\Feature;

use App\Models\Department;
use App\Models\Hospital;
use App\Models\ShiftTemplate;
use App\Models\Skill;
use App\Models\Staff;
use App\Models\User;
use App\Services\RosterService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class StaffManagementTest extends TestCase
{
    use RefreshDatabase;

    private Hospital $hospital;
    private Department $opd;
    private Skill $card;
    private Skill $ped;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo('2026-11-10 09:00');
        $this->hospital = Hospital::create(['code' => 'H001', 'name' => 'Hospital 1']);
        $this->opd = Department::create(['hospital_id' => $this->hospital->id, 'code' => 'OPD', 'name' => 'ผู้ป่วยนอก']);
        $this->card = Skill::create(['code' => 'CARD', 'name' => 'อายุรกรรมหัวใจ']);
        $this->ped = Skill::create(['code' => 'PED', 'name' => 'กุมารเวชกรรม']);
    }

    private function url(string $path = ''): string
    {
        return "/api/hospitals/{$this->hospital->id}{$path}";
    }

    public function test_head_of_department_adds_a_doctor_with_skills_and_a_doctor_account(): void
    {
        $this->actingAsRole('admin', $this->hospital);

        $id = $this->postJson($this->url('/staff'), ['name' => 'นพ. ใหม่', 'department_id' => $this->opd->id, 'skill_ids' => [$this->card->id]])
            ->assertCreated()
            ->assertJsonPath('name', 'นพ. ใหม่')
            ->assertJsonPath('skills.0.code', 'CARD')
            ->json('id');

        $user = User::where('staff_id', $id)->first();
        $this->assertSame('doctor', $user->role->value);
        $this->assertSame($this->hospital->id, $user->hospital_id);
        // แพทย์ใหม่อยู่ในรายชื่อที่หน้าเว็บใช้จัดเวร
        $this->getJson($this->url('/staff'))->assertJsonPath('0.name', 'นพ. ใหม่');
    }

    public function test_edit_name_and_skills(): void
    {
        $doctor = Staff::create(['hospital_id' => $this->hospital->id, 'department_id' => $this->opd->id, 'name' => 'Dr. A']);
        $doctor->skills()->attach($this->card);
        User::create(['name' => 'Dr. A', 'email' => 'a@test.local', 'password' => 'x', 'role' => 'doctor', 'hospital_id' => $this->hospital->id, 'staff_id' => $doctor->id]);
        $this->actingAsRole('admin', $this->hospital);

        $this->patchJson($this->url("/staff/{$doctor->id}"), ['name' => 'Dr. A (หัวใจ+เด็ก)', 'skill_ids' => [$this->card->id, $this->ped->id]])
            ->assertOk()->assertJsonCount(2, 'skills');
        $this->assertSame('Dr. A (หัวใจ+เด็ก)', User::where('staff_id', $doctor->id)->value('name'));

        $this->patchJson($this->url("/staff/{$doctor->id}"), ['skill_ids' => []])->assertOk()->assertJsonCount(0, 'skills');
        $this->patchJson($this->url("/staff/{$doctor->id}"), ['skill_ids' => [999]])->assertUnprocessable();
    }

    public function test_directory_shows_month_hours_next_shift_and_pending_leave(): void
    {
        $doctor = Staff::create(['hospital_id' => $this->hospital->id, 'department_id' => $this->opd->id, 'name' => 'Dr. A']);
        $morning = ShiftTemplate::create(['department_id' => $this->opd->id, 'code' => 'M', 'name' => 'เวรเช้า', 'start_time' => '08:00', 'end_time' => '16:00', 'min_staff' => 1, 'sort_order' => 0]);
        $roster = app(RosterService::class);
        $roster->assign($doctor, $morning, '2026-11-02');
        $roster->assign($doctor, $morning, '2026-11-12');
        $doctor->unavailabilities()->create(['date' => '2026-11-20', 'status' => 'pending']);
        $this->actingAsRole('admin', $this->hospital);

        $this->getJson($this->url('/staff-directory'))->assertOk()
            ->assertJsonPath('0.shifts_this_month', 2)
            ->assertJsonPath('0.hours_this_month', 16)
            ->assertJsonPath('0.next_shift.date', '2026-11-12')
            ->assertJsonPath('0.pending_leave', 1);
    }

    public function test_only_head_of_department_manages_doctors_of_their_own_hospital(): void
    {
        $other = Hospital::create(['code' => 'H002', 'name' => 'Hospital 2']);
        $otherDept = Department::create(['hospital_id' => $other->id, 'code' => 'OPD', 'name' => 'OPD']);

        foreach (['doctor', 'nurse', 'registration'] as $role) {
            $this->actingAsRole($role, $this->hospital);
            $this->getJson($this->url('/staff-directory'))->assertForbidden();
            $this->postJson($this->url('/staff'), ['name' => 'X', 'department_id' => $this->opd->id, 'skill_ids' => []])->assertForbidden();
        }

        // แอดมินเพิ่มแพทย์เข้าแผนกของโรงพยาบาลอื่นไม่ได้
        $this->actingAsRole('admin', $this->hospital);
        $this->postJson($this->url('/staff'), ['name' => 'X', 'department_id' => $otherDept->id, 'skill_ids' => []])->assertUnprocessable();
    }
}
