import { useEffect, useMemo } from 'react';
import { Link, NavLink, useSearchParams } from 'react-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { addDays, api, isoDate, STATUS } from '../api';
import { useAuth } from '../auth';
import { byId, useDepartments } from '../useLookups';
import TicketBoard, { clock, waitMinutes } from './TicketBoard';
import StaffPanel from './StaffPanel';
import IssueTicketForm from './IssueTicketForm';
import { calendarRange } from './RosterCalendar';

const VIEWS = [['list', 'รายการ'], ['month', 'เดือน'], ['week', 'สัปดาห์'], ['day', 'วัน']];
const WEEKDAYS = ['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'];
const STATUS_DOT = { waiting: 'bg-sky-500', called: 'bg-violet-500', completed: 'bg-emerald-500' };

const today = () => isoDate(new Date());
const mondayOf = (iso) => addDays(iso, -((new Date(`${iso}T00:00:00`).getDay() + 6) % 7));
const firstOfMonth = (iso) => `${iso.slice(0, 7)}-01`;
const lastOfMonth = (iso) => { const d = new Date(`${iso}T00:00:00`); return isoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0)); };
const shiftMonth = (iso, n) => { const d = new Date(`${iso}T00:00:00`); return isoDate(new Date(d.getFullYear(), d.getMonth() + n, 1)); };
const thaiDate = (iso, opts) => new Date(`${iso}T00:00:00`).toLocaleDateString('th-TH', opts);
const minutes = (seconds) => (seconds == null ? '—' : Math.round(seconds / 60));
// พื้นหลังตามความหนาแน่น (0–1) — ยิ่งคิวเยอะยิ่งเข้ม
const heat = (value, max) => (value ? `rgba(79, 70, 229, ${0.08 + 0.5 * (value / Math.max(max, 1))})` : undefined);

