<?php

namespace App\Http\Controllers;

use App\Models\Hospital;
use App\Models\Skill;

// ข้อมูลอ้างอิงสำหรับหน้าเว็บ: มีไม่กี่แถวและแทบไม่เปลี่ยน ฝั่ง frontend cache ไว้นานได้
class LookupController extends Controller
{
    public function skills()
    {
        return Skill::orderBy('code')->get(['id', 'code', 'name']);
    }

    public function departments(Hospital $hospital)
    {
        return $hospital->departments()->orderBy('code')->get(['id', 'code', 'name']);
    }

    public function staff(Hospital $hospital)
    {
        return $hospital->staff()
            ->with('skills:id,code,name') // eager loading กัน N+1
            ->where('is_active', true)
            ->orderBy('department_id')->orderBy('id')
            ->get(['id', 'department_id', 'name']);
    }
}
