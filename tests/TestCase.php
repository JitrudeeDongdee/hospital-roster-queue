<?php

namespace Tests;

use App\Models\Hospital;
use App\Models\Staff;
use App\Models\User;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;

abstract class TestCase extends BaseTestCase
{
    /** ล็อกอินเป็นผู้ใช้บทบาท $role ของโรงพยาบาล (แพทย์ต้องส่ง $staff ที่ผูกกับผู้ใช้) */
    protected function actingAsRole(string $role, Hospital $hospital, ?Staff $staff = null): User
    {
        $user = User::create([
            'name' => "{$role} test",
            'email' => Str::random(12).'@test.local',
            'password' => Str::random(40),
            'role' => $role,
            'hospital_id' => $hospital->id,
            'staff_id' => $staff?->id,
        ]);
        Sanctum::actingAs($user);

        return $user;
    }

    protected function actingAsDoctor(Staff $staff): User
    {
        return $this->actingAsRole('doctor', $staff->hospital, $staff);
    }
}
