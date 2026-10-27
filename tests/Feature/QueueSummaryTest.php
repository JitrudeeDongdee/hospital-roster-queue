<?php

namespace Tests\Feature;

use App\Models\Department;
use App\Models\Hospital;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class QueueSummaryTest extends TestCase
{
    use RefreshDatabase;

    private Hospital $hospital;
    private Department $opd;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(now()->parse('2026-10-27 12:00:00'));

        $this->hospital = Hospital::create(['code' => 'H001', 'name' => 'Hospital 1']);
        $this->opd = Department::create(['hospital_id' => $this->hospital->id, 'code' => 'OPD', 'name' => 'Outpatient']);
    }

    private function ticket(string $date, string $time, string $status, ?int $waitMinutes = null): void
    {
        static $number = 0;
        $created = "{$date} {$time}:00";
        DB::table('queue_tickets')->insert([
            'hospital_id' => $this->hospital->id, 'department_id' => $this->opd->id, 'service_date' => $date,
            'number' => ++$number, 'patient_ref' => 'P1', 'priority' => 0, 'status' => $status,
            'called_at' => $waitMinutes === null ? null : now()->parse($created)->addMinutes($waitMinutes),
            'created_at' => $created, 'updated_at' => $created,
        ]);
    }

    private function summary(string $query)
    {
        return $this->getJson("/api/hospitals/{$this->hospital->id}/tickets/summary?{$query}");
    }

    public function test_month_view_reads_past_days_from_the_daily_summary_and_today_live(): void
    {
        $this->ticket('2026-10-26', '08:10', 'completed', 10);
        $this->ticket('2026-10-26', '08:40', 'completed', 30);
        $this->ticket('2026-10-27', '09:05', 'waiting');
        $this->ticket('2026-10-27', '09:20', 'completed', 20);
        $this->artisan('queue:aggregate-stats', ['--from' => '2026-10-26', '--to' => '2026-10-26']);
        $this->ticket('2026-10-26', '15:00', 'completed', 5); // เพิ่มหลังสรุปแล้ว → เดือนนี้ไม่เห็น (อ่านจากตารางสรุป)

        $this->actingAsRole('nurse', $this->hospital);
        $days = collect($this->summary('from=2026-10-01&to=2026-10-31&group=day')->assertOk()->json('data'))->keyBy('date');

        $this->assertSame(['total' => 2, 'completed' => 2, 'avg_wait_seconds' => 1200, 'source' => 'summary'],
            collect($days['2026-10-26'])->only('total', 'completed', 'avg_wait_seconds', 'source')->all());
        $this->assertSame(['total' => 2, 'waiting' => 1, 'completed' => 1, 'source' => 'live'],
            collect($days['2026-10-27'])->only('total', 'waiting', 'completed', 'source')->all());
    }

    public function test_week_and_day_views_group_by_hour_of_issue(): void
    {
        $this->ticket('2026-10-27', '08:05', 'completed', 15);
        $this->ticket('2026-10-27', '08:50', 'waiting');
        $this->ticket('2026-10-27', '10:15', 'called', 5);

        $this->actingAsRole('admin', $this->hospital);
        $hours = $this->summary('from=2026-10-26&to=2026-11-01&group=hour')->assertOk()->json('data');

        $this->assertSame([[8, 2, 1, 1], [10, 1, 0, 0]], array_map(fn ($h) => [$h['hour'], $h['total'], $h['waiting'], $h['completed']], $hours));
    }

    public function test_ranges_are_bounded_and_registration_cannot_read(): void
    {
        $this->actingAsRole('admin', $this->hospital);
        $this->summary('from=2026-10-01&to=2026-11-30&group=day')->assertStatus(422);
        $this->summary('from=2026-10-01&to=2026-10-31&group=hour')->assertStatus(422);

        $this->actingAsRole('registration', $this->hospital);
        $this->summary('from=2026-10-01&to=2026-10-31&group=day')->assertForbidden();
    }
}
