<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class StaffUnavailability extends Model
{
    protected $fillable = ['staff_id', 'date', 'reason'];

    protected $casts = ['date' => 'date:Y-m-d'];
}
