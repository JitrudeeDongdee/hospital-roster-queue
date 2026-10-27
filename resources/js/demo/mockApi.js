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
    const departments = [];
    const staff = [];
    const tickets = [];
    const counters = {};

    for (let h = 1; h <= 15; h++) {
        hospitals.push({ id: h, code: `H${String(h).padStart(3, '0')}`, name: `Demo Hospital ${h}` });

        for (const [code, name] of [['OPD', 'Outpatient'], ['LAB', 'Laboratory'], ['XRAY', 'Radiology']]) {
            const department = { id: departments.length + 1, hospital_id: h, code, name };
            departments.push(department);

            for (let s = 1; s <= 3; s++) {
                const owned = [...skills].sort(() => random() - 0.5).slice(0, 2);
                staff.push({ id: staff.length + 1, hospital_id: h, department_id: department.id, name: `${code} staff ${s}`, skills: owned });
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

    return { skills, hospitals, departments, staff, tickets, counters };
})();

class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findIn(list, id, hospitalId) {
    const item = list.find((x) => x.id === Number(id));
    if (!item || item.hospital_id !== Number(hospitalId)) throw new HttpError(404, 'Not Found'); // = scopeBindings
    return item;
}

const routes = [
    ['GET', /^\/hospitals$/, () => db.hospitals],
    ['GET', /^\/skills$/, () => db.skills],
    ['GET', /^\/hospitals\/(\d+)\/departments$/, ([h]) => db.departments.filter((d) => d.hospital_id === Number(h))],
    ['GET', /^\/hospitals\/(\d+)\/staff$/, ([h]) => db.staff.filter((s) => s.hospital_id === Number(h))],

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

    ['POST', /^\/hospitals\/(\d+)\/departments\/(\d+)\/tickets$/, ([h, d], _query, body) => {
        const department = findIn(db.departments, d, h);
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

    ['POST', /^\/hospitals\/(\d+)\/staff\/(\d+)\/call-next$/, ([h, s]) => {
        const member = findIn(db.staff, s, h);
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

    ['POST', /^\/hospitals\/(\d+)\/tickets\/(\d+)\/complete$/, ([h, t]) => {
        const ticket = findIn(db.tickets, t, h);
        if (ticket.status !== 'called') throw new HttpError(422, 'Ticket has not been called.');
        Object.assign(ticket, { status: 'completed' });
        return { ...ticket };
    }],
];

export async function mockApi(path, { method = 'GET', body } = {}) {
    await delay(120 + Math.random() * 180); // ให้รู้สึกเหมือนเรียกผ่านเน็ต

    const url = new URL(path, 'http://demo.local');
    for (const [routeMethod, pattern, handler] of routes) {
        const match = routeMethod === method && url.pathname.match(pattern);
        if (match) return handler(match.slice(1), url.searchParams, body);
    }

    throw new HttpError(404, `No demo route for ${method} ${url.pathname}`);
}
