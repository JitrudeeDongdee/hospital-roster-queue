import { Fragment, useEffect, useState } from 'react';
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
// ช่องอยากลงในสัปดาห์ที่ชั่วโมงเกินเพดาน: ยังเลือกได้ แต่เปลี่ยนเป็นสีแดงเตือน
const PREFER_OVER = 'bg-red-600 text-white border-red-700';

const monthOf = (iso) => iso.slice(0, 7);
const shiftMonth = (month, n) => {
    const [y, m] = month.split('-').map(Number);
    return isoDate(new Date(y, m - 1 + n, 1)).slice(0, 7);
};
const monthLabel = (month) => new Date(`${month}-01T00:00:00`).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
const dayMonth = (iso) => `${Number(iso.slice(8))}/${Number(iso.slice(5, 7))}`;
const weekday = (iso) => new Date(`${iso}T00:00:00`).getDay();
// สัปดาห์เริ่มวันจันทร์ — ตรงกับกติกาชั่วโมงต่อสัปดาห์ของ backend
const mondayOf = (iso) => addDays(iso, -((weekday(iso) + 6) % 7));
const hoursOf = (t) => {
    const [sh, sm] = t.start_time.split(':').map(Number);
    const [eh, em] = t.end_time.split(':').map(Number);
    let minutes = eh * 60 + em - (sh * 60 + sm);
    if (minutes <= 0) minutes += 24 * 60;
    return minutes / 60;
};

