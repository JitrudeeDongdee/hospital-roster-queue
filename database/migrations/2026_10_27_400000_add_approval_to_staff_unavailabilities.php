<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('staff_unavailabilities', function (Blueprint $table) {
            // pending = แพทย์ขอ รอแอดมิน · approved = ใช้บังคับกติกาจัดเวร · rejected = ไม่อนุมัติ
            $table->string('status', 10)->default('approved');
            $table->foreignId('requested_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('decided_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('decided_at')->nullable();
            $table->string('decision_note', 200)->nullable();
            $table->index(['status', 'date']); // กล่องคำขอของแอดมิน
        });
    }

    public function down(): void
    {
        Schema::table('staff_unavailabilities', function (Blueprint $table) {
            $table->dropIndex(['status', 'date']);
            $table->dropConstrainedForeignId('decided_by');
            $table->dropConstrainedForeignId('requested_by');
            $table->dropColumn(['status', 'decided_at', 'decision_note']);
        });
    }
};
