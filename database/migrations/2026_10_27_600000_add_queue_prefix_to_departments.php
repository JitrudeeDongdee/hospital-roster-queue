<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // เลขนำหน้าคิวของแผนก (1–9) → เลขคิวที่ผู้ป่วยเห็นเป็นตัวเลขล้วน เช่น ผู้ป่วยนอก 1001, แล็บ 2001 ไม่ซ้ำกันทั้งโรงพยาบาล
        Schema::table('departments', function (Blueprint $table) {
            $table->unsignedTinyInteger('queue_prefix')->nullable();
            $table->unique(['hospital_id', 'queue_prefix']);
        });
    }

    public function down(): void
    {
        Schema::table('departments', function (Blueprint $table) {
            $table->dropUnique(['hospital_id', 'queue_prefix']);
            $table->dropColumn('queue_prefix');
        });
    }
};
