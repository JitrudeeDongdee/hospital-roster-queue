<?php

use App\Http\Controllers\AuthController;
use App\Http\Controllers\DoctorQueueController;
use App\Http\Controllers\LeaveController;
use App\Http\Controllers\LookupController;
use App\Http\Controllers\QueueSummaryController;
use App\Http\Controllers\RosterController;
use App\Http\Controllers\ShiftPreferenceController;
use App\Http\Controllers\ShiftRequestController;
use App\Http\Controllers\StaffController;
use App\Http\Controllers\StatsController;
use App\Http\Controllers\TicketController;
use Illuminate\Support\Facades\Route;

// เดโม: เลือกผู้ใช้ทดลอง (404 ถ้า DEMO_LOGIN=false)
Route::get('demo-users', [AuthController::class, 'demoUsers']);
Route::post('demo-login', [AuthController::class, 'demoLogin'])->middleware('throttle:30,1');
Route::get('roles', [AuthController::class, 'roles']);

Route::middleware('auth:sanctum')->group(function () {
    Route::get('me', [AuthController::class, 'me']);
    Route::post('logout', [AuthController::class, 'logout']);
    Route::get('skills', [LookupController::class, 'skills']);

    // ทุก route อยู่ใต้ hospital: ผู้ใช้ต้องสังกัดโรงพยาบาลนั้น (403) และ scopeBindings ทำให้
    // department/staff/ticket/shift ของโรงพยาบาลอื่นได้ 404 · สิทธิ์แต่ละ route ใช้ Gate จาก App\Enums\Role
    Route::middleware('hospital.member')->scopeBindings()->prefix('hospitals/{hospital}')->group(function () {
        Route::get('departments', [LookupController::class, 'departments']);
        Route::get('staff', [LookupController::class, 'staff']);

        // จัดการแพทย์ (หัวหน้าแผนก)
        Route::get('staff-directory', [StaffController::class, 'index'])->middleware('can:staff.manage');
        Route::post('staff', [StaffController::class, 'store'])->middleware('can:staff.manage');
        Route::patch('staff/{staff}', [StaffController::class, 'update'])->middleware('can:staff.manage');

        // คิวผู้ป่วย
        Route::get('tickets', [TicketController::class, 'index'])->middleware('can:queue.view');
        Route::get('tickets/summary', [QueueSummaryController::class, 'show'])->middleware('can:queue.view');
        Route::post('departments/{department}/tickets', [TicketController::class, 'store'])->middleware('can:ticket.issue');
        Route::post('staff/{staff}/call-next', [TicketController::class, 'callNext'])->middleware('can:ticket.call');
        Route::post('tickets/{ticket}/complete', [TicketController::class, 'complete'])->middleware('can:ticket.call');
        Route::patch('tickets/{ticket}/triage', [TicketController::class, 'triage'])->middleware('can:ticket.triage');
        Route::get('staff/{staff}/my-queue', [DoctorQueueController::class, 'show'])->middleware('can:queue.view');
        Route::get('stats', [StatsController::class, 'index'])->middleware('can:stats.view');
        Route::get('on-duty', [RosterController::class, 'onDuty'])->middleware('can:queue.view');

        // จัดเวรแพทย์
        Route::get('departments/{department}/roster', [RosterController::class, 'show'])->middleware('can:roster.view');
        Route::post('departments/{department}/roster/generate', [RosterController::class, 'generate'])->middleware('can:roster.manage');
        Route::post('shifts', [RosterController::class, 'store'])->middleware('can:roster.manage');
        Route::delete('shifts/{shift}', [RosterController::class, 'destroy'])->middleware('can:roster.manage');
        Route::get('staff/{staff}/unavailabilities', [RosterController::class, 'unavailabilities'])->middleware('can:roster.view');
        Route::post('staff/{staff}/unavailabilities', [LeaveController::class, 'store']); // ตรวจสิทธิ์ใน controller (ขอของตัวเอง / บันทึกให้ทุกคน)

        // คำขอลา: แพทย์ขอ → แอดมินอนุมัติ
        Route::get('leave-requests', [LeaveController::class, 'index'])->middleware('can:leave.approve');
        Route::post('leave-requests/{leave}/approve', [LeaveController::class, 'approve'])->middleware('can:leave.approve');
        Route::post('leave-requests/{leave}/reject', [LeaveController::class, 'reject'])->middleware('can:leave.approve');
        Route::delete('leave-requests/{leave}', [LeaveController::class, 'destroy']); // ตรวจสิทธิ์ใน controller

        // ขอย้าย/แลกเวร: เพื่อนตอบรับแล้วเปลี่ยนทันที · ติดกติกาหรือช่องขาดคน → แอดมินเคลียร์
        Route::get('shift-requests', [ShiftRequestController::class, 'index']); // ตรวจสิทธิ์ใน controller (ของตัวเอง / แอดมิน)
        Route::post('shift-requests', [ShiftRequestController::class, 'store'])->middleware('can:shift.request.own');
        Route::post('shift-requests/{shiftRequest}/accept', [ShiftRequestController::class, 'accept'])->middleware('can:shift.request.own');
        Route::post('shift-requests/{shiftRequest}/decline', [ShiftRequestController::class, 'decline'])->middleware('can:shift.request.own');
        Route::post('shift-requests/{shiftRequest}/approve', [ShiftRequestController::class, 'approve'])->middleware('can:shift.request.resolve');
        Route::post('shift-requests/{shiftRequest}/reject', [ShiftRequestController::class, 'reject'])->middleware('can:shift.request.resolve');
        Route::delete('shift-requests/{shiftRequest}', [ShiftRequestController::class, 'destroy'])->middleware('can:shift.request.own');

        // เวรที่อยากลง/ไม่สะดวก ก่อนจัดร่าง
        Route::get('staff/{staff}/preferences/months', [ShiftPreferenceController::class, 'months']); // ตรวจสิทธิ์ใน controller
        Route::get('staff/{staff}/preferences', [ShiftPreferenceController::class, 'show']); // ตรวจสิทธิ์ใน controller
        Route::put('staff/{staff}/preferences', [ShiftPreferenceController::class, 'update'])->middleware('can:shift.request.own');
    });
});
