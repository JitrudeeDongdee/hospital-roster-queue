import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, api, errorMessages, isoDate } from '../api';
import { useDepartments, useStaff } from '../useLookups';
import { useAuth } from '../auth';

const DAY_NAMES = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];

const firstOfMonth = (date = new Date()) => isoDate(new Date(date.getFullYear(), date.getMonth(), 1));
const shiftMonth = (iso, months) => {
    const d = new Date(`${iso}T00:00:00`);
    return isoDate(new Date(d.getFullYear(), d.getMonth() + months, 1));
};
const lastOfMonth = (iso) => addDays(shiftMonth(iso, 1), -1);
const monthLabel = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
const weekday = (iso) => new Date(`${iso}T00:00:00`).getDay();

export default function RosterPage({ hospitalId }) {
    const queryClient = useQueryClient();
    const { user, can } = useAuth();
    const canManage = can('roster.manage');
    const departments = useDepartments(hospitalId).data ?? [];
    const allStaff = useStaff(hospitalId).data ?? [];
    const [departmentId, setDepartmentId] = useState(null);
    const [monthStart, setMonthStart] = useState(firstOfMonth());
    const [problems, setProblems] = useState(null);

    const ownDept = allStaff.find((s) => s.id === user.staff_id)?.department_id;
    const deptId = departmentId ?? ownDept ?? departments[0]?.id;
    const doctors = allStaff.filter((s) => s.department_id === deptId);
    const from = monthStart;
    const to = lastOfMonth(monthStart);
    const rosterKey = ['roster', hospitalId, deptId, from];

    const roster = useQuery({
        queryKey: rosterKey,
        queryFn: () => api(`/hospitals/${hospitalId}/departments/${deptId}/roster?from=${from}&to=${to}`),
        enabled: !!deptId,
    });

    const refresh = () => {
        queryClient.invalidateQueries({ queryKey: ['roster', hospitalId] });
        queryClient.invalidateQueries({ queryKey: ['my-queue', hospitalId] });
    };

    const generate = useMutation({
        mutationFn: () => api(`/hospitals/${hospitalId}/departments/${deptId}/roster/generate`, { method: 'POST', body: { from, to } }),
        onSuccess: (data) => {
            queryClient.setQueryData(rosterKey, data);
            setProblems(data.gaps.length ? [`สร้างเพิ่ม ${data.created} เวร · ยังเหลือ ${data.gaps.length} ช่องที่จัดไม่ได้โดยไม่ผิดกติกา`] : [`สร้างเพิ่ม ${data.created} เวร · ครบทุกช่อง`]);
            queryClient.invalidateQueries({ queryKey: ['my-queue', hospitalId] });
        },
        onError: (error) => setProblems(errorMessages(error)),
    });

    const assign = useMutation({
        mutationFn: (body) => api(`/hospitals/${hospitalId}/shifts`, { method: 'POST', body }),
        onSuccess: () => { setProblems(null); refresh(); },
        onError: (error) => setProblems(errorMessages(error)),
    });

    const remove = useMutation({
        mutationFn: (shiftId) => api(`/hospitals/${hospitalId}/shifts/${shiftId}`, { method: 'DELETE' }),
        onSuccess: refresh,
    });

    const cells = useMemo(() => {
        const map = {};
        for (const shift of roster.data?.shifts ?? []) (map[`${shift.shift_date}|${shift.shift_template_id}`] ??= []).push(shift);
        return map;
    }, [roster.data]);
    const gaps = useMemo(() => Object.fromEntries((roster.data?.gaps ?? []).map((g) => [`${g.date}|${g.shift_template_id}`, g.problem])), [roster.data]);
    const hours = useMemo(() => {
        const perDoctor = {};
        const templates = Object.fromEntries((roster.data?.templates ?? []).map((t) => [t.id, t]));
        for (const s of roster.data?.shifts ?? []) perDoctor[s.staff_id] = (perDoctor[s.staff_id] ?? 0) + shiftHours(templates[s.shift_template_id]);
        return perDoctor;
    }, [roster.data]);

    const templates = roster.data?.templates ?? [];
    const days = [];
    for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
    const gapCount = roster.data?.gaps.length ?? 0;

    return (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4">
                    <h2 className="mr-auto text-lg font-semibold">ตารางเวรแพทย์</h2>
                    <select className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={deptId ?? ''} onChange={(e) => { setDepartmentId(Number(e.target.value)); setProblems(null); }}>
                        {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                    <div className="flex items-center gap-1 text-sm">
                        <button className="rounded-md border border-slate-300 px-2 py-1.5" onClick={() => { setMonthStart(shiftMonth(monthStart, -1)); setProblems(null); }} aria-label="เดือนก่อน">‹</button>
                        <span className="w-36 text-center font-medium">{monthLabel(from)}</span>
                        <button className="rounded-md border border-slate-300 px-2 py-1.5" onClick={() => { setMonthStart(shiftMonth(monthStart, 1)); setProblems(null); }} aria-label="เดือนถัดไป">›</button>
                    </div>
                    {canManage ? (
                        <button
                            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
                            disabled={generate.isPending || !deptId}
                            onClick={() => generate.mutate()}
                        >
                            {generate.isPending ? 'กำลังจัด…' : 'จัดเวรทั้งเดือนอัตโนมัติ (ร่าง)'}
                        </button>
                    ) : (
                        <span className="rounded-md bg-slate-100 px-3 py-1.5 text-xs text-slate-500">ดูอย่างเดียว · จัดเวรได้เฉพาะแอดมิน</span>
                    )}
                </div>

                {problems && (
                    <ul className="mx-4 mt-4 space-y-1 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
                        {problems.map((p) => <li key={p}>• {p}</li>)}
                    </ul>
                )}

                {roster.isSuccess && (
                    <p className={`mx-4 mt-4 text-sm ${gapCount ? 'text-red-600' : 'text-emerald-700'}`}>
                        {gapCount ? `ยังมี ${gapCount} ช่องที่คนไม่ครบหรือขาดความเชี่ยวชาญ (สีแดง)` : 'ทุกเวรในเดือนนี้มีแพทย์ครบตามกติกา'}
                    </p>
                )}

                <div className="max-h-[70vh] overflow-auto p-4">
                    {roster.isPending && <p className="text-sm text-slate-500">กำลังโหลด…</p>}
                    {roster.isError && <p className="text-sm text-red-600">{roster.error.message}</p>}
                    {roster.isSuccess && (
                        <table className="w-full min-w-[640px] table-fixed border-collapse text-sm">
                            <thead className="sticky top-0 z-10 bg-white">
                                <tr>
                                    <th className="w-24 p-2 text-left text-xs font-medium text-slate-500">วัน</th>
                                    {templates.map((t) => (
                                        <th key={t.id} className="p-2 text-left text-xs font-medium text-slate-500">
                                            {t.name} <span className="font-normal">{t.start_time.slice(0, 5)}–{t.end_time.slice(0, 5)}</span>
                                            <div className="font-normal text-slate-400">ขั้นต่ำ {t.min_staff} คน{t.required_skill_id ? ' · ต้องมีความเชี่ยวชาญ' : ''}</div>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {days.map((date) => (
                                    <tr key={date} className={`border-t border-slate-100 align-top ${[0, 6].includes(weekday(date)) ? 'bg-slate-50' : ''}`}>
                                        <td className="p-2 font-medium">{DAY_NAMES[weekday(date)]} {formatDay(date)}</td>
                                        {templates.map((t) => {
                                            const key = `${date}|${t.id}`;
                                            const assigned = cells[key] ?? [];
                                            return (
                                                <td key={t.id} className={`p-2 ${gaps[key] ? 'bg-red-50' : ''}`}>
                                                    <div className="flex flex-wrap gap-1">
                                                        {assigned.map((s) => (
                                                            <span key={s.id} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${s.staff_id === user.staff_id ? 'bg-emerald-100 text-emerald-900 ring-1 ring-emerald-400' : 'bg-indigo-50 text-indigo-800'}`}>
                                                                {s.staff_name}
                                                                {canManage && <button className="text-indigo-400 hover:text-red-600" onClick={() => remove.mutate(s.id)} aria-label={`เอา ${s.staff_name} ออกจากเวร`}>✕</button>}
                                                            </span>
                                                        ))}
                                                    </div>
                                                    {canManage && <select
                                                        className="mt-1 w-full rounded border border-dashed border-slate-300 bg-transparent px-1 py-0.5 text-xs text-slate-500"
                                                        value=""
                                                        onChange={(e) => assign.mutate({ staff_id: Number(e.target.value), shift_template_id: t.id, date })}
                                                    >
                                                        <option value="">+ ลงเวร</option>
                                                        {doctors.filter((d) => !assigned.some((s) => s.staff_id === d.id)).map((d) => (
                                                            <option key={d.id} value={d.id}>{d.name}</option>
                                                        ))}
                                                    </select>}
                                                    {gaps[key] && <p className="mt-1 text-xs text-red-600">{gaps[key]}</p>}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </section>

            <div className="space-y-6">
                <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <h2 className="mb-1 text-lg font-semibold">ชั่วโมงเดือนนี้</h2>
                    <p className="mb-3 text-xs text-slate-500">กติกา: ไม่เกินชั่วโมงต่อสัปดาห์ที่โรงพยาบาลกำหนด · พักระหว่างเวรขั้นต่ำ</p>
                    <ul className="space-y-2 text-sm">
                        {doctors.map((d) => (
                            <li key={d.id} className="flex items-center justify-between gap-2">
                                <span>
                                    {d.name}
                                    <span className="ml-1 text-xs text-slate-400">{d.skills.map((s) => s.code).join(', ')}</span>
                                </span>
                                <span className="font-mono">{hours[d.id] ?? 0} ชม.</span>
                            </li>
                        ))}
                    </ul>
                </section>
                {(can('leave.manage.any') || can('leave.manage.own')) && (
                    <UnavailabilityPanel
                        hospitalId={hospitalId}
                        doctors={can('leave.manage.any') ? doctors : doctors.filter((d) => d.id === user.staff_id)}
                        onChange={refresh}
                    />
                )}
            </div>
        </div>
    );
}

function UnavailabilityPanel({ hospitalId, doctors, onChange }) {
    const queryClient = useQueryClient();
    const [staffId, setStaffId] = useState('');
    const [date, setDate] = useState('');
    const [reason, setReason] = useState('');
    const doctorId = staffId || doctors[0]?.id;

    const list = useQuery({
        queryKey: ['unavailabilities', hospitalId, doctorId],
        queryFn: () => api(`/hospitals/${hospitalId}/staff/${doctorId}/unavailabilities`),
        enabled: !!doctorId,
    });

    const add = useMutation({
        mutationFn: () => api(`/hospitals/${hospitalId}/staff/${doctorId}/unavailabilities`, { method: 'POST', body: { date, reason } }),
        onSuccess: () => {
            setDate('');
            setReason('');
            queryClient.invalidateQueries({ queryKey: ['unavailabilities', hospitalId, doctorId] });
            onChange();
        },
    });

    const input = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm';

    return (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold">วันลา / วันไม่สะดวก</h2>
            <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
                <select className={input} value={doctorId ?? ''} onChange={(e) => setStaffId(Number(e.target.value))}>
                    {doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <input className={input} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
                <input className={input} placeholder="เหตุผล (ไม่บังคับ)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={100} />
                <button className="w-full rounded-md bg-slate-800 py-2 text-sm font-medium text-white disabled:opacity-40" disabled={add.isPending}>บันทึกวันลา</button>
            </form>
            {add.isError && <p className="mt-2 text-sm text-red-600">{errorMessages(add.error).join(' ')}</p>}
            <ul className="mt-3 space-y-1 text-sm">
                {list.data?.map((u) => (
                    <li key={u.id} className="flex justify-between"><span>{formatDay(u.date.slice(0, 10))}</span><span className="text-slate-500">{u.reason}</span></li>
                ))}
                {list.data?.length === 0 && <li className="text-slate-400">ยังไม่มีวันลา</li>}
            </ul>
        </section>
    );
}

function shiftHours(template) {
    if (!template) return 0;
    const [sh, sm] = template.start_time.split(':').map(Number);
    const [eh, em] = template.end_time.split(':').map(Number);
    let minutes = eh * 60 + em - (sh * 60 + sm);
    if (minutes <= 0) minutes += 24 * 60;
    return minutes / 60;
}

function formatDay(iso) {
    const [, m, d] = iso.split('-');
    return `${Number(d)}/${Number(m)}`;
}
