<?php

use Illuminate\Support\Facades\Route;

// หน้าเว็บเป็น SPA (React Router): ทุก path ที่ไม่ใช่ /api ส่งหน้าเดียวกัน แล้วให้ React เลือกหน้าเอง
Route::view('/{path?}', 'app')->where('path', '^(?!api(/|$)).*$');
