// API จำลองสำหรับ GitHub Pages (ไม่มี server) — ทำตามพฤติกรรมเดียวกับ Laravel API ใน repo นี้:
// cursor pagination 50 แถว, เรียกคิวตามความเชี่ยวชาญ + priority, แยกข้อมูลตามโรงพยาบาล
// ข้อมูลอยู่ใน memory ของ browser เท่านั้น รีเฟรชแล้วเริ่มใหม่

const PAGE_SIZE = 50;
const pad = (n) => String(n).padStart(2, '0');
const today = (() => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; })();

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
        { id: 1, code: 'GEN', name: 'เวชปฏิบัติทั่วไป' },
        { id: 2, code: 'CARD', name: 'อายุรกรรมหัวใจ' },
        { id: 3, code: 'PED', name: 'กุมารเวชกรรม' },
        { id: 4, code: 'US', name: 'อัลตราซาวด์' },
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

        for (const [i, [code, name]] of [['OPD', 'ผู้ป่วยนอก'], ['LAB', 'ห้องแล็บ'], ['XRAY', 'เอกซเรย์']].entries()) {
            const department = { id: departments.length + 1, hospital_id: h, code, name, queue_prefix: i + 1 };
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

    // คิวย้อนหลัง 35 วัน (~90 ใบ/โรงพยาบาล/วัน) + วันนี้ (~200 ใบ/โรงพยาบาล) — เวลาออกบัตร 07:00–16:00
    const at = (date, minutes) => {
        const d = new Date(`${date}T07:00:00`);
        d.setMinutes(d.getMinutes() + minutes);
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
    };
    const now = new Date();
    const minutesSinceOpen = Math.max(30, (now.getHours() - 7) * 60 + now.getMinutes());
    const addTicket = (department, date, created, status, waitMin) => {
        const key = `${department.id}|${date}`;
        counters[key] = (counters[key] ?? 0) + 1;
        const roll = random();
        tickets.push({
            id: tickets.length + 1,
            hospital_id: department.hospital_id,
            department_id: department.id,
            required_skill_id: random() < 0.25 ? pick(skills).id : null,
            number: counters[key],
            priority: roll < 0.05 ? 2 : roll < 0.2 ? 1 : 0,
            status,
            staff_id: null,
            service_date: date,
            created_at: created,
            called_at: waitMin === null ? null : at(date, Math.round((new Date(created) - new Date(`${date}T07:00:00`)) / 60000) + waitMin),
        });
    };
    for (let back = 35; back >= 1; back--) {
        const d = new Date(now); d.setDate(d.getDate() - back);
        const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        const perDay = 15 * (70 + Math.floor(random() * 40));
        const day = [];
        for (let i = 0; i < perDay; i++) day.push([pick(departments), Math.floor(random() * 540)]);
        day.sort((a, b) => a[1] - b[1]).forEach(([department, minute]) => addTicket(department, date, at(date, minute), 'completed', 5 + Math.floor(random() * 55)));
    }
    const todayIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    for (let i = 0; i < 3000; i++) {
        const minute = Math.floor((minutesSinceOpen * i) / 3000);
        const done = minute < minutesSinceOpen - 60 && random() < 0.6;
        addTicket(pick(departments), todayIso, at(todayIso, minute), done ? 'completed' : 'waiting', done ? 5 + Math.floor(random() * 40) : null);
    }

    // ผู้ใช้ทดลอง: แอดมิน/พยาบาล/เวชระเบียน 1 คนต่อโรงพยาบาล + แพทย์ทุกคน
    const users = [];
    for (const h of hospitals) {
        for (const m of staff.filter((x) => x.hospital_id === h.id)) users.push({ id: users.length + 1, name: m.name, role: 'doctor', hospital_id: h.id, staff_id: m.id });
        for (const [role, title] of [['admin', 'หัวหน้าแผนก'], ['nurse', 'พยาบาลคัดกรอง'], ['registration', 'เวชระเบียน']]) {
            users.push({ id: users.length + 1, name: `${title} ${h.code}`, role, hospital_id: h.id, staff_id: null });
        }
    }

    return { skills, hospitals, departments, staff, tickets, counters, templates, shifts, unavailabilities, users, shiftRequests: [], preferences: [] };
})();

