<?php

namespace App\Http\Controllers;

use App\Models\Hospital;
use Illuminate\Http\Request;

class StatsController extends Controller
{
    // GET /api/hospitals/{hospital}/stats?from=2026-10-01&to=2026-10-27
    public function index(Request $request, Hospital $hospital)
    {
        $data = $request->validate([
            'from' => 'required|date',
            'to' => 'required|date|after_or_equal:from',
        ]);

        // อ่านจากตารางสรุปรายวัน ไม่ใช่ COUNT จาก queue_tickets
        return $hospital->dailyStats()
            ->whereBetween('service_date', [$data['from'], $data['to']])
            ->orderBy('service_date')
            ->get(['department_id', 'service_date', 'total_tickets', 'completed_tickets', 'avg_wait_seconds']);
    }
}
