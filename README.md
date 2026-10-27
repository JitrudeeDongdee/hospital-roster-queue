# Hospital Queue API

A multi-hospital queue management API built with **Laravel 13, PHP 8.5 and MySQL 8.4**.
It is a practice project for a hospital queue system that starts with 15 hospitals and
grows to 30, so it focuses on three things: keeping each hospital's data separate,
routing patients to staff with the right skill, and staying fast as tickets pile up.

## What it does

- **Issue tickets:** each department runs its own numbers every day. A locked counter row keeps numbers unique when several kiosks issue tickets at the same moment.
- **Skill-based calling:** staff can only call tickets that need a skill they have, or tickets that need no particular skill. Higher priority goes first, then first come, first served.
- **Concurrent calling:** `FOR UPDATE SKIP LOCKED` lets several rooms call at once without two rooms getting the same patient.
- **Hospital isolation:** every route sits under `/hospitals/{hospital}` with scoped bindings, so a department, staff member or ticket from another hospital returns `404`.
- **No patient personal data:** tickets store a reference code only.

## Large-data techniques

| Technique | Where | Why |
|---|---|---|
| Composite indexes matched to queries, incl. `priority DESC, id` | `create_queue_tables` migration | Calling the next patient and listing a hospital's queue read the index, with no filesort |
| Keyset (cursor) pagination | `TicketController@index` → `cursorPaginate()` | Deep pages stay as fast as the first page |
| Batched inserts | `queue:seed-demo` | 1,000 rows per `INSERT` instead of one row at a time |
| Daily summary table + `upsert` | `queue:aggregate-stats`, `daily_queue_stats` | Dashboards read one row per department per day, not millions of tickets. Re-running the command does not duplicate rows |
| Chunked deletes | `queue:purge` | Deletes old tickets in small batches so the table is never locked for long |
| Scheduled aggregation | `routes/console.php` | Summarises yesterday every night at 00:30 |

### Measured on MySQL 8.4 (200,000 tickets, 15 hospitals, 45 departments)

- Seeding 200,000 tickets in batches: **22.9 s**
- Reading page 3,981 with `OFFSET 199000`: **46 ms**. The same page with keyset (`id > ?`): **0.14 ms**
- `EXPLAIN` for calling the next patient, listing a hospital's queue and reading stats: all three use their index, `range` access, no filesort

## Endpoints

All endpoints are under `/api/hospitals/{hospital}`.

| Method | Path | Result |
|---|---|---|
| POST | `/departments/{department}/tickets` | Issue a ticket → `201` |
| POST | `/staff/{staff}/call-next` | Call the next ticket this staff member can take (`404` if none) |
| POST | `/tickets/{ticket}/complete` | Complete a called ticket |
| GET | `/tickets?status=waiting&date=YYYY-MM-DD&cursor=…` | Today's tickets, 50 per page, cursor-paginated |
| GET | `/stats?from=YYYY-MM-DD&to=YYYY-MM-DD` | Daily totals and average wait per department |

## Run locally

```bash
composer install
cp .env.example .env
php artisan key:generate
docker compose up -d --wait
```

Set these in `.env` (MySQL from `docker-compose.yml`, on port 3317):

```
DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3317
DB_DATABASE=hospital_queue
DB_USERNAME=queue
DB_PASSWORD=queue
```

```bash
php artisan migrate
php artisan queue:seed-demo --hospitals=15 --tickets=200000
php artisan queue:aggregate-stats --from=2026-09-27 --to=2026-10-26
php artisan serve
```

## Tests

8 feature tests covering ticket numbering, priority order, skill routing, hospital isolation,
cursor pagination, completing tickets, re-runnable aggregation and purging. They pass on both
SQLite and MySQL 8.4.

```bash
php artisan test
```

## Not covered yet

- Staff authentication. A real system would use Sanctum tokens and check that the staff member belongs to the hospital in the URL.
- Live display screens. These could be added with Laravel Reverb (WebSockets).
- Partitioning `queue_tickets` by month, once the table grows past tens of millions of rows.