// ---- สิทธิ์: สำเนาของ App\\Enums\\Role ใน backend ----
const PERMISSIONS = {
    'roster.view': 'ดูตารางเวร',
    'roster.manage': 'จัดเวร / จัดอัตโนมัติ / ลบเวร',
    'leave.manage.any': 'บันทึกวันลาให้แพทย์ทุกคน (อนุมัติทันที)',
    'leave.manage.own': 'ขอลา / ยกเลิกคำขอของตัวเอง',
    'leave.approve': 'อนุมัติ / ไม่อนุมัติคำขอลา',
    'shift.request.own': 'ขอย้าย/แลกเวรของตัวเอง · ตอบรับคำขอแลก · ส่งเวรที่อยากลง',
    'shift.request.resolve': 'เคลียร์คำขอย้าย/แลกเวรที่ติดกติกา',
    'staff.manage': 'ดูรายละเอียดแพทย์ · เพิ่มแพทย์ · แก้ชื่อ/ความเชี่ยวชาญ',
    'queue.view': 'ดูรายการคิว',
    'ticket.issue': 'ออกบัตรคิว',
    'ticket.triage': 'กำหนดความเร่งด่วน / ความเชี่ยวชาญ (คัดกรอง)',
    'ticket.call': 'เรียกคิว / ตรวจเสร็จ (ของตัวเอง)',
    'stats.view': 'ดูสถิติ',
};
const ROLES = [
    { value: 'admin', label: 'แอดมิน / หัวหน้าแผนก', permissions: ['roster.view', 'roster.manage', 'leave.manage.any', 'leave.approve', 'shift.request.resolve', 'staff.manage', 'queue.view', 'ticket.issue', 'ticket.triage', 'stats.view'] },
    { value: 'doctor', label: 'แพทย์', permissions: ['roster.view', 'leave.manage.own', 'shift.request.own', 'queue.view', 'ticket.call'] },
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

function violations(member, template, date, leaveStatuses = ['approved'], ignoreShiftIds = []) {
    const [hard, soft] = problems(member, template, date, leaveStatuses, ignoreShiftIds);
    return [...hard, ...soft];
}

// [hard, soft] เหมือน RosterService::problems — hard = ห้ามลง · soft = ลงได้แต่ชิปเป็นสีแดง
function problems(member, template, date, leaveStatuses = ['approved'], ignoreShiftIds = []) {
    const hospital = db.hospitals.find((h) => h.id === member.hospital_id);
    const [start, end] = windowOf(template, date);
    const rest = hospital.min_rest_hours * HOUR;
    const errors = [];
    const soft = [];

    if (template.department_id !== member.department_id) errors.push('แพทย์ไม่ได้อยู่ในแผนกของเวรนี้');
    if (db.unavailabilities.some((u) => u.staff_id === member.id && u.date === date && leaveStatuses.includes(u.status))) errors.push('แพทย์แจ้งลา/ไม่สะดวกในวันนี้');

    const mine = db.shifts.filter((s) => s.staff_id === member.id && !ignoreShiftIds.includes(s.id));
    for (const other of mine) {
        const os = new Date(other.starts_at);
        const oe = new Date(other.ends_at);
        if (os < end && oe > start) errors.push(`เวรซ้อนกับเวร ${fmt(os)}–${fmt(oe).slice(-5)}`);
        else if (os.getTime() < end.getTime() + rest && oe.getTime() > start.getTime() - rest) soft.push(`พักน้อยกว่า ${hospital.min_rest_hours} ชม. ก่อน/หลังเวร ${fmt(os)}`);
    }

    const weekStart = new Date(start);
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * HOUR);
    const total = mine
        .filter((s) => new Date(s.starts_at) >= weekStart && new Date(s.starts_at) < weekEnd)
        .reduce((sum, s) => sum + (new Date(s.ends_at) - new Date(s.starts_at)) / HOUR, (end - start) / HOUR);
    if (total > hospital.max_weekly_hours) soft.push(`ชั่วโมงสัปดาห์นี้จะเป็น ${total} ชม. เกิน ${hospital.max_weekly_hours} ชม.`);

    return [errors, soft];
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
        shifts: shifts.map((s) => ({ id: s.id, shift_template_id: s.shift_template_id, shift_date: s.shift_date, staff_id: s.staff_id, staff_name: staffOf(s).name, warnings: warningsOf(s, hospital) })),
        gaps,
        contested: contestedOf(templates, shifts, from, to),
        preferences: db.preferences
            .filter((p) => templates.some((t) => t.id === p.shift_template_id) && p.date >= from && p.date <= to)
            .map(({ staff_id, shift_template_id, date, kind }) => ({ staff_id, shift_template_id, date, kind })),
    };
}

// ช่องที่มีคนอยากลงมากกว่าที่นั่งที่ยังว่าง — เหมือน RosterService::contested
function contestedOf(templates, shifts, from, to) {
    const groups = {};
    for (const p of db.preferences) {
        if (p.kind !== 'prefer' || p.date < from || p.date > to || !templates.some((t) => t.id === p.shift_template_id)) continue;
        (groups[`${p.shift_template_id}|${p.date}`] ??= []).push(p.staff_id);
    }
    const out = [];
    for (const [key, ids] of Object.entries(groups)) {
        const [templateId, date] = key.split('|');
        const assignedIds = shifts.filter((s) => s.shift_template_id === Number(templateId) && s.shift_date === date).map((s) => s.staff_id);
        const seats = Math.max(0, templates.find((t) => t.id === Number(templateId)).min_staff - assignedIds.length);
        const waiting = ids.filter((id) => !assignedIds.includes(id));
        if (seats > 0 && waiting.length > seats) out.push({ date, shift_template_id: Number(templateId), seats, staff_ids: waiting });
    }
    return out;
}

// เวรที่ผิดกติกาแบบเตือน (พักไม่พอ / ชั่วโมงต่อสัปดาห์เกิน) — เหมือน RosterService::shiftWarnings
function warningsOf(shift, hospital) {
    const out = [];
    const rest = hospital.min_rest_hours * HOUR;
    const mine = db.shifts.filter((x) => x.staff_id === shift.staff_id).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const i = mine.indexOf(shift);
    for (const [a, b] of [[mine[i - 1], shift], [shift, mine[i + 1]]]) {
        if (a && b && new Date(b.starts_at) - new Date(a.ends_at) < rest) out.push(`พักน้อยกว่า ${hospital.min_rest_hours} ชม. ระหว่างเวร ${fmt(new Date(a.starts_at))} กับ ${fmt(new Date(b.starts_at))}`);
    }
    const weekStart = new Date(shift.starts_at);
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * HOUR);
    const hours = mine.filter((x) => new Date(x.starts_at) >= weekStart && new Date(x.starts_at) < weekEnd).reduce((sum, x) => sum + (new Date(x.ends_at) - new Date(x.starts_at)) / HOUR, 0);
    if (hours > hospital.max_weekly_hours) out.push(`สัปดาห์ ${pad(weekStart.getDate())}/${pad(weekStart.getMonth() + 1)} รวม ${hours} ชม. เกิน ${hospital.max_weekly_hours} ชม.`);
    return out;
}

