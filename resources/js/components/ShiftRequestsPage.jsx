import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, api, errorMessages, isoDate } from '../api';
import { useAuth } from '../auth';
import { useStaff } from '../useLookups';

export const REQUEST_STATUS = {
    pending_peer: { label: 'รอเพื่อนตอบ', className: 'bg-sky-100 text-sky-900 border-sky-300' },
    needs_admin: { label: 'รอแอดมินเคลียร์', className: 'bg-amber-100 text-amber-900 border-amber-300' },
    approved: { label: 'เปลี่ยนแล้ว', className: 'bg-emerald-100 text-emerald-900 border-emerald-300' },
    declined: { label: 'เพื่อนปฏิเสธ', className: 'bg-slate-100 text-slate-700 border-slate-300' },
    rejected: { label: 'แอดมินไม่อนุมัติ', className: 'bg-rose-100 text-rose-900 border-rose-300' },
};

const DAY_NAMES = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const day = (iso) => {
    const d = new Date(`${iso}T00:00:00`);
    return `${DAY_NAMES[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
};
const slotLabel = (slot) => `${day(slot.date)} ${slot.name} ${slot.start_time}–${slot.end_time}`;

export function useShiftRequests(hospitalId, enabled = true) {
    return useQuery({
        queryKey: ['shift-requests', hospitalId],
        queryFn: () => api(`/hospitals/${hospitalId}/shift-requests`),
        enabled,
        refetchInterval: 30_000,
    });
}

// ตัวเลขบนเมนู: แพทย์ = คำขอแลกที่รอตัวเองตอบ · แอดมิน = คำขอที่รอเคลียร์
export function useShiftRequestCount(hospitalId, enabled) {
    const { data } = useShiftRequests(hospitalId, enabled);
    return (data?.incoming.length ?? 0) + (data?.needs_admin.length ?? 0);
}

// ขอย้าย/แลกเวร: แพทย์ขอ → (แลก) เพื่อนตอบรับ → เปลี่ยนทันที · ติดกติกา/ช่องขาดคน → แอดมินเคลียร์
export default function ShiftRequestsPage({ hospitalId }) {
    const { can, user } = useAuth();
    const own = can('shift.request.own') && user.staff_id;
    const requests = useShiftRequests(hospitalId);

    return (
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
            <div className="space-y-6">
                {can('shift.request.resolve') && <AdminInbox hospitalId={hospitalId} data={requests.data} />}
                {own && <Incoming hospitalId={hospitalId} list={requests.data?.incoming ?? []} />}
                {own && <MyShifts hospitalId={hospitalId} staffId={user.staff_id} openSlots={(requests.data?.mine ?? []).filter((r) => ['pending_peer', 'needs_admin'].includes(r.status)).map((r) => r.from)} />}
                {own && <MyRequests hospitalId={hospitalId} list={requests.data?.mine ?? []} />}
            </div>
            <section className="h-fit rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
                <h2 className="mb-2 font-semibold text-slate-800">ขั้นตอนย้าย/แลกเวร</h2>
                <ol className="list-decimal space-y-1 pl-5">
                    <li><b>ย้ายไปช่องอื่น:</b> ถ้าไม่ผิดกติกาและช่องเดิมยังมีคนครบ ระบบย้ายให้ทันที · ถ้าช่องเดิมจะขาดคน ส่งให้แอดมินตัดสิน</li>
                    <li><b>แลกกับเพื่อน:</b> เพื่อนกดตอบรับแล้วสลับให้ทันที ไม่ต้องรอแอดมิน</li>
                    <li>ถ้าสลับแล้วผิดกติกา (เวรซ้อน พักไม่พอ ชั่วโมงเกิน วันลา) หรือช่องขาดความเชี่ยวชาญ คำขอจะไปรอ <StatusBadge status="needs_admin" /></li>
                    <li>แอดมินเคลียร์ตารางแล้วอนุมัติ หรือไม่อนุมัติพร้อมเหตุผล</li>
                </ol>
            </section>
        </div>
    );
}

function useRefresh(hospitalId) {
    const queryClient = useQueryClient();
    return () => {
        queryClient.invalidateQueries({ queryKey: ['shift-requests', hospitalId] });
        queryClient.invalidateQueries({ queryKey: ['roster', hospitalId] });
        queryClient.invalidateQueries({ queryKey: ['my-queue', hospitalId] });
    };
}

function AdminInbox({ hospitalId, data }) {
    const refresh = useRefresh(hospitalId);
    const [notes, setNotes] = useState({});
    const [error, setError] = useState(null);
    const decide = useMutation({
        mutationFn: ({ id, action }) => api(`/hospitals/${hospitalId}/shift-requests/${id}/${action}`, { method: 'POST', body: { note: notes[id] || null } }),
        onSuccess: () => { setError(null); refresh(); },
        onError: (e) => setError(errorMessages(e)),
    });

    return (
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <h2 className="border-b border-slate-200 p-4 text-lg font-semibold">คำขอย้าย/แลกเวรที่รอแอดมินเคลียร์</h2>
            {error && (
                <div className="mx-4 mt-4 rounded-md bg-rose-50 p-3 text-sm text-rose-800">
                    ยังอนุมัติไม่ได้ — เคลียร์ตารางเวรก่อน:
                    <ul className="mt-1 list-disc pl-5">{error.map((m) => <li key={m}>{m}</li>)}</ul>
                </div>
            )}
            {data?.needs_admin.length === 0 && <p className="p-6 text-center text-sm text-slate-500">ไม่มีคำขอที่รอเคลียร์</p>}
            <ul className="divide-y divide-slate-100">
                {data?.needs_admin.map((r) => (
                    <li key={r.id} className="space-y-2 p-4 text-sm">
                        <RequestSummary r={r} />
                        <div className="flex flex-wrap items-center gap-2">
                            <Link className="text-xs text-indigo-700 underline" to={`/roster/table?dept=${r.department_id}&month=${r.from.date.slice(0, 7)}&doctors=${[r.requester.id, r.target_staff?.id].filter(Boolean).join(',')}`}>
                                เปิดตารางเวรของแพทย์ที่เกี่ยวข้อง
                            </Link>
                            <input
                                className="ml-auto w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs sm:w-44"
                                placeholder="หมายเหตุ (ไม่บังคับ)"
                                value={notes[r.id] ?? ''}
                                onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
                                maxLength={200}
                            />
                            <button className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-40" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, action: 'approve' })}>อนุมัติ</button>
                            <button className="rounded-md border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-40" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, action: 'reject' })}>ไม่อนุมัติ</button>
                        </div>
                    </li>
                ))}
            </ul>
            {data?.recent.length > 0 && (
                <details className="border-t border-slate-200 p-4 text-sm">
                    <summary className="cursor-pointer text-slate-600">ล่าสุด {data.recent.length} รายการ</summary>
                    <ul className="mt-3 space-y-3">{data.recent.map((r) => <li key={r.id}><RequestSummary r={r} /></li>)}</ul>
                </details>
            )}
        </section>
    );
}

function Incoming({ hospitalId, list }) {
    const refresh = useRefresh(hospitalId);
    const respond = useMutation({
        mutationFn: ({ id, action }) => api(`/hospitals/${hospitalId}/shift-requests/${id}/${action}`, { method: 'POST' }),
        onSuccess: refresh,
    });
    if (!list.length) return null;

    return (
        <section className="rounded-xl border border-sky-300 bg-sky-50 shadow-sm">
            <h2 className="p-4 pb-2 text-lg font-semibold">เพื่อนขอแลกเวรกับคุณ ({list.length})</h2>
            <ul className="divide-y divide-sky-200">
                {list.map((r) => (
                    <li key={r.id} className="space-y-2 p-4 text-sm">
                        <p>
                            <b>{r.requester.name}</b> ขอรับเวรของคุณ <b>{slotLabel(r.to)}</b> แล้วให้คุณไปลง <b>{slotLabel(r.from)}</b> แทน
                        </p>
                        {r.reason && <p className="text-slate-600">เหตุผล: {r.reason}</p>}
                        <Problems list={r.problems} note="ถ้าตอบรับ คำขอจะไปรอแอดมินเคลียร์ก่อน" />
                        <div className="flex gap-2">
                            <button className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40" disabled={respond.isPending} onClick={() => respond.mutate({ id: r.id, action: 'accept' })}>ตอบรับ</button>
                            <button className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs disabled:opacity-40" disabled={respond.isPending} onClick={() => respond.mutate({ id: r.id, action: 'decline' })}>ปฏิเสธ</button>
                        </div>
                        {respond.isError && respond.variables?.id === r.id && <p className="text-xs text-rose-700">{errorMessages(respond.error).join(' ')}</p>}
                    </li>
                ))}
            </ul>
        </section>
    );
}

// เวรของฉันที่ยังไม่ถึง (42 วันข้างหน้า) + ฟอร์มขอย้าย/แลก
function MyShifts({ hospitalId, staffId, openSlots }) {
    const department = useStaff(hospitalId).data?.find((s) => s.id === staffId)?.department_id;
    const from = isoDate(new Date());
    const to = addDays(from, 41);
    const roster = useQuery({
        queryKey: ['roster', hospitalId, department, from, to],
        queryFn: () => api(`/hospitals/${hospitalId}/departments/${department}/roster?from=${from}&to=${to}`),
        enabled: !!department,
    });
    const [openId, setOpenId] = useState(null);
    const templates = Object.fromEntries((roster.data?.templates ?? []).map((t) => [t.id, t]));
    // เวรที่เริ่มไปแล้วขอเปลี่ยนไม่ได้ (backend ก็ตรวจ) — ซ่อนตั้งแต่ในรายการ
    const upcoming = (s) => new Date(`${s.shift_date}T${templates[s.shift_template_id]?.start_time}`) > new Date();
    const mine = (roster.data?.shifts ?? []).filter((s) => s.staff_id === staffId && upcoming(s));
    const busy = (s) => openSlots.some((slot) => slot.date === s.shift_date && slot.shift_template_id === s.shift_template_id);

    return (
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <h2 className="border-b border-slate-200 p-4 text-lg font-semibold">เวรของฉัน (6 สัปดาห์ข้างหน้า)</h2>
            {roster.isPending && <p className="p-4 text-sm text-slate-500">กำลังโหลด…</p>}
            {roster.isSuccess && mine.length === 0 && <p className="p-6 text-center text-sm text-slate-500">ยังไม่มีเวร</p>}
            <ul className="divide-y divide-slate-100">
                {mine.map((s) => {
                    const t = templates[s.shift_template_id];
                    return (
                        <li key={s.id} className="p-4 text-sm">
                            <div className="flex items-center justify-between gap-3">
                                <span>{day(s.shift_date)} · {t.name} {t.start_time.slice(0, 5)}–{t.end_time.slice(0, 5)}</span>
                                {busy(s) ? (
                                    <span className="text-xs text-slate-500">มีคำขอค้างอยู่</span>
                                ) : (
                                    <button className="rounded-md border border-slate-300 px-3 py-1 text-xs hover:bg-slate-100" onClick={() => setOpenId(openId === s.id ? null : s.id)}>
                                        {openId === s.id ? 'ปิด' : 'ขอย้าย / แลก'}
                                    </button>
                                )}
                            </div>
                            {openId === s.id && <RequestForm hospitalId={hospitalId} shift={s} roster={roster.data} staffId={staffId} onDone={() => setOpenId(null)} />}
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}

function RequestForm({ hospitalId, shift, roster, staffId, onDone }) {
    const refresh = useRefresh(hospitalId);
    const [type, setType] = useState('swap');
    const [toDate, setToDate] = useState('');
    const [toTemplate, setToTemplate] = useState(roster.templates[0]?.id ?? '');
    const [target, setTarget] = useState('');
    const [reason, setReason] = useState('');
    const [result, setResult] = useState(null);
    const templates = Object.fromEntries(roster.templates.map((t) => [t.id, t]));
    const now = isoDate(new Date());
    const colleagues = roster.shifts.filter((s) => s.staff_id !== staffId && new Date(`${s.shift_date}T${templates[s.shift_template_id].start_time}`) > new Date());
    const gapKeys = new Set(roster.gaps.map((g) => `${g.date}|${g.shift_template_id}`));

    const submit = useMutation({
        mutationFn: () => api(`/hospitals/${hospitalId}/shift-requests`, {
            method: 'POST',
            body: type === 'move'
                ? { shift_id: shift.id, type, to_date: toDate, to_template_id: Number(toTemplate), reason }
                : { shift_id: shift.id, type, target_shift_id: Number(target), reason },
        }),
        onSuccess: (r) => { setResult(r); refresh(); },
    });

    if (result) {
        const text = {
            approved: 'ย้ายเวรให้แล้ว',
            needs_admin: 'ส่งให้แอดมินตัดสินแล้ว เพราะช่องเดิมจะขาดคน',
            pending_peer: `ส่งคำขอให้ ${result.target_staff?.name} แล้ว รอตอบรับ`,
        }[result.status];
        return (
            <div className="mt-3 rounded-md bg-emerald-50 p-3 text-sm text-emerald-900">
                {text} <button className="ml-2 underline" onClick={onDone}>ปิด</button>
            </div>
        );
    }

    const input = 'rounded-md border border-slate-300 px-2 py-1.5 text-sm';
    return (
        <form className="mt-3 space-y-2 rounded-md bg-slate-50 p-3" onSubmit={(e) => { e.preventDefault(); submit.mutate(); }}>
            <div className="flex rounded-md border border-slate-300 bg-white p-0.5 text-xs" role="radiogroup">
                {[['swap', 'แลกกับเพื่อน'], ['move', 'ย้ายไปช่องอื่น']].map(([value, label]) => (
                    <button type="button" key={value} role="radio" aria-checked={type === value} onClick={() => setType(value)} className={`flex-1 rounded px-2 py-1 ${type === value ? 'bg-indigo-600 text-white' : 'text-slate-600'}`}>{label}</button>
                ))}
            </div>
            {type === 'swap' ? (
                <select className={`${input} w-full`} value={target} onChange={(e) => setTarget(e.target.value)} required aria-label="เวรของเพื่อนที่จะแลก">
                    <option value="">เลือกเวรของเพื่อน…</option>
                    {colleagues.map((s) => {
                        const t = templates[s.shift_template_id];
                        return <option key={s.id} value={s.id}>{day(s.shift_date)} {t.name} {t.start_time.slice(0, 5)} — {s.staff_name}</option>;
                    })}
                </select>
            ) : (
                <div className="flex gap-2">
                    <input className={`${input} flex-1`} type="date" min={now} value={toDate} onChange={(e) => setToDate(e.target.value)} required aria-label="วันที่ใหม่" />
                    <select className={input} value={toTemplate} onChange={(e) => setToTemplate(e.target.value)} aria-label="ช่วงเวรใหม่">
                        {roster.templates.map((t) => <option key={t.id} value={t.id}>{t.name}{toDate && gapKeys.has(`${toDate}|${t.id}`) ? ' (ยังขาดคน)' : ''}</option>)}
                    </select>
                </div>
            )}
            <input className={`${input} w-full`} placeholder="เหตุผล (ไม่บังคับ)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
            <button className="w-full rounded-md bg-slate-800 py-2 text-sm font-medium text-white disabled:opacity-40" disabled={submit.isPending}>ส่งคำขอ</button>
            {submit.isError && (
                <ul className="list-disc space-y-0.5 pl-5 text-xs text-rose-700">{errorMessages(submit.error).map((m) => <li key={m}>{m}</li>)}</ul>
            )}
        </form>
    );
}

function MyRequests({ hospitalId, list }) {
    const refresh = useRefresh(hospitalId);
    const cancel = useMutation({
        mutationFn: (id) => api(`/hospitals/${hospitalId}/shift-requests/${id}`, { method: 'DELETE' }),
        onSuccess: refresh,
    });
    if (!list.length) return null;

    return (
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <h2 className="border-b border-slate-200 p-4 text-lg font-semibold">คำขอของฉัน</h2>
            <ul className="divide-y divide-slate-100">
                {list.map((r) => (
                    <li key={r.id} className="flex items-start justify-between gap-3 p-4 text-sm">
                        <RequestSummary r={r} />
                        {['pending_peer', 'needs_admin'].includes(r.status) && (
                            <button className="shrink-0 text-xs text-slate-500 underline hover:text-rose-700" onClick={() => cancel.mutate(r.id)}>ยกเลิก</button>
                        )}
                    </li>
                ))}
            </ul>
        </section>
    );
}

function RequestSummary({ r }) {
    return (
        <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={r.status} />
                <span className="font-medium">
                    {r.type === 'swap' ? `${r.requester.name} ⇄ ${r.target_staff?.name}` : `${r.requester.name} ย้ายเวร`}
                </span>
            </div>
            <div className="text-slate-700">
                {slotLabel(r.from)} {r.type === 'swap' ? '⇄' : '→'} {slotLabel(r.to)}
            </div>
            {r.reason && <div className="text-slate-500">เหตุผล: {r.reason}</div>}
            {['pending_peer', 'needs_admin'].includes(r.status) && <Problems list={r.problems} />}
            {r.decision_note && <div className="text-slate-500">หมายเหตุแอดมิน: {r.decision_note}</div>}
            {r.status === 'approved' && <div className="text-xs text-slate-400">{r.decided_by_name ? `อนุมัติโดย ${r.decided_by_name}` : 'เปลี่ยนอัตโนมัติ (ไม่ติดกติกา)'}</div>}
        </div>
    );
}

function Problems({ list, note }) {
    if (!list?.length) return null;
    return (
        <div className="rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
            {note && <p className="mb-0.5 font-medium">{note}</p>}
            <ul className="list-disc pl-4">{list.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
    );
}

export function StatusBadge({ status }) {
    const s = REQUEST_STATUS[status];
    return <span className={`inline-block rounded-full border px-2 py-0.5 text-xs ${s.className}`}>{s.label}</span>;
}
