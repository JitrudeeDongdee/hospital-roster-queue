# Changelog

รูปแบบตาม [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) และเลขเวอร์ชันตาม [Semantic Versioning](https://semver.org/)
เลขเวอร์ชันมาจาก git tag (`vX.Y.Z`) เท่านั้น

## [Unreleased]

## [0.1.0] - 2026-10-27

release แรก — ตัวอย่างระบบจัดเวรแพทย์และจัดคิวผู้ป่วยหลายโรงพยาบาล (Laravel 13 + MySQL 8.4 + React 19)

### Added
- จัดเวรแพทย์รายเดือน: เวรเช้า/บ่าย/ดึก ตรวจกติกาเวรซ้อน ชั่วโมงพักขั้นต่ำ ชั่วโมงสูงสุดต่อสัปดาห์ และวันลา
- จัดเวรอัตโนมัติทั้งเดือนเป็นร่าง แล้วลงเวร/ลบเวรเองได้ · แสดงช่องที่คนไม่ครบหรือขาดความเชี่ยวชาญ
- มุมมองตาราง ปฏิทินรวม และปฏิทินรายแพทย์ พร้อมกรองแพทย์หลายคน
- ระบบขอลา: แพทย์ขอ → แอดมินอนุมัติ/ไม่อนุมัติพร้อมเหตุผล · อนุมัติไม่ได้ถ้าวันนั้นยังมีเวร
- คิวผู้ป่วย: ออกบัตร เรียกคิวตามความเชี่ยวชาญและความเร่งด่วน (`FOR UPDATE SKIP LOCKED`) และคิวของแพทย์แต่ละคน
- หน้าคิวแบบรายการพร้อมเวลา และปฏิทินรายเดือน/สัปดาห์/วัน (`/api/hospitals/{id}/tickets/summary`)
- ผู้ใช้ตามบทบาท แอดมิน/แพทย์/พยาบาล/เวชระเบียน ตรวจสิทธิ์ทุก route และแยกข้อมูลตามโรงพยาบาล
- เทคนิคข้อมูลจำนวนมาก: keyset pagination, composite index, ตารางสรุปรายวัน, ลบข้อมูลเก่าเป็นชุด, virtualization ฝั่งหน้าเว็บ
- endpoint `GET /version` และ `version.json` บน GitHub Pages
- CI/CD: ทดสอบบน SQLite และ MySQL ก่อน deploy · push tag `v*` แล้ว deploy Pages และสร้าง GitHub Release
- เอกสาร architecture (BPMN, ER diagram, network, แผน migration) และเอกสารเทคนิคข้อมูลจำนวนมาก

### Fixed
- ตั้ง timezone เป็น `Asia/Bangkok` — คิวที่ออกช่วง 00:00–07:00 ไม่ถูกนับเป็นวันก่อนหน้าแล้ว
- หัวตารางเวรไม่มีแถวโผล่ทะลุขึ้นมาตอนเลื่อน

[Unreleased]: https://github.com/JitrudeeDongdee/waka-crud/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/JitrudeeDongdee/waka-crud/releases/tag/v0.1.0
