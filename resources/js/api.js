export const DEMO = import.meta.env.VITE_DEMO === 'true';

export async function api(path, { body, ...options } = {}) {
    if (DEMO) {
        // GitHub Pages ไม่มี server — ใช้ API จำลองใน browser (dynamic import: ไม่ติดไปกับ build ปกติ)
        const { mockApi } = await import('./demo/mockApi');
        return mockApi(path, { ...options, body });
    }

    const res = await fetch(`/api${path}`, {
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        ...options,
    });

    if (res.status === 204) return null;

    const data = await res.json().catch(() => null);
    if (!res.ok) {
        const error = new Error(data?.message ?? `HTTP ${res.status}`);
        error.status = res.status;
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
    called: { label: 'เรียกแล้ว', className: 'bg-violet-100 text-violet-800' },
    completed: { label: 'เสร็จสิ้น', className: 'bg-emerald-100 text-emerald-800' },
};
