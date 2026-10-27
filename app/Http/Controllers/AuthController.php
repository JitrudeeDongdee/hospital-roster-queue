<?php

namespace App\Http\Controllers;

use App\Enums\Role;
use App\Models\User;
use Illuminate\Http\Request;

class AuthController extends Controller
{
    // GET /api/demo-users — รายชื่อผู้ใช้ทดลอง (เปิดเฉพาะเมื่อ DEMO_LOGIN=true)
    public function demoUsers()
    {
        abort_unless(config('app.demo_login'), 404);

        return User::with('hospital:id,code,name')
            ->whereHas('hospital', fn ($q) => $q->where('code', 'H001'))
            ->where(fn ($q) => $q->where('role', '!=', Role::Doctor)->orWhereIn('staff_id', fn ($s) => $s->select('id')->from('staff')->where('name', 'like', '%-1')))
            ->orderBy('id')
            ->get(['id', 'name', 'role', 'hospital_id'])
            ->map(fn (User $u) => $this->present($u));
    }

    // POST /api/demo-login {user_id} — ออก token ให้ผู้ใช้ทดลองโดยไม่ต้องใช้รหัสผ่าน (เปิดเฉพาะเมื่อ DEMO_LOGIN=true)
    public function demoLogin(Request $request)
    {
        abort_unless(config('app.demo_login'), 404);

        $user = User::findOrFail($request->validate(['user_id' => 'required|integer'])['user_id']);

        return ['token' => $user->createToken('demo')->plainTextToken, 'user' => $this->present($user)];
    }

    // GET /api/me — ผู้ใช้ปัจจุบัน + สิทธิ์ (หน้าเว็บใช้ซ่อน/แสดงปุ่ม แต่ backend ตรวจซ้ำทุก request)
    public function me(Request $request)
    {
        return $this->present($request->user()->load('hospital:id,code,name'));
    }

    // POST /api/logout
    public function logout(Request $request)
    {
        $request->user()->currentAccessToken()?->delete();

        return response()->noContent();
    }

    // GET /api/roles — ตารางบทบาท × สิทธิ์
    public function roles()
    {
        return [
            'permissions' => Role::PERMISSIONS,
            'roles' => collect(Role::cases())->map(fn (Role $r) => ['value' => $r->value, 'label' => $r->label(), 'permissions' => $r->permissions()]),
        ];
    }

    private function present(User $user): array
    {
        return [
            'id' => $user->id,
            'name' => $user->name,
            'role' => $user->role->value,
            'role_label' => $user->role->label(),
            'hospital' => $user->hospital?->only(['id', 'code', 'name']),
            'staff_id' => $user->staff_id,
            'permissions' => $user->role->permissions(),
        ];
    }
}
