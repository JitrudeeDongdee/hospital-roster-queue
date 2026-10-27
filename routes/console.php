<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// สรุปยอดของเมื่อวานทุกคืน
Schedule::command('queue:aggregate-stats')->dailyAt('00:30');
Schedule::command('appointments:mark-no-shows')->everyFifteenMinutes();
