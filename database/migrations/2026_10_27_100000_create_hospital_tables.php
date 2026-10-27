<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('hospitals', function (Blueprint $table) {
            $table->id();
            $table->string('code')->unique();
            $table->string('name');
            $table->timestamps();
        });

        Schema::create('departments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('hospital_id')->constrained()->cascadeOnDelete();
            $table->string('code');
            $table->string('name');
            $table->timestamps();

            $table->unique(['hospital_id', 'code']);
        });

        // ความเชี่ยวชาญ เช่น อายุรกรรมหัวใจ, กุมารเวช, อัลตราซาวด์
        Schema::create('skills', function (Blueprint $table) {
            $table->id();
            $table->string('code')->unique();
            $table->string('name');
            $table->timestamps();
        });

        Schema::create('staff', function (Blueprint $table) {
            $table->id();
            $table->foreignId('hospital_id')->constrained()->cascadeOnDelete();
            $table->foreignId('department_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->index(['hospital_id', 'department_id', 'is_active']);
        });

        Schema::create('skill_staff', function (Blueprint $table) {
            $table->foreignId('staff_id')->constrained('staff')->cascadeOnDelete();
            $table->foreignId('skill_id')->constrained()->cascadeOnDelete();

            $table->primary(['staff_id', 'skill_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('skill_staff');
        Schema::dropIfExists('staff');
        Schema::dropIfExists('skills');
        Schema::dropIfExists('departments');
        Schema::dropIfExists('hospitals');
    }
};
