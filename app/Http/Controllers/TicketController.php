<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreTicketRequest;
use App\Models\Department;
use App\Models\Hospital;
use App\Models\QueueTicket;
use App\Models\Staff;
use App\Services\QueueService;
use Illuminate\Http\Request;

class TicketController extends Controller
{
    public function __construct(private QueueService $queue) {}

    // GET /api/hospitals/{hospital}/tickets?status=waiting&date=2026-10-27&cursor=...
    public function index(Request $request, Hospital $hospital)
    {
        $request->validate([
            'status' => 'nullable|in:waiting,called,completed',
            'date' => 'nullable|date',
        ]);

        return $hospital->tickets()
            ->select(['id', 'department_id', 'number', 'priority', 'status', 'staff_id', 'service_date', 'created_at', 'called_at'])
            ->where('service_date', $request->input('date', now()->toDateString()))
            ->when($request->status, fn ($q, $status) => $q->where('status', $status))
            ->orderBy('id')
            ->cursorPaginate(50); // keyset: WHERE id > ? แทน OFFSET จึงเร็วเท่าเดิมแม้หน้าลึก
    }

    // POST /api/hospitals/{hospital}/departments/{department}/tickets
    public function store(StoreTicketRequest $request, Hospital $hospital, Department $department)
    {
        return response()->json($this->queue->issue($department, $request->validated()), 201);
    }

    // POST /api/hospitals/{hospital}/staff/{staff}/call-next
    public function callNext(Hospital $hospital, Staff $staff)
    {
        abort_unless($staff->is_active, 422, 'Staff is not active.');

        $ticket = $this->queue->callNext($staff);

        return $ticket
            ? response()->json($ticket)
            : response()->json(['message' => 'No waiting tickets for this staff member.'], 404);
    }

    // POST /api/hospitals/{hospital}/tickets/{ticket}/complete
    public function complete(Hospital $hospital, QueueTicket $ticket)
    {
        abort_unless($ticket->status === QueueTicket::CALLED, 422, 'Ticket has not been called.');

        $ticket->update(['status' => QueueTicket::COMPLETED, 'completed_at' => now()]);

        return $ticket;
    }
}
