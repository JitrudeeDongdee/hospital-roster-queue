<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Appointment extends Model
{
    public const BOOKED = 'booked';
    public const CHECKED_IN = 'checked_in';
    public const NO_SHOW = 'no_show';
    public const CANCELLED = 'cancelled';

    protected $fillable = ['hospital_id', 'department_id', 'staff_id', 'patient_ref', 'slot_start', 'slot_end', 'status', 'source', 'note', 'ticket_id', 'checked_in_at'];

    protected $casts = ['slot_start' => 'datetime', 'slot_end' => 'datetime', 'checked_in_at' => 'datetime'];

    public function department(): BelongsTo
    {
        return $this->belongsTo(Department::class);
    }

    public function staff(): BelongsTo
    {
        return $this->belongsTo(Staff::class);
    }

    public function ticket(): BelongsTo
    {
        return $this->belongsTo(QueueTicket::class, 'ticket_id');
    }
}
