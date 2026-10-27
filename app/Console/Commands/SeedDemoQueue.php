<?php

namespace App\Console\Commands;

use App\Models\Department;
use App\Models\Hospital;
use App\Models\ShiftPreference;
use App\Models\ShiftTemplate;
use App\Models\Skill;
use App\Models\Staff;
use App\Services\RosterService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class SeedDemoQueue extends Command
{
    protected $signature = 'queue:seed-demo {--hospitals=15} {--tickets=200000} {--days=30} {--batch=1000} {--today=600}';

    protected $description = 'Create demo hospitals, staff and a large volume of historical tickets using batched inserts';

    public function handle(): int
    {
        $started = microtime(true);

        $skills = collect([
            ['code' => 'GEN', 'name' => 'เวชปฏิบัติทั่วไป'],
            ['code' => 'CARD', 'name' => 'อายุรกรรมหัวใจ'],
            ['code' => 'PED', 'name' => 'กุมารเวชกรรม'],
            ['code' => 'US', 'name' => 'อัลตราซาวด์'],
        ])->map(fn ($s) => Skill::firstOrCreate(['code' => $s['code']], $s));

        $departments = collect();
        // ผู้ใช้ทดลองไม่มีรหัสผ่านที่ใช้ได้จริง (สุ่มแล้วทิ้ง) — เข้าได้ทาง demo-login เท่านั้น
        $unusablePassword = Hash::make(Str::random(40));
        $users = [];

        for ($h = 1; $h <= (int) $this->option('hospitals'); $h++) {
            $hospital = Hospital::create(['code' => sprintf('H%03d', $h), 'name' => "Demo Hospital {$h}"]);

            foreach ([['OPD', 'ผู้ป่วยนอก'], ['LAB', 'ห้องแล็บ'], ['XRAY', 'เอกซเรย์']] as $i => [$code, $name]) {
                $department = Department::create(['hospital_id' => $hospital->id, 'code' => $code, 'name' => $name, 'queue_prefix' => $i + 1]);
                $departments->push($department);

                foreach ([['M', 'เวรเช้า', '08:00', '16:00', 2], ['A', 'เวรบ่าย', '16:00', '00:00', 1], ['N', 'เวรดึก', '00:00', '08:00', 1]] as $i => [$tc, $tn, $from, $to, $min]) {
                    ShiftTemplate::create([
                        'department_id' => $department->id, 'code' => $tc, 'name' => $tn,
                        'start_time' => $from, 'end_time' => $to, 'min_staff' => $min, 'sort_order' => $i,
                        // OPD เวรเช้าต้องมีหมออายุรกรรมหัวใจอย่างน้อย 1 คน
                        'required_skill_id' => $code === 'OPD' && $tc === 'M' ? $skills->firstWhere('code', 'CARD')->id : null,
                    ]);
                }

                for ($s = 1; $s <= 6; $s++) {
                    $staff = Staff::create([
                        'hospital_id' => $hospital->id,
                        'department_id' => $department->id,
                        'name' => "Dr. {$code}-{$s}",
                    ]);
                    $staff->skills()->attach($skills->random(2)->pluck('id'));
                    $users[] = ['name' => $staff->name, 'email' => strtolower("{$hospital->code}.{$code}-{$s}@demo.test"), 'role' => 'doctor', 'hospital_id' => $hospital->id, 'staff_id' => $staff->id];
                }
            }

            foreach (['admin' => 'หัวหน้าแผนก', 'nurse' => 'พยาบาลคัดกรอง', 'registration' => 'เวชระเบียน'] as $role => $title) {
                $users[] = ['name' => "{$title} {$hospital->code}", 'email' => strtolower("{$hospital->code}.{$role}@demo.test"), 'role' => $role, 'hospital_id' => $hospital->id, 'staff_id' => null];
            }
        }

        DB::table('users')->insert(array_map(fn ($u) => $u + ['password' => $unusablePassword, 'created_at' => now(), 'updated_at' => now()], $users));

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
        $this->seedRoster();

        // สรุปวันที่ผ่านมาแล้วเข้า daily_queue_stats ให้ปฏิทินรายเดือนอ่านได้เลย
        $this->call('queue:aggregate-stats', ['--from' => now()->subDays($days)->toDateString(), '--to' => now()->subDay()->toDateString()]);
        $this->info(sprintf('Inserted %d tickets for %d departments in %.1fs', $total, $departments->count(), microtime(true) - $started));

        return self::SUCCESS;
    }

    // โรงพยาบาลแรก: จัดเวรเดือนนี้ไว้ให้ลองขอย้าย/แลกได้เลย · เดือนหน้ายังว่าง มีแค่เวรที่แพทย์อยากลง ให้ลองจัดร่าง
    private function seedRoster(): void
    {
        $roster = app(RosterService::class);
        $nextMonth = now()->toImmutable()->addMonthNoOverflow()->startOfMonth();

        foreach (Department::where('hospital_id', Hospital::min('id'))->with('shiftTemplates', 'staff')->get() as $department) {
            $roster->generate($department, now()->startOfMonth()->toDateString(), now()->endOfMonth()->toDateString());

            $rows = [];
            foreach ($department->staff as $i => $doctor) {
                foreach ([2, 8, 14] as $offset) {
                    $template = $department->shiftTemplates[($i + $offset) % $department->shiftTemplates->count()];
                    $rows[] = ['staff_id' => $doctor->id, 'shift_template_id' => $template->id, 'date' => $nextMonth->addDays($offset + $i)->toDateString(), 'kind' => $offset === 14 ? 'avoid' : 'prefer', 'created_at' => now(), 'updated_at' => now()];
                }
            }
            ShiftPreference::insert($rows);
        }

        $this->linkTicketsToDoctorsOnDuty();
    }

    // คิวของโรงพยาบาลแรกที่ออกระหว่างมีตารางเวร: ให้คิวที่ตรวจแล้วมีชื่อแพทย์ที่อยู่เวรตอนนั้น
    // และคิววันนี้ที่ออกไปเกิน 1 ชม. ตรวจเสร็จไปครึ่งหนึ่ง — รายการคิวจะได้เห็นว่าใครดูแล
    private function linkTicketsToDoctorsOnDuty(): void
    {
        $hospitalId = Hospital::min('id');
        $shifts = DB::table('shifts')->where('hospital_id', $hospitalId)->get(['department_id', 'staff_id', 'starts_at', 'ends_at'])->groupBy('department_id');
        $tickets = DB::table('queue_tickets')->where('hospital_id', $hospitalId)->where('service_date', '>=', now()->startOfMonth()->toDateString())
            ->where(fn ($q) => $q->where('status', 'completed')->orWhere(fn ($t) => $t->where('service_date', now()->toDateString())->where('created_at', '<', now()->subHour())))
            ->get(['id', 'department_id', 'status', 'created_at']);

        foreach ($tickets as $ticket) {
            $onDuty = ($shifts[$ticket->department_id] ?? collect())->filter(fn ($s) => $s->starts_at <= $ticket->created_at && $s->ends_at > $ticket->created_at)->values();
            if ($onDuty->isEmpty() || ($ticket->status === 'waiting' && random_int(0, 1) === 0)) {
                continue;
            }
            $calledAt = now()->parse($ticket->created_at)->addMinutes(random_int(5, 45));
            DB::table('queue_tickets')->where('id', $ticket->id)->update([
                'staff_id' => $onDuty->random()->staff_id,
                'status' => 'completed',
                'called_at' => $ticket->status === 'completed' ? DB::raw('called_at') : $calledAt,
                'completed_at' => $ticket->status === 'completed' ? DB::raw('completed_at') : $calledAt->copy()->addMinutes(10),
            ]);
        }
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
            // กระจายเวลาออกบัตรระหว่าง 07:00 ถึงตอนนี้ (ถ้ายังไม่ถึง 07:30 ใช้ตั้งแต่เที่ยงคืน)
            $open = now()->setTime(7, 0);
            $start = now()->lt($open->copy()->addMinutes(30)) ? now()->startOfDay() : $open;
            $createdAt = $start->copy()->addSeconds((int) ($start->diffInSeconds(now()) * ($i + 1) / ($count + 1)))->toDateTimeString();

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