function generateRoster(department, from, to) {
    const templates = db.templates.filter((t) => t.department_id === department.id);
    const doctors = db.staff.filter((m) => m.department_id === department.id);
    const hours = Object.fromEntries(doctors.map((d) => [d.id, 0]));
    for (const s of db.shifts) if (s.shift_date >= from && s.shift_date <= to && s.staff_id in hours) hours[s.staff_id] += (new Date(s.ends_at) - new Date(s.starts_at)) / HOUR;
    const wish = Object.fromEntries(db.preferences
        .filter((p) => p.staff_id in hours && p.date >= from && p.date <= to)
        .map((p) => [`${p.staff_id}|${p.shift_template_id}|${p.date}`, p.kind]));
    const wishRank = (d, t, date) => ({ prefer: 0, avoid: 2 })[wish[`${d.id}|${t.id}|${date}`]] ?? 1;
    const rest = db.hospitals.find((h) => h.id === department.hospital_id).min_rest_hours * HOUR;
    const preferOf = {};
    for (const [key, kind] of Object.entries(wish)) {
        const [staffId, templateId, date] = key.split('|');
        if (kind === 'prefer') (preferOf[staffId] ??= []).push(windowOf(templateOf(Number(templateId)), date));
    }
    // ลงช่องนี้แล้วจะชนหรือพักไม่พอกับช่องอื่นที่หมอคนนี้อยากลงไหม — เหมือน RosterService::generate
    const blocksWish = (d, t, date) => {
        const [start, end] = windowOf(t, date);
        return (preferOf[d.id] ?? []).some(([ws, we]) => ws.getTime() !== start.getTime() && ws.getTime() < end.getTime() + rest && we.getTime() > start.getTime() - rest) ? 1 : 0;
    };
    let created = 0;

    for (const date of daysBetween(from, to)) {
        for (const t of templates) {
            const assigned = db.shifts.filter((s) => s.shift_template_id === t.id && s.shift_date === date).map((s) => db.staff.find((m) => m.id === s.staff_id));
            // คนอยากลงเกินที่นั่งที่เหลือ = ไม่เลือกให้ (หัวหน้าตัดสิน) — เหมือน RosterService::generate
            const seats = Math.max(0, t.min_staff - assigned.length);
            const wanting = doctors.filter((d) => wish[`${d.id}|${t.id}|${date}`] === 'prefer' && !assigned.includes(d));
            if (seats > 0 && wanting.length > seats) continue;
            while (coverageProblem(t, assigned)) {
                const needSkill = t.required_skill_id && !assigned.some((d) => d.skills.some((k) => k.id === t.required_skill_id));
                const rank = (d) => [needSkill && !d.skills.some((k) => k.id === t.required_skill_id) ? 1 : 0, wishRank(d, t, date), blocksWish(d, t, date), hours[d.id], d.id];
                const pick = doctors
                    .filter((d) => !assigned.includes(d) && violations(d, t, date, ['approved', 'pending']).length === 0)
                    .sort((a, b) => { const [x, y] = [rank(a), rank(b)]; return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || x[3] - y[3] || x[4] - y[4]; })[0];
                if (!pick) break;
                const shift = assignShift(pick, t, date);
                hours[pick.id] += (new Date(shift.ends_at) - new Date(shift.starts_at)) / HOUR;
                assigned.push(pick);
                created++;
            }
        }
    }

    const stats = { prefer_total: 0, prefer_met: 0, avoid_total: 0, avoid_used: 0 };
    for (const [key, kind] of Object.entries(wish)) {
        const [staffId, templateId, date] = key.split('|');
        const got = db.shifts.some((s) => s.staff_id === Number(staffId) && s.shift_template_id === Number(templateId) && s.shift_date === date);
        stats[`${kind}_total`]++;
        if (got) stats[kind === 'prefer' ? 'prefer_met' : 'avoid_used']++;
    }

    return { created, preference_stats: stats, ...rosterOf(department, from, to) };
}

// ---- ย้าย/แลกเวร: ตรรกะเดียวกับ ShiftChangeService.php ----
const templateOf = (id) => db.templates.find((t) => t.id === id);
const staffById = (id) => db.staff.find((m) => m.id === id);

function coverageAfter(template, date, leavingId, joining) {
    const doctors = db.shifts
        .filter((s) => s.shift_template_id === template.id && s.shift_date === date && s.staff_id !== leavingId)
        .map((s) => staffById(s.staff_id));
    return coverageProblem(template, joining ? [...doctors, joining] : doctors);
}

const slotProblem = (template, date, problem) => (problem ? `${template.name} ${date.slice(8)}/${date.slice(5, 7)}: ${problem}` : null);

function evaluateChange(r) {
    const requester = staffById(r.requester_staff_id);
    const from = templateOf(r.from_template_id);
    const to = templateOf(r.to_template_id);
    const shift = db.shifts.find((s) => s.id === r.shift_id);
    if (!shift || shift.staff_id !== requester.id || shift.shift_template_id !== from.id || shift.shift_date !== r.from_date) {
        return { blocking: ['เวรเดิมของผู้ขอถูกเปลี่ยนไปแล้ว'], coverage: [] };
    }
    if (r.type === 'move') {
        if (from.id === to.id && r.from_date === r.to_date) return { blocking: ['ช่องใหม่ต้องไม่ใช่ช่องเดิม'], coverage: [] };
        return {
            blocking: violations(requester, to, r.to_date, ['approved'], [shift.id]),
            coverage: [slotProblem(from, r.from_date, coverageAfter(from, r.from_date, requester.id, null))].filter(Boolean),
        };
    }
    const friend = staffById(r.target_staff_id);
    const target = db.shifts.find((s) => s.id === r.target_shift_id);
    if (!target || target.staff_id !== friend.id || target.shift_template_id !== to.id || target.shift_date !== r.to_date) {
        return { blocking: [`เวรของ ${friend.name} ถูกเปลี่ยนไปแล้ว`], coverage: [] };
    }
    const ignore = [shift.id, target.id];
    return {
        blocking: [
            ...violations(requester, to, r.to_date, ['approved'], ignore).map((e) => `${requester.name}: ${e}`),
            ...violations(friend, from, r.from_date, ['approved'], ignore).map((e) => `${friend.name}: ${e}`),
        ],
        coverage: [
            slotProblem(from, r.from_date, coverageAfter(from, r.from_date, requester.id, friend)),
            slotProblem(to, r.to_date, coverageAfter(to, r.to_date, friend.id, requester)),
        ].filter(Boolean),
    };
}

