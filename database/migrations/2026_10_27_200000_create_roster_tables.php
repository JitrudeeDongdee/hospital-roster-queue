<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // กติกาการจัดเวรของแต่ละโรงพยาบาล
        Schema::table('hospitals', function (Blueprint $table) {
            $table->unsignedTinyInteger('min_rest_hours')->default(8);
            $table->unsignedTinyInteger('max_weekly_hours')->default(60);
        });

        // แม่แบบเวรของแต่ละแผนก เช่น เช้า 08–16, บ่าย 16–24, ดึก 00–08 (end <= start = จบวันถัดไป)
        Schema::create('shift_templates', function (Blueprint $table) {
            $table->id();
            $table->foreignId('department_id')->constrained()->cascadeOnDelete();
            $table->string('code', 8);
            $table->string('name');
            $table->time('start_time');
            $table->time('end_time');
            $table->unsignedTinyInteger('min_staff')->default(1);
            $table->foreignId('required_skill_id')->nullable()->constrained('skills'); // เวรนี้ต้องมีหมอที่มีความเชี่ยวชาญนี้อย่างน้อย 1 คน
            $table->unsignedTinyInteger('sort_order')->default(0);
            $table->timestamps();

            $table->unique(['department_id', 'code']);
        });

        Schema::create('shifts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('hospital_id')->constrained();
            $table->foreignId('department_id')->constrained();
            $table->foreignId('shift_template_id')->constrained();
            $table->foreignId('staff_id')->constrained('staff');
            $table->date('shift_date');
            $table->dateTime('starts_at');
            $table->dateTime('ends_at');
            $table->timestamps();

            $table->unique(['staff_id', 'shift_template_id', 'shift_date']);
            // ตารางเวรของแผนกในช่วงวัน
            $table->index(['department_id', 'shift_date']);
            // ตรวจเวรซ้อน/เวลาพัก/ชั่วโมงต่อสัปดาห์ของหมอแต่ละคน
            $table->index(['staff_id', 'starts_at']);
        });

        Schema::create('staff_unavailabilities', function (Blueprint $table) {
            $table->id();
            $table->foreignId('staff_id')->constrained('staff')->cascadeOnDelete();
            $table->date('date');
            $table->string('reason', 100)->nullable();
            $table->timestamps();

            $table->unique(['staff_id', 'date']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('staff_unavailabilities');
        Schema::dropIfExists('shifts');
        Schema::dropIfExists('shift_templates');

        Schema::table('hospitals', function (Blueprint $table) {
            $table->dropColumn(['min_rest_hours', 'max_weekly_hours']);
        });
    }
};
