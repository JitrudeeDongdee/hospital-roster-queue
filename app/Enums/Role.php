<?php

namespace App\Enums;

/**
 * บทบาทและสิทธิ์ทั้งหมดของระบบ — แหล่งเดียวที่ backend (Gate) และหน้าเว็บ (/api/roles) ใช้ร่วมกัน
 */
enum Role: string
{
    case Admin = 'admin';
    case Doctor = 'doctor';
    case Nurse = 'nurse';
    case Registration = 'registration';

    public const PERMISSIONS = [
        'roster.view' => 'ดูตารางเวร',
        'roster.manage' => 'จัดเวร / จัดอัตโนมัติ / ลบเวร',
        'leave.manage.any' => 'บันทึกวันลาให้แพทย์ทุกคน',
        'leave.manage.own' => 'บันทึกวันลาของตัวเอง',
        'queue.view' => 'ดูรายการคิว',
        'ticket.issue' => 'ออกบัตรคิว',
        'ticket.triage' => 'กำหนดความเร่งด่วน / ความเชี่ยวชาญ (คัดกรอง)',
        'ticket.call' => 'เรียกคิว / ตรวจเสร็จ (ของตัวเอง)',
        'stats.view' => 'ดูสถิติ',
    ];

    public function label(): string
    {
        return match ($this) {
            self::Admin => 'แอดมิน / หัวหน้าแผนก',
            self::Doctor => 'แพทย์',
            self::Nurse => 'พยาบาล',
            self::Registration => 'เวชระเบียน / ตู้คิว',
        };
    }

    /** @return list<string> */
    public function permissions(): array
    {
        return match ($this) {
            self::Admin => ['roster.view', 'roster.manage', 'leave.manage.any', 'queue.view', 'ticket.issue', 'ticket.triage', 'stats.view'],
            self::Doctor => ['roster.view', 'leave.manage.own', 'queue.view', 'ticket.call'],
            self::Nurse => ['roster.view', 'queue.view', 'ticket.issue', 'ticket.triage'],
            self::Registration => ['ticket.issue'],
        };
    }
}
