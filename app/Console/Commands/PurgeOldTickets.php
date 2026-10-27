<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class PurgeOldTickets extends Command
{
    protected $signature = 'queue:purge {--days=90} {--chunk=5000}';

    protected $description = 'Delete tickets older than N days in small chunks so the table is never locked for long';

    public function handle(): int
    {
        $cutoff = now()->subDays((int) $this->option('days'))->toDateString();
        $chunk = (int) $this->option('chunk');
        $deleted = 0;

        // ลบทีละก้อนด้วย id (ใช้ primary key) — แต่ละรอบเป็น transaction สั้น ๆ ไม่ล็อกตารางนาน
        do {
            $ids = DB::table('queue_tickets')
                ->where('service_date', '<', $cutoff)
                ->orderBy('id')
                ->limit($chunk)
                ->pluck('id');

            $count = $ids->isEmpty() ? 0 : DB::table('queue_tickets')->whereIn('id', $ids)->delete();
            $deleted += $count;
        } while ($count > 0);

        $this->info("Deleted {$deleted} tickets older than {$cutoff}");

        return self::SUCCESS;
    }
}
