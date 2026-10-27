<?php

namespace App\Http\Controllers;

use App\Models\Hospital;
use App\Models\QueueTicket;
use App\Models\Staff;

// ฟังก์ชันเสริม: หมอดูได้ตลอดว่ามีคิวไหนที่ตัวเองรับได้ (แผนกเดียวกัน + ความเชี่ยวชาญตรง) และเวรถัดไปของตัวเอง
class DoctorQueueController extends Controller
{
    // GET /api/hospitals/{hospital}/staff/{staff}/my-queue
    public function show(Hospital $hospital, Staff $staff)
    {
        $skillIds = $staff->skills()->pluck('skills.id');
        $today = now()->toDateString();

        $waiting = QueueTicket::query()
            ->where('department_id', $staff->department_id)
            ->where('service_date', $today)
            ->where('status', QueueTicket::WAITING)
            ->where(fn ($q) => $q->whereNull('required_skill_id')->orWhereIn('required_skill_id', $skillIds))
            ->orderByDesc('priority')->orderBy('id')
            ->limit(20)
            ->get(['id', 'number', 'priority', 'required_skill_id', 'created_at']);

        return [
            'current' => QueueTicket::where('staff_id', $staff->id)->where('status', QueueTicket::CALLED)->latest('called_at')->first(),
            'waiting' => $waiting,
            'next_shifts' => $staff->shifts()
                ->with('template:id,code,name')
                ->where('ends_at', '>', now())
                ->orderBy('starts_at')
                ->limit(5)
                ->get(['id', 'shift_template_id', 'shift_date', 'starts_at', 'ends_at']),
        ];
    }
}
