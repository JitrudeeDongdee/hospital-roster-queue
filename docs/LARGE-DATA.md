# การจัดการข้อมูลปริมาณมาก — ค้นคว้าประกอบระบบจัดเวรแพทย์และจัดคิว

จิตฤดี ดวงดี · 27 ต.ค. 2569 · โค้ด: [github.com/JitrudeeDongdee/hospital-roster-queue](https://github.com/JitrudeeDongdee/hospital-roster-queue) · ภาพรวมระบบ: [ARCHITECTURE.md](ARCHITECTURE.md)

> **บริบท:** ระบบตารางเวรแพทย์และคิวผู้ป่วยแบบ multi-tenant ปัจจุบันมี 15 โรงพยาบาล และจะขยายเป็น 30 แห่ง
> Stack ปัจจุบันคือ Laravel 13 (PHP 8.5), MySQL 8.4 และ React 19 + TanStack Query/Virtual โดยมีแผนย้ายไป Next.js + NestJS
> ปริมาณงานที่ประมาณไว้คือคิวสูงสุด ~90,000 ใบต่อวัน หรือ ~33 ล้านแถวต่อปีในตาราง `queue_tickets`
> และมีจอแสดงคิวหลายร้อยจออ่านข้อมูลตลอดเวลา
>
> **ที่มาของข้อมูล:** ข้อเท็จจริงทุกข้อมาจากเอกสารทางการที่เปิดอ่านจริงตามรายการ Sources ท้ายเอกสาร (MySQL 8.4, Laravel 13, TanStack, MDN, Redis และ Azure Architecture Center)
> ส่วนที่เป็นความเห็นหรือการประมาณของผู้เขียนจะติดป้าย *[ความเห็น]* และส่วนที่ยืนยันจากแหล่งไม่ได้จะติดป้าย *[ยังไม่ยืนยัน]*

---

## 0. คำตอบสั้นสำหรับสัมภาษณ์ (30 วินาที)

"Index เป็นแค่ชั้นแรกค่ะ ดิฉันมองปัญหาข้อมูลเยอะเป็น 4 ชั้น
(1) **DB**: ออกแบบ composite index ให้ตรงกับ query จริงแล้วพิสูจน์ด้วย `EXPLAIN ANALYZE` ใช้ keyset pagination แทน OFFSET
เขียนและลบเป็น batch และแบ่ง partition ตามเดือนเพื่อให้ archive ข้อมูลเก่าได้ด้วยการ drop partition แทน `DELETE` ก้อนใหญ่
(2) **Backend**: ใช้ `chunkById`/`lazyById` สำหรับงาน batch ใช้ `cursorPaginate` สำหรับ API ป้องกัน N+1
และย้ายงานหนักไปทำใน queue
(3) **Frontend**: ไม่โหลดทั้งหมดมาไว้ฝั่ง client ใช้ infinite query + virtualization และกรองข้อมูลที่ server
(4) **Architecture**: จอคิวหลายร้อยจอไม่ควร poll DB ให้ทำ read model ไว้ใน Redis แล้ว push การเปลี่ยนแปลงผ่าน WebSocket
ส่วน sharding ตาม tenant จะใช้เมื่อเครื่องเดียวรับ write หรือ storage ไม่ไหว หรือมีข้อกำหนดเรื่องการแยกข้อมูล"

---

## 1. ชั้นฐานข้อมูล (MySQL 8.4 / InnoDB)

### 1.1 ลำดับคอลัมน์ใน Composite index และกฎ leftmost prefix
- **คืออะไร:** index หลายคอลัมน์จะถูกใช้ค้นหาได้ก็ต่อเมื่อ query ใช้คอลัมน์ชุดที่ "ชิดซ้าย" ของ index
  เช่น index `(col1, col2, col3)` รองรับการค้นด้วย `(col1)`, `(col1, col2)` และ `(col1, col2, col3)`
  แต่ไม่รองรับ `(col2)` หรือ `(col2, col3)` [MySQL: Multiple-Column Indexes]
- **ใช้เมื่อไร:** query ส่วนใหญ่ของระบบ multi-tenant กรองด้วย `hospital_id` เสมอ จึงควรวาง tenant key ไว้ซ้ายสุด
  แล้วตามด้วยคอลัมน์ที่กรองแบบเท่ากับ (equality) จากนั้นจึงเป็นคอลัมน์ช่วง (range) หรือคอลัมน์ที่ใช้เรียงลำดับ
  use-the-index-luke แนะนำว่าคอลัมน์ที่ถูกค้นหาเดี่ยว ๆ ควรอยู่หน้าสุด และ index หนึ่งตัวที่เรียงคอลัมน์ดีมักแทน index สองตัวได้
  ซึ่งช่วยประหยัดพื้นที่และลดต้นทุนการเขียน [UTIL: Concatenated keys]
- **ข้อควรระวัง:** index ที่ขึ้นต้นด้วย `created_at` จะใช้ไม่ได้กับ query `WHERE hospital_id = ?`
  และ index ทุกตัวที่เพิ่มเข้าไปทำให้ INSERT ช้าลง
```sql
-- index ที่ใช้จริงใน repo: เรียกคิวถัดไปของแผนก (database/migrations/..._create_queue_tables.php)
CREATE INDEX queue_tickets_next_idx
  ON queue_tickets (department_id, service_date, status, priority DESC, id);
```

### 1.2 Covering index (index-only scan)
- **คืออะไร:** ถ้า index มีทุกคอลัมน์ที่ query ต้องใช้ MySQL จะอ่านจาก index อย่างเดียวโดยไม่ต้องไปอ่านแถวจริง
  ใน `EXPLAIN` จะเห็นค่า `Extra: Using index` [MySQL: EXPLAIN Output]
- **ใช้เมื่อไร:** query ที่ถูกเรียกบ่อยและอ่านหลายแถว เช่น รายการเลขคิวบนจอ ซึ่งต้องการแค่ `id, number, status`
- **ข้อควรระวัง:** index จะใหญ่ขึ้นและการเขียนช้าลง อีกทั้งการได้ index-only scan นั้นเปราะบาง
  ถ้ามีคนเพิ่มคอลัมน์ใน SELECT ทีหลัง ประโยชน์นี้จะหายไปเงียบ ๆ
  ข้อแนะนำคือเขียนคอมเมนต์ไว้ว่า query ไหนพึ่ง index นี้ และ SELECT เฉพาะคอลัมน์ที่จำเป็น [UTIL: Index-only scan]

### 1.3 Descending index
- **คืออะไร:** ใน MySQL 8.x คำว่า `DESC` ในนิยาม index มีผลจริงแล้ว (เวอร์ชันก่อนหน้า MySQL จะ parse แต่ไม่สนใจ)
  index จึงเก็บข้อมูลเรียงจากมากไปน้อยและ scan ไปข้างหน้าได้ ทำให้ `ORDER BY a ASC, b DESC` ใช้ index เดียวได้โดยไม่ต้อง filesort
  [MySQL 8.4: Descending Indexes; MySQL 8.0: What Is New]
- **ข้อจำกัด:** รองรับเฉพาะ InnoDB และ `BTREE` เท่านั้น (ใช้กับ HASH/FULLTEXT/SPATIAL ไม่ได้)
  ไม่ใช้ change buffering และไม่ถูกใช้สำหรับ optimization ของ `MIN()`/`MAX()` ที่ไม่มี `GROUP BY` [MySQL 8.4: Descending Indexes]
- **เวอร์ชัน:** คู่มือ 8.0 ระบุว่าเป็นความสามารถใหม่ของซีรีส์ 8.0 แต่หน้าที่เปิดอ่านไม่ได้ระบุ minor version *[ยังไม่ยืนยันเลข minor]*
```sql
-- feed "คิวล่าสุดก่อน" เรียงหลายทิศทาง
CREATE INDEX ix_recent ON queue_tickets (hospital_id ASC, called_at DESC, id DESC);
```

### 1.4 EXPLAIN และ EXPLAIN ANALYZE
- **คืออะไร:** `EXPLAIN` แสดงแผนการรันที่ optimizer คาดไว้ ส่วน `EXPLAIN ANALYZE` จะ **รัน statement จริง**
  แล้วรายงานเวลา จำนวนแถวจริงเทียบกับที่คาดไว้ และจำนวน loop ของแต่ละ iterator
  output เป็นรูปแบบ `TREE` เสมอ (`FORMAT=JSON` จะ error) และใช้ได้กับ `SELECT`, `UPDATE`/`DELETE` แบบหลายตาราง และ `TABLE` [MySQL 8.4: EXPLAIN]
- **เวอร์ชัน:** `EXPLAIN ANALYZE` เริ่มมีใน **MySQL 8.0.18** และระบุ `FORMAT=TREE` ตรง ๆ ได้ตั้งแต่ 8.0.21 [MySQL 8.0: EXPLAIN]
- **สิ่งที่ต้องดู:** ค่า `type: ALL` (full scan) ซึ่งคู่มือบอกว่า "usually very bad" กับ `Extra: Using filesort` และ `Using temporary`
  ซึ่งคู่มือแนะนำให้เฝ้าดูถ้าต้องการให้ query เร็ว [MySQL 8.4: EXPLAIN Output]
- **ข้อควรระวัง:** คำสั่งนี้รัน query จริง ห้ามใช้กับ UPDATE/DELETE บน production โดยไม่ตั้งใจ
```sql
EXPLAIN ANALYZE
SELECT id, number FROM queue_tickets
WHERE department_id = 12 AND service_date = '2026-10-27' AND status = 'waiting'
ORDER BY priority DESC, id LIMIT 1;
```

### 1.5 อย่าครอบคอลัมน์ที่มี index ด้วยฟังก์ชัน
- **ปัญหา:** ฟังก์ชันเป็น "black box" ต่อ optimizer เงื่อนไขอย่าง `WHERE DATE(created_at) = ?` หรือ `DATE_FORMAT(...)` จึงใช้ index บนคอลัมน์นั้นไม่ได้
  ให้เขียนเป็นเงื่อนไขช่วงแทน [UTIL: Dates]
- **ทางเลือก:** MySQL 8.x รองรับ functional key part ซึ่งต้องเขียนนิพจน์ในวงเล็บซ้อน เช่น `INDEX ((col1 + col2))`
  ข้อจำกัดคือ ใช้เป็น primary key ไม่ได้ ใช้ใน foreign key ไม่ได้ และนับรวมกับจำนวนคอลัมน์สูงสุดของตาราง
  เพราะถูกสร้างเป็น hidden virtual generated column [MySQL 8.4: CREATE INDEX]
```sql
-- แย่: ใช้ index บน created_at ไม่ได้
SELECT COUNT(*) FROM queue_tickets WHERE DATE(created_at) = '2026-10-27';
-- ดี: เขียนเป็นช่วงแบบ half-open
SELECT COUNT(*) FROM queue_tickets
WHERE created_at >= '2026-10-27' AND created_at < '2026-10-28';
```

### 1.6 Keyset (seek) pagination แทน OFFSET
- **ปัญหาของ OFFSET:** database ยังต้องอ่านแถวที่ถูกข้ามทั้งหมดแล้วทิ้งไป หน้ายิ่งลึกยิ่งช้า
  และถ้ามีข้อมูลเข้าหรือถูกลบระหว่างที่ผู้ใช้เปลี่ยนหน้า จะเกิดแถวซ้ำหรือแถวหาย [UTIL: No-offset]
- **วิธี seek:** ส่งค่าคีย์ของแถวสุดท้ายในหน้าก่อนกลับมา แล้ว query ด้วย `WHERE key < :last ORDER BY key DESC LIMIT n`
  ลำดับการเรียงต้อง **deterministic** ถ้าคีย์เรียงไม่ unique ให้เพิ่มคอลัมน์ unique (เช่น `id`) เป็น tie-breaker
  และ index ต้องตรงกับ `ORDER BY` ทั้งคอลัมน์และทิศทาง [UTIL: Fetch next page]
- **เฉพาะ MySQL:** use-the-index-luke ระบุว่า MySQL ประเมิน row value อย่าง `(a, b) < (?, ?)` ได้ถูกต้อง
  แต่ใช้เป็น access predicate ของ index ไม่ได้ [UTIL: Fetch next page]
  คู่มือ MySQL 8.4 ยืนยันว่า range optimization ใช้กับ row constructor ได้เฉพาะรูป `IN()` ส่วนรูป `<`/`>` ไม่ได้กล่าวถึง [MySQL 8.4: Range Optimization]
  แนวทางที่ปลอดภัยจึงเป็นการเขียนเงื่อนไขแบบกระจาย (expanded) แล้วตรวจด้วย `EXPLAIN`
- **ข้อจำกัด:** กระโดดไปหน้าที่ N ตรง ๆ ไม่ได้ จึงเหมาะกับ infinite scroll หรือปุ่ม "ถัดไป" [UTIL: No-offset]
```sql
SELECT id, number, called_at FROM queue_tickets
WHERE hospital_id = 7
  AND (called_at < :last_called_at OR (called_at = :last_called_at AND id < :last_id))
ORDER BY called_at DESC, id DESC
LIMIT 50;
```

### 1.7 Batch insert และ LOAD DATA
- คู่มือแนะนำให้รวมหลายแถวไว้ใน `INSERT ... VALUES (...), (...)` เดียว ซึ่ง "considerably faster (many times faster in some cases)"
  เมื่อเทียบกับ INSERT ทีละแถว และสำหรับไฟล์ข้อความให้ใช้ `LOAD DATA` ซึ่ง "usually 20 times faster" กว่า INSERT [MySQL 8.4: Optimizing INSERT]
- **ข้อควรระวังของ LOAD DATA:** แบบไม่มี `LOCAL` ไฟล์ต้องอยู่บนเครื่อง server และต้องผ่านเงื่อนไข `secure_file_priv`
  ส่วน `LOCAL` ต้องเปิด `local_infile` ทั้งฝั่ง server และ client
  เมื่อใช้ `LOCAL` แถวที่ key ซ้ำจะถูกจัดการเหมือน `IGNORE` (ข้ามไป) [MySQL 8.4: LOAD DATA]
  ค่า default ของ `local_infile` ให้ตรวจด้วย `SHOW VARIABLES` เอง *[ยังไม่ยืนยันค่า default จากหน้าที่อ่าน]*
- **ตัวอย่างการใช้งาน:** import ตารางเวรแพทย์รายเดือนจาก CSV หรือ backfill ข้อมูลตอน onboard โรงพยาบาลใหม่

### 1.8 UPDATE/DELETE ทีละก้อน (chunked)
- `DELETE` และ `UPDATE` แบบตารางเดียวรองรับ `ORDER BY ... LIMIT` (แบบหลายตารางไม่รองรับ)
  คู่มือแนะนำให้รันซ้ำจนจำนวนแถวที่ถูกลบน้อยกว่าค่า LIMIT [MySQL 8.4: DELETE; MySQL 8.4: UPDATE]
- การลบแถวจำนวนมากจากตาราง InnoDB ใหญ่ ๆ อาจทำให้ lock table size เกินขีดจำกัด
  ทางเลือกคือ copy แถวที่จะเก็บไว้ไปตารางใหม่ แล้ว `RENAME TABLE` แบบ atomic [MySQL 8.4: DELETE]
- **ข้อควรระวัง:** transaction ใหญ่จะถือ lock นานและทำให้ replica lag ควรใช้ก้อนเล็กแล้วพักระหว่างรอบ *[ความเห็น]*
```sql
-- รันซ้ำจนกว่า ROW_COUNT() < 5000
DELETE FROM queue_tickets WHERE service_date < '2025-01-01' ORDER BY id LIMIT 5000;
```

### 1.9 INSERT ... ON DUPLICATE KEY UPDATE (upsert)
- **คืออะไร:** ถ้าแถวที่จะ insert ชน `UNIQUE` หรือ `PRIMARY KEY` ระบบจะ UPDATE แถวเดิมแทน
  ค่า affected-rows ต่อแถวเป็น 1 เมื่อ insert, 2 เมื่อ update และ 0 เมื่อค่าเหมือนเดิม [MySQL 8.4: INSERT ... ON DUPLICATE KEY UPDATE]
- **ข้อควรระวัง:**
  - การอ้างถึงแถวใหม่ด้วย `VALUES()` เป็น **deprecated** ให้ใช้ row alias (`AS new`) แทน
  - คู่มือแนะนำให้หลีกเลี่ยงการใช้กับตารางที่มี unique index หลายตัว
  - บน InnoDB ที่มี auto-increment การ INSERT แบบนี้จะเลื่อนค่า auto-increment แม้สุดท้ายจะกลายเป็น UPDATE
  - ไม่ปลอดภัยกับ statement-based replication ในบางกรณี [MySQL 8.4: INSERT ... ON DUPLICATE KEY UPDATE]
```sql
INSERT INTO daily_queue_stats (hospital_id, department_id, service_date, total_tickets, completed_tickets)
VALUES (7, 12, '2026-10-27', 1, 0) AS new
ON DUPLICATE KEY UPDATE total_tickets = daily_queue_stats.total_tickets + new.total_tickets;
```

### 1.10 SELECT ... FOR UPDATE SKIP LOCKED (หยิบงานจากคิวพร้อมกันหลายตัว)
- **คืออะไร:** locking read ที่ไม่รอ row lock แต่ตัดแถวที่ถูก lock อยู่ออกจากผลลัพธ์ทันที (`NOWAIT` จะ error แทน)
  คู่มือระบุว่าวิธีนี้ให้ "inconsistent view" จึงไม่เหมาะกับงาน transaction ทั่วไป
  แต่เหมาะกับการลด lock contention เมื่อหลาย session อ่านตารางลักษณะคิว [MySQL 8.4: Locking Reads]
- **เวอร์ชัน:** เริ่มมีใน **MySQL 8.0.1** [MySQL Blog: 8.0.1 SKIP LOCKED/NOWAIT]
- **ข้อควรระวัง:** ใช้ได้กับ row lock เท่านั้น และไม่ปลอดภัยกับ statement-based replication [MySQL 8.4: Locking Reads]
  เอกสาร query builder ของ Laravel 13 อธิบายเฉพาะ `sharedLock()`/`lockForUpdate()` ไม่มี `skipLocked` [Laravel: Query Builder]
  ใน repo นี้จึงส่ง lock clause เองด้วย `->lock('for update skip locked')` (`QueueService::callNext()`) และทดสอบบน MySQL 8.4 ใน CI แล้ว
- **ใช้กับระบบนี้อย่างไร:** แพทย์หลายห้องตรวจกด "เรียกคิวถัดไป" พร้อมกันโดยไม่ได้คิวซ้ำและไม่ต้องรอกัน
```php
// QueueService::callNext() ใน repo นี้ (ย่อ)
DB::transaction(function () use ($staff, $skillIds) {
    $ticket = QueueTicket::where('department_id', $staff->department_id)
        ->where('service_date', today())->where('status', 'waiting')
        ->where(fn ($q) => $q->whereNull('required_skill_id')->orWhereIn('required_skill_id', $skillIds))
        ->orderByDesc('priority')->orderBy('id')
        ->lock('for update skip locked')
        ->first();
    $ticket?->update(['status' => 'called', 'staff_id' => $staff->id, 'called_at' => now()]);
});
```

### 1.11 Range partitioning รายเดือน และข้อจำกัด
- **คืออะไร:** แบ่งตารางเป็น partition ตามช่วงของค่าวันที่ คู่มือระบุว่าเหมาะเมื่อ (1) ต้องลบข้อมูลเก่า
  (2) partition ตามคอลัมน์วันเวลา และ (3) query กรองด้วยคอลัมน์ที่ใช้ partition ซึ่งทำให้เกิด **partition pruning**
  การ `ALTER TABLE ... DROP PARTITION` "can be much more efficient" กว่าการใช้ `DELETE` [MySQL 8.4: RANGE Partitioning]
  pruning ทำงานกับ `YEAR()`, `TO_DAYS()` และ `TO_SECONDS()` บนคอลัมน์ DATE/DATETIME [MySQL 8.4: Partition Pruning]
- **ข้อจำกัดสำคัญ:**
  - **InnoDB ที่ถูก partition ใช้ foreign key ไม่ได้ทั้งสองทิศทาง** คือตาราง partition มี FK ไม่ได้
    และตารางอื่นก็มี FK ชี้มาที่มันไม่ได้ [MySQL 8.4: Partitioning Limitations]
  - **unique key ทุกตัวรวมถึง PK ต้องมีคอลัมน์ที่ใช้ partition** จึงต้องเปลี่ยน PK เป็น `(id, service_date)` [MySQL 8.4: Partitioning Keys]
  - มีได้สูงสุด 8192 partition, ไม่รองรับ FULLTEXT และการจัดการ partition มักต้องใช้ write lock [MySQL 8.4: Partitioning Limitations]
  - `ADD PARTITION` เพิ่มได้เฉพาะช่วงบนสุด ถ้ามี `MAXVALUE` อยู่ต้องใช้ `REORGANIZE PARTITION` แยกช่วงแทน [MySQL 8.4: Managing RANGE Partitions]
- **ใช้กับระบบนี้อย่างไร *[ความเห็น]*:** ใน repo นี้ `queue_tickets` มี FK ไปหา `hospitals`/`departments`/`skills`/`staff` อยู่
  ต้องตัดสินใจว่าจะย้ายการตรวจ integrity ไปไว้ในชั้นแอป หรือจะไม่ partition แล้ว archive ด้วยวิธีอื่น
  นี่คือ trade-off ที่ควรพูดถึงในการสัมภาษณ์
```sql
CREATE TABLE queue_tickets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  hospital_id INT UNSIGNED NOT NULL,
  service_date DATE NOT NULL,
  status VARCHAR(16) NOT NULL,
  PRIMARY KEY (id, service_date),
  KEY ix_main (hospital_id, service_date, status, id)
)
PARTITION BY RANGE COLUMNS (service_date) (
  PARTITION p2026_09 VALUES LESS THAN ('2026-10-01'),
  PARTITION p2026_10 VALUES LESS THAN ('2026-11-01'),
  PARTITION pmax     VALUES LESS THAN (MAXVALUE)
);
```

### 1.12 Summary/aggregate tables
- **คืออะไร:** ตารางสรุปที่คำนวณไว้ล่วงหน้า เช่น `daily_queue_stats(hospital_id, department_id, service_date, total_tickets, completed_tickets, avg_wait_seconds)` ที่มีใน repo นี้
  เพื่อให้ dashboard ไม่ต้อง `GROUP BY` บนข้อมูล 33 ล้านแถว อัปเดตได้ด้วย upsert (ข้อ 1.9) หรือ job ที่รันตามรอบเวลา
- **ข้อควรระวัง *[ความเห็น]*:** ข้อมูลอาจไม่ตรงกับต้นฉบับ ต้องมี job สำหรับ rebuild/reconcile
  และต้องกำหนดชัดว่าตัวเลขบนหน้าจอช้ากว่าข้อมูลจริงได้นานเท่าไร
  แนวคิดนี้ตรงกับ materialized view ใน CQRS ข้อ 4.2 [MS: CQRS]

### 1.13 Read replicas
- MySQL replication เป็นแบบ **asynchronous โดย default** การ scale-out คือส่ง write ทั้งหมดไปที่ source
  และกระจาย read ไปยัง replica หลายตัว [MySQL 8.4: Replication]
- ใน Laravel ตั้งค่าแยก `read`/`write` host ได้ และมีตัวเลือก `sticky` ที่ทำให้ read ใน request เดียวกันหลังจาก write ไปอ่านที่ write connection
  ส่วน middleware `PreventStaleDatabaseReads` ขยายพฤติกรรมนี้ไปยัง request ถัดไปใน session เดียวกัน (default 2 วินาที) [Laravel: Database]
- **ข้อควรระวัง:** replica lag เช่น คนไข้กดรับคิวแล้วหน้าจอยังไม่แสดงคิวของตัวเอง
  การดำเนินการที่ต้องเห็นข้อมูลล่าสุดควรอ่านจาก primary

### 1.14 Archiving
- **ถ้าตารางเป็น partition:** ใช้ `ALTER TABLE ... EXCHANGE PARTITION p WITH TABLE t_archive` ซึ่งเป็นการสลับในระดับ metadata
  ตารางปลายทางต้องมีโครงสร้างเหมือนกัน ไม่ได้ partition และไม่มี FK
  ส่วน `WITHOUT VALIDATION` ช่วยข้ามการตรวจแถว ในตัวอย่างของคู่มือกับข้อมูล 1 ล้านแถวใช้ 0.74 วินาทีเมื่อตรวจ เทียบกับ 0.01 วินาทีเมื่อข้าม
  [MySQL 8.4: Exchanging Partitions] จากนั้นจึง `DROP PARTITION`
- **ถ้าไม่ได้ partition:** ใช้ `INSERT ... SELECT` ไปยังตาราง archive แล้ว `DELETE` ทีละก้อน (ข้อ 1.8)
- **นโยบาย *[ความเห็น]*:** ระยะเวลาเก็บข้อมูลผู้ป่วยต้องเป็นไปตามข้อกำหนดของโรงพยาบาลและกฎหมาย ควรถามก่อน ไม่ควรเดาเอง

---

## 2. ชั้น Laravel

### 2.1 เปรียบเทียบเมธอดสำหรับวนอ่านข้อมูลจำนวนมาก

| เมธอด | จำนวน query | หน่วยความจำ | ปลอดภัยเมื่อ update คอลัมน์ที่ใช้กรองระหว่างวนไหม | Eager load ได้ไหม |
|---|---|---|---|---|
| `get()` / `all()` | 1 | โหลดทุกแถวเข้าหน่วยความจำ (เอกสารเตือนว่าอาจ out of memory) | – | ได้ |
| `chunk(n, fn)` | 1 ต่อก้อน | ทีละก้อน | **ไม่ปลอดภัย** เอกสารบอกว่าผลอาจ "unexpected and inconsistent" | ได้ |
| `chunkById(n, fn)` | 1 ต่อก้อน | ทีละก้อน | **ปลอดภัย** เพราะดึงแถวที่ `id >` ค่าสุดท้ายของก้อนก่อน | ได้ |
| `lazy(n)` | 1 ต่อก้อน | ทีละก้อน แต่คืนเป็น `LazyCollection` แบบ stream | ไม่ปลอดภัย (ใช้ `lazyById` แทน) | ได้ |
| `lazyById(n)` / `lazyByIdDesc` | 1 ต่อก้อน | ทีละก้อน | ปลอดภัย | ได้ |
| `cursor()` | **1 query** | hydrate model ทีละตัว แต่ PDO ยัง buffer ผลดิบทั้งหมด จึงยัง out of memory ได้ | – | **ไม่ได้** |

แหล่งที่มา: [Laravel: Eloquent], [Laravel: Query Builder]

**ข้อควรระวังเพิ่มเติม:**
- `chunkById`/`lazyById` จะเพิ่ม `where` ของตัวเองเข้าไปใน query ดังนั้นเงื่อนไข `orWhere` ต้องครอบด้วย closure (logical grouping)
- ถ้าเปลี่ยนค่า primary key หรือ foreign key ระหว่างวน แถวอาจหลุดจากผลลัพธ์ได้ [Laravel: Query Builder]
- สำหรับงานใหญ่มาก เอกสารแนะนำ `lazy` มากกว่า `cursor` [Laravel: Eloquent]
- `chunk` แบ่งหน้าด้วย limit/offset ภายใน framework *[ยังไม่ยืนยันจากเอกสาร เป็นรายละเอียดของ implementation]*

```php
// ปิดคิวค้างของเมื่อวาน: กรองด้วย status และเปลี่ยน status ระหว่างวน จึงต้องใช้ ById
QueueTicket::where(fn ($q) => $q->where('status', 'waiting')->orWhere('status', 'called'))
    ->where('service_date', '<', today())
    ->chunkById(1000, fn ($rows) => QueueTicket::whereKey($rows->modelKeys())
        ->update(['status' => 'expired']));
```

### 2.2 cursorPaginate
- **คืออะไร:** แทนที่จะใช้ OFFSET ระบบจะสร้าง `where` ที่เทียบกับค่าของคอลัมน์ที่ใช้เรียง แล้วส่ง cursor ที่ encode แล้วผ่าน query string
  เอกสาร Laravel ระบุว่า "providing the most efficient database performance" ในบรรดาวิธี paginate ทั้งหมด
  และเหมาะกับข้อมูลขนาดใหญ่และ infinite scroll [Laravel: Pagination]
- **ข้อจำกัด:** มีแค่ลิงก์ถัดไป/ก่อนหน้า ต้องเรียงด้วยคอลัมน์หรือชุดคอลัมน์ที่ unique ห้ามมีค่า `null`
  ถ้าใช้ expression ใน `ORDER BY` ต้องตั้ง alias และ select คอลัมน์นั้นด้วย [Laravel: Pagination]
  ส่วน `paginate()` แบบปกติจะรัน `COUNT` ทุกครั้ง ถ้าไม่ต้องแสดงจำนวนหน้าให้ใช้ `simplePaginate` [Laravel: Pagination]
```php
return QueueTicket::where('hospital_id', $hid)
    ->orderByDesc('called_at')->orderByDesc('id')
    ->cursorPaginate(50);   // ส่ง next_cursor ไปให้ TanStack Query
```

### 2.3 Eager loading / N+1 และ preventLazyLoading
- การอ่าน relation แบบ lazy ภายใน loop ทำให้เกิด query 1 + N ครั้ง ตัวอย่างในเอกสารคือหนังสือ 25 เล่มต้องใช้ 26 query
  ส่วน `with('author')` ลดเหลือ 2 query [Laravel: Eloquent Relationships]
- ใช้ `Model::preventLazyLoading(! $this->app->isProduction())` ใน `AppServiceProvider` เพื่อให้ lazy load โยน exception ตอน dev/test
  แต่ production ยังทำงานได้ตามปกติ [Laravel: Eloquent]
- ใน repo นี้ `RosterService::roster()` ใช้ `with('staff:id,name', 'staff.skills:id')` และ `LookupController::staff()` ใช้ `with('skills:id,code,name')`

### 2.4 Insert/upsert แบบ batch
- `upsert($values, uniqueBy, update)` ทำ insert-or-update ใน operation เดียว และตั้ง `created_at`/`updated_at` ให้อัตโนมัติ
  **บน MySQL/MariaDB พารามิเตอร์ `uniqueBy` จะถูกละเลย** ระบบใช้ primary/unique index ของตารางเสมอ [Laravel: Eloquent]
  พฤติกรรมนี้จึงมีความเสี่ยงเดียวกับข้อ 1.9 ถ้าตารางมี unique index หลายตัว
- `insertOrIgnore` จะเลี่ยง strict mode ของ MySQL ทำให้ error อื่นนอกจาก key ซ้ำถูกกลืนไปด้วย [Laravel: Query Builder]
- ควรแบ่ง array ก่อนส่ง เช่น `collect($rows)->chunk(1000)->each(fn ($c) => DB::table('x')->insert($c->all()))`
  เพื่อไม่ให้ statement ใหญ่เกิน `max_allowed_packet` *[ความเห็น]*

### 2.5 Queue/Job สำหรับงานที่ใช้เวลานาน
- เอกสาร Laravel ให้ย้ายงานที่ใช้เวลานาน (ตัวอย่างคือ parse CSV) ไปไว้ใน queue เพื่อให้ตอบ request ได้เร็ว
  เมื่อส่ง model เข้า job ระบบจะ serialize แค่ identifier แล้วดึง model ใหม่ตอนรัน [Laravel: Queues]
- เครื่องมือที่เกี่ยวข้อง [Laravel: Queues]:
  - `ShouldBeUnique` กันไม่ให้มี job เดียวกันซ้ำในคิว
  - middleware `WithoutOverlapping($key)` กันไม่ให้ job ทำงานซ้อนกันตาม key เช่น ต่อ hospital
  - `RateLimited` จำกัดอัตราการรัน
- **ใช้กับระบบนี้อย่างไร:** import ตารางเวร, สร้างรายงานรายเดือน, rebuild summary table และ broadcast event (ข้อ 3.6)

### 2.6 Caching
- `Cache::remember($key, $ttl, fn)` เป็น cache-aside แบบพื้นฐาน [Laravel: Cache]
- `Cache::flexible($key, [fresh, stale], fn)` เป็น **stale-while-revalidate** โดยช่วง fresh คืนค่าทันที
  ช่วง stale คืนค่าเก่าแล้ว refresh ผ่าน deferred function หลังส่ง response ไปแล้ว
  และเมื่อเลยช่วง stale จะคำนวณใหม่ทันที [Laravel: Cache]
  เหมาะกับข้อมูลที่ช้ากว่าความจริงได้ไม่กี่วินาที เช่น สถิติบนจอ
- `Cache::lock()` เป็น atomic lock ที่ต้องให้ทุก server ใช้ cache กลางตัวเดียวกัน
  ส่วน cache tags ไม่รองรับบน driver `file`/`database`/`dynamodb`/`storage` [Laravel: Cache]
- **ข้อควรระวัง:** key ต้องมี tenant อยู่ในชื่อเสมอ เช่น `h:{id}:sp:{id}:waiting` เพื่อไม่ให้ข้อมูลรั่วข้าม tenant
  และ `Cache::flush()` ไม่สนใจ prefix [Laravel: Cache]

---

## 3. ชั้น Frontend (React 19 + TanStack)

### 3.1 Virtualization (TanStack Virtual)
- **คืออะไร:** "headless UI utility for virtualizing long lists" โดยจะ render เฉพาะแถวที่มองเห็น ไม่ได้ render หลายหมื่นแถว
  ค่าที่ต้องกำหนดคือ `count`, `getScrollElement` และ `estimateSize` [TanStack Virtual: Introduction]
- **ตัวเลือกสำคัญ:**
  - `overscan` (default คือ 1)
  - `estimateSize` ควรประเมินขนาดใหญ่สุดที่เป็นไปได้
  - `measureElement` สำหรับแถวที่สูงไม่เท่ากัน
  - `getItemKey` ควรคืน id ที่ unique แทน index ที่เป็นค่า default [TanStack Virtual: Virtualizer API]
- **ข้อควรระวัง:** การค้นหาด้วย Ctrl+F ของเบราว์เซอร์และ screen reader จะไม่เห็นแถวที่ไม่ได้ render *[ความเห็น]*

### 3.2 Infinite query + cursor (TanStack Query)
- `useInfiniteQuery` ใช้ `queryFn({ pageParam })`, `initialPageParam` (required) และ `getNextPageParam`
  ซึ่งคืน `null`/`undefined` เมื่อไม่มีหน้าถัดไป [TanStack Query: Infinite Queries]
- **ข้อควรระวัง:**
  - มี fetch ของ InfiniteQuery ได้ครั้งละหนึ่งอันเท่านั้น ควรตรวจ `isFetching` ก่อนเรียก `fetchNextPage`
  - เมื่อ refetch ระบบจะดึง **ทุกหน้าตามลำดับตั้งแต่หน้าแรก** ควรใช้ `maxPages` จำกัดหน่วยความจำและต้นทุนการ refetch [TanStack Query: Infinite Queries]

### 3.3 กรองที่ server, debounce และ AbortController
- อย่าโหลด 10,000 แถวมากรองฝั่ง client ให้ส่ง filter ไปที่ API ที่มี index รองรับ (ข้อ 1.1) และรวม filter เข้าไปใน `queryKey`
- **Debounce** คือการรวม operation ที่เกิดถี่ ๆ ให้เหลือการเรียกครั้งเดียว ใช้กับช่องค้นหาโดยรอให้ผู้ใช้หยุดพิมพ์ก่อน [MDN: Debounce]
- **AbortController** ยกเลิก fetch ที่ยังไม่เสร็จได้ [MDN: AbortController]
  TanStack Query ส่ง `signal` เข้า `queryFn` และถ้าโค้ดส่ง signal นี้ต่อให้ `fetch` request เก่าจะถูกยกเลิกเมื่อ `queryKey` เปลี่ยน
  แต่ถ้าไม่ได้ใช้ signal request เก่าจะยังทำงานจนจบ [TanStack Query: Query Cancellation]
```tsx
const debounced = useDebouncedValue(search, 300);           // hook debounce ของโปรเจกต์
const q = useInfiniteQuery({
  queryKey: ['tickets', hospitalId, { search: debounced, status }],
  queryFn: ({ pageParam, signal }) =>
    fetch(`/api/hospitals/${hospitalId}/tickets?cursor=${pageParam ?? ''}&q=${encodeURIComponent(debounced)}`,
          { signal }).then(r => r.json()),
  initialPageParam: null as string | null,
  getNextPageParam: (last) => last.next_cursor ?? undefined,   // มาจาก cursorPaginate
  maxPages: 10,
  staleTime: 15_000,
});
const rows = q.data?.pages.flatMap(p => p.data) ?? [];
const v = useVirtualizer({ count: rows.length, getScrollElement: () => ref.current,
                           estimateSize: () => 44, getItemKey: i => rows[i].id, overscan: 8 });
```

### 3.4 Caching และ staleTime
- ค่า default ของ TanStack Query ถือว่าข้อมูลใน cache **stale ทันที** (staleTime 0) และจะ refetch เมื่อ mount, focus หน้าต่าง หรือเน็ตกลับมา
  query ที่ไม่ได้ใช้จะถูกลบออกหลัง 5 นาที (gcTime) และ retry 3 ครั้ง [TanStack Query: Important Defaults]
- การตั้ง `staleTime` ให้เหมาะกับข้อมูลช่วยลด request ได้มาก เช่น ตารางเวร 5 นาที, รายชื่อแผนก 1 ชั่วโมง
  ส่วนคิวไม่ต้องตั้งค่านี้เพราะจะ push ผ่าน WebSocket แทน *[ความเห็น]*
- `invalidateQueries({ queryKey: ['tickets'] })` match แบบ prefix และ refetch query ที่ active อยู่ [TanStack Query: Query Invalidation]

### 3.5 Push ผ่าน WebSocket แทน polling
- เอกสาร Laravel ระบุว่า WebSocket เป็น "more efficient alternative to continually polling"
  event ที่ implement `ShouldBroadcast` จะถูกส่งผ่าน queue (ต้องมี worker) ส่วน `ShouldBroadcastNow` จะส่งทันที
  private channel ต้องมีการ authorize ใน `routes/channels.php` [Laravel: Broadcasting]
- **Laravel Reverb:**
  - scale แนวนอนได้ด้วย Redis pub/sub (`REVERB_SCALING_ENABLED=true`) โดยวางหลัง load balancer
  - event loop default (`stream_select`) รับได้ประมาณ 1,024 ไฟล์ ถ้าเกิน 1,000 connection ต้องใช้ `ext-uv`
  - ต้องปรับ `ulimit`, nginx `worker_connections` และ supervisor `minfds` [Laravel: Reverb]
- **Socket.IO (สำหรับฝั่ง NestJS ในอนาคต):**
  - Redis adapter ใช้ pub/sub ส่ง packet ข้าม server แต่ **ยังต้องใช้ sticky session** ไม่อย่างนั้นจะได้ HTTP 400
  - สำหรับโปรเจกต์ใหม่ เอกสารแนะนำ sharded adapter ซึ่งต้องใช้ Redis 7.0 ขึ้นไป [Socket.IO: Redis adapter]
- **ข้อควรระวังสำคัญ:** Redis Pub/Sub เป็น **at-most-once** ถ้า subscriber หลุด ข้อความจะหายไปถาวร [Redis: Pub/Sub]
  ดังนั้นจอคิวต้อง **ดึง snapshot ใหม่ทุกครั้งที่ reconnect** และควรมี sequence number เพื่อตรวจว่ามีข้อความหาย *[ความเห็น]*
- **รูปแบบที่แนะนำ *[ความเห็น]*:**
  1. จอเข้า channel `queue.h{hospital}.dept{department}`
  2. ได้รับ event แล้วนำไปอัปเดต cache ด้วย `queryClient.setQueryData` หรือ invalidate
  3. polling ใช้เป็น fallback ที่ช่วงห่างยาว
```js
echo.private(`queue.h${h}.dept${dept}`)
    .listen('TicketCalled', (e) => qc.setQueryData(['board', h, dept], (old) => applyEvent(old, e)));
```

### 3.6 Web Workers
- Web Workers รัน script ใน background thread โดยไม่บล็อก UI แต่เข้าถึง DOM ไม่ได้
  ข้อมูลที่ส่งผ่าน `postMessage` จะถูก **copy** ด้วย structured clone
  ถ้าเป็นข้อมูลก้อนใหญ่ใช้ transferable object (เช่น `ArrayBuffer`) เพื่อย้ายแบบ zero-copy ได้ [MDN: Using Web Workers]
- **ใช้กับระบบนี้อย่างไร:** parse หรือ validate CSV ตารางเวรก่อน upload, export รายงานขนาดใหญ่ฝั่ง client
  ไม่ควรใช้กับรายการที่ server กรองและแบ่งหน้าให้อยู่แล้ว

---

## 4. ชั้นสถาปัตยกรรม

### 4.1 Caching ด้วย Redis
- **Cache-aside:** อ่านจาก cache ก่อน ถ้าไม่มี (miss) ให้อ่านจาก DB แล้วเขียนลง cache
  เวลาเขียนให้ **อัปเดต DB ก่อนแล้วจึงลบ cache** ถ้าลบ cache ก่อน อาจมี request อื่นนำค่าเก่ากลับมาใส่ cache [MS: Cache-Aside]
  pattern นี้ไม่รับประกัน consistency และไม่เหมาะกับข้อมูล sensitive ใน cache ที่ใช้ร่วมกันหลายผู้ใช้ [MS: Cache-Aside]
  ข้อมูลผู้ป่วยจึงควรเก็บเฉพาะที่จำเป็นและไม่ใส่ PII *[ความเห็น]*
- **Eviction:** ตั้ง `maxmemory` และ `maxmemory-policy` โดย `allkeys-lru` เป็นค่าเริ่มต้นที่ดีเมื่อข้อมูลบางส่วนถูกเข้าถึงบ่อยกว่าส่วนอื่นมาก
  ถ้าใช้ Redis ตัวเดียวทั้งเป็น cache และเก็บ key ที่ต้องคงอยู่ เอกสารแนะนำให้แยกเป็น 2 instance
  ใช้ค่า `keyspace_hits`/`keyspace_misses` ใน `INFO` วัด hit ratio ได้ [Redis: Key eviction]

### 4.2 CQRS-lite (read model)
- **คืออะไร:** แยกโมเดลการเขียน (command) ออกจากโมเดลการอ่าน (query)
  ระดับพื้นฐานใช้ data store เดียวกันได้ ส่วน read store อาจเป็น materialized view หรือ replica
  เหมาะเมื่อ read มากกว่า write มาก [MS: CQRS]
- **ข้อควรระวัง:** ความซับซ้อนเพิ่มขึ้น, read model เป็น eventual consistency (อาจเห็นข้อมูลเก่า)
  และไม่เหมาะกับ domain ที่เป็น CRUD ธรรมดา ถ้าใช้ event ควรใช้ Transactional Outbox และทำให้ consumer เป็น idempotent [MS: CQRS]
- **ใช้กับระบบนี้อย่างไร *[ความเห็น]*:** "CQRS-lite" ในที่นี้คือ ฝั่งเขียนยังเป็น Laravel + MySQL
  เมื่อมีการเรียกหรือออกคิว job จะอัปเดต read model ของจอ (เช่น Redis hash หรือ sorted set ต่อแผนก) แล้ว broadcast
  จอหลายร้อยจออ่านจาก read model นี้ ไม่ต้องอ่านตาราง `queue_tickets` ตรง ๆ จึงแยกโหลดอ่านที่หนักออกจาก DB หลักได้

### 4.3 Horizontal scaling ของ app server แบบ stateless
- หลัก 12-factor: process ต้อง "stateless and share-nothing" และ sticky session "should never be used or relied upon" [12factor: Processes]
  ดังนั้น session, cache และ lock ต้องอยู่ในที่เก็บกลาง (Redis/DB) จึงเพิ่มจำนวน PHP/Node instance หลัง load balancer ได้
- **ข้อยกเว้นที่ควรพูดตรง ๆ:** WebSocket เป็น connection ที่มี state
  Socket.IO ต้องใช้ sticky session [Socket.IO: Redis adapter] ส่วน Reverb ใช้ load balancer กระจาย connection แล้วส่งข้อความข้ามเครื่องผ่าน Redis [Laravel: Reverb]
  จึงควรแยก tier ของ realtime ออกจาก tier ของ HTTP API

### 4.4 เมื่อไรควร shard ตาม tenant
- **กลยุทธ์:** ใช้ lookup (directory) ด้วย `tenant_id` เป็น shard key ได้ หลาย tenant อาจอยู่ใน shard เดียวกัน แต่ข้อมูลของ tenant หนึ่งไม่ข้าม shard
  การใช้ virtual shard ช่วยให้ rebalance ได้ง่ายขึ้น [MS: Sharding]
- **ควร shard เมื่อ [MS: Sharding]:**
  - ข้อมูลเกินความจุของ instance เดียว
  - throughput ของ write สูงจน read replica ช่วยไม่ได้
  - มีข้อกำหนดด้านภูมิภาคหรือ compliance
  - tenant ต้องการการแยกข้อมูลทางกายภาพ
- **ไม่ควร shard เมื่อ [MS: Sharding]:**
  - ปัญหาคอขวดอยู่ที่ read (ใช้ replica และ cache แทน)
  - partition ภายใน instance เดียวพอแล้ว
  - งานต้องการ join หรือ aggregate ข้าม entity เยอะ
  - เอกสารระบุว่า sharding เพิ่มความซับซ้อน "substantial and permanent" ทั้งเรื่อง monitoring, backup และ DDL ที่ต้องทำทุก shard
- **ประเมินสำหรับระบบนี้ *[ความเห็น/การประมาณ]*:**
  - 90,000 ใบต่อวันเฉลี่ยประมาณ 1 write ต่อวินาที (ช่วงพีคอาจสูงกว่า 10 เท่า) และ 33 ล้านแถวต่อปี
    ปริมาณนี้อยู่ในระดับที่ MySQL instance เดียว + partition รายเดือน + replica + Redis read model รับได้
  - โหลดหลักมาจาก **การอ่าน** ของจอ ไม่ใช่การเขียน
  - จึงยังไม่ควร shard ในตอนนี้ แต่ควรออกแบบให้ทุก query มี `hospital_id` และ key ทุกตัวขึ้นต้นด้วย tenant
    เพื่อให้แยก tenant ใหญ่หรือ tenant ที่ต้องแยกข้อมูลออกไปเป็น shard ได้ภายหลัง
  - ตัวเลขนี้ต้องยืนยันด้วย load test ก่อนตัดสินใจ

---

## 5. สรุปว่าเทคนิคไหนแก้ปัญหาอะไรในระบบนี้

| ปัญหา | เทคนิคหลัก | หัวข้อ | ใน repo นี้ |
|---|---|---|---|
| จอคิวหลายร้อยจออ่านพร้อมกัน | Redis read model + WebSocket push + snapshot เมื่อ reconnect | 3.5, 4.1, 4.2 | ยังไม่ทำ (เดโม polling 15 วินาที) |
| หลายห้องตรวจเรียกคิวพร้อมกัน | `FOR UPDATE SKIP LOCKED` (MySQL 8.0.1 ขึ้นไป) | 1.10 | ทำแล้ว `QueueService::callNext()` |
| เลขคิวไม่ซ้ำเมื่อหลายตู้กดพร้อมกัน | ล็อกแถว counter (`lockForUpdate`) | 1.10 | ทำแล้ว `QueueService::issue()` |
| ประวัติคิวโตปีละ 33 ล้านแถว | partition รายเดือน + exchange/drop partition (แลกกับการเสีย FK) | 1.11, 1.14 | ยังไม่ทำ ใช้ลบทีละก้อน `queue:purge` แทน |
| รายการยาวในหน้าเว็บ | `cursorPaginate` + `useInfiniteQuery` + virtualizer | 1.6, 2.2, 3.1–3.2 | ทำแล้ว `TicketController::index`, `TicketBoard.jsx` |
| dashboard สถิติ | summary table + upsert (+ `Cache::flexible`) | 1.12, 2.4, 2.6 | ทำแล้ว `queue:aggregate-stats` (ยังไม่มี cache) |
| จัดเวรทั้งเดือน / งาน batch | โหลดครั้งเดียวแล้วตรวจกติกาใน memory, insert เป็นชุด, queue job | 2.1, 2.4, 2.5 | ทำแล้ว `RosterService::generate()`, `queue:seed-demo` |
| พิสูจน์ว่า index ถูกใช้จริง | `EXPLAIN` / `EXPLAIN ANALYZE` (8.0.18 ขึ้นไป) | 1.4 | ตรวจแล้ว ผลอยู่ใน README และ ARCHITECTURE.md |

---

## Sources (หน้าที่เปิดอ่านจริงทั้งหมด)

**MySQL (dev.mysql.com)**
- [MySQL: Multiple-Column Indexes] https://dev.mysql.com/doc/refman/8.4/en/multiple-column-indexes.html
- [MySQL 8.4: Descending Indexes] https://dev.mysql.com/doc/refman/8.4/en/descending-indexes.html
- (อ่านประกอบ) https://dev.mysql.com/doc/refman/8.0/en/descending-indexes.html
- [MySQL 8.0: What Is New] https://dev.mysql.com/doc/refman/8.0/en/mysql-nutshell.html
- [MySQL 8.4: EXPLAIN] https://dev.mysql.com/doc/refman/8.4/en/explain.html
- [MySQL 8.0: EXPLAIN] https://dev.mysql.com/doc/refman/8.0/en/explain.html
- [MySQL 8.4: EXPLAIN Output] https://dev.mysql.com/doc/refman/8.4/en/explain-output.html
- [MySQL 8.4: CREATE INDEX] https://dev.mysql.com/doc/refman/8.4/en/create-index.html
- [MySQL 8.4: Range Optimization] https://dev.mysql.com/doc/refman/8.4/en/range-optimization.html
- [MySQL 8.4: Optimizing INSERT] https://dev.mysql.com/doc/refman/8.4/en/insert-optimization.html
- [MySQL 8.4: LOAD DATA] https://dev.mysql.com/doc/refman/8.4/en/load-data.html
- [MySQL 8.4: DELETE] https://dev.mysql.com/doc/refman/8.4/en/delete.html
- [MySQL 8.4: UPDATE] https://dev.mysql.com/doc/refman/8.4/en/update.html
- [MySQL 8.4: INSERT ... ON DUPLICATE KEY UPDATE] https://dev.mysql.com/doc/refman/8.4/en/insert-on-duplicate.html
- [MySQL 8.4: Locking Reads] https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html
- [MySQL Blog: 8.0.1 SKIP LOCKED/NOWAIT] https://dev.mysql.com/blog-archive/mysql-8-0-1-using-skip-locked-and-nowait-to-handle-hot-rows/
- [MySQL 8.4: RANGE Partitioning] https://dev.mysql.com/doc/refman/8.4/en/partitioning-range.html
- [MySQL 8.4: Partitioning Limitations] https://dev.mysql.com/doc/refman/8.4/en/partitioning-limitations.html
- [MySQL 8.4: Partitioning Keys] https://dev.mysql.com/doc/refman/8.4/en/partitioning-limitations-partitioning-keys-unique-keys.html
- [MySQL 8.4: Managing RANGE Partitions] https://dev.mysql.com/doc/refman/8.4/en/partitioning-management-range-list.html
- [MySQL 8.4: Exchanging Partitions] https://dev.mysql.com/doc/refman/8.4/en/partitioning-management-exchange.html
- [MySQL 8.4: Partition Pruning] https://dev.mysql.com/doc/refman/8.4/en/partitioning-pruning.html
- [MySQL 8.4: Replication] https://dev.mysql.com/doc/refman/8.4/en/replication.html

**use-the-index-luke.com**
- [UTIL: Concatenated keys] https://use-the-index-luke.com/sql/where-clause/the-equals-operator/concatenated-keys
- [UTIL: Index-only scan] https://use-the-index-luke.com/sql/clustering/index-only-scan-covering-index
- [UTIL: Obfuscated conditions] https://use-the-index-luke.com/sql/where-clause/obfuscation
- [UTIL: Dates] https://use-the-index-luke.com/sql/where-clause/obfuscation/dates
- [UTIL: No-offset] https://use-the-index-luke.com/no-offset
- [UTIL: Fetch next page] https://use-the-index-luke.com/sql/partial-results/fetch-next-page

**Laravel 13.x (laravel.com/docs)**
- [Laravel: Eloquent] https://laravel.com/docs/13.x/eloquent
- [Laravel: Query Builder] https://laravel.com/docs/13.x/queries
- [Laravel: Pagination] https://laravel.com/docs/13.x/pagination
- [Laravel: Eloquent Relationships] https://laravel.com/docs/13.x/eloquent-relationships
- [Laravel: Database] https://laravel.com/docs/13.x/database
- [Laravel: Queues] https://laravel.com/docs/13.x/queues
- [Laravel: Cache] https://laravel.com/docs/13.x/cache
- [Laravel: Broadcasting] https://laravel.com/docs/13.x/broadcasting
- [Laravel: Reverb] https://laravel.com/docs/13.x/reverb

**TanStack**
- [TanStack Virtual: Introduction] https://tanstack.com/virtual/latest/docs/introduction
- [TanStack Virtual: Virtualizer API] https://tanstack.com/virtual/latest/docs/api/virtualizer
- [TanStack Query: Infinite Queries] https://tanstack.com/query/latest/docs/framework/react/guides/infinite-queries
- [TanStack Query: Important Defaults] https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults
- [TanStack Query: Query Cancellation] https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation
- [TanStack Query: Query Invalidation] https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation

**MDN / Redis / Socket.IO / สถาปัตยกรรม**
- [MDN: AbortController] https://developer.mozilla.org/en-US/docs/Web/API/AbortController
- [MDN: Debounce] https://developer.mozilla.org/en-US/docs/Glossary/Debounce
- [MDN: Using Web Workers] https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers
- [Redis: Key eviction] https://redis.io/docs/latest/develop/reference/eviction/
- [Redis: Pub/Sub] https://redis.io/docs/latest/develop/pubsub/
- [Socket.IO: Redis adapter] https://socket.io/docs/v4/redis-adapter/
- [MS: Cache-Aside] https://learn.microsoft.com/en-us/azure/architecture/patterns/cache-aside
- [MS: CQRS] https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs
- [MS: Sharding] https://learn.microsoft.com/en-us/azure/architecture/patterns/sharding
- [12factor: Processes] https://12factor.net/processes

### ข้อที่ยังยืนยันไม่ได้หรือไม่ได้ใส่ไว้
- เลข minor version ที่เริ่มมี descending index และ functional key part (หน้าคู่มือที่เปิดระบุแค่ว่าเป็นของซีรีส์ 8.0)
- ค่า default ของ `local_infile` ใน 8.4
- ภายใน `chunk()` ของ Laravel ใช้ offset (เอกสารบอกเพียงว่า `chunkById` แบ่งหน้าตาม primary key)
- ไม่ได้ใส่ข้ออ้างเรื่อง SQL ที่ `cursorPaginate` สร้างจริงเมื่อเรียงหลายคอลัมน์ และ API `skipLocked` ของ Laravel (ไม่มีในเอกสาร 13.x)
- ไม่ได้ใส่หัวข้อ "Automatic Eager Loading" ของ Laravel 13 เพราะหน้าที่ดึงมาถูกตัดก่อนถึงส่วนนั้น
