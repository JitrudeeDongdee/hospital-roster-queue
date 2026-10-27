// API จำลองสำหรับ GitHub Pages (ไม่มี server) — ทำตามพฤติกรรมเดียวกับ Laravel API ใน repo นี้:
// cursor pagination 50 แถว, เรียกคิวตามความเชี่ยวชาญ + priority, แยกข้อมูลตามโรงพยาบาล
// ข้อมูลอยู่ใน memory ของ browser เท่านั้น รีเฟรชแล้วเริ่มใหม่

const PAGE_SIZE = 50;
const today = new Date().toISOString().slice(0, 10);

function prng(seed) {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const random = prng(42);
const pick = (list) => list[Math.floor(random() * list.length)];

const db = (() => {
    const skills = [
        { id: 1, code: 'GEN', name: 'General practice' },
        { id: 2, code: 'CARD', name: 'Cardiology' },
        { id: 3, code: 'PED', name: 'Pediatrics' },
        { id: 4, code: 'US', name: 'Ultrasound' },
    ];
    const hospitals = [];
    const templates = [];
    const shifts = [];
    const unavailabilities = [];
    const departments = [];
    const staff = [];
    const tickets = [];
    const counters = {};

    for (let h = 1; h <= 15; h++) {
        hospitals.push({ id: h, code: `H${String(h).padStart(3, '0')}`, name: `Demo Hospital ${h}`, min_rest_hours: 8, max_weekly_hours: 60 });

        for (const [code, name] of [['OPD', 'Outpatient'], ['LAB', 'Laboratory'], ['XRAY', 'Radiology']]) {
            const department = { id: departments.length + 1, hospital_id: h, code, name };
            departments.push(department);

            [['M', 'เวรเช้า', '08:00:00', '16:00:00', 2], ['A', 'เวรบ่าย', '16:00:00', '00:00:00', 1], ['N', 'เวรดึก', '00:00:00', '08:00:00', 1]]
                .forEach(([tc, name, start_time, end_time, min_staff], sort_order) => templates.push({
                    id: templates.length + 1, department_id: department.id, code: tc, name, start_time, end_time, min_staff, sort_order,
                    required_skill_id: code === 'OPD' && tc === 'M' ? 2 : null, // OPD เวรเช้าต้องมีหมอหัวใจ
                }));

            for (let s = 1; s <= 6; s++) {
                let owned = [...skills].sort(() => random() - 0.5).slice(0, 2);
                if (code === 'OPD' && (s === 1 || s === 4) && !owned.some((k) => k.id === 2)) owned = [skills[1], owned[0]];
                staff.push({ id: staff.length + 1, hospital_id: h, department_id: department.id, name: `Dr. ${code}-${s}`, skills: owned });
            }
        }
    }

    // คิววันนี้ ~3,000 ใบต่อโรงพยาบาล — พอให้เห็น infinite scroll + virtualization ทำงาน
    for (let i = 0; i < 45_000; i++) {
        const department = pick(departments);
        counters[department.id] = (counters[department.id] ?? 0) + 1;
        const roll = random();
        tickets.push({
            id: i + 1,
            hospital_id: department.hospital_id,
            department_id: department.id,
            required_skill_id: random() < 0.25 ? pick(skills).id : null,
            number: counters[department.id],
            priority: roll < 0.05 ? 2 : roll < 0.2 ? 1 : 0,
            status: random() < 0.55 ? 'completed' : 'waiting',
            staff_id: null,
            service_date: today,
            created_at: new Date().toISOString(),
            called_at: null,
        });
    }

    // ผู้ใช้ทดลอง: แอดมิน/พยาบาล/เวชระเบียน 1 คนต่อโรงพยาบาล + แพทย์ทุกคน
    const users = [];
    for (const h of hospitals) {
        for (const m of staff.filter((x) => x.hospital_id === h.id)) users.push({ id: users.length + 1, name: m.name, role: 'doctor', hospital_id: h.id, staff_id: m.id });
        for (const [role, title] of [['admin', 'หัวหน้าแผนก'], ['nurse', 'พยาบาลคัดกรอง'], ['registration', 'เวชระเบียน']]) {
            users.push({ id: users.length + 1, name: `${title} ${h.code}`, role, hospital_id: h.id, staff_id: null });
        }
    }

    return { skills, hospitals, departments, staff, tickets, counters, templates, shifts, unavailabilities, users };
})();

// ---- สิทธิ์: สำเนาของ App\\Enums\\Role ใน backend ----
const PERMISSIONS = {
    'roster.view': 'ดูตารางเวร',
    'roster.manage': 'จัดเวร / จัดอัตโนมัติ / ลบเวร',
    'leave.manage.any': 'บันทึกวันลาให้แพทย์ทุกคน',
    'leave.manage.own': 'บันทึกวันลาของตัวเอง',
    'queue.view': 'ดูรายการคิว',
    'ticket.issue': 'ออกบัตรคิว',
    'ticket.triage': 'กำหนดความเร่งด่วน / ความเชี่ยวชาญ (คัดกรอง)',
    'ticket.call': 'เรียกคิว / ตรวจเสร็จ (ของตัวเอง)',
    'stats.view': 'ดูสถิติ',
};
const ROLES = [
    { value: 'admin', label: 'แอดมิน / หัวหน้าแผนก', permissions: ['roster.view', 'roster.manage', 'leave.manage.any', 'queue.view', 'ticket.issue', 'ticket.triage', 'stats.view'] },
    { value: 'doctor', label: 'แพทย์', permissions: ['roster.view', 'leave.manage.own', 'queue.view', 'ticket.call'] },
    { value: 'nurse', label: 'พยาบาล', permissions: ['roster.view', 'queue.view', 'ticket.issue', 'ticket.triage'] },
    { value: 'registration', label: 'เวชระเบียน / ตู้คิว', permissions: ['ticket.issue'] },
];
const roleOf = (user) => ROLES.find((r) => r.value === user.role);
const can = (user, permission) => roleOf(user).permissions.includes(permission);
const present = (user) => {
    const h = db.hospitals.find((x) => x.id === user.hospital_id);
    return { id: user.id, name: user.name, role: user.role, role_label: roleOf(user).label, hospital: { id: h.id, code: h.code, name: h.name }, staff_id: user.staff_id, permissions: roleOf(user).permissions };
};
const forbid = (condition, message) => { if (condition) throw new HttpError(403, message); };

class HttpError extends Error {
    constructor(status, message, errors) {
        super(message);
        this.status = status;
        this.errors = errors;
    }
}

// ---- จัดเวร: ตรรกะเดียวกับ RosterService.php ----
const HOUR = 3_600_000;
const pad = (n) => String(n).padStart(2, '0');
const localIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
const fmt = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

function windowOf(template, date) {
    const start = new Date(`${date}T${template.start_time}`);
    let end = new Date(`${date}T${template.end_time}`);
    if (end <= start) end = new Date(end.getTime() + 24 * HOUR);
    return [start, end];
}

function daysBetween(from, to) {
    const days = [];
    for (let d = new Date(`${from}T00:00:00`); d <= new Date(`${to}T00:00:00`); d.setDate(d.getDate() + 1)) {
        days.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    }
    return days;
}

function violations(member, template, date) {
    const hospital = db.hospitals.find((h) => h.id === member.hospital_id);
    const [start, end] = windowOf(template, date);
    const rest = hospital.min_rest_hours * HOUR;
    const errors = [];

    if (template.department_id !== member.department_id) errors.push('แพทย์ไม่ได้อยู่ในแผนกของเวรนี้');
    if (db.unavailabilities.some((u) => u.staff_id === member.id && u.date === date)) errors.push('แพทย์แจ้งลา/ไม่สะดวกในวันนี้');

    const mine = db.shifts.filter((s) => s.staff_id === member.id);
    for (const other of mine) {
        const os = new Date(other.starts_at);
        const oe = new Date(other.ends_at);
        if (os < end && oe > start) errors.push(`เวรซ้อนกับเวร ${fmt(os)}–${fmt(oe).slice(-5)}`);
        else if (os.getTime() < end.getTime() + rest && oe.getTime() > start.getTime() - rest) errors.push(`พักน้อยกว่า ${hospital.min_rest_hours} ชม. ก่อน/หลังเวร ${fmt(os)}`);
    }

    const weekStart = new Date(start);
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * HOUR);
    const total = mine
        .filter((s) => new Date(s.starts_at) >= weekStart && new Date(s.starts_at) < weekEnd)
        .reduce((sum, s) => sum + (new Date(s.ends_at) - new Date(s.starts_at)) / HOUR, (end - start) / HOUR);
    if (total > hospital.max_weekly_hours) errors.push(`ชั่วโมงสัปดาห์นี้จะเป็น ${total} ชม. เกิน ${hospital.max_weekly_hours} ชม.`);

    return errors;
}