// แพทย์เลือกช่องเวรที่อยากลง / ไม่สะดวก ของเดือนที่ยังไม่จัด — ระบบจัดร่างให้ช่องที่อยากลงก่อน เลี่ยงช่องที่ไม่สะดวก
export default function PreferencesPage({ hospitalId, staffId }) {
    const queryClient = useQueryClient();
    const [params, setParams] = useSearchParams();
    const month = /^\d{4}-\d{2}$/.test(params.get('month') ?? '') ? params.get('month') : shiftMonth(monthOf(isoDate(new Date())), 1);
    const department = useStaff(hospitalId).data?.find((s) => s.id === staffId)?.department_id;
    const base = `/hospitals/${hospitalId}/staff/${staffId}/preferences`;
    const url = `${base}?month=${month}`;

    const saved = useQuery({ queryKey: ['preferences', hospitalId, staffId, month], queryFn: () => api(url) });
    const history = useQuery({ queryKey: ['preferences', hospitalId, staffId, 'months'], queryFn: () => api(`${base}/months`) });
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
        onSuccess: (data) => {
            queryClient.setQueryData(['preferences', hospitalId, staffId, month], data);
            queryClient.invalidateQueries({ queryKey: ['preferences', hospitalId, staffId, 'months'] });
        },
    });

    const locked = saved.data?.locked;
    const maxWeekly = saved.data?.max_weekly_hours ?? null;
    const leave = Object.fromEntries((saved.data?.leave ?? []).map((l) => [l.date, l.status]));
    const days = [];
    for (let d = `${month}-01`; monthOf(d) === month; d = addDays(d, 1)) days.push(d);

    // ชั่วโมงของช่องที่อยากลง แยกรายสัปดาห์ (จันทร์–อาทิตย์) และรวมทั้งเดือน
    const hoursOfTemplate = Object.fromEntries(templates.map((t) => [t.id, hoursOf(t)]));
    const weekHours = {};
    let monthHours = 0;
    for (const [key, kind] of Object.entries(draft)) {
        if (kind !== 'prefer') continue;
        const [date, templateId] = key.split('|');
        const h = hoursOfTemplate[templateId] ?? 0;
        weekHours[mondayOf(date)] = (weekHours[mondayOf(date)] ?? 0) + h;
        monthHours += h;
    }
    const isOver = (date) => maxWeekly !== null && (weekHours[mondayOf(date)] ?? 0) > maxWeekly;
    const overWeeks = Object.values(weekHours).filter((h) => maxWeekly !== null && h > maxWeekly).length;

    const count = (kind) => Object.values(draft).filter((k) => k === kind).length;
    const savedMap = Object.fromEntries((saved.data?.items ?? []).map((i) => [`${i.date}|${i.shift_template_id}`, i.kind]));
    const dirty = JSON.stringify(Object.entries(draft).filter(([, k]) => k).sort()) !== JSON.stringify(Object.entries(savedMap).sort());
    const toggle = (key) => !locked && setDraft({ ...draft, [key]: NEXT[draft[key]] });
    const go = (m) => setParams({ month: m });

    return (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
            <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4">
                    <h2 className="mr-auto text-lg font-semibold">เวรที่อยากลง</h2>
                    <div className="flex items-center gap-1 text-sm">
                        <button className="rounded-md border border-slate-300 px-2 py-1.5" onClick={() => go(shiftMonth(month, -1))} aria-label="เดือนก่อน">‹</button>
                        <span className="w-36 text-center font-medium">{monthLabel(month)}</span>
                        <button className="rounded-md border border-slate-300 px-2 py-1.5" onClick={() => go(shiftMonth(month, 1))} aria-label="เดือนถัดไป">›</button>
                    </div>
                    <button
                        className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
                        disabled={locked || !dirty || save.isPending}
                        onClick={() => save.mutate()}
                    >
                        {save.isPending ? 'กำลังบันทึก…' : 'บันทึก'}
                    </button>
                </div>

                {locked && <p className="mx-4 mt-4 rounded-md bg-slate-100 p-3 text-sm text-slate-700">เดือนนี้แผนกจัดเวรแล้ว ดูได้อย่างเดียว · ถ้าต้องการเปลี่ยน ให้ขอย้าย/แลกเวรแทน</p>}
                {save.isError && <p className="mx-4 mt-4 rounded-md bg-rose-50 p-3 text-sm text-rose-800">{errorMessages(save.error).join(' ')}</p>}
                {save.isSuccess && !dirty && <p className="mx-4 mt-4 text-sm text-emerald-700">บันทึกแล้ว · แอดมินจะเห็นตอนจัดเวรร่าง</p>}

                <div className="mx-4 mt-4 flex flex-wrap items-center gap-2 text-sm">
                    <span className={`rounded-md border px-2 py-1 ${overWeeks ? 'border-red-300 bg-red-50 text-red-800' : 'border-slate-200 bg-slate-50'}`}>
                        อยากลงรวม <strong className="font-mono">{monthHours}</strong> ชม. ({count('prefer')} ช่อง)
                        {maxWeekly !== null && <> · เพดาน {maxWeekly} ชม./สัปดาห์</>}
                    </span>
                    {overWeeks > 0 && <span className="rounded-md border border-red-300 bg-red-50 px-2 py-1 text-red-800">⚠ เกินเพดาน {overWeeks} สัปดาห์ (ยังส่งได้ แต่ระบบจัดเวรให้ไม่เกินเพดาน)</span>}
                    <span className="text-slate-500">ไม่สะดวก {count('avoid')} ช่อง</span>
                </div>
                <p className="mx-4 mt-2 text-xs text-slate-500">
                    กดช่องเพื่อสลับ: ว่าง → <Chip kind="prefer" /> → <Chip kind="avoid" /> → ว่าง · วันที่ลาไว้แล้วเลือกไม่ได้
                </p>

                <div className="overflow-x-auto p-4">
                    <table className="w-full min-w-[480px] table-fixed border-collapse text-sm">
                        <thead>
                            <tr>
                                <th className="w-24 p-2 text-left text-xs font-medium text-slate-500">วัน</th>
                                {templates.map((t) => (
                                    <th key={t.id} className="p-2 text-left text-xs font-medium text-slate-500">{t.name} <span className="font-normal">{t.start_time.slice(0, 5)}–{t.end_time.slice(0, 5)} · {hoursOfTemplate[t.id]} ชม.</span></th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {days.map((date, i) => {
                                const wd = weekday(date);
                                const onLeave = leave[date];
                                const endOfWeek = wd === 0 || i === days.length - 1;
                                return (
                                    <Fragment key={date}>
                                        <tr className={`border-t border-slate-100 ${onLeave ? 'bg-amber-50' : [0, 6].includes(wd) ? 'bg-slate-50' : ''}`}>
                                            <td className="p-2 font-medium">{DAY_NAMES[wd]} {Number(date.slice(8))}</td>
                                            {onLeave ? (
                                                <td colSpan={templates.length} className="p-1">
                                                    <div className={`rounded border px-2 py-1 text-center text-xs ${onLeave === 'approved' ? 'border-amber-400 bg-amber-100 text-amber-900' : 'border-dashed border-amber-400 text-amber-900'}`}>
                                                        {onLeave === 'approved' ? 'ลา (อนุมัติแล้ว)' : 'ขอลา (รออนุมัติ)'} · เลือกเวรวันนี้ไม่ได้
                                                    </div>
                                                </td>
                                            ) : templates.map((t) => {
                                                const key = `${date}|${t.id}`;
                                                const kind = draft[key];
                                                const style = kind === 'prefer' && isOver(date) ? PREFER_OVER : kind ? KIND[kind].className : 'border-dashed border-slate-300 text-slate-400 hover:bg-slate-100';
                                                return (
                                                    <td key={t.id} className="p-1">
                                                        <button
                                                            className={`w-full rounded border px-2 py-1 text-xs ${style} disabled:cursor-not-allowed disabled:opacity-60`}
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
                                        {endOfWeek && (
                                            <WeekTotal from={mondayOf(date)} to={date} hours={weekHours[mondayOf(date)] ?? 0} max={maxWeekly} cols={templates.length + 1} />
                                        )}
                                    </Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </section>

            {/* จอแคบ: ประวัติขึ้นก่อนตาราง ไม่ต้องเลื่อนผ่านทั้งเดือนเพื่อหาเดือนอื่น */}
            <div className="order-first space-y-6 xl:order-none">
                <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
                    <h2 className="border-b border-slate-200 p-4 font-semibold">ประวัติที่เคยส่ง</h2>
                    {history.data?.length === 0 && <p className="p-4 text-sm text-slate-500">ยังไม่เคยส่ง</p>}
                    <ul className="divide-y divide-slate-100">
                        {history.data?.map((h) => (
                            <li key={h.month}>
                                <button
                                    className={`flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm hover:bg-indigo-50 ${h.month === month ? 'bg-indigo-50 font-medium' : ''}`}
                                    onClick={() => go(h.month)}
                                >
                                    <span>{monthLabel(h.month)}</span>
                                    <span className="flex items-center gap-1.5 text-xs">
                                        <span className="text-emerald-700">★ {h.prefer}</span>
                                        <span className="text-slate-500">✕ {h.avoid}</span>
                                        <span className={`rounded-full px-1.5 ${h.locked ? 'bg-slate-200 text-slate-600' : 'bg-sky-100 text-sky-800'}`}>{h.locked ? 'จัดเวรแล้ว' : 'แก้ได้'}</span>
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </section>
                <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
                    <h2 className="mb-2 font-semibold text-slate-800">ใช้ทำอะไร</h2>
                    <ul className="list-disc space-y-1 pl-5">
                        <li>ส่งได้จนกว่าแผนกจะเริ่มจัดเวรของเดือนนั้น</li>
                        <li>ตอนแอดมินกด "จัดเวรทั้งเดือนอัตโนมัติ" ระบบจะลงช่องที่คุณอยากลงก่อน และเลี่ยงช่องที่ไม่สะดวก</li>
                        <li>เลือกเกินเพดานชั่วโมงต่อสัปดาห์ได้ (ช่องเป็นสีแดง) แต่ระบบจัดให้ไม่เกินเพดาน</li>
                        <li>ไม่สะดวก ≠ ลา · ถ้าไปไม่ได้จริงให้ขอลา วันที่ลาไว้แล้วจะเลือกเวรไม่ได้</li>
                    </ul>
                </section>
            </div>
        </div>
    );
}

function WeekTotal({ from, to, hours, max, cols }) {
    const over = max !== null && hours > max;
    return (
        <tr>
            <td colSpan={cols} className={`border-b-2 px-2 py-1 text-right text-xs ${over ? 'border-red-300 bg-red-50 font-medium text-red-700' : 'border-slate-200 text-slate-500'}`}>
                สัปดาห์ {dayMonth(from)}–{dayMonth(to)}: อยากลง <span className="font-mono">{hours}</span>{max !== null && <> / {max}</>} ชม.{over && ' · เกินเพดาน'}
            </td>
        </tr>
    );
}

function Chip({ kind }) {
    return <span className={`inline-block rounded border px-1.5 text-xs ${KIND[kind].className}`}>{KIND[kind].label}</span>;
}
