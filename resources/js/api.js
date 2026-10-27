export const DEMO = import.meta.env.VITE_DEMO === 'true';

// token ของผู้ใช้ — localStorage อาจใช้ไม่ได้ (private mode) จึงห่อ try/catch และเก็บสำรองไว้ใน memory
let memoryToken = null;
export function getToken() {
    try { return localStorage.getItem('token') ?? memoryToken; } catch { return memoryToken; }
}
export function setToken(token) {
    memoryToken = token;
    try { token ? localStorage.setItem('token', token) : localStorage.removeItem('token'); } catch { /* ใช้ค่าใน memory */ }
}

export async function api(path, { body, ...options } = {}) {
    const token = getToken();

    if (DEMO) {
        // GitHub Pages ไม่มี server — ใช้ API จำลองใน browser (dynamic import: ไม่ติดไปกับ build ปกติ)
        const { mockApi } = await import('./demo/mockApi');
        try {
            return await mockApi(path, { ...options, body, token });
        } catch (error) {
            if (error.status === 401) window.dispatchEvent(new Event('auth:expired'));
            throw error;
        }
    }

    const res = await fetch(`/api${path}`, {
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        ...options,
    });

    if (res.status === 204) return null;
    if (res.status === 401) window.dispatchEvent(new Event('auth:expired'));

    const data = await res.json().catch(() => null);
    if (!res.ok) {
        const error = new Error(data?.message ?? `HTTP ${res.status}`);
        error.status = res.status;
        error.errors = data?.errors; // ข้อความ validation ของ Laravel (เช่น กติกาเวรที่ผิด)
        throw error;
    }

    return data;
}

export const PRIORITY = {
    0: { label: 'ปกติ', className: 'bg-slate-100 text-slate-600' },
    1: { label: 'ผู้สูงอายุ/ผู้พิการ', className: 'bg-amber-100 text-amber-800' },
    2: { label: 'เร่งด่วน', className: 'bg-red-100 text-red-700' },
};

export const STATUS = {
    waiting: { label: 'รอเรียก', className: 'bg-sky-100 text-sky-800' },
    called: { label: 'กำลังตรวจ', className: 'bg-violet-100 text-violet-800' },
    completed: { label: 'เสร็จสิ้น', className: 'bg-emerald-100 text-emerald-800' },
};

// วันที่แบบ YYYY-MM-DD ตามเวลาเครื่อง (ไม่ใช้ toISOString เพราะจะเลื่อนเป็น UTC)
export function isoDate(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function addDays(iso, days) {
    const d = new Date(`${iso}T00:00:00`);
    d.setDate(d.getDate() + days);
    return isoDate(d);
}

export function mondayOf(date = new Date()) {
    const d = new Date(date);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return isoDate(d);
}

// เลขคิวที่ผู้ป่วยเห็น: ตัวเลขล้วน หลักแรก = แผนก เช่น ผู้ป่วยนอก 1001 · แล็บ 2001 (ไม่ซ้ำทั้งโรงพยาบาล ผู้สูงอายุอ่านง่าย)
export const queueNo = (department, number) =>
    department?.queue_prefix ? `${department.queue_prefix}${String(number).padStart(3, '0')}` : String(number).padStart(3, '0');

export const errorMessages = (error) => (error?.errors ? Object.values(error.errors).flat() : [error?.message]);
