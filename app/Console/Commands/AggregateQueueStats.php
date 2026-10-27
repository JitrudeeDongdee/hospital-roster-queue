<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class AggregateQueueStats extends Command
{
    protected $signature = 'queue:aggregate-stats {--from=} {--to=}';

    protected $description = 'Summarise tickets into daily_queue_stats (one GROUP BY in the database, then one upsert)';

    public function handle(): int
    {
        $from = $this->option('from') ?? now()->subDay()->toDateString();
        $to = $this->option('to') ?? $from;

        $waitSeconds = DB::getDriverName() === 'sqlite'
            ? 'AVG((julianday(called_at) - julianday(created_at)) * 86400)'
            : 'AVG(TIMESTAMPDIFF(SECOND, created_at, called_at))';

        // ให้ database รวมยอดเอง — ได้กลับมาแค่ 1 แถวต่อแผนกต่อวัน ไม่ต้องดึงตั๋วทุกใบมานับใน PHP
        $rows = DB::table('queue_tickets')
            ->selectRaw("hospital_id, department_id, service_date,
                COUNT(*) AS total_tickets,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_tickets,
                {$waitSeconds} AS avg_wait_seconds")
            ->whereBetween('service_date', [$from, $to])
            ->groupBy('hospital_id', 'department_id', 'service_date')
            ->get()
            ->map(fn ($r) => [
                'hospital_id' => $r->hospital_id,
                'department_id' => $r->department_id,
                'service_date' => $r->service_date,
                'total_tickets' => (int) $r->total_tickets,
                'completed_tickets' => (int) $r->completed_tickets,
                'avg_wait_seconds' => $r->avg_wait_seconds === null ? null : (int) round($r->avg_wait_seconds),
                'created_at' => now(),
                'updated_at' => now(),
            ]);

        // รันซ้ำได้ (idempotent): แผนก+วันเดิมจะถูกอัปเดต ไม่เพิ่มแถวซ้ำ
        foreach ($rows->chunk(1000) as $chunk) {
            DB::table('daily_queue_stats')->upsert(
                $chunk->values()->all(),
                ['department_id', 'service_date'],
                ['total_tickets', 'completed_tickets', 'avg_wait_seconds', 'updated_at'],
            );
        }

        $this->info("Aggregated {$rows->count()} department-days from {$from} to {$to}");

        return self::SUCCESS;
    }
}