function assignShift(member, template, date) {
    const [start, end] = windowOf(template, date);
    const shift = {
        id: db.shifts.length ? db.shifts.at(-1).id + 1 : 1,
        hospital_id: member.hospital_id, department_id: template.department_id, shift_template_id: template.id,
        staff_id: member.id, shift_date: date, starts_at: localIso(start), ends_at: localIso(end),
    };
    db.shifts.push(shift);
    return shift;
}

function coverageProblem(template, doctors) {
    if (doctors.length < template.min_staff) return `ต้องมีแพทย์อย่างน้อย ${template.min_staff} คน (มี ${doctors.length})`;
    if (template.required_skill_id && !doctors.some((d) => d.skills.some((k) => k.id === template.required_skill_id))) return 'ยังไม่มีแพทย์ที่มีความเชี่ยวชาญที่เวรนี้ต้องการ';
    return null;
}

function rosterOf(department, from, to) {
    const templates = db.templates.filter((t) => t.department_id === department.id);
    const shifts = db.shifts.filter((s) => s.department_id === department.id && s.shift_date >= from && s.shift_date <= to);
    const staffOf = (s) => db.staff.find((m) => m.id === s.staff_id);
    const gaps = [];
    for (const date of daysBetween(from, to)) {
        for (const t of templates) {
            const problem = coverageProblem(t, shifts.filter((s) => s.shift_template_id === t.id && s.shift_date === date).map(staffOf));
            if (problem) gaps.push({ date, shift_template_id: t.id, problem });
        }
    }
    const hospital = db.hospitals.find((h) => h.id === department.hospital_id);
    return {
        rules: { min_rest_hours: hospital.min_rest_hours, max_weekly_hours: hospital.max_weekly_hours },
        templates,
        shifts: shifts.map((s) => ({ id: s.id, shift_template_id: s.shift_template_id, shift_date: s.shift_date, staff_id: s.staff_id, staff_name: staffOf(s).name })),
        gaps,
    };
}

