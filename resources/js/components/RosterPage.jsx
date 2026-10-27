import { useMemo, useRef, useState } from 'react';
import { Link, NavLink, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import RosterCalendar, { calendarRange } from './RosterCalendar';
import DoctorFilter from './DoctorFilter';
import { Badge } from './LeavePage';
import { RequestForm } from './ShiftRequestsPage';
import { addDays, api, errorMessages, isoDate } from '../api';
import { useDepartments, useStaff } from '../useLookups';
import { useAuth } from '../auth';
import Select from './Select';

const DAY_NAMES = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];

const firstOfMonth = (date = new Date()) => isoDate(new Date(date.getFullYear(), date.getMonth(), 1));
const shiftMonth = (iso, months) => {
    const d = new Date(`${iso}T00:00:00`);
    return isoDate(new Date(d.getFullYear(), d.getMonth() + months, 1));
};
const lastOfMonth = (iso) => addDays(shiftMonth(iso, 1), -1);
const monthLabel = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
const weekday = (iso) => new Date(`${iso}T00:00:00`).getDay();

const VIEWS = [['table', 'ตาราง'], ['calendar', 'ปฏิทิน']];

// view มาจาก URL: /roster/table · /roster/calendar — ตัวกรองอยู่ใน query (?dept=&month=YYYY-MM&doctors=1,4)
// ปฏิทินเลือกแพทย์คนเดียว = ดูรายละเอียดรายแพทย์ (วันลา ชั่วโมงต่อสัปดาห์) · หลายคน/ทุกคน = ปฏิทินรวม
export default function RosterPage({ hospitalId, view }) {
    const queryClient = useQueryClient();
    const [params, setParams] = useSearchParams();
    const { user, can } = useAuth();
    const canManage = can('roster.manage');
    const departments = useDepartments(hospitalId).data ?? [];
    const allStaff = useStaff(hospitalId).data ?? [];
    const [problems, setProblems] = useState(null);
    // กล่อง "ร้องขอ" ข้างตาราง: แท็บที่เปิด + เวรที่แพทย์เลือกจะย้าย/แลก (คลิกชิปชื่อตัวเองในตารางก็ได้)
    const [requestTab, setRequestTab] = useState('leave');
    const [moveShiftId, setMoveShiftId] = useState('');
    const canMove = can('shift.request.own') && !!user.staff_id;
    const requestRef = useRef(null);
    // ชิปของตัวเองที่ยังไม่เริ่ม → คลิกเพื่อขอย้าย/แลก (จอแคบกล่องอยู่ใต้ตาราง จึงเลื่อนไปให้เห็น)
    const movable = (s) => canMove && s.staff_id === user.staff_id && new Date(`${s.shift_date}T${templateById[s.shift_template_id]?.start_time}`) > new Date();
    const pickToMove = (s) => {
        setRequestTab('shifts');
        setMoveShiftId(String(s.id));
        requestAnimationFrame(() => requestRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
    };

    // ลิงก์ที่มีแค่ ?doctors= (เช่น จากหน้าการลา) — ใช้แผนกของแพทย์คนแรก
    const doctorFromUrl = allStaff.find((s) => s.id === Number((params.get('doctors') ?? '').split(',')[0]));
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
        setParams(query({ dept: id, doctors: null }));
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
            const p = data.preference_stats;
            setProblems([
                data.gaps.length ? `สร้างเพิ่ม ${data.created} เวร · ยังเหลือ ${data.gaps.length} ช่องที่จัดไม่ได้โดยไม่ผิดกติกา` : `สร้างเพิ่ม ${data.created} เวร · ครบทุกช่อง`,
                ...(data.contested?.length ? [`เว้น ${data.contested.length} ช่องที่มีคนอยากลงเกินจำนวนที่ต้องการ ให้หัวหน้าเลือก (กล่องสีส้ม "ต้องเลือก")`] : []),
                ...(p && p.prefer_total + p.avoid_total > 0
                    ? [`ตรงกับเวรที่แพทย์อยากลง ${p.prefer_met}/${p.prefer_total} ช่อง · ต้องลงช่องที่แพทย์ไม่สะดวก ${p.avoid_used}/${p.avoid_total} ช่อง`]
                    : []),
            ]);
            queryClient.invalidateQueries({ queryKey: ['my-queue', hospitalId] });
        },
        onError: (error) => setProblems(errorMessages(error)),
    });

    const assign = useMutation({
        mutationFn: (body) => api(`/hospitals/${hospitalId}/shifts`, { method: 'POST', body }),
        // พักไม่พอ / ชั่วโมงเกิน = ลงได้ แต่บอกแอดมินว่าต้องปรับ (ชิปของแพทย์คนนั้นจะเป็นสีแดง)
        onSuccess: (shift) => { setProblems(shift.warnings?.length ? ['ลงเวรแล้ว แต่ผิดกติกา ต้องปรับ (ชิปสีแดง):', ...shift.warnings] : null); refresh(); },
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
    // เวรที่แพทย์อยากลง/ไม่สะดวก — แอดมินเห็นก่อนจัดร่างหรือลงเวรเอง
    const wishes = useMemo(() => {
        const map = {};
        for (const p of roster.data?.preferences ?? []) (map[`${p.date}|${p.shift_template_id}`] ??= []).push(p);
        return map;
    }, [roster.data]);
    const staffName = Object.fromEntries(doctors.map((d) => [d.id, d.name]));
    // ช่องที่มีคนอยากลงเกินจำนวนที่ต้องการ — ระบบไม่เลือกให้ หัวหน้าตัดสินเอง
    const contested = useMemo(() => Object.fromEntries((roster.data?.contested ?? []).map((c) => [`${c.date}|${c.shift_template_id}`, c])), [roster.data]);
    const contestedCount = (roster.data?.contested ?? []).filter((c) => c.date >= from && c.date <= to).length;
    // แพทย์ที่มีเวรผิดกติกาแบบเตือนในเดือนนี้ — แผงชั่วโมงแสดงเป็นสีแดง
    const warned = new Set((roster.data?.shifts ?? []).filter((s) => s.warnings?.length && s.shift_date >= from && s.shift_date <= to).map((s) => s.staff_id));
    const hours = useMemo(() => {
        const perDoctor = {};
        const templates = Object.fromEntries((roster.data?.templates ?? []).map((t) => [t.id, t]));
        for (const s of (roster.data?.shifts ?? []).filter((x) => x.shift_date >= from && x.shift_date <= to)) perDoctor[s.staff_id] = (perDoctor[s.staff_id] ?? 0) + shiftHours(templates[s.shift_template_id]);
        return perDoctor;
    }, [roster.data, from, to]);

    const templates = roster.data?.templates ?? [];
    const templateById = Object.fromEntries(templates.map((t) => [t.id, t]));
    const days = [];
    for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
    const gapCount = (roster.data?.gaps ?? []).filter((g) => g.date >= from && g.date <= to).length;
    // สรุปความต้องการทั้งเดือน (เฉพาะแพทย์ที่แสดงอยู่) — นับคนที่อยากลงแต่ยังไม่ได้ และไม่สะดวกแต่ถูกลง
    const wishSummary = { prefer: 0, met: 0, missed: 0, forced: 0 };
    for (const p of roster.data?.preferences ?? []) {
        if (p.date < from || p.date > to || !isShown(p.staff_id)) continue;
        const on = (cells[`${p.date}|${p.shift_template_id}`] ?? []).some((x) => x.staff_id === p.staff_id);
        if (p.kind === 'prefer') { wishSummary.prefer++; wishSummary[on ? 'met' : 'missed']++; } else if (on) wishSummary.forced++;
    }

    return (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
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
                    <Select className="w-40 rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={deptId ?? ''} onChange={setDept} ariaLabel="แผนก" options={departments.map((d) => ({ value: d.id, label: d.name }))} />
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

                {doctors.length > 0 && (
                    <div className="mx-4 mt-4">
                        <DoctorFilter doctors={doctors} selected={selectedDoctors} onChange={setSelectedDoctors} highlight={user.staff_id} />
                        {selectedDoctors.length > 0 && (
                            <p className="mt-1 text-xs text-slate-500">แสดงเฉพาะ {selectedDoctors.length} คนที่เลือก · ช่องสีแดงยังคิดจากแพทย์ทุกคนในแผนก</p>
                        )}
                        {view === 'calendar' && selectedDoctors.length !== 1 && (
                            <p className="mt-1 text-xs text-slate-500">เลือกแพทย์คนเดียวเพื่อดูวันลาและชั่วโมงต่อสัปดาห์ของคนนั้น</p>
                        )}
                    </div>
                )}

                {roster.isSuccess && (
                    <p className={`mx-4 mt-4 text-sm ${gapCount ? 'text-red-600' : 'text-emerald-700'}`}>
                        {gapCount ? `ยังมี ${gapCount} ช่องที่คนไม่ครบหรือขาดความเชี่ยวชาญ (สีแดง)` : 'ทุกเวรในเดือนนี้มีแพทย์ครบตามกติกา'}
                    </p>
                )}
                {roster.isSuccess && view === 'table' && canManage && wishSummary.prefer + wishSummary.forced > 0 && (
                    <div className="mx-4 mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="text-slate-600">ความต้องการของแพทย์:</span>
                        {contestedCount > 0 && <span className="rounded-md border-2 border-orange-400 bg-orange-50 px-2 py-0.5 font-medium text-orange-900">ต้องเลือก {contestedCount} ช่อง</span>}
                        <span className={`rounded-full px-2 py-0.5 ring-1 ${WISH_STYLE.missed}`}>★ อยากลงแต่ยังไม่ได้ {wishSummary.missed}</span>
                        {wishSummary.forced > 0 && <span className={`rounded-full px-2 py-0.5 ring-1 ${WISH_STYLE.forced}`}>✕ ไม่สะดวกแต่ถูกลง {wishSummary.forced}</span>}
                        <span className={`rounded-full px-2 py-0.5 ring-1 ${WISH_STYLE.met}`}>✓ ได้ตามที่อยากลง {wishSummary.met}/{wishSummary.prefer}</span>
                        <span className={`rounded-full px-2 py-0.5 ring-1 ${WISH_STYLE.avoided}`}>✕ ไม่สะดวก</span>
                    </div>
                )}

                {roster.isPending && <p className="p-4 text-sm text-slate-500">กำลังโหลด…</p>}
                {roster.isError && <p className="p-4 text-sm text-red-600">{roster.error.message}</p>}
                {roster.isSuccess && view !== 'table' && (
                    <RosterCalendar
                        hospitalId={hospitalId}
                        roster={selectedDoctors.length === 1 ? roster.data : { ...roster.data, shifts: roster.data.shifts.filter((x) => isShown(x.staff_id)) }}
                        doctors={doctors}
                        monthStart={from}
                        monthEnd={to}
                        mode={selectedDoctors.length === 1 ? 'doctor' : 'all'}
                        doctorId={selectedDoctors.length === 1 ? selectedDoctors[0] : null}
                    />
                )}
                <div className={`max-h-[70vh] overflow-auto px-4 pb-4 ${view === 'table' ? '' : 'hidden'}`}>
                    {roster.isSuccess && view === 'table' && (
                        <table className="w-full min-w-[640px] table-fixed border-collapse text-sm">
                            <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_#e2e8f0]">
                                <tr>
                                    <th className="w-24 bg-white p-2 pt-4 text-left text-xs font-medium text-slate-500">วัน</th>
                                    {templates.map((t) => (
                                        <th key={t.id} className="bg-white p-2 pt-4 text-left text-xs font-medium text-slate-500">
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
                                                            <span
                                                                key={s.id}
                                                                onClick={movable(s) ? () => pickToMove(s) : undefined}
                                                                title={s.warnings?.length ? s.warnings.join('\n') : movable(s) ? 'คลิกเพื่อขอย้าย/แลกเวรนี้' : undefined}
                                                                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${movable(s) ? 'cursor-pointer hover:ring-2' : ''} ${s.warnings?.length ? 'bg-red-600 text-white ring-1 ring-red-700' : s.staff_id === user.staff_id ? 'bg-emerald-100 text-emerald-900 ring-1 ring-emerald-400' : 'bg-indigo-50 text-indigo-800'}`}
                                                            >
                                                                {s.warnings?.length > 0 && <span aria-label="ผิดกติกา">⚠</span>}
                                                                {s.staff_name}
                                                                {canManage && <button className={s.warnings?.length ? 'text-red-100 hover:text-white' : 'text-indigo-400 hover:text-red-600'} onClick={() => remove.mutate(s.id)} aria-label={`เอา ${s.staff_name} ออกจากเวร`}>✕</button>}
                                                            </span>
                                                        ))}
                                                    </div>
                                                    {canManage && <Select
                                                        className="mt-1 block w-full rounded border border-dashed border-slate-300 px-1 py-0.5 text-xs text-slate-500"
                                                        value=""
                                                        placeholder="+ ลงเวร"
                                                        ariaLabel={`ลงเวร ${t.name} ${date}`}
                                                        onChange={(v) => assign.mutate({ staff_id: Number(v), shift_template_id: t.id, date })}
                                                        options={doctors.filter((d) => !assigned.some((s) => s.staff_id === d.id)).map((d) => ({ value: d.id, label: d.name }))}
                                                    />}
                                                    {canManage && contested[key] && (
                                                        <div className="mt-1 rounded-md border-2 border-orange-400 bg-orange-50 p-1.5 text-[11px] text-orange-900">
                                                            <p className="mb-1 font-medium">ต้องเลือก: อยากลง {contested[key].staff_ids.length} คน · ต้องการอีก {contested[key].seats} คน</p>
                                                            <div className="flex flex-wrap gap-1">
                                                                {contested[key].staff_ids.map((id) => (
                                                                    <button
                                                                        key={id}
                                                                        className="rounded-full bg-white px-2 py-0.5 ring-1 ring-orange-400 hover:bg-orange-500 hover:text-white disabled:opacity-40"
                                                                        disabled={assign.isPending}
                                                                        onClick={() => assign.mutate({ staff_id: id, shift_template_id: t.id, date })}
                                                                        title={`ลง ${staffName[id]} ในเวรนี้`}
                                                                    >
                                                                        + {staffName[id]}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                    {canManage && !contested[key] && <Wishes list={(wishes[key] ?? []).filter((w) => isShown(w.staff_id))} staffName={staffName} assigned={assigned} />}
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
                            <li key={d.id} className={`flex items-center justify-between gap-2 ${isShown(d.id) ? '' : 'opacity-40'} ${warned.has(d.id) ? 'font-medium text-red-700' : ''}`}>
                                <span>
                                    {warned.has(d.id) && <span title="มีเวรผิดกติกา ต้องปรับ">⚠ </span>}
                                    {d.name}
                                    <span className="ml-1 text-xs text-slate-400">{d.skills.map((s) => s.code).join(', ')}</span>
                                </span>
                                <span className="font-mono">{hours[d.id] ?? 0} ชม.</span>
                            </li>
                        ))}
                    </ul>
                </section>
                {(can('leave.manage.any') || can('leave.manage.own')) && (
                    <section ref={requestRef} className="scroll-mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="mb-3 flex items-center justify-between gap-2">
                            <h2 className="text-lg font-semibold">{canMove ? 'ร้องขอ' : 'บันทึกวันลา'}</h2>
                            <Link className="text-xs text-slate-500 underline" to={`/requests/${requestTab}`}>ดูคำขอทั้งหมด</Link>
                        </div>
                        {canMove && (
                            <div className="mb-3 flex rounded-md border border-slate-300 p-0.5 text-xs" role="tablist">
                                {[['leave', 'ขอลา'], ['shifts', 'ขอย้าย/แลกเวร']].map(([value, label]) => (
                                    <button key={value} role="tab" aria-selected={requestTab === value} onClick={() => setRequestTab(value)} className={`flex-1 rounded px-2 py-1 ${requestTab === value ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{label}</button>
                                ))}
                            </div>
                        )}
                        {requestTab === 'shifts' && canMove && roster.isSuccess ? (
                            <MovePanel hospitalId={hospitalId} roster={roster.data} staffId={user.staff_id} shiftId={moveShiftId} onSelect={setMoveShiftId} />
                        ) : (
                            <UnavailabilityPanel
                                hospitalId={hospitalId}
                                doctors={can('leave.manage.any') ? doctors : doctors.filter((d) => d.id === user.staff_id)}
                                direct={can('leave.manage.any')}
                                onChange={refresh}
                            />
                        )}
                    </section>
                )}
            </div>
        </div>
    );
}

