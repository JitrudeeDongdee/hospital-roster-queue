<?php

namespace App\Console\Commands;

use App\Services\AppointmentService;
use Illuminate\Console\Command;

class MarkNoShows extends Command
{
    protected $signature = 'appointments:mark-no-shows';

    protected $description = 'Mark booked appointments as no-show once the slot and the allowed lateness have passed';

    public function handle(AppointmentService $appointments): int
    {
        $this->info('Marked '.$appointments->markNoShows().' no-shows');

        return self::SUCCESS;
    }
}
