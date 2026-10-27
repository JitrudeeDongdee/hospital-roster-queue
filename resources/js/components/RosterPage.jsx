import { useMemo, useState } from 'react';
import { NavLink, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import RosterCalendar, { calendarRange } from './RosterCalendar';
import DoctorFilter from './DoctorFilter';
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

const VIEWS = [['table', 'ตาราง'], ['calendar', 'ปฏิทินรวม'], ['doctors', 'ปฏิทินรายแพทย์']];

// view มาจาก URL: /roster/table · /roster/calendar · /roster/doctors/:staffId — ตัวกรองอยู่ใน query (?dept=&month=YYYY-MM)
export default function RosterPage({ hospitalId, view }) {
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const { staffId } = useParams();
    const [params, setParams] = useSearchParams();
    const { user, can } = useAuth();
    const canManage = can('roster.manage');
    const departments = useDepartments(hospitalId).data ?? [];
    const allStaff = useStaff(hospitalId).data ?? [];
    const [problems, setProblems] = useState(null);

    const doctorFromUrl = allStaff.find((s) => s.id === Number(staffId));
    const ownDept = allStaff.find((s) => s.id === user.staff_id)?.department_id;
    const deptId = Number(params.get('dept')) || doctorFromUrl?.department_id || ownDept || departments[0]?.id;
    const monthParam = /^\d{4}-\d{2}$/.test(params.get('month') ?? '') ? params.get('month') : null;
    const monthStart = monthParam ? `${monthParam}-01` : firstOfMonth();
    const doctors = allStaff.filter((s) => s.department_id === deptId);
    // ?doctors=1,4 — กรองหลายคน ใช้กับตารางและปฏิทินรวม (เฉพาะคนในแผนกที่เลือก)
    const selectedDoctors = (params.get('doctors') ?? '').split(',').map(Number).filter((id) => doctors.some((d) => d.id === id));
    const isShown = (staffId) => selectedDoctors.length === 0 || selectedDoctors.includes(staffId);
    const from = monthStart;
    const to = lastOfMonth(monthStart);
    // ปฏิทินดึงเต็มสัปดาห์ที่คร่อมต้น/ปลายเดือน ชั่วโมงรายสัปดาห์จึงถูกต้อง
    const [rangeFrom, rangeTo] = view === 'table' ? [from, to] : calendarRange(from, to);
    const rosterKey = ['roster', hospitalId, deptId, rangeFrom, rangeTo];

    const query = (changes) => {
        const next = new URLSearchParams(params);
        for (const [k, v] of Object.entries(changes)) v === null ? next.delete(k) : next.set(k, v);
        return next;
    };
    const setMonth = (iso) => { setParams(query({ month: iso.slice(0, 7) })); setProblems(null); };
    const setDept = (id) => {
        setProblems(null);
        if (view === 'doctors') navigate({ pathname: '/roster/doctors', search: `?${query({ dept: id, doctors: null })}` });
        else setParams(query({ dept: id, doctors: null }));
    };
    const setSelectedDoctors = (ids) => setParams(query({ doctors: ids.length ? ids.join(',') : null }), { replace: true });
    const viewLink = (value) => ({ pathname: `/roster/${value}`, search: `?${query({ dept: deptId ?? null, month: from.slice(0, 7) })}` });

    const roster = useQuery({
        queryKey: rosterKey,
        queryFn: () => api(`/hospitals/${hospitalId}/departments/${deptId}/roster?from=${rangeFrom}&to=${rangeTo}`),
        enabled: !!deptId,
    });

    const refresh = () => {
        queryClient.invalidateQueries({ queryKey: ['roster', hospitalId] });
        queryClient.invalidateQueries({ queryKey: ['my-queue', hospitalId] });
    };

    const generate = useMutation({
        mutationFn: () => api(`/hospitals/${hospitalId}/departments/${deptId}/roster/generate`, { method: 'POST', body: { from, to } }),
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ['roster', hospitalId] });
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
        for (const s of (roster.data?.shifts ?? []).filter((x) => x.shift_date >= from && x.shift_date <= to)) perDoctor[s.staff_id] = (perDoctor[s.staff_id] ?? 0) + shiftHours(templates[s.shift_template_id]);
        return perDoctor;
    }, [roster.data, from, to]);

    const templates = roster.data?.templates ?? [];
    const days = [];
    for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
    const gapCount = (roster.data?.gaps ?? []).filter((g) => g.date >= from && g.date <= to).length;

    return (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4">
                    <h2 className="text-lg font-semibold">ตารางเวรแพทย์</h2>
                    <nav className="mr-auto flex rounded-md border border-slate-300 p-0.5 text-xs" aria-label="มุมมองตารางเวร">
                        {VIEWS.map(([value, label]) => (
                            <NavLink
                                key={value}
                                to={viewLink(value)}
                                className={({ isActive }) => `rounded px-2.5 py-1 ${isActive ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                            >
                                {label}
                            </NavLink>
                        ))}
                    </nav>
                    <select className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={deptId ?? ''} onChange={(e) => setDept(e.target.value)}>
                        {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                    <div className="flex items-center gap-1 text-sm">
                        <button className="rounded-md border border-slate-300 px-2 py-1.5" onClick={() => setMonth(shiftMonth(monthStart, -1))} aria-label="เดือนก่อน">‹</button>
                        <span className="w-36 text-center font-medium">{monthLabel(from)}</span>
                        <button className="rounded-md border border-slate-300 px-2 py-1.5" onClick={() => setMonth(shiftMonth(monthStart, 1))} aria-label="เดือนถัดไป">›</button>
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

                {view !== 'doctors' && doctors.length > 0 && (
                    <div className="mx-4 mt-4">
                        <DoctorFilter doctors={doctors} selected={selectedDoctors} onChange={setSelectedDoctors} highlight={user.staff_id} />
                        {selectedDoctors.length > 0 && (
                            <p className="mt-1 text-xs text-slate-500">แสดงเฉพาะ {selectedDoctors.length} คนที่เลือก · ช่องสีแดงยังคิดจากแพทย์ทุกคนในแผนก</p>
                        )}
                    </div>
                )}

                {roster.isSuccess && (
                    <p className={`mx-4 mt-4 text-sm ${gapCount ? 'text-red-600' : 'text-emerald-700'}`}>
                        {gapCount ? `ยังมี ${gapCount} ช่องที่คนไม่ครบหรือขาดความเชี่ยวชาญ (สีแดง)` : 'ทุกเวรในเดือนนี้มีแพทย์ครบตามกติกา'}
                    </p>
                )}

                {roster.isPending && <p className="p-4 text-sm text-slate-500">กำลังโหลด…</p>}
                {roster.isError && <p className="p-4 text-sm text-red-600">{roster.error.message}</p>}
                {roster.isSuccess && view !== 'table' && (
                    <RosterCalendar
                        hospitalId={hospitalId}
                        roster={view === 'calendar' ? { ...roster.data, shifts: roster.data.shifts.filter((x) => isShown(x.staff_id)) } : roster.data}
                        doctors={doctors}
                        monthStart={from}
                        monthEnd={to}
                        mode={view === 'doctors' ? 'doctor' : 'all'}
                        doctorId={view === 'doctors' ? (doctorFromUrl?.department_id === deptId ? doctorFromUrl.id : null) : null}
                        onSelectDoctor={(id) => navigate({ pathname: `/roster/doctors/${id}`, search: `?${query({})}` })}
                    />
                )}
                <div className={`max-h-[70vh] overflow-auto p-4 ${view === 'table' ? '' : 'hidden'}`}>
                    {roster.isSuccess && view === 'table' && (
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
                                                        {assigned.filter((s) => isShown(s.staff_id)).map((s) => (
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
                            <li key={d.id} className={`flex items-center justify-between gap-2 ${isShown(d.id) ? '' : 'opacity-40'}`}>
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
