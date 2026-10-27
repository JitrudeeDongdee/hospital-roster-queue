# Hospital Roster & Queue

**Live demo (frontend only): https://jitrudeedongdee.github.io/hospital-roster-queue/**
GitHub Pages cannot run PHP, so the demo uses an in-browser mock API that follows the same rules
as the Laravel API below (roster rules, auto-generation, skill-based calling, cursor pagination). Run the project
locally to use the real Laravel + MySQL backend.

A multi-hospital doctor roster and patient queue system built with **Laravel 13, PHP 8.5,
MySQL 8.4 and React 19**. It is a practice project for a hospital system that starts with
15 hospitals and grows to 30. Doctor scheduling is the main feature; each doctor's own
queue view is a supporting feature.

Architecture, BPMN, ER diagram, AWS network for each scaling stage and feature proposals: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
Large-data techniques with sources (MySQL, Laravel, TanStack, Redis): [docs/LARGE-DATA.md](docs/LARGE-DATA.md)

## Doctor roster (main feature)

- **Shift templates per department:** morning 08–16, evening 16–24, night 00–08, each with a minimum number of doctors and an optional required skill (for example, the OPD morning shift needs a cardiologist).
- **Rules checked on every assignment:** no overlapping shifts, minimum rest between shifts (8 h by default), a weekly hour limit (60 h by default), and no shifts on a doctor's leave days. Overlaps, leave days and another department's shift are refused with `422`. Short rest and too many weekly hours are allowed when an admin assigns by hand: the response carries `warnings`, and every shift involved (both sides of a short rest, the whole over-limit week) shows as a red chip in the table and calendars, with the doctor marked red in the hours panel, until the admin fixes it. Auto-generate and doctors' move/swap requests still treat all rules as hard.
- **Monthly roster:** the admin plans a whole month at a time; the weekly hour limit is still checked week by week.
- **Coverage check:** the monthly roster marks every slot that is short of doctors or has no doctor with the required skill.
- **Auto-generate a month as a draft:** fills only the empty slots (124 shifts for a 6-doctor department in about 0.4 s; rules are checked in memory after one load, with the same `check()` used for manual assignment), never removes shifts an admin placed, and picks doctors in this order: passes every rule → has the missing skill → wanted this slot (and not one they marked as inconvenient) → would not block another slot they wanted → fewest hours so far. The result reports how many wishes were met. When more doctors want a slot than it has seats left, the generator does not choose between them: it leaves the slot empty and the roster returns it in `contested`, shown as an orange "choose" box with one button per candidate for the head of department. Slots that cannot be filled within the rules are left for the admin.
- **Leave requests with approval:** doctors request leave (pending) and can cancel while pending; admins approve or reject with a note. Approval is refused while the doctor still has a shift that day (move it first). Approved leave blocks assignment; auto-generate also keeps pending days free. Admin-recorded leave is approved at once. The nav shows the number of pending requests.
- **Shift preferences before the draft:** at `/preferences` a doctor marks slots of a coming month as "want" or "inconvenient" until the department has shifts in that month. Admins see them as ★/✕ in the roster table. On the demo data the generator met 34 of 36 wishes with no inconvenient slots used and full coverage.
- **Move or swap a shift:** at `/requests/shifts` a doctor can move one of their upcoming shifts to another slot, or offer a swap with a colleague's shift. When the colleague accepts, the shifts swap at once with no admin step, as long as both doctors still pass every rule and both slots stay covered. Otherwise the request waits for an admin, who must clear any broken rule first but may accept a short slot. Moving into a slot that breaks a rule is refused; moving out of a slot that would leave it short goes to the admin. Changes run in a transaction that locks both shifts and re-checks the rules.
- **Doctor's own queue:** each doctor can always see the waiting patients they are able to take (same department, matching skill) and their next shifts.

## Roles and permissions

Demo users per hospital: an admin (head of department), every doctor, a triage nurse and a registration clerk. Every permission lives in `App\Enums\Role` and is enforced as a Laravel Gate on each route; the page reads `/api/me` only to hide buttons.

| Permission | Admin | Doctor | Nurse | Registration |
|---|:-:|:-:|:-:|:-:|
| View roster | ✓ | ✓ | ✓ | |
| Manage roster / auto-generate | ✓ | | | |
| Record leave for any doctor (approved at once) | ✓ | | | |
| Request / cancel own pending leave | | own | | |
| Approve / reject leave | ✓ | | | |
| Move / swap own shifts, answer swap requests, send shift preferences | | own | | |
| Resolve move/swap requests that break a rule | ✓ | | | |
| Manage doctors: view details, add, edit name and skills | ✓ | | | |
| View queue | ✓ | ✓ | ✓ | |
| Issue tickets | ✓ | | ✓ | ✓ |
| Set priority / required skill (triage), at issue or later on a waiting ticket | ✓ | | ✓ | |
| Call next / complete | | own | | |
| View stats | ✓ | | | |

