<?php

namespace Tests\Feature;

use App\Models\Department;
use App\Models\Hospital;
use App\Models\QueueTicket;
use App\Models\Skill;
use App\Models\Staff;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class QueueTest extends TestCase
{
    use RefreshDatabase;

    private function hospitalWithDepartment(string $code = 'H001'): array
    {
        $hospital = Hospital::create(['code' => $code, 'name' => "Hospital {$code}"]);
        $department = Department::create(['hospital_id' => $hospital->id, 'code' => 'OPD', 'name' => 'Outpatient']);

        return [$hospital, $department];
    }

    private function issue(Hospital $hospital, Department $department, array $data = []): array
    {
        return $this->postJson("/api/hospitals/{$hospital->id}/departments/{$department->id}/tickets",
            $data + ['patient_ref' => 'P000001'])->assertCreated()->json();
    }

    public function test_ticket_numbers_run_per_department_per_day(): void
    {
        [$hospital, $opd] = $this->hospitalWithDepartment();
        $lab = Department::create(['hospital_id' => $hospital->id, 'code' => 'LAB', 'name' => 'Laboratory']);

        $this->assertSame(1, $this->issue($hospital, $opd)['number']);
        $this->assertSame(2, $this->issue($hospital, $opd)['number']);
        $this->assertSame(1, $this->issue($hospital, $lab)['number']);
    }

    public function test_call_next_takes_higher_priority_first_then_first_come(): void
    {
        [$hospital, $opd] = $this->hospitalWithDepartment();
        $staff = Staff::create(['hospital_id' => $hospital->id, 'department_id' => $opd->id, 'name' => 'Dr. A']);

        $normal = $this->issue($hospital, $opd);
        $elderly = $this->issue($hospital, $opd, ['priority' => 1]);

        $url = "/api/hospitals/{$hospital->id}/staff/{$staff->id}/call-next";
        $this->postJson($url)->assertOk()->assertJsonPath('id', $elderly['id']);
        $this->postJson($url)->assertOk()->assertJsonPath('id', $normal['id']);
        $this->postJson($url)->assertNotFound();
    }

    public function test_call_next_only_gives_tickets_the_staff_member_has_the_skill_for(): void
    {
        [$hospital, $opd] = $this->hospitalWithDepartment();
        $cardio = Skill::create(['code' => 'CARD', 'name' => 'Cardiology']);
        $pediatrics = Skill::create(['code' => 'PED', 'name' => 'Pediatrics']);

        $cardiologist = Staff::create(['hospital_id' => $hospital->id, 'department_id' => $opd->id, 'name' => 'Dr. Heart']);
        $cardiologist->skills()->attach($cardio);
        $pediatrician = Staff::create(['hospital_id' => $hospital->id, 'department_id' => $opd->id, 'name' => 'Dr. Kid']);
        $pediatrician->skills()->attach($pediatrics);

        $heartCase = $this->issue($hospital, $opd, ['required_skill_id' => $cardio->id]);
        $childCase = $this->issue($hospital, $opd, ['required_skill_id' => $pediatrics->id]);

        $this->postJson("/api/hospitals/{$hospital->id}/staff/{$pediatrician->id}/call-next")
            ->assertOk()->assertJsonPath('id', $childCase['id']);
        $this->postJson("/api/hospitals/{$hospital->id}/staff/{$pediatrician->id}/call-next")
            ->assertNotFound(); // ไม่เอาเคสหัวใจไปให้กุมารแพทย์
        $this->postJson("/api/hospitals/{$hospital->id}/staff/{$cardiologist->id}/call-next")
            ->assertOk()->assertJsonPath('id', $heartCase['id']);
    }

    public function test_one_hospital_cannot_reach_another_hospitals_data(): void
    {
        [$hospitalA] = $this->hospitalWithDepartment('H001');
        [$hospitalB, $departmentB] = $this->hospitalWithDepartment('H002');
        $staffB = Staff::create(['hospital_id' => $hospitalB->id, 'department_id' => $departmentB->id, 'name' => 'Dr. B']);
        $ticketB = $this->issue($hospitalB, $departmentB);

        $this->postJson("/api/hospitals/{$hospitalA->id}/departments/{$departmentB->id}/tickets", ['patient_ref' => 'P1'])
            ->assertNotFound();
        $this->postJson("/api/hospitals/{$hospitalA->id}/staff/{$staffB->id}/call-next")->assertNotFound();
        $this->postJson("/api/hospitals/{$hospitalA->id}/tickets/{$ticketB['id']}/complete")->assertNotFound();
        $this->getJson("/api/hospitals/{$hospitalA->id}/tickets")->assertOk()->assertJsonCount(0, 'data');
    }

    public function test_ticket_list_uses_cursor_pagination(): void
    {
        [$hospital, $opd] = $this->hospitalWithDepartment();
        for ($i = 0; $i < 60; $i++) {
            $this->issue($hospital, $opd);
        }

        $first = $this->getJson("/api/hospitals/{$hospital->id}/tickets")->assertOk()->assertJsonCount(50, 'data');
        $this->assertNotNull($first->json('next_cursor'));

        $this->getJson("/api/hospitals/{$hospital->id}/tickets?cursor={$first->json('next_cursor')}")
            ->assertOk()->assertJsonCount(10, 'data');
    }

    public function test_complete_requires_a_called_ticket(): void
    {
        [$hospital, $opd] = $this->hospitalWithDepartment();
        $staff = Staff::create(['hospital_id' => $hospital->id, 'department_id' => $opd->id, 'name' => 'Dr. A']);
        $ticket = $this->issue($hospital, $opd);

        $this->postJson("/api/hospitals/{$hospital->id}/tickets/{$ticket['id']}/complete")->assertStatus(422);
        $this->postJson("/api/hospitals/{$hospital->id}/staff/{$staff->id}/call-next")->assertOk();
        $this->postJson("/api/hospitals/{$hospital->id}/tickets/{$ticket['id']}/complete")
            ->assertOk()->assertJsonPath('status', QueueTicket::COMPLETED);
    }

    public function test_daily_stats_are_aggregated_and_rerunnable(): void
    {
        $this->artisan('queue:seed-demo', ['--hospitals' => 2, '--tickets' => 3000, '--days' => 3, '--batch' => 500])
            ->assertSuccessful();

        $from = now()->subDays(3)->toDateString();
        $to = now()->subDay()->toDateString();
        $this->artisan('queue:aggregate-stats', ['--from' => $from, '--to' => $to])->assertSuccessful();
        $this->artisan('queue:aggregate-stats', ['--from' => $from, '--to' => $to])->assertSuccessful();

        $this->assertDatabaseCount('daily_queue_stats', 2 * 3 * 3); // 2 โรงพยาบาล x 3 แผนก x 3 วัน — รันซ้ำไม่เพิ่มแถว
        $this->assertSame(3000, (int) \DB::table('daily_queue_stats')->sum('total_tickets'));

        $hospital = Hospital::first();
        $this->getJson("/api/hospitals/{$hospital->id}/stats?from={$from}&to={$to}")
            ->assertOk()->assertJsonCount(3 * 3);
    }

    public function test_purge_deletes_only_old_tickets(): void
    {
        $this->artisan('queue:seed-demo', ['--hospitals' => 1, '--tickets' => 1200, '--days' => 30, '--batch' => 500]);
        $old = QueueTicket::where('service_date', '<', now()->subDays(10)->toDateString())->count();

        $this->artisan('queue:purge', ['--days' => 10, '--chunk' => 100])->assertSuccessful();

        $this->assertSame(1200 - $old, QueueTicket::count());
    }
}
