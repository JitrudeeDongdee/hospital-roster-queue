<?php

namespace App\Services;

use App\Models\Appointment;
use App\Models\Department;
use App\Models\Shift;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * นัดหมาย: เปิดรับนัดเฉพาะช่วงที่มีแพทย์อยู่เวร · ความจุ = แพทย์ที่อยู่เวรทั้งช่วง × จำนวนนัดต่อแพทย์
 * นัดไว้ยังไม่ใช่คิว — check-in แล้วจึงออกบัตรคิว
 */
class AppointmentService
{
    public function __construct(private QueueService $queue) {}

    /** ช่วงเวลานัดของแผนกในวันหนึ่ง พร้อมความจุและจำนวนที่นัดแล้ว */
    public function slots(Department $department, string $date): array
    {
        $hospital = $department->hospital;
        $minutes = $hospital->appointment_slot_minutes;
        $open = CarbonImmutable::parse("{$date} {$hospital->appointment_open}");
        $close = CarbonImmutable::parse("{$date} {$hospital->appointment_close}");

        $shifts = Shift::where('department_id', $department->id)
            ->where('starts_at', '<', $close)->where('ends_at', '>', $open)
            ->with('staff:id,name')->get(['staff_id', 'starts_at', 'ends_at']);
        $booked = Appointment::where('department_id', $department->id)
            ->whereBetween('slot_start', [$open, $close])
            ->whereIn('status', [Appointment::BOOKED, Appointment::CHECKED_IN])
            ->get(['staff_id', 'slot_start']);

        $slots = [];
        for ($start = $open; $start < $close; $start = $start->addMinutes($minutes)) {
            $end = $start->addMinutes($minutes);
            // แพทย์ต้องอยู่เวรตลอดทั้งช่วง
            $doctors = $shifts->filter(fn (Shift $s) => $s->starts_at <= $start && $s->ends_at >= $end)->unique('staff_id');
            $inSlot = $booked->filter(fn (Appointment $a) => $a->slot_start->equalTo($start));
            $slots[] = [
                'start' => $start->format('Y-m-d H:i'),
                'end' => $end->format('Y-m-d H:i'),
                'capacity' => $doctors->count() * $hospital->appointments_per_doctor,
                'booked' => $inSlot->count(),
                'doctors' => $doctors->map(fn (Shift $s) => [
                    'id' => $s->staff_id,
                    'name' => $s->staff->name,
                    'booked' => $inSlot->where('staff_id', $s->staff_id)->count(),
                ])->values()->all(),
            ];
        }

        return $slots;
    }

    public function book(Department $department, array $data): Appointment
    {
        $hospital = $department->hospital;
        $start = CarbonImmutable::parse($data['slot_start']);
        $fail = fn (string $m) => throw ValidationException::withMessages(['slot_start' => [$m]]);

        if ($start->lessThan(now()->startOfMinute())) {
            $fail('ช่วงเวลานี้ผ่านไปแล้ว');
        }

        // ล็อกแถวแผนกกันนัดเกินความจุเมื่อหลายเครื่องลงนัดช่วงเดียวกันพร้อมกัน
        return DB::transaction(function () use ($department, $hospital, $data, $start, $fail) {
            DB::table('departments')->where('id', $department->id)->lockForUpdate()->first();
            $slot = collect($this->slots($department, $start->toDateString()))->firstWhere('start', $start->format('Y-m-d H:i'));

            if (! $slot) {
                $fail("นัดได้เฉพาะช่วง {$hospital->appointment_open}–{$hospital->appointment_close} ทุก {$hospital->appointment_slot_minutes} นาที");
            }
            if ($slot['capacity'] === 0) {
                $fail('ช่วงนี้ไม่มีแพทย์อยู่เวร');
            }
            if (! empty($data['staff_id'])) {
                $doctor = collect($slot['doctors'])->firstWhere('id', (int) $data['staff_id']);
                if (! $doctor) {
                    $fail('แพทย์ที่เลือกไม่ได้อยู่เวรตลอดช่วงนี้');
                }
                if ($doctor['booked'] >= $hospital->appointments_per_doctor) {
                    $fail("แพทย์คนนี้รับนัดช่วงนี้ครบ {$hospital->appointments_per_doctor} คนแล้ว");
                }
            }
            if ($slot['booked'] >= $slot['capacity']) {
                $fail('ช่วงนี้นัดเต็มแล้ว');
            }

            return Appointment::create([
                'hospital_id' => $department->hospital_id,
                'department_id' => $department->id,
                'staff_id' => $data['staff_id'] ?? null,
                'patient_ref' => $data['patient_ref'],
                'slot_start' => $start,
                'slot_end' => CarbonImmutable::parse($slot['end']),
                'note' => $data['note'] ?? null,
                'status' => Appointment::BOOKED,
                'source' => 'manual',
            ]);
        });
    }

    /**
     * check-in: ออกบัตรคิวที่ติดเวลานัดไว้ · มาสายเกินเกณฑ์ = เข้าคิวแบบ walk-in (ไม่ได้สิทธิ์นัด)
     *
     * @return array{0: \App\Models\QueueTicket, 1: bool} [บัตรคิว, มาสาย]
     */
    public function checkIn(Appointment $appointment, array $triage = []): array
    {
        if ($appointment->status !== Appointment::BOOKED) {
            throw ValidationException::withMessages(['appointment' => ['นัดนี้ check-in ไม่ได้ (สถานะ: '.$appointment->status.')']]);
        }
        if (! $appointment->slot_start->isToday()) {
            throw ValidationException::withMessages(['appointment' => ['check-in ได้เฉพาะนัดของวันนี้']]);
        }

        $late = now()->greaterThan($appointment->slot_end->copy()->addMinutes($appointment->department->hospital->appointment_late_minutes));

        return DB::transaction(function () use ($appointment, $triage, $late) {
            $ticket = $this->queue->issue($appointment->department, [
                'patient_ref' => $appointment->patient_ref,
                'priority' => $triage['priority'] ?? 0,
                'required_skill_id' => $triage['required_skill_id'] ?? null,
                'appointment_at' => $late ? null : $appointment->slot_start,
                'requested_staff_id' => $late ? null : $appointment->staff_id,
            ]);
            $appointment->update(['status' => Appointment::CHECKED_IN, 'ticket_id' => $ticket->id, 'checked_in_at' => now()]);

            return [$ticket, $late];
        });
    }

    /** นัดที่เลยเวลานัด + เวลาสายที่ยอมรับแล้วยังไม่ check-in = ไม่มา */
    public function markNoShows(): int
    {
        $count = 0;
        Appointment::with('department.hospital')->where('status', Appointment::BOOKED)->where('slot_end', '<', now())
            ->chunkById(500, function ($items) use (&$count) {
                foreach ($items as $a) {
                    if (now()->greaterThan($a->slot_end->copy()->addMinutes($a->department->hospital->appointment_late_minutes))) {
                        $a->update(['status' => Appointment::NO_SHOW]);
                        $count++;
                    }
                }
            });

        return $count;
    }
}
