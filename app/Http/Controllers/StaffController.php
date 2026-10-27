<?php

namespace App\Http\Controllers;

use App\Enums\Role;
use App\Models\Hospital;
use App\Models\Shift;
use App\Models\Staff;
use App\Models\StaffUnavailability;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

// หัวหน้าแผนก: ดูรายละเอียดแพทย์ เพิ่มแพทย์ และแก้ชื่อ/ความเชี่ยวชาญ
class StaffController extends Controller
{
    // GET /api/hospitals/{hospital}/staff-directory — แพทย์ทุกคนพร้อมสรุปเวรเดือนนี้ เวรถัดไป และคำขอลาที่รอ
    public function index(Hospital $hospital)
    {
        $staff = $hospital->staff()->with('skills:id,code,name')->orderBy('department_id')->orderBy('id')->get();
        $ids = $staff->pluck('id');

        // สรุปเวรของเดือนนี้ด้วย query เดียว (ไม่ใช่ทีละคน)
        $month = Shift::whereIn('staff_id', $ids)
            ->whereBetween('shift_date', [now()->startOfMonth()->toDateString(), now()->endOfMonth()->toDateString()])
            ->get(['staff_id', 'starts_at', 'ends_at'])
            ->groupBy('staff_id');
        $next = Shift::whereIn('staff_id', $ids)->where('starts_at', '>', now())->with('template:id,name')->orderBy('starts_at')
            ->get(['staff_id', 'shift_template_id', 'shift_date', 'starts_at'])->unique('staff_id')->keyBy('staff_id');
        $pendingLeave = StaffUnavailability::whereIn('staff_id', $ids)->where('status', StaffUnavailability::PENDING)
            ->selectRaw('staff_id, COUNT(*) AS total')->groupBy('staff_id')->pluck('total', 'staff_id');
        $accounts = User::whereIn('staff_id', $ids)->pluck('staff_id')->flip();

        return $staff->map(fn (Staff $s) => [
            'id' => $s->id,
            'name' => $s->name,
            'department_id' => $s->department_id,
            'is_active' => $s->is_active,
            'skills' => $s->skills->map->only(['id', 'code', 'name'])->values(),
            'shifts_this_month' => ($month[$s->id] ?? collect())->count(),
            'hours_this_month' => ($month[$s->id] ?? collect())->sum(fn ($x) => $x->starts_at->diffInMinutes($x->ends_at) / 60),
            'next_shift' => isset($next[$s->id]) ? ['date' => $next[$s->id]->shift_date->toDateString(), 'name' => $next[$s->id]->template->name] : null,
            'pending_leave' => (int) ($pendingLeave[$s->id] ?? 0),
            'has_account' => $accounts->has($s->id),
        ]);
    }

    // POST /api/hospitals/{hospital}/staff {name, department_id, skill_ids[]} — สร้างแพทย์ + บัญชีผู้ใช้บทบาทแพทย์
    public function store(Request $request, Hospital $hospital)
    {
        $data = $request->validate([
            'name' => 'required|string|max:100',
            'department_id' => ['required', 'integer', Rule::exists('departments', 'id')->where('hospital_id', $hospital->id)],
            'skill_ids' => 'present|array',
            'skill_ids.*' => 'integer|distinct|exists:skills,id',
        ]);

        $staff = DB::transaction(function () use ($hospital, $data) {
            $staff = Staff::create(['hospital_id' => $hospital->id, 'department_id' => $data['department_id'], 'name' => $data['name']]);
            $staff->skills()->sync($data['skill_ids']);
            // บัญชีไม่มีรหัสผ่านที่ใช้ได้ (สุ่มแล้วทิ้ง) — ระบบจริงเชื่อม SSO ของโรงพยาบาล · เดโมเข้าผ่าน demo-login
            User::create([
                'name' => $data['name'],
                'email' => 'staff-'.$staff->id.'-'.Str::lower(Str::random(6)).'@'.Str::lower($hospital->code).'.local',
                'password' => Hash::make(Str::random(40)),
                'role' => Role::Doctor,
                'hospital_id' => $hospital->id,
                'staff_id' => $staff->id,
            ]);

            return $staff;
        });

        return response()->json($this->present($staff), 201);
    }

    // PATCH /api/hospitals/{hospital}/staff/{staff} {name?, skill_ids?}
    public function update(Request $request, Hospital $hospital, Staff $staff)
    {
        $data = $request->validate([
            'name' => 'sometimes|required|string|max:100',
            'skill_ids' => 'sometimes|array',
            'skill_ids.*' => 'integer|distinct|exists:skills,id',
        ]);

        DB::transaction(function () use ($staff, $data) {
            if (isset($data['name'])) {
                $staff->update(['name' => $data['name']]);
                User::where('staff_id', $staff->id)->update(['name' => $data['name']]);
            }
            if (array_key_exists('skill_ids', $data)) {
                $staff->skills()->sync($data['skill_ids']);
            }
        });

        return $this->present($staff->fresh());
    }

    private function present(Staff $staff): array
    {
        return [
            'id' => $staff->id,
            'name' => $staff->name,
            'department_id' => $staff->department_id,
            'is_active' => $staff->is_active ?? true,
            'skills' => $staff->skills()->get(['skills.id', 'code', 'name'])->map->only(['id', 'code', 'name'])->values(),
        ];
    }
}
