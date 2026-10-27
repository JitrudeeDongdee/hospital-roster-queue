# Hospital Roster & Queue

**Live demo (frontend only): https://jitrudeedongdee.github.io/waka-crud/**
GitHub Pages cannot run PHP, so the demo uses an in-browser mock API that follows the same rules
as the Laravel API below (roster rules, auto-generation, skill-based calling, cursor pagination). Run the project
locally to use the real Laravel + MySQL backend.

A multi-hospital doctor roster and patient queue system built with **Laravel 13, PHP 8.5,
MySQL 8.4 and React 19**. It is a practice project for a hospital system that starts with
15 hospitals and grows to 30. Doctor scheduling is the main feature; each doctor's own
queue view is a supporting feature.

Architecture, BPMN, ER diagram and the scaling and migration plan: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Doctor roster (main feature)

- **Shift templates per department:** morning 08–16, evening 16–24, night 00–08, each with a minimum number of doctors and an optional required skill (for example, the OPD morning shift needs a cardiologist).
- **Rules checked on every assignment:** no overlapping shifts, minimum rest between shifts (8 h by default), a weekly hour limit (60 h by default), and no shifts on a doctor's leave days. Breaking a rule returns `422` with the reasons.
- **Coverage check:** the weekly roster marks every slot that is short of doctors or has no doctor with the required skill.
- **Auto-generate as a draft:** fills only the empty slots, never removes shifts an admin placed, and picks doctors in this order: passes every rule → has the missing skill → fewest hours so far. Slots that cannot be filled within the rules are left for the admin.
- **Doctor's own queue:** each doctor can always see the waiting patients they are able to take (same department, matching skill) and their next shifts.

## Patient queue

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

## Frontend (React 19)

The page at `/` is a React app built with Vite inside Laravel, with two tabs: the weekly
roster (main) and the patient queue.

| Technique | Where | Why |
|---|---|---|
| Infinite scroll over the cursor API | `components/TicketBoard.jsx` → `useInfiniteQuery` | Loads 50 tickets at a time, only when you scroll to the end |
| Virtualized list | `@tanstack/react-virtual` | Renders only the ~20 rows on screen, however many tickets are loaded |
| Server-side filters | status and department sent as query params | The browser never downloads tickets it will not show |
| Query cache | TanStack Query, 10-minute cache for hospitals, departments, staff and skills | Reference data loads once |
| Optimistic update | "Complete" in `components/StaffPanel.jsx` | The screen updates at once and rolls back if the server refuses |

The demo refreshes the board every 15 seconds. A production system would push only the tickets
that changed over WebSockets (Laravel Reverb) instead of polling.

## Endpoints

All endpoints are under `/api/hospitals/{hospital}`, except `GET /api/hospitals` and `GET /api/skills`.

| Method | Path | Result |
|---|---|---|
| POST | `/departments/{department}/tickets` | Issue a ticket → `201` |
| POST | `/staff/{staff}/call-next` | Call the next ticket this staff member can take (`404` if none) |
| POST | `/tickets/{ticket}/complete` | Complete a called ticket |
| GET | `/departments`, `/staff` | Reference data for the page (staff include their skills) |
| GET | `/tickets?status=waiting&department_id=…&date=YYYY-MM-DD&cursor=…` | Today's tickets, 50 per page, cursor-paginated |
| GET | `/stats?from=YYYY-MM-DD&to=YYYY-MM-DD` | Daily totals and average wait per department |
| GET | `/departments/{department}/roster?from=&to=` | Shifts, templates and coverage gaps (max 31 days) |
| POST | `/departments/{department}/roster/generate` | Fill empty slots within the rules → `created`, roster, remaining gaps |
| POST | `/shifts` | Assign a doctor (`staff_id`, `shift_template_id`, `date`) → `201`, or `422` with the broken rules |
| DELETE | `/shifts/{shift}` | Remove a shift |
| GET, POST | `/staff/{staff}/unavailabilities` | Leave days |
| GET | `/staff/{staff}/my-queue` | Waiting tickets this doctor can take, current ticket, next shifts |

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
npm install
npm run build
php artisan serve
```

Open http://127.0.0.1:8000. To build the GitHub Pages demo instead: `npm run build:pages`.

## Tests

18 feature tests. Roster: overnight shifts, overlap, minimum rest, weekly hours, leave days,
coverage gaps, auto-generation (fills every slot, covers skills, keeps manual shifts, leaves
gaps it cannot fill), the doctor's own queue and hospital isolation. Queue: numbering, priority,
skill routing, isolation, cursor pagination, completing, aggregation and purging. CI runs them on
both SQLite and MySQL 8.4 before every deploy.

```bash
php artisan test
```

## Not covered yet

- Staff authentication. A real system would use Sanctum tokens and check that the staff member belongs to the hospital in the URL.
- Live updates. The page polls every 15 seconds; Laravel Reverb (WebSockets) would replace that.
- Partitioning `queue_tickets` by month, once the table grows past tens of millions of rows.