function UnavailabilityPanel({ hospitalId, doctors, direct, onChange }) {
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
            queryClient.invalidateQueries({ queryKey: ['unavailabilities', hospitalId] });
            queryClient.invalidateQueries({ queryKey: ['leave-requests', hospitalId] });
            onChange();
        },
    });

    const input = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm';

    return (
        <div>
            <p className="mb-3 text-xs text-slate-500">{direct ? 'แอดมินบันทึกให้ = อนุมัติทันที' : 'ส่งคำขอลาแล้วรอแอดมินอนุมัติ'}</p>
            <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
                <Select className={`block ${input}`} value={doctorId ?? ''} onChange={(v) => setStaffId(Number(v))} ariaLabel="แพทย์" options={doctors.map((d) => ({ value: d.id, label: d.name }))} />
                <input className={input} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
                <input className={input} placeholder="เหตุผล (ไม่บังคับ)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={100} />
                <button className="w-full rounded-md bg-slate-800 py-2 text-sm font-medium text-white disabled:opacity-40" disabled={add.isPending}>{direct ? 'บันทึกวันลา' : 'ส่งคำขอลา'}</button>
            </form>
            {add.isError && <p className="mt-2 text-sm text-red-600">{errorMessages(add.error).join(' ')}</p>}
            <ul className="mt-3 space-y-1 text-sm">
                {list.data?.map((u) => (
                    <li key={u.id} className="flex items-center justify-between gap-2"><span>{formatDay(u.date.slice(0, 10))} <span className="text-slate-500">{u.reason}</span></span><Badge status={u.status} /></li>
                ))}
                {list.data?.length === 0 && <li className="text-slate-400">ยังไม่มีวันลา</li>}
            </ul>
        </div>
    );
}

