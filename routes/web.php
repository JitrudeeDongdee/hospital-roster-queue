<?php

use Illuminate\Support\Facades\Route;

// บอกว่าเครื่องนี้รันเวอร์ชันไหน — ใช้ตรวจหลัง deploy ว่าตรงกับ tag ที่เพิ่งปล่อย
Route::get('/version', fn () => response()->json([
    'version' => config('app.version'),
    'sha' => config('app.build_sha'),
    'built_at' => config('app.built_at'),
]));

// หน้าเว็บเป็น SPA (React Router): ทุก path ที่ไม่ใช่ /api ส่งหน้าเดียวกัน แล้วให้ React เลือกหน้าเอง
Route::view('/{path?}', 'app')->where('path', '^(?!api(/|$)).*$');
