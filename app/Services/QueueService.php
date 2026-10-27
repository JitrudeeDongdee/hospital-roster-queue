<?php

namespace App\Services;

use App\Models\Department;
use App\Models\QueueTicket;
use App\Models\Staff;
use Illuminate\Support\Facades\DB;

class QueueService
{
    /**
     * ออกบัตรคิวใหม่ — ล็อกแถว counter ของแผนก/วัน ทำให้เลขคิวไม่ซ้ำแม้หลายเครื่องกดพร้อมกัน
     */
    public function issue(Department $department, array $data): QueueTicket
    {
        $today = now()->toDateString();

        return DB::transaction(function () use ($department, $data, $today) {
            DB::table('queue_counters')->insertOrIgnore([
                'department_id' => $department->id,
                'service_date' => $today,
                'last_number' => 0,
            ]);

            $counter = DB::table('queue_counters')
                ->where('department_id', $department->id)
                ->where('service_date', $today)
                ->lockForUpdate()
                ->first();

            $number = $counter->last_number + 1;

            DB::table('queue_counters')->where('id', $counter->id)->update(['last_number' => $number]);

            return QueueTicket::create([
                'hospital_id' => $department->hospital_id,
                'department_id' => $department->id,
                'required_skill_id' => $data['required_skill_id'] ?? null,
                'service_date' => $today,
                'number' => $number,
                'patient_ref' => $data['patient_ref'],
                'priority' => $data['priority'] ?? 0,
                'status' => QueueTicket::WAITING,
            ]);
        });
    }

    /**
     * เรียกคิวถัดไปให้เจ้าหน้าที่ — เลือกเฉพาะคิวที่ไม่ระบุความเชี่ยวชาญ หรือระบุตรงกับที่เจ้าหน้าที่มี
     * เรียงตาม priority แล้วมาก่อนได้ก่อน; SKIP LOCKED ให้หลายห้องตรวจเรียกพร้อมกันได้โดยไม่แย่งคิวเดียวกัน
     */
    public function callNext(Staff $staff): ?QueueTicket
    {
        $skillIds = $staff->skills()->pluck('skills.id');

        return DB::transaction(function () use ($staff, $skillIds) {
            $ticket = QueueTicket::query()
                ->where('department_id', $staff->department_id)
                ->where('service_date', now()->toDateString())
                ->where('status', QueueTicket::WAITING)
                ->where(fn ($q) => $q->whereNull('required_skill_id')->orWhereIn('required_skill_id', $skillIds))
                ->orderByDesc('priority')
                ->orderBy('id')
                ->lock('for update skip locked')
                ->first();

            $ticket?->update([
                'status' => QueueTicket::CALLED,
                'staff_id' => $staff->id,
                'called_at' => now(),
            ]);

            return $ticket;
        });
    }
}
