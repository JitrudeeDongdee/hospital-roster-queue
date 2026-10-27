<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ShiftChangeRequest extends Model
{
    public const MOVE = 'move';
    public const SWAP = 'swap';

    public const PENDING_PEER = 'pending_peer';
    public const NEEDS_ADMIN = 'needs_admin';
    public const APPROVED = 'approved';
    public const DECLINED = 'declined';
    public const REJECTED = 'rejected';

    protected $fillable = [
        'hospital_id', 'department_id', 'type', 'requester_staff_id', 'shift_id', 'from_date', 'from_template_id',
        'target_shift_id', 'target_staff_id', 'to_date', 'to_template_id', 'status', 'reason', 'problems',
        'responded_at', 'decided_by', 'decided_at', 'decision_note',
    ];

    protected $casts = [
        'from_date' => 'date:Y-m-d',
        'to_date' => 'date:Y-m-d',
        'problems' => 'array',
        'responded_at' => 'datetime',
        'decided_at' => 'datetime',
    ];

    public function isOpen(): bool
    {
        return in_array($this->status, [self::PENDING_PEER, self::NEEDS_ADMIN], true);
    }

    public function requester(): BelongsTo
    {
        return $this->belongsTo(Staff::class, 'requester_staff_id');
    }

    public function targetStaff(): BelongsTo
    {
        return $this->belongsTo(Staff::class, 'target_staff_id');
    }

    public function shift(): BelongsTo
    {
        return $this->belongsTo(Shift::class);
    }

    public function targetShift(): BelongsTo
    {
        return $this->belongsTo(Shift::class, 'target_shift_id');
    }

    public function fromTemplate(): BelongsTo
    {
        return $this->belongsTo(ShiftTemplate::class, 'from_template_id');
    }

    public function toTemplate(): BelongsTo
    {
        return $this->belongsTo(ShiftTemplate::class, 'to_template_id');
    }

    public function decider(): BelongsTo
    {
        return $this->belongsTo(User::class, 'decided_by');
    }
}
