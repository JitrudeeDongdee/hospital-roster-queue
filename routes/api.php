<?php

use App\Http\Controllers\LookupController;
use App\Http\Controllers\StatsController;
use App\Http\Controllers\TicketController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::get('/user', function (Request $request) {
    return $request->user();
})->middleware('auth:sanctum');

Route::get('hospitals', [LookupController::class, 'hospitals']);
Route::get('skills', [LookupController::class, 'skills']);

// ทุก route อยู่ใต้ hospital — scopeBindings ทำให้ department/staff/ticket ของโรงพยาบาลอื่นได้ 404
Route::scopeBindings()->prefix('hospitals/{hospital}')->group(function () {
    Route::get('departments', [LookupController::class, 'departments']);
    Route::get('staff', [LookupController::class, 'staff']);
    Route::get('tickets', [TicketController::class, 'index']);
    Route::post('departments/{department}/tickets', [TicketController::class, 'store']);
    Route::post('staff/{staff}/call-next', [TicketController::class, 'callNext']);
    Route::post('tickets/{ticket}/complete', [TicketController::class, 'complete']);
    Route::get('stats', [StatsController::class, 'index']);
});
