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
    protected $signature = 'queue:seed-demo {--hospitals=15} {--tickets=200000} {--days=30} {--batch=1000} {--today=600}';

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

        $this->seedToday($departments, $skills, (int) $this->option('today'));
        $this->info(sprintf('Inserted %d tickets for %d departments in %.1fs', $total, $departments->count(), microtime(true) - $started));

        return self::SUCCESS;
    }

    // คิวที่ยังรออยู่ของวันนี้ ให้หน้าเว็บมีอะไรให้เรียก — ตั้ง queue_counters ให้ตรง เลขคิวที่ออกต่อจะได้ไม่ชน
    private function seedToday($departments, $skills, int $count): void
    {
        $today = now()->toDateString();
        $numbers = [];
        $rows = [];

        for ($i = 0; $i < $count; $i++) {
            $department = $departments->random();
            $numbers[$department->id] = ($numbers[$department->id] ?? 0) + 1;
            $createdAt = now()->subMinutes($count - $i)->toDateTimeString();

            $rows[] = [
                'hospital_id' => $department->hospital_id,
                'department_id' => $department->id,
                'required_skill_id' => random_int(0, 3) === 0 ? $skills->random()->id : null,
                'service_date' => $today,
                'number' => $numbers[$department->id],
                'patient_ref' => 'P'.str_pad((string) random_int(1, 999999), 6, '0', STR_PAD_LEFT),
                'priority' => [0, 0, 0, 0, 0, 0, 1, 1, 2][random_int(0, 8)],
                'status' => 'waiting',
                'created_at' => $createdAt,
                'updated_at' => $createdAt,
            ];
        }

        foreach (array_chunk($rows, 1000) as $chunk) {
            DB::table('queue_tickets')->insert($chunk);
        }

        DB::table('queue_counters')->upsert(
            collect($numbers)->map(fn ($n, $id) => ['department_id' => $id, 'service_date' => $today, 'last_number' => $n])->values()->all(),
            ['department_id', 'service_date'],
            ['last_number'],
        );

        $this->info("Added {$count} waiting tickets for today");
    }
}
