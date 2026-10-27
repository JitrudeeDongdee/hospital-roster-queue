<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Shift extends Model
{
    protected $fillable = ['hospital_id', 'department_id', 'shift_template_id', 'staff_id', 'shift_date', 'starts_at', 'ends_at'];

    protected $casts = [
        'shift_date' => 'date:Y-m-d',
        'starts_at' => 'datetime',
        'ends_at' => 'datetime',
    ];

    public function staff(): BelongsTo
    {
        return $this->belongsTo(Staff::class);
    }

    public function template(): BelongsTo
    {
        return $this->belongsTo(ShiftTemplate::class, 'shift_template_id');
    }
}