// แท็บขอย้าย/แลกเวร: เลือกเวรของตัวเองที่ยังไม่เริ่มในช่วงที่เปิดดู แล้วใช้ฟอร์มเดียวกับหน้า "ร้องขอ"
function MovePanel({ hospitalId, roster, staffId, shiftId, onSelect }) {
    const templates = Object.fromEntries(roster.templates.map((t) => [t.id, t]));
    const mine = roster.shifts.filter((s) => s.staff_id === staffId && new Date(`${s.shift_date}T${templates[s.shift_template_id].start_time}`) > new Date());
    const shift = mine.find((s) => String(s.id) === shiftId);

    return (
        <div>
            <p className="mb-3 text-xs text-slate-500">เลือกเวรของคุณ หรือคลิกชิปชื่อตัวเองในตาราง · แลกกับเพื่อน: เพื่อนตอบรับแล้วสลับทันที</p>
            <Select
                className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={shift ? shiftId : ''}
                onChange={onSelect}
                placeholder={mine.length ? 'เลือกเวรของฉัน…' : 'ไม่มีเวรที่ยังไม่เริ่มในเดือนนี้'}
                ariaLabel="เวรของฉันที่จะย้าย/แลก"
                options={mine.map((s) => {
                    const t = templates[s.shift_template_id];
                    return { value: s.id, label: `${formatDay(s.shift_date)} ${t.name} ${t.start_time.slice(0, 5)}–${t.end_time.slice(0, 5)}` };
                })}
            />
            {shift && <RequestForm key={shift.id} hospitalId={hospitalId} shift={shift} roster={roster} staffId={staffId} onDone={() => onSelect('')} />}
        </div>
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

// ความต้องการของแพทย์ในช่องนี้ แยกตามผล — คนที่อยากลงแต่ไม่ได้เด่นสุด (สีส้ม) ให้แอดมินเห็นก่อน
const WISH_STYLE = {
    missed: 'bg-orange-500 text-white ring-orange-600',
    met: 'bg-white text-emerald-800 ring-emerald-400',
    forced: 'bg-red-50 text-red-800 ring-red-300',
    avoided: 'bg-white text-slate-400 ring-slate-200',
};
const WISH_LABEL = { missed: '★ อยากลง ยังไม่ได้', met: '★ ได้ตามที่อยากลง', forced: '✕ ไม่สะดวก แต่ถูกลง', avoided: '✕ ไม่สะดวก' };

function Wishes({ list, staffName, assigned }) {
    if (!list.length) return null;
    const outcome = (w) => {
        const on = assigned.some((s) => s.staff_id === w.staff_id);
        if (w.kind === 'prefer') return on ? 'met' : 'missed';
        return on ? 'forced' : 'avoided';
    };
    const groups = ['missed', 'forced', 'met', 'avoided']
        .map((key) => [key, list.filter((w) => outcome(w) === key)])
        .filter(([, items]) => items.length);
    return (
        <div className="mt-1 space-y-0.5 text-[11px] leading-tight">
            {groups.map(([key, items]) => (
                <div key={key} className="flex flex-wrap items-center gap-1" title={WISH_LABEL[key]}>
                    {items.map((w) => (
                        <span key={w.staff_id} className={`rounded-full px-1.5 py-0.5 ring-1 ${WISH_STYLE[key]}`}>
                            {key === 'met' ? '✓' : key === 'missed' ? '★' : '✕'} {staffName[w.staff_id]}
                        </span>
                    ))}
                </div>
            ))}
        </div>
    );
}
