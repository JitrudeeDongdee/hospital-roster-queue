<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class DailyQueueStat extends Model
{
    protected $fillable = [
        'hospital_id', 'department_id', 'service_date',
        'total_tickets', 'completed_tickets', 'avg_wait_seconds',
    ];

    protected $casts = ['service_date' => 'date:Y-m-d'];
}
