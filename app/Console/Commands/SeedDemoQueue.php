<?php

namespace App\Console\Commands;

use App\Models\Department;
use App\Models\Hospital;
use App\Models\Skill;
use App\Models\Staff;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class SeedDemoQueue extends Command
{
    protected $signature = 'queue:seed-demo {--hospitals=15} {--tickets=200000} {--days=30} {--batch=1000}';

    protected $description = 'Create demo hospitals, staff and a large volume of historical tickets using batched inserts';

    public function handle(): int
    {
        $started = microtime(true);

        $skills = collect([
            ['code' => 'GEN', 'name' => 'General practice'],
            ['code' => 'CARD', 'name' => 'Cardiology'],
            ['code' => 'PED', 'name' => 'Pediatrics'],
            ['code' => 'US', 'name' => 'Ultrasound'],
        ])->map(fn ($s) => Skill::firstOrCreate(['code' => $s['code']], $s));

        $departments = collect();

        for ($h = 1; $h <= (int) $this->option('hospitals'); $h++) {
            $hospital = Hospital::create(['code' => sprintf('H%03d', $h), 'name' => "Demo Hospital {$h}"]);

            foreach (['OPD' => 'Outpatient', 'LAB' => 'Laboratory', 'XRAY' => 'Radiology'] as $code => $name) {
                $department = Department::create(['hospital_id' => $hospital->id, 'code' => $code, 'name' => $name]);
                $departments->push($department);

                for ($s = 1; $s <= 3; $s++) {
                    $staff = Staff::create([
                        'hospital_id' => $hospital->id,
                        'department_id' => $department->id,
                        'name' => "{$code} staff {$s}",
                    ]);
                    $staff->skills()->attach($skills->random(2)->pluck('id'));
                }
            }
        }

        // ตั๋วย้อนหลัง: สร้างทีละ batch แล้ว INSERT ครั้งเดียวต่อ batch (ไม่ใช่ทีละแถว)
        $total = (int) $this->option('tickets');
        $batchSize = (int) $this->option('batch');
        $days = (int) $this->option('days');
        $numbers = [];
        $batch = [];
        $bar = $this->output->createProgressBar($total);

        for ($i = 0; $i < $total; $i++) {
            $department = $departments->random();
            $date = now()->subDays(random_int(1, $days))->toDateString();
            $key = "{$department->id}|{$date}";
            $numbers[$key] = ($numbers[$key] ?? 0) + 1;
            $createdAt = "{$date} ".sprintf('%02d:%02d:00', random_int(7, 15), random_int(0, 59));
            $calledAt = date('Y-m-d H:i:s', strtotime($createdAt) + random_int(120, 3600));

            $batch[] = [
                'hospital_id' => $department->hospital_id,
                'department_id' => $department->id,
                'service_date' => $date,
                'number' => $numbers[$key],
                'patient_ref' => 'P'.str_pad((string) random_int(1, 999999), 6, '0', STR_PAD_LEFT),
                'priority' => random_int(0, 9) === 0 ? 1 : 0,
                'status' => 'completed',
                'called_at' => $calledAt,
                'completed_at' => date('Y-m-d H:i:s', strtotime($calledAt) + random_int(300, 1200)),
                'created_at' => $createdAt,
                'updated_at' => $createdAt,
            ];

            if (count($batch) === $batchSize) {
                DB::table('queue_tickets')->insert($batch);
                $bar->advance(count($batch));
                $batch = [];
            }
        }

        if ($batch) {
            DB::table('queue_tickets')->insert($batch);
            $bar->advance(count($batch));
        }

        $bar->finish();
        $this->newLine();
        $this->info(sprintf('Inserted %d tickets for %d departments in %.1fs', $total, $departments->count(), microtime(true) - $started));

        return self::SUCCESS;
    }
}
