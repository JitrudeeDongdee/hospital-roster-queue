<?php

namespace App\Http\Controllers;

use App\Models\Appointment;
use App\Models\Hospital;
use App\Models\QueueTicket;
use App\Models\Staff;
use App\Services\QueueService;
use Illuminate\Http\Request;

// ฟังก์ชันเสริม: หมอดูได้ตลอดว่ามีคิวไหนที่ตัวเองรับได้ (แผนกเดียวกัน + ความเชี่ยวชาญตรง) และเวรถัดไปของตัวเอง
class DoctorQueueController extends Controller
{
    // GET /api/hospitals/{hospital}/staff/{staff}/my-queue
    public function show(Request $request, Hospital $hospital, Staff $staff, QueueService $queue)
    {
        // แพทย์ดูได้เฉพาะของตัวเอง · แอดมิน/พยาบาลดูของแพทย์คนไหนก็ได้ในโรงพยาบาล
        $user = $request->user();
        abort_if($user->staff_id !== null && $user->staff_id !== $staff->id, 403, 'ดูได้เฉพาะคิวของตัวเอง');

        // ลำดับเดียวกับตอนกดเรียก (QueueService::eligibleFor) — คิวแรกคือคิวที่จะถูกเรียกจริง
        $waiting = $queue->eligibleFor($staff)->limit(20)
            ->get(['id', 'number', 'priority', 'required_skill_id', 'created_at', 'appointment_at']);

        return [
            'current' => QueueTicket::where('staff_id', $staff->id)->where('status', QueueTicket::CALLED)->latest('called_at')->first(),
            'waiting' => $waiting,
            // นัดของแพทย์คนนี้วันนี้ที่ยังไม่ check-in
            'appointments_left' => Appointment::where('staff_id', $staff->id)->whereDate('slot_start', now()->toDateString())->where('status', Appointment::BOOKED)->count(),
            'next_shifts' => $staff->shifts()
                ->with('template:id,code,name')
                ->where('ends_at', '>', now())
                ->orderBy('starts_at')
                ->limit(5)
                ->get(['id', 'shift_template_id', 'shift_date', 'starts_at', 'ends_at']),
        ];
    }
}