function applyChange(r, attributes) {
    const { blocking } = evaluateChange(r);
    if (blocking.length) throw new HttpError(422, blocking[0], { request: blocking });
    const shift = db.shifts.find((s) => s.id === r.shift_id);
    if (r.type === 'move') {
        const [start, end] = windowOf(templateOf(r.to_template_id), r.to_date);
        Object.assign(shift, { shift_template_id: r.to_template_id, shift_date: r.to_date, starts_at: localIso(start), ends_at: localIso(end) });
    } else {
        const target = db.shifts.find((s) => s.id === r.target_shift_id);
        [shift.staff_id, target.staff_id] = [r.target_staff_id, r.requester_staff_id];
    }
    Object.assign(r, { status: 'approved', decided_at: new Date().toISOString(), updated_at: Date.now() }, attributes);
}

const isOpen = (r) => ['pending_peer', 'needs_admin'].includes(r.status);

function presentChange(r) {
    const slot = (templateId, date) => {
        const t = templateOf(templateId);
        return { date, shift_template_id: t.id, name: t.name, start_time: t.start_time.slice(0, 5), end_time: t.end_time.slice(0, 5) };
    };
    const person = (id) => (id ? { id, name: staffById(id).name } : null);
    return {
        id: r.id, type: r.type, status: r.status, department_id: r.department_id,
        requester: person(r.requester_staff_id), target_staff: person(r.target_staff_id),
        from: slot(r.from_template_id, r.from_date), to: slot(r.to_template_id, r.to_date),
        reason: r.reason, problems: r.problems ?? [], decided_by_name: r.decided_by_name ?? null, decision_note: r.decision_note ?? null,
        created_at: r.created_at, decided_at: r.decided_at ?? null,
    };
}

function findChange(id, hospitalId) {
    const r = db.shiftRequests.find((x) => x.id === Number(id));
    if (!r || r.hospital_id !== Number(hospitalId)) throw new HttpError(404, 'Not Found');
    return r;
}

const fail422 = (field, messages) => { throw new HttpError(422, messages[0], { [field]: messages }); };

