<?php

namespace App\Models;

use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;

class ShiftTemplate extends Model
{
    protected $fillable = ['department_id', 'code', 'name', 'start_time', 'end_time', 'min_staff', 'required_skill_id', 'sort_order'];

    /** @return array{0: CarbonImmutable, 1: CarbonImmutable} เวลาเริ่ม/จบจริงของเวรนี้ในวันที่กำหนด */
    public function window(string $date): array
    {
        $start = CarbonImmutable::parse("{$date} {$this->start_time}");
        $end = CarbonImmutable::parse("{$date} {$this->end_time}");

        return [$start, $end->lessThanOrEqualTo($start) ? $end->addDay() : $end];
    }
}
