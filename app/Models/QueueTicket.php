<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class QueueTicket extends Model
{
    public const WAITING = 'waiting';
    public const CALLED = 'called';
    public const COMPLETED = 'completed';

    protected $fillable = [
        'hospital_id', 'department_id', 'required_skill_id', 'staff_id',
        'service_date', 'number', 'patient_ref', 'priority', 'status',
        'called_at', 'completed_at',
    ];

    protected $casts = [
        'service_date' => 'date:Y-m-d',
        'called_at' => 'datetime',
        'completed_at' => 'datetime',
    ];

    public function department(): BelongsTo
    {
        return $this->belongsTo(Department::class);
    }

    public function staff(): BelongsTo
    {
        return $this->belongsTo(Staff::class);
    }
}
