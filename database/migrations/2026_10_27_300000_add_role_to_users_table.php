<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('role', 20)->default('registration');
            $table->foreignId('hospital_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignId('staff_id')->nullable()->constrained('staff')->nullOnDelete(); // ผู้ใช้ที่เป็นแพทย์ ผูกกับข้อมูลแพทย์
            $table->index(['hospital_id', 'role']);
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropConstrainedForeignId('staff_id');
            $table->dropConstrainedForeignId('hospital_id');
            $table->dropColumn('role');
        });
    }
};
