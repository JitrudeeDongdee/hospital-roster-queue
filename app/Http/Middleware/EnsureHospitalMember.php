<?php

namespace App\Http\Middleware;

use App\Models\Hospital;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

// ผู้ใช้เข้าถึงได้เฉพาะ route ของโรงพยาบาลที่ตัวเองสังกัด
class EnsureHospitalMember
{
    public function handle(Request $request, Closure $next): Response
    {
        $hospital = $request->route('hospital');
        $hospitalId = $hospital instanceof Hospital ? $hospital->id : (int) $hospital;

        abort_unless($request->user()?->hospital_id === $hospitalId, 403, 'คุณไม่ได้สังกัดโรงพยาบาลนี้');

        return $next($request);
    }
}
