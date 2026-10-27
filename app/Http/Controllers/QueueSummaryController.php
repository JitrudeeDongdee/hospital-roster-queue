<?php

namespace App\Http\Controllers;

use App\Models\Hospital;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

// ข้อมูลสำหรับปฏิทินคิว
// group=day  (≤ 42 วัน): วันที่ผ่านมาแล้วอ่านจาก daily_queue_stats (สรุปไว้ทุกคืน) · วันนี้นับสด — ไม่ต้อง COUNT คิวทั้งเดือน
// group=hour (≤ 7 วัน):  นับจาก queue_tickets ตามชั่วโมงที่ออกบัตร — ช่วงสั้น ใช้ index (hospital_id, service_date, id)
class QueueSummaryController extends Controller
{
    public function show(Request $request, Hospital $hospital)
    {
        $data = $request->validate([
            'from' => 'required|date_format:Y-m-d',
            'to' => 'required|date_format:Y-m-d|after_or_equal:from',
            'group' => 'required|in:day,hour',
            'department_id' => 'nullable|integer',
        ]);
        $days = now()->parse($data['from'])->diffInDays($data['to']) + 1;
        abort_if($data['group'] === 'day' && $days > 42, 422, 'Day summary is limited to 42 days.');
        abort_if($data['group'] === 'hour' && $days > 7, 422, 'Hourly summary is limited to 7 days.');

        return ['group' => $data['group'], 'data' => $data['group'] === 'day' ? $this->byDay($hospital, $data) : $this->byHour($hospital, $data)];
    }

    private function byDay(Hospital $hospital, array $data): array
    {
        $today = now()->toDateString();
        $dept = $data['department_id'] ?? null;

        $past = DB::table('daily_queue_stats')
            ->where('hospital_id', $hospital->id)
            ->whereBetween('service_date', [$data['from'], min($data['to'], now()->subDay()->toDateString())])
            ->when($dept, fn ($q) => $q->where('department_id', $dept))
            ->groupBy('service_date')
            ->selectRaw('service_date, SUM(total_tickets) AS total, SUM(completed_tickets) AS completed,
                ROUND(SUM(avg_wait_seconds * completed_tickets) / NULLIF(SUM(completed_tickets), 0)) AS avg_wait_seconds')
            ->get()
            ->map(fn ($r) => ['date' => substr($r->service_date, 0, 10), 'total' => (int) $r->total, 'waiting' => 0, 'called' => 0,
                'completed' => (int) $r->completed, 'avg_wait_seconds' => $r->avg_wait_seconds === null ? null : (int) $r->avg_wait_seconds, 'source' => 'summary']);

        $live = [];
        if ($today >= $data['from'] && $today <= $data['to']) {
            $row = $this->liveQuery($hospital, $dept)->where('service_date', $today)->selectRaw($this->countsSql())->first();
            $live[] = ['date' => $today] + $this->counts($row) + ['source' => 'live'];
        }

        return $past->concat($live)->sortBy('date')->values()->all();
    }

    private function byHour(Hospital $hospital, array $data): array
    {
        $hour = DB::getDriverName() === 'sqlite' ? "CAST(strftime('%H', created_at) AS INTEGER)" : 'HOUR(created_at)';

        return $this->liveQuery($hospital, $data['department_id'] ?? null)
            ->whereBetween('service_date', [$data['from'], $data['to']])
            ->groupBy('service_date', DB::raw($hour))
            ->selectRaw("service_date, {$hour} AS hour, ".$this->countsSql())
            ->orderBy('service_date')->orderBy('hour')
            ->get()
            ->map(fn ($r) => ['date' => substr($r->service_date, 0, 10), 'hour' => (int) $r->hour] + $this->counts($r))
            ->all();
    }

    private function liveQuery(Hospital $hospital, ?int $dept)
    {
        return DB::table('queue_tickets')->where('hospital_id', $hospital->id)->when($dept, fn ($q) => $q->where('department_id', $dept));
    }

    private function countsSql(): string
    {
        $wait = DB::getDriverName() === 'sqlite'
            ? '(julianday(called_at) - julianday(created_at)) * 86400'
            : 'TIMESTAMPDIFF(SECOND, created_at, called_at)';

        return "COUNT(*) AS total,
            SUM(CASE WHEN status = 'waiting' THEN 1 ELSE 0 END) AS waiting,
            SUM(CASE WHEN status = 'called' THEN 1 ELSE 0 END) AS called,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
            AVG(CASE WHEN called_at IS NOT NULL THEN {$wait} END) AS avg_wait_seconds";
    }

    private function counts(?object $r): array
    {
        return [
            'total' => (int) ($r->total ?? 0),
            'waiting' => (int) ($r->waiting ?? 0),
            'called' => (int) ($r->called ?? 0),
            'completed' => (int) ($r->completed ?? 0),
            'avg_wait_seconds' => isset($r->avg_wait_seconds) ? (int) round($r->avg_wait_seconds) : null,
        ];
    }
}
