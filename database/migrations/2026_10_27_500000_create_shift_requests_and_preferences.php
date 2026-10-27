<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // คำขอย้าย/แลกเวรของแพทย์ — เก็บวันและช่วงเวรตอนขอไว้ด้วย เพราะหลังสลับแล้ว shift เดิมเป็นของอีกคน
        Schema::create('shift_change_requests', function (Blueprint $table) {
            $table->id();
            $table->foreignId('hospital_id')->constrained()->cascadeOnDelete();
            $table->foreignId('department_id')->constrained()->cascadeOnDelete();
            $table->string('type', 5); // move = ย้ายไปช่องอื่น · swap = แลกกับเวรของเพื่อน
            $table->foreignId('requester_staff_id')->constrained('staff')->cascadeOnDelete();
            $table->foreignId('shift_id')->nullable()->constrained()->nullOnDelete();
            $table->date('from_date');
            $table->foreignId('from_template_id')->constrained('shift_templates')->cascadeOnDelete();
            $table->foreignId('target_shift_id')->nullable()->constrained('shifts')->nullOnDelete();
            $table->foreignId('target_staff_id')->nullable()->constrained('staff')->cascadeOnDelete();
            $table->date('to_date');
            $table->foreignId('to_template_id')->constrained('shift_templates')->cascadeOnDelete();
            // pending_peer = รอเพื่อนตอบ · needs_admin = ติดกติกา รอแอดมินเคลียร์ · approved · declined (เพื่อนปฏิเสธ) · rejected (แอดมินปฏิเสธ)
            $table->string('status', 12);
            $table->string('reason', 200)->nullable();
            $table->json('problems')->nullable();
            $table->timestamp('responded_at')->nullable();
            $table->foreignId('decided_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('decided_at')->nullable();
            $table->string('decision_note', 200)->nullable();
            $table->timestamps();
            $table->index(['hospital_id', 'status']);
            $table->index(['target_staff_id', 'status']);
            $table->index(['requester_staff_id', 'created_at']);
        });

        // ความต้องการลงเวรก่อนจัดร่าง: prefer = อยากลง · avoid = ไม่สะดวก (ไม่ใช่วันลา จัดให้ได้ถ้าคนไม่พอ)
        Schema::create('shift_preferences', function (Blueprint $table) {
            $table->id();
            $table->foreignId('staff_id')->constrained('staff')->cascadeOnDelete();
            $table->foreignId('shift_template_id')->constrained()->cascadeOnDelete();
            $table->date('date');
            $table->string('kind', 6);
            $table->timestamps();
            $table->unique(['staff_id', 'date', 'shift_template_id']);
            $table->index(['shift_template_id', 'date']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('shift_preferences');
        Schema::dropIfExists('shift_change_requests');
    }
};