Checks happen in three layers: authenticated (401), member of the hospital in the URL (403; another hospital's ids → 404), and the permission plus ownership where it says "own" (403).
Passwordless demo login is available only with `DEMO_LOGIN=true` (off by default).

## Patient queue

- **Numeric queue numbers:** patients see digits only, with the first digit for the department (outpatients 1001, lab 2001, X-ray 3001; `departments.queue_prefix`), so numbers never repeat across a hospital on the same day and are easy for elderly patients to read. Up to 999 tickets per department per day keep the 4-digit form.

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

The page is a React app built with Vite inside Laravel, with a demo-user picker and
pages for the monthly roster (main), the patient queue and the role × permission matrix.
Buttons are shown according to the user's permissions.

Every page has its own URL (React Router), so links can be shared and back/forward work:

| URL | Page |
|---|---|
| `/login` | Demo-user picker (after a deep link, returns to that page) |
| `/roster/table?dept=1&month=2026-11&doctors=1,4` | Roster table, editable by admins, filtered to selected doctors |
| `/roster/calendar?dept=1&month=2026-11&doctors=1,4` | Month calendar filtered by the same doctor picker as the table; colour per shift, red when a slot is short. With exactly one doctor selected (`doctors=5`) it also shows that doctor's leave days and hours per week against the limit. Old `/roster/doctors/5` links redirect here |
| `/requests/leave?status=pending` | "Requests" menu, leave tab — Admin: leave inbox (pending / approved / rejected) · Doctor: request leave and see own requests |
| `/staff?dept=1&id=5` | Admin: every doctor with skills, shifts and hours this month, next shift and pending leave; click a row to edit name and skills, or add a doctor (also creates their doctor account) |
| `/requests/shifts` | "Requests" menu, move/swap tab — Doctor: own upcoming shifts, swap requests to answer, own requests · Admin: requests that need clearing. Old `/leave` and `/shifts` links redirect |
| `/queue/list?date=2026-10-26&status=waiting&dept=1` | Tickets of a day with issue time, call time and wait (minutes) |
| `/queue/month?date=2026-10-01` | Month calendar: tickets, completed and average wait per day (heat-shaded); past days from the daily summary table, today live |
| `/queue/week?date=2026-10-27` | Day × hour grid of tickets issued — shows the busy hours |
| `/queue/day?date=2026-10-27` | Tickets of one day grouped by hour, coloured by status |
| `/roles` | Role × permission matrix |

Pages a role cannot use show a 403 page; unknown paths show a 404 page. Laravel serves the app
for every non-`/api` path, and the GitHub Pages build ships `404.html` (a copy of `index.html`)
so deep links work there too.

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
| PATCH | `/tickets/{ticket}/triage` | Nurse sets `priority` and `required_skill_id` on a waiting ticket (for example one issued by registration); `422` once called |
| GET | `/departments`, `/staff` | Reference data for the page (staff include their skills) |
| GET | `/tickets?status=waiting\|called\|completed\|active&department_id=&number=&priority=&staff_id=&date=YYYY-MM-DD&cursor=…` | Tickets of a day, 50 per page, cursor-paginated; `active` = waiting + in progress; `number`/`priority`/`staff_id` power the search box and filters |
| GET | `/tickets/summary?from=&to=&group=day\|hour&department_id=` | Calendar data: `day` (≤ 42 days) reads past days from `daily_queue_stats` and counts today live; `hour` (≤ 7 days) groups by hour of issue |
| GET | `/stats?from=YYYY-MM-DD&to=YYYY-MM-DD` | Daily totals and average wait per department |
| GET | `/api/demo-users`, POST `/api/demo-login` | Demo users and token (only with `DEMO_LOGIN=true`) |
| GET | `/api/me`, `/api/roles` | Current user with permissions; role × permission matrix |
| GET | `/departments/{department}/roster?from=&to=` | Shifts, templates and coverage gaps (max 31 days) |
| POST | `/departments/{department}/roster/generate` | Fill empty slots within the rules → `created`, roster, remaining gaps |
| POST | `/shifts` | Assign a doctor (`staff_id`, `shift_template_id`, `date`) → `201`, or `422` with the broken rules |
| DELETE | `/shifts/{shift}` | Remove a shift |
| GET, POST | `/staff/{staff}/unavailabilities` | Leave days with status; POST = request (doctor, pending) or record (admin, approved) |
| GET | `/leave-requests?status=pending` | Admin inbox with counts and whether the doctor has a shift that day |
| POST | `/leave-requests/{leave}/approve`, `/reject` | Decide a pending request (`note` optional) |
| DELETE | `/leave-requests/{leave}` | Cancel own pending request (doctor) or remove (admin) |
| GET | `/shift-requests` | `mine`, `incoming` (swaps waiting for me), `needs_admin`, `recent`, depending on the role |
| POST | `/shift-requests` | `{shift_id, type: move, to_date, to_template_id}` or `{shift_id, type: swap, target_shift_id}` → `201` with `status` `approved`, `needs_admin` or `pending_peer` |
| POST | `/shift-requests/{id}/accept`, `/decline` | Colleague answers a swap |
| POST | `/shift-requests/{id}/approve`, `/reject` | Admin resolves (`note` optional); approve returns `422` while a rule is still broken |
| DELETE | `/shift-requests/{id}` | Requester cancels while open |
| GET, PUT | `/staff/{staff}/preferences?month=YYYY-MM` | Want / inconvenient slots for one month, plus the weekly hour cap and the doctor's leave days; PUT replaces the month, `422` once the roster exists or for a leave day |
| GET | `/staff/{staff}/preferences/months` | Months the doctor has sent, with counts and whether each is already rostered |
| GET | `/staff-directory` | Admin: doctors with skills, shifts/hours this month, next shift, pending leave, whether they have an account |
| POST | `/staff` | Admin adds a doctor `{name, department_id, skill_ids[]}` and a doctor user account → `201` |
| PATCH | `/staff/{staff}` | Admin edits `name` and/or `skill_ids` |
| GET | `/on-duty` | Doctors whose shift covers now (staff, department, shift name), used by the queue list to show who will take a waiting ticket |
| GET | `/staff/{staff}/my-queue` | Waiting tickets this doctor can take, current ticket, next shifts |

## Versioning and releases

Versions follow [SemVer](https://semver.org/). The pushed git tag is the only source of the number:
CI reads it, builds with it, and the running app reports it.

- `GET /version` (Laravel) and `/hospital-roster-queue/version.json` (Pages) return `{"version","sha","built_at"}`.
  The version also shows at the bottom of every page.
- Pushing to `main` runs the tests and builds as `0.0.0-dev.<run>`, but does not deploy.
- Pushing a tag `vX.Y.Z` runs the tests, deploys Pages, and creates a GitHub Release from that
  version's section in [CHANGELOG.md](CHANGELOG.md).

To release, move the `[Unreleased]` notes under a new version heading in `CHANGELOG.md`, commit, then:

```bash
git tag -a v0.2.0 -m "v0.2.0"
git push origin v0.2.0
```

## Run locally

```bash
composer install
cp .env.example .env   # set DEMO_LOGIN=true to use the demo users · APP_TIMEZONE defaults to Asia/Bangkok
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

63 feature tests. Queue search/filter and the active status. Contested slots left for the head. Doctor management: add with skills and account, edit name/skills, directory figures, admin-only and own hospital only. On-duty doctors from the roster. Triage of a waiting ticket issued by registration. Shift requests: move applied at once, move that leaves a slot short goes to the admin, move into a rule break refused, swap applied when the colleague accepts, swap that breaks a rule waits until the admin clears it, swap that drops a required skill, decline/cancel/one open request per shift, own upcoming shifts only; preferences saved per month and locked once the roster exists; the generator honours wants and avoids, and keeps a doctor free for the slot they asked for. Queue calendar: month from the daily summary + live today, hourly grouping, range limits. Leave: pending vs approved, approval blocked by a shift, reject and re-request, admin-recorded leave, cancel rules, auto-generate skips pending, other hospitals. Authorization: guests, other hospitals, triage, roster management, doctors acting only for themselves, leave days, stats, demo login on/off. Roster: overnight shifts, overlap, minimum rest, weekly hours, leave days,
coverage gaps, auto-generation (a full month within every rule, covers skills, keeps manual
shifts, leaves gaps it cannot fill), the doctor's own queue and hospital isolation. Queue: numbering, priority,
skill routing, isolation, cursor pagination, completing, aggregation and purging. CI runs them on
both SQLite and MySQL 8.4 before every deploy.

```bash
php artisan test
```

## Not covered yet

- Real sign-in (hospital SSO, or password + MFA). Only passwordless demo users exist today.
- Live updates. The page polls every 15 seconds; Laravel Reverb (WebSockets) would replace that.
- Partitioning `queue_tickets` by month, once the table grows past tens of millions of rows.

## License

[MIT](LICENSE) © 2026 JitrudeeDongdee
