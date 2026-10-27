<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasManyThrough;

class Hospital extends Model
{
    protected $fillable = ['code', 'name', 'min_rest_hours', 'max_weekly_hours', 'appointment_open', 'appointment_close', 'appointment_slot_minutes', 'appointments_per_doctor', 'appointment_early_minutes', 'appointment_late_minutes'];

    public function departments(): HasMany
    {
        return $this->hasMany(Department::class);
    }

    public function staff(): HasMany
    {
        return $this->hasMany(Staff::class);
    }

    public function tickets(): HasMany
    {
        return $this->hasMany(QueueTicket::class);
    }

    public function shifts(): HasMany
    {
        return $this->hasMany(Shift::class);
    }

    // คำขอลาของแพทย์ในโรงพยาบาลนี้ (ใช้กับ scopeBindings ของ route {leave})
    public function leaves(): HasManyThrough
    {
        return $this->hasManyThrough(StaffUnavailability::class, Staff::class);
    }

    // ใช้กับ scopeBindings ของ route {appointment}
    public function appointments(): HasMany
    {
        return $this->hasMany(Appointment::class);
    }

    // ใช้กับ scopeBindings ของ route {shiftRequest}
    public function shiftRequests(): HasMany
    {
        return $this->hasMany(ShiftChangeRequest::class);
    }

    public function dailyStats(): HasMany
    {
        return $this->hasMany(DailyQueueStat::class);
    }
}
