<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // เลขคิวล่าสุดของแต่ละแผนกต่อวัน — ล็อกแถวนี้ตอนออกบัตรคิว เลขจึงไม่ซ้ำแม้กดพร้อมกัน
        Schema::create('queue_counters', function (Blueprint $table) {
            $table->id();
            $table->foreignId('department_id')->constrained()->cascadeOnDelete();
            $table->date('service_date');
            $table->unsignedInteger('last_number')->default(0);

            $table->unique(['department_id', 'service_date']);
        });

        Schema::create('queue_tickets', function (Blueprint $table) {
            $table->id();
            $table->foreignId('hospital_id')->constrained();
            $table->foreignId('department_id')->constrained();
            $table->foreignId('required_skill_id')->nullable()->constrained('skills');
            $table->foreignId('staff_id')->nullable()->constrained('staff');
            $table->date('service_date');
            $table->unsignedInteger('number');
            $table->string('patient_ref', 64); // รหัสอ้างอิงเท่านั้น ไม่เก็บข้อมูลส่วนบุคคลของผู้ป่วย
            $table->unsignedTinyInteger('priority')->default(0); // 0 ปกติ, 1 ผู้สูงอายุ/ผู้พิการ, 2 เร่งด่วน
            $table->string('status', 16)->default('waiting'); // waiting, called, completed, skipped
            $table->timestamp('called_at')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();

            $table->unique(['department_id', 'service_date', 'number']);
            // เรียกคิวถัดไป: WHERE department_id, service_date, status ORDER BY priority DESC, id ASC
            $table->rawIndex('department_id, service_date, status, priority DESC, id', 'queue_tickets_next_idx');
            // รายการคิวของโรงพยาบาลแบบ keyset (cursor) ตาม id — ไม่ใส่ status คั่นกลาง ไม่งั้น ORDER BY id ต้อง filesort
            $table->index(['hospital_id', 'service_date', 'id'], 'queue_tickets_list_idx');
        });

        // ตารางสรุปรายวัน — dashboard อ่านจากตารางนี้แทนการ COUNT คิวหลายล้านแถวทุกครั้ง
        Schema::create('daily_queue_stats', function (Blueprint $table) {
            $table->id();
            $table->foreignId('hospital_id')->constrained();
            $table->foreignId('department_id')->constrained();
            $table->date('service_date');
            $table->unsignedInteger('total_tickets');
            $table->unsignedInteger('completed_tickets');
            $table->unsignedInteger('avg_wait_seconds')->nullable();
            $table->timestamps();

            $table->unique(['department_id', 'service_date']);
            $table->index(['hospital_id', 'service_date']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('daily_queue_stats');
        Schema::dropIfExists('queue_tickets');
        Schema::dropIfExists('queue_counters');
    }
};