// /queue/:view?date=YYYY-MM-DD&dept=1 — view: list | month | week | day
export default function QueuePage({ hospitalId, view }) {
    const { can } = useAuth();
    const [params, setParams] = useSearchParams();
    const departments = useDepartments(hospitalId).data ?? [];
    const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? params.get('date') : today();
    const dept = params.get('dept') ?? '';

    const withParams = (changes) => {
        const next = new URLSearchParams(params);
        for (const [k, v] of Object.entries(changes)) (v === null || v === '' ? next.delete(k) : next.set(k, v));
        return `?${next}`;
    };
    const step = { list: (n) => addDays(date, n), day: (n) => addDays(date, n), week: (n) => addDays(date, 7 * n), month: (n) => shiftMonth(date, n) }[view];
    const label = {
        list: thaiDate(date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
        day: thaiDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
        week: `${thaiDate(mondayOf(date), { day: 'numeric', month: 'short' })} – ${thaiDate(addDays(mondayOf(date), 6), { day: 'numeric', month: 'short', year: 'numeric' })}`,
        month: thaiDate(date, { month: 'long', year: 'numeric' }),
    }[view];

    const toolbar = (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <nav className="flex rounded-md border border-slate-300 p-0.5 text-xs" aria-label="มุมมองคิว">
                {VIEWS.map(([value, text]) => (
                    <NavLink key={value} to={{ pathname: `/queue/${value}`, search: withParams({}) }}
                        className={({ isActive }) => `rounded px-3 py-1 ${isActive ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                        {text}
                    </NavLink>
                ))}
            </nav>
            <select className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={dept} onChange={(e) => setParams(withParams({ dept: e.target.value }))} aria-label="แผนก">
                <option value="">ทุกแผนก</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <div className="ml-auto flex items-center gap-1 text-sm">
                <button className="rounded-md border border-slate-300 px-2 py-1.5" onClick={() => setParams(withParams({ date: step(-1) }))} aria-label="ก่อนหน้า">‹</button>
                <span className="min-w-44 text-center font-medium">{label}</span>
                <button className="rounded-md border border-slate-300 px-2 py-1.5" onClick={() => setParams(withParams({ date: step(1) }))} aria-label="ถัดไป">›</button>
                <button className="ml-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs" onClick={() => setParams(withParams({ date: null }))}>วันนี้</button>
                {view === 'list' && (
                    <input type="date" className="ml-1 rounded-md border border-slate-300 px-2 py-1 text-xs" value={date} onChange={(e) => e.target.value && setParams(withParams({ date: e.target.value }))} aria-label="เลือกวันที่" />
                )}
            </div>
        </div>
    );

    const dayLink = (iso) => ({ pathname: '/queue/day', search: withParams({ date: iso }) });

    return (
        <>
            {toolbar}
            {view === 'list' && (
                <div className={`grid gap-6 ${date === today() ? 'lg:grid-cols-[1fr_340px]' : ''}`}>
                    <TicketBoard hospitalId={hospitalId} date={date} />
                    {date === today() && (
                        <div className="space-y-6">
                            <StaffPanel hospitalId={hospitalId} />
                            {can('ticket.issue') && <IssueTicketForm hospitalId={hospitalId} />}
                        </div>
                    )}
                </div>
            )}
            {view === 'month' && <MonthView hospitalId={hospitalId} date={date} dept={dept} dayLink={dayLink} />}
            {view === 'week' && <WeekView hospitalId={hospitalId} date={date} dept={dept} dayLink={dayLink} />}
            {view === 'day' && <DayView hospitalId={hospitalId} date={date} dept={dept} />}
        </>
    );
}

function useSummary(hospitalId, from, to, group, dept) {
    return useQuery({
        queryKey: ['queue-summary', hospitalId, group, from, to, dept],
        queryFn: () => api(`/hospitals/${hospitalId}/tickets/summary?${new URLSearchParams({ from, to, group, ...(dept ? { department_id: dept } : {}) })}`),
        refetchInterval: to >= today() && from <= today() ? 30_000 : false,
    });
}

function MonthView({ hospitalId, date, dept, dayLink }) {
    const monthStart = firstOfMonth(date);
    const monthEnd = lastOfMonth(date);
    const [gridStart, gridEnd] = calendarRange(monthStart, monthEnd);
    const summary = useSummary(hospitalId, gridStart, gridEnd, 'day', dept);
    const byDate = Object.fromEntries((summary.data?.data ?? []).map((d) => [d.date, d]));
    const inMonth = Object.values(byDate).filter((d) => d.date >= monthStart && d.date <= monthEnd);
    const max = Math.max(0, ...inMonth.map((d) => d.total));
    const totals = inMonth.reduce((a, d) => ({ total: a.total + d.total, completed: a.completed + d.completed }), { total: 0, completed: 0 });

    const weeks = [];
    for (let d = gridStart; d <= gridEnd; d = addDays(d, 7)) weeks.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));

    return (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap gap-2 text-sm">
                <Stat label="คิวทั้งเดือน" value={totals.total.toLocaleString()} />
                <Stat label="ตรวจเสร็จ" value={totals.completed.toLocaleString()} />
                <Stat label="วันที่คิวมากสุด" value={max.toLocaleString()} />
                <span className="self-center text-xs text-slate-500">วันที่ผ่านมาอ่านจากตารางสรุปรายวัน · วันนี้นับสด · กดวันเพื่อดูรายชั่วโมง</span>
            </div>
            {summary.isPending && <p className="text-sm text-slate-500">กำลังโหลด…</p>}
            <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] table-fixed border-collapse text-xs">
                    <thead><tr>{WEEKDAYS.map((d, i) => <th key={d} className={`p-1.5 font-medium ${i >= 5 ? 'text-rose-600' : 'text-slate-500'}`}>{d}</th>)}</tr></thead>
                    <tbody>
                        {weeks.map((week) => (
                            <tr key={week[0]}>
                                {week.map((iso) => {
                                    const d = byDate[iso];
                                    const outside = iso < monthStart || iso > monthEnd;
                                    return (
                                        <td key={iso} className={`h-24 border border-slate-200 p-0 align-top ${outside ? 'bg-slate-50 text-slate-400' : ''}`} style={outside ? undefined : { background: heat(d?.total, max) }}>
                                            <Link to={dayLink(iso)} className="block h-full p-1.5 hover:ring-2 hover:ring-inset hover:ring-indigo-400">
                                                <div className={`flex justify-between ${iso === today() ? 'font-bold text-indigo-700' : ''}`}>
                                                    <span>{Number(iso.slice(8))}</span>
                                                    {d?.source === 'live' && <span className="rounded bg-rose-600 px-1 text-[10px] text-white">สด</span>}
                                                </div>
                                                {d && d.total > 0 ? (
                                                    <div className="mt-1 space-y-0.5">
                                                        <div className="text-base font-semibold text-slate-800">{d.total.toLocaleString()} <span className="text-xs font-normal">คิว</span></div>
                                                        <div className="text-slate-600">เสร็จ {d.completed.toLocaleString()}{d.waiting ? ` · รอ ${d.waiting}` : ''}</div>
                                                        <div className="text-slate-500">รอเฉลี่ย {minutes(d.avg_wait_seconds)} นาที</div>
                                                    </div>
                                                ) : !outside && <div className="mt-2 text-slate-300">—</div>}
                                            </Link>
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

function WeekView({ hospitalId, date, dept, dayLink }) {
    const start = mondayOf(date);
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    const summary = useSummary(hospitalId, start, days[6], 'hour', dept);
    const rows = summary.data?.data ?? [];
    const cell = Object.fromEntries(rows.map((r) => [`${r.date}|${r.hour}`, r]));
    const max = Math.max(0, ...rows.map((r) => r.total));
    const hours = rows.length ? range(Math.min(7, ...rows.map((r) => r.hour)), Math.max(17, ...rows.map((r) => r.hour))) : range(7, 17);
    const dayTotal = (iso) => rows.filter((r) => r.date === iso).reduce((sum, r) => sum + r.total, 0);

    return (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="mb-3 text-xs text-slate-500">จำนวนคิวตามชั่วโมงที่ออกบัตร · สีเข้ม = คนเยอะ · กดช่องเพื่อดูรายวัน</p>
            {summary.isPending && <p className="text-sm text-slate-500">กำลังโหลด…</p>}
            <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] table-fixed border-collapse text-xs">
                    <thead>
                        <tr>
                            <th className="w-16 p-1.5 text-left font-medium text-slate-500">เวลา</th>
                            {days.map((iso, i) => (
                                <th key={iso} className={`p-1.5 font-medium ${iso === today() ? 'text-indigo-700' : i >= 5 ? 'text-rose-600' : 'text-slate-500'}`}>
                                    <Link to={dayLink(iso)} className="hover:underline">{WEEKDAYS[i]} {thaiDate(iso, { day: 'numeric', month: 'short' })}</Link>
                                    <div className="font-normal text-slate-400">{dayTotal(iso).toLocaleString()} คิว</div>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {hours.map((h) => (
                            <tr key={h}>
                                <td className="border border-slate-200 p-1.5 font-mono text-slate-500">{String(h).padStart(2, '0')}:00</td>
                                {days.map((iso) => {
                                    const r = cell[`${iso}|${h}`];
                                    return (
                                        <td key={iso} className="h-10 border border-slate-200 p-0 text-center" style={{ background: heat(r?.total, max) }}>
                                            <Link to={dayLink(iso)} className="block h-full py-1.5" title={r ? `รอ ${r.waiting} · เรียกแล้ว ${r.called} · เสร็จ ${r.completed} · รอเฉลี่ย ${minutes(r.avg_wait_seconds)} นาที` : undefined}>
                                                {r ? <span className="font-semibold text-slate-800">{r.total}</span> : <span className="text-slate-300">·</span>}
                                            </Link>
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

function DayView({ hospitalId, date, dept }) {
    const departments = byId(useDepartments(hospitalId).data);
    // โหลดคิวทั้งวันทีละหน้า (cursor) จนครบ — วันหนึ่งต่อโรงพยาบาลมีหลักร้อย ไม่ใช่หลักแสน
    const tickets = useInfiniteQuery({
        queryKey: ['tickets', hospitalId, date, 'all', dept],
        queryFn: ({ pageParam, signal }) => api(`/hospitals/${hospitalId}/tickets?${new URLSearchParams({ date, ...(dept ? { department_id: dept } : {}), ...(pageParam ? { cursor: pageParam } : {}) })}`, { signal }),
        initialPageParam: null,
        getNextPageParam: (last) => last.next_cursor ?? undefined,
        refetchInterval: date === today() ? 30_000 : false,
    });
    useEffect(() => {
        if (tickets.hasNextPage && !tickets.isFetchingNextPage) tickets.fetchNextPage();
    }, [tickets.hasNextPage, tickets.isFetchingNextPage, tickets.fetchNextPage]);

    const rows = useMemo(() => tickets.data?.pages.flatMap((p) => p.data) ?? [], [tickets.data]);
    const byHour = useMemo(() => {
        const map = {};
        for (const t of rows) (map[new Date(t.created_at).getHours()] ??= []).push(t);
        for (const list of Object.values(map)) list.sort((a, b) => a.created_at.localeCompare(b.created_at));
        return map;
    }, [rows]);
    const hours = Object.keys(byHour).map(Number).sort((a, b) => a - b);
    const max = Math.max(0, ...Object.values(byHour).map((list) => list.length));
    const done = rows.filter((t) => t.status === 'completed');
    const waits = rows.map(waitMinutes).filter((m) => m !== null);

    return (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                <Stat label="คิวทั้งวัน" value={rows.length.toLocaleString()} />
                <Stat label="ตรวจเสร็จ" value={done.length.toLocaleString()} />
                <Stat label="รอเฉลี่ย" value={waits.length ? `${Math.round(waits.reduce((a, b) => a + b, 0) / waits.length)} นาที` : '—'} />
                <span className="flex gap-3 text-xs text-slate-500">
                    {Object.entries(STATUS).map(([key, s]) => <span key={key} className="flex items-center gap-1"><span className={`inline-block h-2.5 w-2.5 rounded-full ${STATUS_DOT[key]}`} />{s.label}</span>)}
                </span>
                {tickets.hasNextPage && <span className="text-xs text-slate-500">กำลังโหลด… {rows.length} คิว</span>}
            </div>
            {tickets.isSuccess && rows.length === 0 && <p className="p-6 text-center text-sm text-slate-500">ไม่มีคิวในวันนี้</p>}
            <ol className="divide-y divide-slate-100">
                {hours.map((h) => (
                    <li key={h} className="grid grid-cols-[64px_120px_1fr] items-start gap-3 py-2">
                        <span className="font-mono text-sm text-slate-600">{String(h).padStart(2, '0')}:00</span>
                        <div>
                            <div className="h-2 rounded bg-indigo-500" style={{ width: `${(byHour[h].length / Math.max(max, 1)) * 100}%` }} />
                            <div className="mt-1 text-xs text-slate-500">{byHour[h].length} คิว</div>
                        </div>
                        <div className="flex flex-wrap gap-1">
                            {byHour[h].map((t) => (
                                <span key={t.id} title={`ออกบัตร ${clock(t.created_at)} · เรียก ${clock(t.called_at)}${waitMinutes(t) !== null ? ` · รอ ${waitMinutes(t)} นาที` : ''}`}
                                    className="inline-flex items-center gap-1 rounded border border-slate-200 px-1.5 py-0.5 font-mono text-xs">
                                    <span className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT[t.status]}`} />
                                    {departments[t.department_id]?.code}-{String(t.number).padStart(3, '0')}
                                    <span className="text-slate-400">{clock(t.created_at)}</span>
                                </span>
                            ))}
                        </div>
                    </li>
                ))}
            </ol>
        </section>
    );
}

function range(from, to) {
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

function Stat({ label, value }) {
    return <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-slate-700">{label} <strong className="font-mono">{value}</strong></span>;
}