// เดโม: โรงพยาบาลแรกมีเวรเดือนนี้แล้ว (ลองขอย้าย/แลกได้เลย) · เดือนหน้ามีเวรที่แพทย์อยากลงไว้ให้ลองจัดร่าง
{
    const now = new Date();
    const first = isoOf(new Date(now.getFullYear(), now.getMonth(), 1));
    const last = isoOf(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    for (const department of db.departments.filter((d) => d.hospital_id === 1)) {
        generateRoster(department, first, last);
        const templates = db.templates.filter((t) => t.department_id === department.id);
        db.staff.filter((m) => m.department_id === department.id).forEach((doctor, i) => {
            for (const offset of [2, 8, 14]) {
                const d = new Date(next);
                d.setDate(d.getDate() + offset + i);
                db.preferences.push({ staff_id: doctor.id, shift_template_id: templates[(i + offset) % templates.length].id, date: isoOf(d), kind: offset === 14 ? 'avoid' : 'prefer' });
            }
        });
    }
}

// คิวที่ตรวจแล้วของโรงพยาบาลแรก (ช่วงที่มีตารางเวร) ผูกกับแพทย์ที่อยู่เวรตอนออกบัตร — รายการคิวจะเห็นว่าใครดูแล
for (const t of db.tickets) {
    if (t.hospital_id !== 1 || t.status !== 'completed') continue;
    const at = new Date(t.created_at);
    const duty = db.shifts.filter((x) => x.department_id === t.department_id && new Date(x.starts_at) <= at && new Date(x.ends_at) > at);
    if (duty.length) t.staff_id = duty[t.id % duty.length].staff_id;
}

function isoOf(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const leaveOf = (member, month) => db.unavailabilities
    .filter((u) => u.staff_id === member.id && u.date.startsWith(month) && ['approved', 'pending'].includes(u.status))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((u) => ({ date: u.date, status: u.status }));
const monthLocked = (member, month) => db.shifts.some((x) => x.department_id === member.department_id && x.shift_date.startsWith(month));

function preferencesOf(member, month) {
    return {
        month,
        locked: monthLocked(member, month),
        max_weekly_hours: db.hospitals.find((h) => h.id === member.hospital_id).max_weekly_hours,
        leave: leaveOf(member, month),
        items: db.preferences.filter((p) => p.staff_id === member.id && p.date.startsWith(month))
            .sort((a, b) => a.date.localeCompare(b.date))
            .map(({ date, shift_template_id, kind }) => ({ date, shift_template_id, kind })),
    };
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findIn(list, id, hospitalId) {
    const item = list.find((x) => x.id === Number(id));
    if (!item || item.hospital_id !== Number(hospitalId)) throw new HttpError(404, 'Not Found'); // = scopeBindings
    return item;
}

const routes = [
    
    ['GET', /^\/skills$/, () => db.skills, {}],
    ['GET', /^\/demo-users$/, () => db.users.filter((u) => u.hospital_id === 1).map(present), { public: true }],
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
        const number = Number(query.get('number') ?? 0);
        const priority = query.get('priority');
        const staffId = Number(query.get('staff_id') ?? 0);
        const date = query.get('date') ?? today;
        const page = [];

        for (const t of db.tickets) {
            if (t.id <= after || t.hospital_id !== Number(h) || t.service_date !== date) continue;
            if (status === 'active' ? t.status === 'completed' : status && t.status !== status) continue;
            if (departmentId && t.department_id !== departmentId) continue;
            if (number && t.number !== number) continue;
            if (priority !== null && priority !== '' && t.priority !== Number(priority)) continue;
            if (staffId && t.staff_id !== staffId) continue;
            page.push(t);
            if (page.length > PAGE_SIZE) break;
        }

        const hasMore = page.length > PAGE_SIZE;
        const data = page.slice(0, PAGE_SIZE).map((t) => ({ ...t }));
        return { data, per_page: PAGE_SIZE, next_cursor: hasMore ? String(data.at(-1).id) : null };
    }],

    ['GET', /^\/hospitals\/(\d+)\/tickets\/summary$/, ([h], query) => {
        const from = query.get('from');
        const to = query.get('to');
        const group = query.get('group');
        const dept = Number(query.get('department_id') ?? 0);
        const buckets = new Map();
        for (const t of db.tickets) {
            if (t.hospital_id !== Number(h) || t.service_date < from || t.service_date > to || (dept && t.department_id !== dept)) continue;
            const hour = new Date(t.created_at).getHours();
            const key = group === 'hour' ? `${t.service_date}|${hour}` : t.service_date;
            const b = buckets.get(key) ?? { date: t.service_date, ...(group === 'hour' ? { hour } : {}), total: 0, waiting: 0, called: 0, completed: 0, waitSum: 0, waitN: 0 };
            b.total++; b[t.status]++;
            if (t.called_at) { b.waitSum += (new Date(t.called_at) - new Date(t.created_at)) / 1000; b.waitN++; }
            buckets.set(key, b);
        }
        const data = [...buckets.values()]
            .map(({ waitSum, waitN, ...b }) => ({ ...b, avg_wait_seconds: waitN ? Math.round(waitSum / waitN) : null, ...(group === 'day' ? { source: b.date === today ? 'live' : 'summary' } : {}) }))
            .sort((a, b) => a.date.localeCompare(b.date) || (a.hour ?? 0) - (b.hour ?? 0));
        return { group, data };
    }],

    ['POST', /^\/hospitals\/(\d+)\/departments\/(\d+)\/tickets$/, ([h, d], _query, body, user) => {
        const department = findIn(db.departments, d, h);
        forbid((Number(body?.priority) > 0 || body?.required_skill_id) && !can(user, 'ticket.triage'), 'ต้องเป็นพยาบาลคัดกรองจึงกำหนดความเร่งด่วน/ความเชี่ยวชาญได้');
        if (!body?.patient_ref) throw new HttpError(422, 'The patient ref field is required.');
        const counterKey = `${department.id}|${today}`;
        db.counters[counterKey] = (db.counters[counterKey] ?? 0) + 1;
        const ticket = {
            id: db.tickets.length + 1,
            hospital_id: department.hospital_id,
            department_id: department.id,
            required_skill_id: body.required_skill_id ?? null,
            number: db.counters[counterKey],
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
        // ตรวจได้ทีละคิว — เหมือน QueueService::callNext
        if (db.tickets.some((t) => t.staff_id === member.id && t.status === 'called')) fail422('ticket', ['ยังมีคิวที่กำลังตรวจอยู่ กดเสร็จสิ้นก่อนจึงเรียกคิวถัดไปได้']);
        const skillIds = member.skills.map((skill) => skill.id);
        // เหมือน QueueService::callNext — คิวที่ไม่ระบุความเชี่ยวชาญหรือที่ตรงกับเจ้าหน้าที่, priority DESC แล้ว id ASC
        const next = db.tickets
            .filter((t) => t.department_id === member.department_id && t.status === 'waiting' && t.service_date === today
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
        const [errors, warnings] = problems(member, template, body.date);
        if (errors.length) throw new HttpError(422, errors[0], { shift: errors });
        return { ...assignShift(member, template, body.date), warnings };
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
        const direct = can(user, 'leave.manage.any');
        forbid(!(direct || (can(user, 'leave.manage.own') && user.staff_id === member.id)), 'ขอลาได้เฉพาะของตัวเอง');
        const fail = (message) => { throw new HttpError(422, message, { date: [message] }); };
        if (direct && db.shifts.some((x) => x.staff_id === member.id && x.shift_date === body.date)) fail('แพทย์มีเวรในวันนี้อยู่แล้ว ต้องลบเวรออกก่อน');
        let leave = db.unavailabilities.find((u) => u.staff_id === member.id && u.date === body.date);
        if (leave && leave.status !== 'rejected') fail(leave.status === 'pending' ? 'มีคำขอลาวันนี้รออนุมัติอยู่แล้ว' : 'วันนี้ลาอยู่แล้ว');
        const attributes = {
            reason: body.reason || null, status: direct ? 'approved' : 'pending', requested_by: user.id,
            decided_by_name: direct ? user.name : null, decided_at: direct ? new Date().toISOString() : null, decision_note: null,
        };
        if (leave) Object.assign(leave, attributes);
        else db.unavailabilities.push(leave = { id: (db.unavailabilities.at(-1)?.id ?? 0) + 1, staff_id: member.id, date: body.date, ...attributes });
        return { ...leave };
    }],

    ['GET', /^\/hospitals\/(\d+)\/leave-requests$/, ([h], query) => {
        const status = query.get('status') ?? 'pending';
        const ours = db.unavailabilities.filter((u) => db.staff.find((m) => m.id === u.staff_id)?.hospital_id === Number(h));
        const counts = { pending: 0, approved: 0, rejected: 0 };
        for (const u of ours) counts[u.status]++;
        const data = ours.filter((u) => u.status === status)
            .sort((a, b) => (status === 'pending' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)))
            .map((u) => {
                const member = db.staff.find((m) => m.id === u.staff_id);
                return { ...u, staff_name: member.name, department_id: member.department_id, has_shift: db.shifts.some((x) => x.staff_id === u.staff_id && x.shift_date === u.date) };
            });
        return { counts, data };
    }],
    ['POST', /^\/hospitals\/(\d+)\/leave-requests\/(\d+)\/(approve|reject)$/, ([h, id, action], _q, body, user) => {
        const leave = db.unavailabilities.find((u) => u.id === Number(id));
        if (!leave || db.staff.find((m) => m.id === leave.staff_id).hospital_id !== Number(h)) throw new HttpError(404, 'Not Found');
        if (leave.status !== 'pending') throw new HttpError(422, 'คำขอนี้ตัดสินไปแล้ว');
        if (action === 'approve' && db.shifts.some((x) => x.staff_id === leave.staff_id && x.shift_date === leave.date)) {
            throw new HttpError(422, 'แพทย์มีเวรวันนี้ ต้องย้าย/ลบเวรก่อนจึงอนุมัติได้', { leave: ['แพทย์มีเวรวันนี้ ต้องย้าย/ลบเวรก่อนจึงอนุมัติได้'] });
        }
        Object.assign(leave, { status: action === 'approve' ? 'approved' : 'rejected', decided_by_name: user.name, decided_at: new Date().toISOString(), decision_note: body?.note || null });
        return { ...leave };
    }],
    ['DELETE', /^\/hospitals\/(\d+)\/leave-requests\/(\d+)$/, ([h, id], _q, _b, user) => {
        const leave = db.unavailabilities.find((u) => u.id === Number(id));
        if (!leave || db.staff.find((m) => m.id === leave.staff_id).hospital_id !== Number(h)) throw new HttpError(404, 'Not Found');
        const own = can(user, 'leave.manage.own') && user.staff_id === leave.staff_id && leave.status === 'pending';
        forbid(!(own || can(user, 'leave.manage.any')), 'ยกเลิกได้เฉพาะคำขอของตัวเองที่ยังรออนุมัติ');
        db.unavailabilities.splice(db.unavailabilities.indexOf(leave), 1);
        return null;
    }],

    ['GET', /^\/hospitals\/(\d+)\/staff-directory$/, ([h]) => {
        const now = new Date();
        const first = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
        const last = isoOf(new Date(now.getFullYear(), now.getMonth() + 1, 0));
        return db.staff.filter((m) => m.hospital_id === Number(h)).map((m) => {
            const mine = db.shifts.filter((x) => x.staff_id === m.id);
            const month = mine.filter((x) => x.shift_date >= first && x.shift_date <= last);
            const next = mine.filter((x) => new Date(x.starts_at) > now).sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
            return {
                id: m.id, name: m.name, department_id: m.department_id, is_active: true, skills: m.skills,
                shifts_this_month: month.length,
                hours_this_month: month.reduce((sum, x) => sum + (new Date(x.ends_at) - new Date(x.starts_at)) / HOUR, 0),
                next_shift: next ? { date: next.shift_date, name: templateOf(next.shift_template_id).name } : null,
                pending_leave: db.unavailabilities.filter((u) => u.staff_id === m.id && u.status === 'pending').length,
                has_account: db.users.some((u) => u.staff_id === m.id),
            };
        });
    }],
    ['POST', /^\/hospitals\/(\d+)\/staff$/, ([h], _q, body) => {
        if (!body.name?.trim()) fail422('name', ['กรุณาใส่ชื่อ']);
        findIn(db.departments, body.department_id, h);
        const skills = (body.skill_ids ?? []).map((id) => db.skills.find((k) => k.id === id) ?? fail422('skill_ids', ['ความเชี่ยวชาญไม่ถูกต้อง']));
        const member = { id: db.staff.length + 1, hospital_id: Number(h), department_id: Number(body.department_id), name: body.name.trim(), skills };
        db.staff.push(member);
        db.users.push({ id: db.users.length + 1, name: member.name, role: 'doctor', hospital_id: member.hospital_id, staff_id: member.id });
        return { id: member.id, name: member.name, department_id: member.department_id, is_active: true, skills };
    }],
    ['PATCH', /^\/hospitals\/(\d+)\/staff\/(\d+)$/, ([h, s], _q, body) => {
        const member = findIn(db.staff, s, h);
        if (body.name !== undefined) {
            if (!body.name.trim()) fail422('name', ['กรุณาใส่ชื่อ']);
            member.name = body.name.trim();
            for (const u of db.users.filter((x) => x.staff_id === member.id)) u.name = member.name;
        }
        if (body.skill_ids) member.skills = body.skill_ids.map((id) => db.skills.find((k) => k.id === id) ?? fail422('skill_ids', ['ความเชี่ยวชาญไม่ถูกต้อง']));
        return { id: member.id, name: member.name, department_id: member.department_id, is_active: true, skills: member.skills };
    }],
    ['GET', /^\/hospitals\/(\d+)\/on-duty$/, ([h]) => {
        const now = new Date();
        return db.shifts
            .filter((x) => x.hospital_id === Number(h) && new Date(x.starts_at) <= now && new Date(x.ends_at) > now)
            .map((x) => ({ staff_id: x.staff_id, department_id: x.department_id, shift_name: templateOf(x.shift_template_id).name, ends_at: x.ends_at }));
    }],
    ['GET', /^\/hospitals\/(\d+)\/shift-requests$/, ([h], _q, _b, user) => {
        const own = can(user, 'shift.request.own') && user.staff_id;
        const resolve = can(user, 'shift.request.resolve');
        forbid(!own && !resolve, 'This action is unauthorized.');
        const ours = db.shiftRequests.filter((r) => r.hospital_id === Number(h));
        const newest = (a, b) => b.id - a.id;
        return {
            mine: own ? ours.filter((r) => r.requester_staff_id === user.staff_id).sort(newest).slice(0, 50).map(presentChange) : [],
            incoming: own ? ours.filter((r) => r.target_staff_id === user.staff_id && r.status === 'pending_peer').map(presentChange) : [],
            needs_admin: resolve ? ours.filter((r) => r.status === 'needs_admin').map(presentChange) : [],
            recent: resolve ? ours.filter((r) => !isOpen(r)).sort((a, b) => b.updated_at - a.updated_at).slice(0, 30).map(presentChange) : [],
        };
    }],
    ['POST', /^\/hospitals\/(\d+)\/shift-requests$/, ([h], _q, body, user) => {
        const shift = findIn(db.shifts, body.shift_id, h);
        forbid(user.staff_id !== shift.staff_id, 'ขอย้าย/แลกได้เฉพาะเวรของตัวเอง');
        if (new Date(shift.starts_at) <= new Date()) fail422('shift_id', ['เวรนี้เริ่มไปแล้ว ขอย้าย/แลกไม่ได้']);
        if (db.shiftRequests.some((r) => r.shift_id === shift.id && isOpen(r))) fail422('shift_id', ['เวรนี้มีคำขอที่ยังไม่จบอยู่แล้ว']);
        const r = {
            id: (db.shiftRequests.at(-1)?.id ?? 0) + 1, hospital_id: Number(h), department_id: shift.department_id, type: body.type,
            requester_staff_id: shift.staff_id, shift_id: shift.id, from_date: shift.shift_date, from_template_id: shift.shift_template_id,
            target_shift_id: null, target_staff_id: null, reason: body.reason || null, created_at: new Date().toISOString(), updated_at: Date.now(),
        };
        if (body.type === 'move') {
            const template = db.templates.find((t) => t.id === Number(body.to_template_id) && t.department_id === shift.department_id);
            if (!template) throw new HttpError(404, 'Not Found');
            if (!body.to_date || body.to_date < today) fail422('to_date', ['วันที่ใหม่ต้องไม่ใช่วันที่ผ่านมาแล้ว']);
            Object.assign(r, { to_date: body.to_date, to_template_id: template.id });
            const { blocking, coverage } = evaluateChange(r);
            if (blocking.length) fail422('to_date', blocking);
            Object.assign(r, { status: 'needs_admin', problems: coverage });
            db.shiftRequests.push(r);
            if (!coverage.length) applyChange(r, { problems: [] });
        } else {
            const target = db.shifts.find((s) => s.id === Number(body.target_shift_id) && s.department_id === shift.department_id);
            if (!target) throw new HttpError(404, 'Not Found');
            if (target.staff_id === shift.staff_id) fail422('target_shift_id', ['เลือกเวรของแพทย์คนอื่น']);
            if (new Date(target.starts_at) <= new Date()) fail422('target_shift_id', ['เวรของเพื่อนเริ่มไปแล้ว']);
            Object.assign(r, { target_shift_id: target.id, target_staff_id: target.staff_id, to_date: target.shift_date, to_template_id: target.shift_template_id });
            const { blocking, coverage } = evaluateChange(r);
            Object.assign(r, { status: 'pending_peer', problems: [...blocking, ...coverage] });
            db.shiftRequests.push(r);
        }
        return presentChange(r);
    }],
    ['POST', /^\/hospitals\/(\d+)\/shift-requests\/(\d+)\/(accept|decline)$/, ([h, id, action], _q, _b, user) => {
        const r = findChange(id, h);
        forbid(user.staff_id !== r.target_staff_id, 'ตอบได้เฉพาะคำขอที่ส่งถึงคุณ');
        if (r.status !== 'pending_peer') throw new HttpError(422, 'คำขอนี้ตอบไปแล้ว');
        if (action === 'decline') {
            Object.assign(r, { status: 'declined', updated_at: Date.now() });
        } else {
            const { blocking, coverage } = evaluateChange(r);
            const problems = [...blocking, ...coverage];
            if (problems.length) Object.assign(r, { status: 'needs_admin', problems, updated_at: Date.now() });
            else applyChange(r, { problems: [] });
        }
        return presentChange(r);
    }],
    ['POST', /^\/hospitals\/(\d+)\/shift-requests\/(\d+)\/(approve|reject)$/, ([h, id, action], _q, body, user) => {
        const r = findChange(id, h);
        if (action === 'approve') {
            if (r.status !== 'needs_admin') throw new HttpError(422, 'คำขอนี้ไม่ได้รอแอดมินเคลียร์');
            applyChange(r, { decided_by_name: user.name, decision_note: body?.note || null });
        } else {
            if (!isOpen(r)) throw new HttpError(422, 'คำขอนี้จบไปแล้ว');
            Object.assign(r, { status: 'rejected', decided_by_name: user.name, decided_at: new Date().toISOString(), decision_note: body?.note || null, updated_at: Date.now() });
        }
        return presentChange(r);
    }],
    ['DELETE', /^\/hospitals\/(\d+)\/shift-requests\/(\d+)$/, ([h, id], _q, _b, user) => {
        const r = findChange(id, h);
        forbid(user.staff_id !== r.requester_staff_id || !isOpen(r), 'ยกเลิกได้เฉพาะคำขอของตัวเองที่ยังไม่จบ');
        db.shiftRequests.splice(db.shiftRequests.indexOf(r), 1);
        return null;
    }],

    ['GET', /^\/hospitals\/(\d+)\/staff\/(\d+)\/preferences\/months$/, ([h, s], _q, _b, user) => {
        const member = findIn(db.staff, s, h);
        forbid(!(can(user, 'roster.manage') || (can(user, 'shift.request.own') && user.staff_id === member.id)), 'This action is unauthorized.');
        const months = [...new Set(db.preferences.filter((p) => p.staff_id === member.id).map((p) => p.date.slice(0, 7)))].sort().reverse();
        return months.map((month) => {
            const mine = db.preferences.filter((p) => p.staff_id === member.id && p.date.startsWith(month));
            return { month, prefer: mine.filter((p) => p.kind === 'prefer').length, avoid: mine.filter((p) => p.kind === 'avoid').length, locked: monthLocked(member, month) };
        });
    }],
    ['GET', /^\/hospitals\/(\d+)\/staff\/(\d+)\/preferences$/, ([h, s], query, _b, user) => {
        const member = findIn(db.staff, s, h);
        forbid(!(can(user, 'roster.manage') || (can(user, 'shift.request.own') && user.staff_id === member.id)), 'This action is unauthorized.');
        return preferencesOf(member, query.get('month'));
    }],
    ['PUT', /^\/hospitals\/(\d+)\/staff\/(\d+)\/preferences$/, ([h, s], query, body, user) => {
        const member = findIn(db.staff, s, h);
        forbid(user.staff_id !== member.id, 'ส่งได้เฉพาะของตัวเอง');
        const month = query.get('month');
        if (preferencesOf(member, month).locked) fail422('month', ['เดือนนี้แผนกจัดเวรแล้ว ถ้าต้องการเปลี่ยนให้ขอย้าย/แลกเวรแทน']);
        const onLeave = [...new Set(body.items.map((i) => i.date))].filter((d) => leaveOf(member, month).some((l) => l.date === d));
        if (onLeave.length) fail422('items', [`วันที่ลาไว้แล้วเลือกเวรไม่ได้: ${onLeave.join(', ')}`]);
        for (const i of body.items) {
            if (!i.date.startsWith(month)) fail422('items', ['วันที่ต้องอยู่ในเดือนที่เลือก']);
            if (!db.templates.some((t) => t.id === i.shift_template_id && t.department_id === member.department_id)) fail422('items', ['ช่วงเวรไม่ถูกต้อง']);
        }
        db.preferences = db.preferences.filter((p) => !(p.staff_id === member.id && p.date.startsWith(month)));
        db.preferences.push(...body.items.map((i) => ({ staff_id: member.id, shift_template_id: i.shift_template_id, date: i.date, kind: i.kind })));
        return preferencesOf(member, month);
    }],

    ['GET', /^\/hospitals\/(\d+)\/staff\/(\d+)\/my-queue$/, ([h, s], _q, _b, user) => {
        const member = findIn(db.staff, s, h);
        forbid(user.staff_id !== null && user.staff_id !== member.id, 'ดูได้เฉพาะคิวของตัวเอง');
        const skillIds = member.skills.map((k) => k.id);
        const now = new Date();
        return {
            current: db.tickets.find((t) => t.staff_id === member.id && t.status === 'called') ?? null,
            waiting: db.tickets
                .filter((t) => t.department_id === member.department_id && t.status === 'waiting' && t.service_date === today && (t.required_skill_id === null || skillIds.includes(t.required_skill_id)))
                .sort((a, b) => b.priority - a.priority || a.id - b.id)
                .slice(0, 20),
            next_shifts: db.shifts
                .filter((x) => x.staff_id === member.id && new Date(x.ends_at) > now)
                .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
                .slice(0, 5)
                .map((x) => ({ ...x, template: db.templates.find((t) => t.id === x.shift_template_id) })),
        };
    }],

    ['PATCH', /^\/hospitals\/(\d+)\/tickets\/(\d+)\/triage$/, ([h, t], _q, body) => {
        const ticket = findIn(db.tickets, t, h);
        if (![0, 1, 2].includes(Number(body.priority))) throw new HttpError(422, 'The selected priority is invalid.', { priority: ['The selected priority is invalid.'] });
        if (ticket.status !== 'waiting') throw new HttpError(422, 'คิวนี้ถูกเรียกไปแล้ว แก้ความเร่งด่วน/ความเชี่ยวชาญไม่ได้');
        Object.assign(ticket, { priority: Number(body.priority), required_skill_id: body.required_skill_id ?? null });
        return { ...ticket };
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
    ['PATCH', /\/triage$/, 'ticket.triage'],
    ['GET', /\/my-queue$/, 'queue.view'],
    ['GET', /\/on-duty$/, 'queue.view'],
    ['GET', /\/staff-directory$/, 'staff.manage'],
    ['POST', /\/staff$/, 'staff.manage'],
    ['PATCH', /\/staff\/\d+$/, 'staff.manage'],
    ['GET', /\/roster$/, 'roster.view'],
    ['POST', /\/roster\/generate$/, 'roster.manage'],
    ['POST', /\/shifts$/, 'roster.manage'],
    ['DELETE', /\/shifts\/\d+$/, 'roster.manage'],
    ['GET', /\/unavailabilities$/, 'roster.view'],
    ['GET', /\/leave-requests$/, 'leave.approve'],
    ['POST', /\/leave-requests\/\d+\/(approve|reject)$/, 'leave.approve'],
    ['POST', /\/shift-requests$/, 'shift.request.own'],
    ['POST', /\/shift-requests\/\d+\/(accept|decline)$/, 'shift.request.own'],
    ['POST', /\/shift-requests\/\d+\/(approve|reject)$/, 'shift.request.resolve'],
    ['DELETE', /\/shift-requests\/\d+$/, 'shift.request.own'],
    ['PUT', /\/preferences$/, 'shift.request.own'],
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
