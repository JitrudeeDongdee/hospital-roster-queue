<?php

namespace App\Services;

use App\Models\Department;
use App\Models\QueueTicket;
use App\Models\Staff;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

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
                'appointment_at' => $data['appointment_at'] ?? null,
                'requested_staff_id' => $data['requested_staff_id'] ?? null,
            ]);
        });
    }

    /**
     * เรียกคิวถัดไปให้เจ้าหน้าที่ — เลือกเฉพาะคิวที่ไม่ระบุความเชี่ยวชาญ หรือระบุตรงกับที่เจ้าหน้าที่มี
     * เรียงตาม priority แล้วมาก่อนได้ก่อน; SKIP LOCKED ให้หลายห้องตรวจเรียกพร้อมกันได้โดยไม่แย่งคิวเดียวกัน
     */
    public function callNext(Staff $staff): ?QueueTicket
    {
        return DB::transaction(function () use ($staff) {
            // แพทย์หนึ่งคนตรวจได้ทีละคิว: ล็อกแถวของแพทย์ก่อน กันกดเรียกซ้อนสองครั้งพร้อมกัน
            Staff::whereKey($staff->id)->lockForUpdate()->first();
            if (QueueTicket::where('staff_id', $staff->id)->where('status', QueueTicket::CALLED)->exists()) {
                throw ValidationException::withMessages(['ticket' => ['ยังมีคิวที่กำลังตรวจอยู่ กดเสร็จสิ้นก่อนจึงเรียกคิวถัดไปได้']]);
            }

            $ticket = $this->eligibleFor($staff)
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

    /**
     * คิวที่แพทย์คนนี้รับได้ เรียงตามลำดับที่จะถูกเรียก — ใช้ทั้งตอนเรียกคิวและตอนแสดง "คิวถัดไป" ให้ตรงกันเสมอ
     * แผนกเดียวกัน · ความเชี่ยวชาญตรง · นัดที่ระบุแพทย์ต้องเป็นแพทย์คนนั้น
     * ลำดับ: ความเร่งด่วน → คิวนัดที่ถึงเวลา (ก่อนเวลานัดไม่เกิน N นาที) → มาก่อนได้ก่อน
     */
    public function eligibleFor(Staff $staff): Builder
    {
        $skillIds = $staff->skills()->pluck('skills.id');

        return QueueTicket::query()
            ->where('department_id', $staff->department_id)
            ->where('service_date', now()->toDateString())
            ->where('status', QueueTicket::WAITING)
            ->where(fn ($q) => $q->whereNull('required_skill_id')->orWhereIn('required_skill_id', $skillIds))
            ->where(fn ($q) => $q->whereNull('requested_staff_id')->orWhere('requested_staff_id', $staff->id))
            ->orderByDesc('priority')
            ->orderByRaw('CASE WHEN appointment_at IS NOT NULL AND appointment_at <= ? THEN 0 ELSE 1 END', [now()->addMinutes($staff->hospital->appointment_early_minutes)->toDateTimeString()])
            ->orderBy('id');
    }
}