function generateRoster(department, from, to) {
    const templates = db.templates.filter((t) => t.department_id === department.id);
    const doctors = db.staff.filter((m) => m.department_id === department.id);
    const hours = Object.fromEntries(doctors.map((d) => [d.id, 0]));
    for (const s of db.shifts) if (s.shift_date >= from && s.shift_date <= to && s.staff_id in hours) hours[s.staff_id] += (new Date(s.ends_at) - new Date(s.starts_at)) / HOUR;
    let created = 0;

    for (const date of daysBetween(from, to)) {
        for (const t of templates) {
            const assigned = db.shifts.filter((s) => s.shift_template_id === t.id && s.shift_date === date).map((s) => db.staff.find((m) => m.id === s.staff_id));
            while (coverageProblem(t, assigned)) {
                const needSkill = t.required_skill_id && !assigned.some((d) => d.skills.some((k) => k.id === t.required_skill_id));
                const rank = (d) => [needSkill && !d.skills.some((k) => k.id === t.required_skill_id) ? 1 : 0, hours[d.id], d.id];
                const pick = doctors
                    .filter((d) => !assigned.includes(d) && violations(d, t, date).length === 0)
                    .sort((a, b) => { const [x, y] = [rank(a), rank(b)]; return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; })[0];
                if (!pick) break;
                const shift = assignShift(pick, t, date);
                hours[pick.id] += (new Date(shift.ends_at) - new Date(shift.starts_at)) / HOUR;
                assigned.push(pick);
                created++;
            }
        }
    }

    return { created, ...rosterOf(department, from, to) };
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findIn(list, id, hospitalId) {
    const item = list.find((x) => x.id === Number(id));
    if (!item || item.hospital_id !== Number(hospitalId)) throw new HttpError(404, 'Not Found'); // = scopeBindings
    return item;
}

const routes = [
    
    ['GET', /^\/skills$/, () => db.skills, {}],
    ['GET', /^\/demo-users$/, () => db.users.filter((u) => u.hospital_id === 1 && (u.role !== 'doctor' || u.name.endsWith('-1'))).map(present), { public: true }],
    ['POST', /^\/demo-login$/, (_p, _q, body) => {
        const user = db.users.find((u) => u.id === Number(body.user_id));
        if (!user) throw new HttpError(404, 'Not Found');
        return { token: `demo-${user.id}`, user: present(user) };
    }, { public: true }],
    ['GET', /^\/roles$/, () => ({ permissions: PERMISSIONS, roles: ROLES }), { public: true }],
    ['GET', /^\/me$/, (_p, _q, _b, user) => present(user), {}],
    ['POST', /^\/logout$/, () => null, {}],
    ['GET', /^\/hospitals\/(\d+)\/departments$/, ([h]) => db.departments.filter((d) => d.hospital_id === Number(h)), {}],
    ['GET', /^\/hospitals\/(\d+)\/staff$/, ([h]) => db.staff.filter((s) => s.hospital_id === Number(h)), {}],

    ['GET', /^\/hospitals\/(\d+)\/tickets$/, ([h], query) => {
        const after = Number(query.get('cursor') ?? 0); // keyset: id > cursor
        const status = query.get('status');
        const departmentId = Number(query.get('department_id') ?? 0);
        const page = [];

        for (const t of db.tickets) {
            if (t.id <= after || t.hospital_id !== Number(h)) continue;
            if (status && t.status !== status) continue;
            if (departmentId && t.department_id !== departmentId) continue;
            page.push(t);
            if (page.length > PAGE_SIZE) break;
        }

        const hasMore = page.length > PAGE_SIZE;
        const data = page.slice(0, PAGE_SIZE).map((t) => ({ ...t }));
        return { data, per_page: PAGE_SIZE, next_cursor: hasMore ? String(data.at(-1).id) : null };
    }],

    ['POST', /^\/hospitals\/(\d+)\/departments\/(\d+)\/tickets$/, ([h, d], _query, body, user) => {
        const department = findIn(db.departments, d, h);
        forbid((Number(body?.priority) > 0 || body?.required_skill_id) && !can(user, 'ticket.triage'), 'ต้องเป็นพยาบาลคัดกรองจึงกำหนดความเร่งด่วน/ความเชี่ยวชาญได้');
        if (!body?.patient_ref) throw new HttpError(422, 'The patient ref field is required.');
        db.counters[department.id] = (db.counters[department.id] ?? 0) + 1;
        const ticket = {
            id: db.tickets.length + 1,
            hospital_id: department.hospital_id,
            department_id: department.id,
            required_skill_id: body.required_skill_id ?? null,
            number: db.counters[department.id],
            priority: body.priority ?? 0,
            status: 'waiting',
            staff_id: null,
            service_date: today,
            created_at: new Date().toISOString(),
            called_at: null,
        };
        db.tickets.push(ticket);
        return { ...ticket };
    }],

    ['POST', /^\/hospitals\/(\d+)\/staff\/(\d+)\/call-next$/, ([h, s], _q, _b, user) => {
        const member = findIn(db.staff, s, h);
        forbid(user.staff_id !== member.id, 'เรียกคิวได้เฉพาะในชื่อของตัวเอง');
        const skillIds = member.skills.map((skill) => skill.id);
        // เหมือน QueueService::callNext — คิวที่ไม่ระบุความเชี่ยวชาญหรือที่ตรงกับเจ้าหน้าที่, priority DESC แล้ว id ASC
        const next = db.tickets
            .filter((t) => t.department_id === member.department_id && t.status === 'waiting'
                && (t.required_skill_id === null || skillIds.includes(t.required_skill_id)))
            .sort((a, b) => b.priority - a.priority || a.id - b.id)[0];
        if (!next) throw new HttpError(404, 'No waiting tickets for this staff member.');
        Object.assign(next, { status: 'called', staff_id: member.id, called_at: new Date().toISOString() });
        return { ...next };
    }],

    ['GET', /^\/hospitals\/(\d+)\/departments\/(\d+)\/roster$/, ([h, d], query) => rosterOf(findIn(db.departments, d, h), query.get('from'), query.get('to'))],
    ['POST', /^\/hospitals\/(\d+)\/departments\/(\d+)\/roster\/generate$/, ([h, d], _q, body) => generateRoster(findIn(db.departments, d, h), body.from, body.to)],

    ['POST', /^\/hospitals\/(\d+)\/shifts$/, ([h], _q, body) => {
        const member = findIn(db.staff, body.staff_id, h);
        const template = db.templates.find((t) => t.id === Number(body.shift_template_id));
        if (!template) throw new HttpError(404, 'Not Found');
        findIn(db.departments, template.department_id, h);
        const errors = violations(member, template, body.date);
        if (errors.length) throw new HttpError(422, errors[0], { shift: errors });
        return assignShift(member, template, body.date);
    }],
    ['DELETE', /^\/hospitals\/(\d+)\/shifts\/(\d+)$/, ([h, id]) => {
        const shift = findIn(db.shifts, id, h);
        db.shifts.splice(db.shifts.indexOf(shift), 1);
        return null;
    }],

    ['GET', /^\/hospitals\/(\d+)\/staff\/(\d+)\/unavailabilities$/, ([h, s], query) => {
        const member = findIn(db.staff, s, h);
        const from = query.get('from') ?? '0000-00-00';
        const to = query.get('to') ?? '9999-99-99';
        return db.unavailabilities.filter((u) => u.staff_id === member.id && u.date >= from && u.date <= to).sort((a, b) => a.date.localeCompare(b.date));
    }],
    ['POST', /^\/hospitals\/(\d+)\/staff\/(\d+)\/unavailabilities$/, ([h, s], _q, body, user) => {
        const member = findIn(db.staff, s, h);
        forbid(!(can(user, 'leave.manage.any') || (can(user, 'leave.manage.own') && user.staff_id === member.id)), 'บันทึกวันลาได้เฉพาะของตัวเอง');
        if (db.shifts.some((x) => x.staff_id === member.id && x.shift_date === body.date)) {
            throw new HttpError(422, 'แพทย์มีเวรในวันนี้อยู่แล้ว ต้องลบเวรออกก่อน', { date: ['แพทย์มีเวรในวันนี้อยู่แล้ว ต้องลบเวรออกก่อน'] });
        }
        const existing = db.unavailabilities.find((u) => u.staff_id === member.id && u.date === body.date);
        if (existing) return existing;
        const row = { id: db.unavailabilities.length + 1, staff_id: member.id, date: body.date, reason: body.reason || null };
        db.unavailabilities.push(row);
        return row;
    }],

    ['GET', /^\/hospitals\/(\d+)\/staff\/(\d+)\/my-queue$/, ([h, s], _q, _b, user) => {
        const member = findIn(db.staff, s, h);
        forbid(user.staff_id !== null && user.staff_id !== member.id, 'ดูได้เฉพาะคิวของตัวเอง');
        const skillIds = member.skills.map((k) => k.id);
        const now = new Date();
        return {
            current: db.tickets.find((t) => t.staff_id === member.id && t.status === 'called') ?? null,
            waiting: db.tickets
                .filter((t) => t.department_id === member.department_id && t.status === 'waiting' && (t.required_skill_id === null || skillIds.includes(t.required_skill_id)))
                .sort((a, b) => b.priority - a.priority || a.id - b.id)
                .slice(0, 20),
            next_shifts: db.shifts
                .filter((x) => x.staff_id === member.id && new Date(x.ends_at) > now)
                .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
                .slice(0, 5)
                .map((x) => ({ ...x, template: db.templates.find((t) => t.id === x.shift_template_id) })),
        };
    }],

    ['POST', /^\/hospitals\/(\d+)\/tickets\/(\d+)\/complete$/, ([h, t], _q, _b, user) => {
        const ticket = findIn(db.tickets, t, h);
        forbid(ticket.staff_id !== null && ticket.staff_id !== user.staff_id, 'ปิดได้เฉพาะคิวที่ตัวเองเรียก');
        if (ticket.status !== 'called') throw new HttpError(422, 'Ticket has not been called.');
        Object.assign(ticket, { status: 'completed' });
        return { ...ticket };
    }],
];

// สิทธิ์ของแต่ละ route — ตรงกับ ->middleware('can:...') ใน routes/api.php
const ROUTE_PERMISSIONS = [
    ['GET', /\/tickets$/, 'queue.view'],
    ['POST', /\/departments\/\d+\/tickets$/, 'ticket.issue'],
    ['POST', /\/call-next$/, 'ticket.call'],
    ['POST', /\/complete$/, 'ticket.call'],
    ['GET', /\/my-queue$/, 'queue.view'],
    ['GET', /\/roster$/, 'roster.view'],
    ['POST', /\/roster\/generate$/, 'roster.manage'],
    ['POST', /\/shifts$/, 'roster.manage'],
    ['DELETE', /\/shifts\/\d+$/, 'roster.manage'],
    ['GET', /\/unavailabilities$/, 'roster.view'],
];

export async function mockApi(path, { method = 'GET', body, token } = {}) {
    await delay(120 + Math.random() * 180); // ให้รู้สึกเหมือนเรียกผ่านเน็ต

    const url = new URL(path, 'http://demo.local');
    for (const [routeMethod, pattern, handler, options = {}] of routes) {
        const match = routeMethod === method && url.pathname.match(pattern);
        if (!match) continue;

        let user = null;
        if (!options.public) {
            user = db.users.find((u) => token === `demo-${u.id}`);
            if (!user) throw new HttpError(401, 'Unauthenticated.');
            const hospital = url.pathname.match(/^\/hospitals\/(\d+)/);
            forbid(hospital && Number(hospital[1]) !== user.hospital_id, 'คุณไม่ได้สังกัดโรงพยาบาลนี้');
            const rule = ROUTE_PERMISSIONS.find(([m, re]) => m === method && re.test(url.pathname));
            forbid(rule && !can(user, rule[2]), 'This action is unauthorized.');
        }

        return handler(match.slice(1), url.searchParams, body, user);
    }

    throw new HttpError(404, `No demo route for ${method} ${url.pathname}`);
}
