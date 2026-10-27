import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, api, errorMessages, isoDate } from '../api';
import { useStaff } from '../useLookups';

const DAY_NAMES = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const NEXT = { undefined: 'prefer', prefer: 'avoid', avoid: undefined };
const KIND = {
    prefer: { label: '★ อยากลง', className: 'bg-emerald-600 text-white border-emerald-600' },
    avoid: { label: '✕ ไม่สะดวก', className: 'bg-slate-500 text-white border-slate-500' },
};

const monthOf = (iso) => iso.slice(0, 7);
const shiftMonth = (month, n) => {
    const [y, m] = month.split('-').map(Number);
    return isoDate(new Date(y, m - 1 + n, 1)).slice(0, 7);
};
const monthLabel = (month) => new Date(`${month}-01T00:00:00`).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });

// แพทย์เลือกช่องเวรที่อยากลง / ไม่สะดวก ของเดือนที่ยังไม่จัด — ระบบจัดร่างให้ช่องที่อยากลงก่อน เลี่ยงช่องที่ไม่สะดวก
export default function PreferencesPage({ hospitalId, staffId }) {
    const queryClient = useQueryClient();
    const [params, setParams] = useSearchParams();
    const month = /^\d{4}-\d{2}$/.test(params.get('month') ?? '') ? params.get('month') : shiftMonth(monthOf(isoDate(new Date())), 1);
    const department = useStaff(hospitalId).data?.find((s) => s.id === staffId)?.department_id;
    const url = `/hospitals/${hospitalId}/staff/${staffId}/preferences?month=${month}`;

    const saved = useQuery({ queryKey: ['preferences', hospitalId, staffId, month], queryFn: () => api(url) });
    // ใช้ roster เพื่อเอาช่วงเวรของแผนก (เดือนที่ยังไม่จัดจะไม่มีเวร มีแค่ templates)
    const templates = useQuery({
        queryKey: ['roster', hospitalId, department, `${month}-01`, `${month}-01`],
        queryFn: () => api(`/hospitals/${hospitalId}/departments/${department}/roster?from=${month}-01&to=${month}-01`),
        enabled: !!department,
        select: (data) => data.templates,
    }).data ?? [];

    const [draft, setDraft] = useState({});
    useEffect(() => {
        if (saved.data) setDraft(Object.fromEntries(saved.data.items.map((i) => [`${i.date}|${i.shift_template_id}`, i.kind])));
    }, [saved.data]);

    const save = useMutation({
        mutationFn: () => api(url, {
            method: 'PUT',
            body: {
                items: Object.entries(draft).filter(([, kind]) => kind).map(([key, kind]) => {
                    const [date, shift_template_id] = key.split('|');
                    return { date, shift_template_id: Number(shift_template_id), kind };
                }),
            },
        }),
        onSuccess: (data) => queryClient.setQueryData(['preferences', hospitalId, staffId, month], data),
    });

    const locked = saved.data?.locked;
    const days = [];
    for (let d = `${month}-01`; monthOf(d) === month; d = addDays(d, 1)) days.push(d);
    const count = (kind) => Object.values(draft).filter((k) => k === kind).length;
    const savedMap = Object.fromEntries((saved.data?.items ?? []).map((i) => [`${i.date}|${i.shift_template_id}`, i.kind]));
    const dirty = JSON.stringify(Object.entries(draft).filter(([, k]) => k).sort()) !== JSON.stringify(Object.entries(savedMap).sort());
    const toggle = (key) => !locked && setDraft({ ...draft, [key]: NEXT[draft[key]] });

    return (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4">
                    <h2 className="mr-auto text-lg font-semibold">เวรที่อยากลง</h2>
                    <div className="flex items-center gap-1 text-sm">
                        <button className="rounded-md border border-slate-300 px-2 py-1.5" onClick={() => setParams({ month: shiftMonth(month, -1) })} aria-label="เดือนก่อน">‹</button>
                        <span className="w-36 text-center font-medium">{monthLabel(month)}</span>
                        <button className="rounded-md border border-slate-300 px-2 py-1.5" onClick={() => setParams({ month: shiftMonth(month, 1) })} aria-label="เดือนถัดไป">›</button>
                    </div>
                    <button
                        className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
                        disabled={locked || !dirty || save.isPending}
                        onClick={() => save.mutate()}
                    >
                        {save.isPending ? 'กำลังบันทึก…' : 'บันทึก'}
                    </button>
                </div>

                {locked && <p className="mx-4 mt-4 rounded-md bg-slate-100 p-3 text-sm text-slate-700">เดือนนี้แผนกจัดเวรแล้ว แก้ไม่ได้ · ถ้าต้องการเปลี่ยน ให้ขอย้าย/แลกเวรแทน</p>}
                {save.isError && <p className="mx-4 mt-4 rounded-md bg-rose-50 p-3 text-sm text-rose-800">{errorMessages(save.error).join(' ')}</p>}
                {save.isSuccess && !dirty && <p className="mx-4 mt-4 text-sm text-emerald-700">บันทึกแล้ว · แอดมินจะเห็นตอนจัดเวรร่าง</p>}
                <p className="mx-4 mt-4 text-sm text-slate-600">
                    กดช่องเพื่อสลับ: ว่าง → <Chip kind="prefer" /> → <Chip kind="avoid" /> → ว่าง ·
                    เลือกแล้ว อยากลง {count('prefer')} · ไม่สะดวก {count('avoid')}
                </p>

                <div className="overflow-x-auto p-4">
                    <table className="w-full min-w-[480px] table-fixed border-collapse text-sm">
                        <thead>
                            <tr>
                                <th className="w-24 p-2 text-left text-xs font-medium text-slate-500">วัน</th>
                                {templates.map((t) => (
                                    <th key={t.id} className="p-2 text-left text-xs font-medium text-slate-500">{t.name} <span className="font-normal">{t.start_time.slice(0, 5)}–{t.end_time.slice(0, 5)}</span></th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {days.map((date) => {
                                const wd = new Date(`${date}T00:00:00`).getDay();
                                return (
                                    <tr key={date} className={`border-t border-slate-100 ${[0, 6].includes(wd) ? 'bg-slate-50' : ''}`}>
                                        <td className="p-2 font-medium">{DAY_NAMES[wd]} {Number(date.slice(8))}</td>
                                        {templates.map((t) => {
                                            const key = `${date}|${t.id}`;
                                            const kind = draft[key];
                                            return (
                                                <td key={t.id} className="p-1">
                                                    <button
                                                        className={`w-full rounded border px-2 py-1 text-xs ${kind ? KIND[kind].className : 'border-dashed border-slate-300 text-slate-400 hover:bg-slate-100'} disabled:cursor-not-allowed disabled:opacity-60`}
                                                        disabled={locked}
                                                        onClick={() => toggle(key)}
                                                        aria-label={`${date} ${t.name}: ${kind ? KIND[kind].label : 'ไม่ได้เลือก'}`}
                                                    >
                                                        {kind ? KIND[kind].label : '—'}
                                                    </button>
                                                </td>
                                            );
                                        })}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </section>
            <section className="h-fit rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
                <h2 className="mb-2 font-semibold text-slate-800">ใช้ทำอะไร</h2>
                <ul className="list-disc space-y-1 pl-5">
                    <li>ส่งได้จนกว่าแผนกจะเริ่มจัดเวรของเดือนนั้น</li>
                    <li>ตอนแอดมินกด "จัดเวรทั้งเดือนอัตโนมัติ" ระบบจะลงช่องที่คุณอยากลงก่อน และเลี่ยงช่องที่ไม่สะดวก</li>
                    <li>ไม่สะดวก ≠ ลา · ถ้าคนไม่พอ ระบบยังลงช่องนั้นได้ ถ้าไปไม่ได้จริงให้ขอลา</li>
                    <li>กติกาเวร (ซ้อน พัก ชั่วโมงต่อสัปดาห์) สำคัญกว่าความต้องการเสมอ</li>
                </ul>
            </section>
        </div>
    );
}

function Chip({ kind }) {
    return <span className={`inline-block rounded border px-1.5 text-xs ${KIND[kind].className}`}>{KIND[kind].label}</span>;
}
