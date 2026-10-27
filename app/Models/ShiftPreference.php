<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ShiftPreference extends Model
{
    public const PREFER = 'prefer';
    public const AVOID = 'avoid';

    protected $fillable = ['staff_id', 'shift_template_id', 'date', 'kind'];

    protected $casts = ['date' => 'date:Y-m-d'];
}
