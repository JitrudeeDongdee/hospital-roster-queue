<?php

namespace App\Http\Controllers;

use App\Models\Appointment;
use App\Models\Department;
use App\Models\Hospital;
use App\Services\AppointmentService;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

// นัดหมาย: เวชระเบียน/พยาบาล/หัวหน้าแผนก ลงนัด · check-in แล้วออกบัตรคิว · ยกเลิก
class AppointmentController extends Controller
{
    public function __construct(private AppointmentService $appointments) {}

    // GET /api/hospitals/{hospital}/appointments?date=&department_id=
    public function index(Request $request, Hospital $hospital)
    {
        $data = $request->validate(['date' => 'nullable|date_format:Y-m-d', 'department_id' => 'nullable|integer']);
        $date = $data['date'] ?? now()->toDateString();

        $list = $hospital->appointments()
            ->with('staff:id,name', 'ticket:id,number,status')
            ->whereDate('slot_start', $date)
            ->when($data['department_id'] ?? null, fn ($q, $id) => $q->where('department_id', $id))
            ->orderBy('slot_start')->orderBy('id')
            ->get();

        return [
            'date' => $date,
            'counts' => $list->countBy('status'),
            'data' => $list->map(fn (Appointment $a) => $this->present($a))->values(),
        ];
    }

    // GET /api/hospitals/{hospital}/departments/{department}/appointment-slots?date=
    public function slots(Request $request, Hospital $hospital, Department $department)
    {
        $date = $request->validate(['date' => 'required|date_format:Y-m-d'])['date'];

        return $this->appointments->slots($department, $date);
    }

    // POST /api/hospitals/{hospital}/departments/{department}/appointments {patient_ref, slot_start, staff_id?, note?}
    public function store(Request $request, Hospital $hospital, Department $department)
    {
        $data = $request->validate([
            'patient_ref' => 'required|string|max:64',
            'slot_start' => 'required|date_format:Y-m-d H:i',
            'staff_id' => ['nullable', 'integer', Rule::exists('staff', 'id')->where('department_id', $department->id)],
            'note' => 'nullable|string|max:200',
        ]);

        return response()->json($this->present($this->appointments->book($department, $data)->load('staff:id,name')), 201);
    }

    // POST /api/hospitals/{hospital}/appointments/{appointment}/check-in {priority?, required_skill_id?}
    public function checkIn(Request $request, Hospital $hospital, Appointment $appointment)
    {
        $triage = $request->validate(['priority' => 'nullable|integer|in:0,1,2', 'required_skill_id' => 'nullable|integer|exists:skills,id']);
        abort_if((($triage['priority'] ?? 0) > 0 || ! empty($triage['required_skill_id'])) && $request->user()->cannot('ticket.triage'), 403, 'ต้องเป็นพยาบาลคัดกรองจึงกำหนดความเร่งด่วน/ความเชี่ยวชาญได้');

        [$ticket, $late] = $this->appointments->checkIn($appointment, $triage);

        return ['appointment' => $this->present($appointment->fresh(['staff:id,name', 'ticket:id,number,status'])), 'ticket' => $ticket, 'late' => $late];
    }

    // POST /api/hospitals/{hospital}/appointments/{appointment}/cancel
    public function cancel(Hospital $hospital, Appointment $appointment)
    {
        abort_unless($appointment->status === Appointment::BOOKED, 422, 'ยกเลิกได้เฉพาะนัดที่ยังไม่ check-in');
        $appointment->update(['status' => Appointment::CANCELLED]);

        return $this->present($appointment->fresh(['staff:id,name']));
    }

    private function present(Appointment $a): array
    {
        return [
            'id' => $a->id,
            'department_id' => $a->department_id,
            'staff_id' => $a->staff_id,
            'staff_name' => $a->staff?->name,
            'patient_ref' => $a->patient_ref,
            'slot_start' => $a->slot_start->format('Y-m-d H:i'),
            'slot_end' => $a->slot_end->format('Y-m-d H:i'),
            'status' => $a->status,
            'source' => $a->source,
            'note' => $a->note,
            'ticket' => $a->ticket ? ['id' => $a->ticket->id, 'number' => $a->ticket->number, 'status' => $a->ticket->status] : null,
            'checked_in_at' => $a->checked_in_at,
        ];
    }
}
