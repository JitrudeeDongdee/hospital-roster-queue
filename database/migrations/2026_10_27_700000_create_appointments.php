<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // กติกานัดหมายตั้งได้ต่อโรงพยาบาล
        Schema::table('hospitals', function (Blueprint $table) {
            $table->time('appointment_open')->default('08:00');
            $table->time('appointment_close')->default('16:00');
            $table->unsignedTinyInteger('appointment_slot_minutes')->default(30);
            $table->unsignedTinyInteger('appointments_per_doctor')->default(3); // ต่อแพทย์ 1 คนต่อช่วง
            $table->unsignedTinyInteger('appointment_early_minutes')->default(15); // ถึงเวลานัด = ก่อนเวลากี่นาที
            $table->unsignedTinyInteger('appointment_late_minutes')->default(30); // สายเกินนี้ = walk-in
        });

        // นัดไว้ ≠ ได้คิว: check-in แล้วจึงออกบัตรคิว
        Schema::create('appointments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('hospital_id')->constrained()->cascadeOnDelete();
            $table->foreignId('department_id')->constrained()->cascadeOnDelete();
            $table->foreignId('staff_id')->nullable()->constrained('staff')->nullOnDelete(); // นัดแพทย์ระบุตัว (ไม่บังคับ)
            $table->string('patient_ref', 64);
            $table->dateTime('slot_start');
            $table->dateTime('slot_end');
            $table->string('status', 12)->default('booked'); // booked · checked_in · no_show · cancelled
            $table->string('source', 10)->default('manual'); // manual · his
            $table->string('note', 200)->nullable();
            $table->foreignId('ticket_id')->nullable()->constrained('queue_tickets')->nullOnDelete();
            $table->timestamp('checked_in_at')->nullable();
            $table->timestamps();
            $table->index(['department_id', 'slot_start']);
            $table->index(['hospital_id', 'slot_start']);
            $table->index(['staff_id', 'slot_start']);
        });

        // คิวที่มาจากนัด: เวลานัดใช้จัดลำดับตอนเรียก · แพทย์ที่นัดไว้เท่านั้นที่เรียกคิวนี้ได้
        Schema::table('queue_tickets', function (Blueprint $table) {
            $table->dateTime('appointment_at')->nullable();
            $table->foreignId('requested_staff_id')->nullable()->constrained('staff')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('queue_tickets', function (Blueprint $table) {
            $table->dropConstrainedForeignId('requested_staff_id');
            $table->dropColumn('appointment_at');
        });
        Schema::dropIfExists('appointments');
        Schema::table('hospitals', function (Blueprint $table) {
            $table->dropColumn(['appointment_open', 'appointment_close', 'appointment_slot_minutes', 'appointments_per_doctor', 'appointment_early_minutes', 'appointment_late_minutes']);
        });
    }
};
