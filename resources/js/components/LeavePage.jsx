import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, api, errorMessages, isoDate } from '../api';
import { useAuth } from '../auth';
import { byId, useDepartments } from '../useLookups';

export const LEAVE_STATUS = {
    pending: { label: 'รออนุมัติ', className: 'bg-amber-100 text-amber-900 border-amber-300' },
    approved: { label: 'อนุมัติแล้ว', className: 'bg-emerald-100 text-emerald-900 border-emerald-300' },
    rejected: { label: 'ไม่อนุมัติ', className: 'bg-rose-100 text-rose-900 border-rose-300' },
};

const formatDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

// หน้าการลา: แอดมินเห็นกล่องคำขอ · แพทย์เห็นฟอร์มขอลา + คำขอของตัวเอง
export default function LeavePage({ hospitalId }) {
    const { can, user } = useAuth();

    return (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
            {can('leave.approve') ? <ApprovalInbox hospitalId={hospitalId} /> : <MyRequests hospitalId={hospitalId} staffId={user.staff_id} />}
            <div className="space-y-6">
                {can('leave.manage.own') && user.staff_id && <RequestForm hospitalId={hospitalId} staffId={user.staff_id} />}
                <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
                    <h2 className="mb-2 font-semibold text-slate-800">ขั้นตอนการลา</h2>
                    <ol className="list-decimal space-y-1 pl-5">
                        <li>แพทย์ส่งคำขอลา → สถานะ <Badge status="pending" /></li>
                        <li>ระหว่างรอ แพทย์ยกเลิกคำขอเองได้ และการจัดเวรอัตโนมัติจะเว้นวันนั้นไว้</li>
                        <li>แอดมินอนุมัติ → <Badge status="approved" /> ระบบจะไม่ให้ลงเวรวันนั้น · ถ้าวันนั้นมีเวรอยู่ ต้องย้ายเวรก่อน</li>
                        <li>หรือไม่อนุมัติพร้อมเหตุผล → <Badge status="rejected" /> แพทย์ขอใหม่ได้</li>
                    </ol>
                </section>
            </div>
        </div>
    );
}

export function usePendingLeaveCount(hospitalId, enabled) {
    return useQuery({
        queryKey: ['leave-requests', hospitalId, 'pending'],
        queryFn: () => api(`/hospitals/${hospitalId}/leave-requests?status=pending`),
        enabled,
        refetchInterval: 30_000,
        select: (data) => data.counts.pending,
    });
}

function ApprovalInbox({ hospitalId }) {
    const queryClient = useQueryClient();
    const [params, setParams] = useSearchParams();
    const status = LEAVE_STATUS[params.get('status')] ? params.get('status') : 'pending';
    const departments = byId(useDepartments(hospitalId).data);
    const [notes, setNotes] = useState({});
    const [error, setError] = useState(null);

    const inbox = useQuery({
        queryKey: ['leave-requests', hospitalId, status],
        queryFn: () => api(`/hospitals/${hospitalId}/leave-requests?status=${status}`),
    });

    const refresh = () => {
        queryClient.invalidateQueries({ queryKey: ['leave-requests', hospitalId] });
        queryClient.invalidateQueries({ queryKey: ['unavailabilities', hospitalId] });
        queryClient.invalidateQueries({ queryKey: ['roster', hospitalId] });
    };
    const decide = useMutation({
        mutationFn: ({ id, action }) => api(`/hospitals/${hospitalId}/leave-requests/${id}/${action}`, { method: 'POST', body: { note: notes[id] || null } }),
        onSuccess: () => { setError(null); refresh(); },
        onError: (e) => setError(errorMessages(e).join(' ')),
    });

    return (
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4">
                <h2 className="mr-auto text-lg font-semibold">คำขอลา</h2>
                <nav className="flex rounded-md border border-slate-300 p-0.5 text-xs" aria-label="สถานะคำขอลา">
                    {Object.entries(LEAVE_STATUS).map(([value, s]) => (
                        <button
                            key={value}
                            onClick={() => setParams({ status: value })}
                            className={`rounded px-2.5 py-1 ${status === value ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                        >
                            {s.label} {inbox.data && <span className="ml-0.5 font-mono">({inbox.data.counts[value]})</span>}
                        </button>
                    ))}
                </nav>
            </div>

            {error && <p className="mx-4 mt-4 rounded-md bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
            {inbox.isPending && <p className="p-4 text-sm text-slate-500">กำลังโหลด…</p>}
            {inbox.data?.data.length === 0 && <p className="p-6 text-center text-sm text-slate-500">ไม่มีคำขอในสถานะนี้</p>}

            <ul className="divide-y divide-slate-100">
                {inbox.data?.data.map((l) => (
                    <li key={l.id} className="flex flex-wrap items-start gap-3 p-4 text-sm">
                        <div className="min-w-48 flex-1">
                            <div className="font-medium">{l.staff_name} <span className="text-xs text-slate-500">· {departments[l.department_id]?.name}</span></div>
                            <div>{formatDate(l.date)}</div>
                            {l.reason && <div className="text-slate-500">เหตุผล: {l.reason}</div>}
                            {l.decision_note && <div className="text-slate-500">หมายเหตุแอดมิน: {l.decision_note}</div>}
                            {l.decided_by_name && <div className="text-xs text-slate-400">โดย {l.decided_by_name}</div>}
                            {l.status === 'pending' && l.has_shift && (
                                <div className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">
                                    วันนี้แพทย์มีเวรอยู่ — ต้องย้ายเวรก่อนจึงอนุมัติได้ ·{' '}
                                    <Link className="underline" to={`/roster/table?dept=${l.department_id}&month=${l.date.slice(0, 7)}&doctors=${l.staff_id}`}>ไปที่ตารางเวร</Link>
                                </div>
                            )}
                        </div>
                        {l.status === 'pending' ? (
                            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                                <input
                                    className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs sm:w-44"
                                    placeholder="หมายเหตุ (ไม่บังคับ)"
                                    value={notes[l.id] ?? ''}
                                    onChange={(e) => setNotes({ ...notes, [l.id]: e.target.value })}
                                    maxLength={200}
                                />
                                <button
                                    className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
                                    disabled={l.has_shift || decide.isPending}
                                    title={l.has_shift ? 'ต้องย้ายเวรของวันนั้นก่อน' : undefined}
                                    onClick={() => decide.mutate({ id: l.id, action: 'approve' })}
                                >
                                    อนุมัติ
                                </button>
                                <button
                                    className="rounded-md border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-40"
                                    disabled={decide.isPending}
                                    onClick={() => decide.mutate({ id: l.id, action: 'reject' })}
                                >
                                    ไม่อนุมัติ
                                </button>
                            </div>
                        ) : (
                            <Badge status={l.status} />
                        )}
                    </li>
                ))}
            </ul>
        </section>
    );
}

function MyRequests({ hospitalId, staffId }) {
    const queryClient = useQueryClient();
    const from = addDays(isoDate(new Date()), -60);
    const mine = useQuery({
        queryKey: ['unavailabilities', hospitalId, staffId, 'mine'],
        queryFn: () => api(`/hospitals/${hospitalId}/staff/${staffId}/unavailabilities?from=${from}`),
        enabled: !!staffId,
    });
    const cancel = useMutation({
        mutationFn: (id) => api(`/hospitals/${hospitalId}/leave-requests/${id}`, { method: 'DELETE' }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['unavailabilities', hospitalId] }),
    });

    return (
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <h2 className="border-b border-slate-200 p-4 text-lg font-semibold">คำขอลาของฉัน</h2>
            {mine.data?.length === 0 && <p className="p-6 text-center text-sm text-slate-500">ยังไม่มีคำขอลา</p>}
            <ul className="divide-y divide-slate-100">
                {mine.data?.map((l) => (
                    <li key={l.id} className="flex items-start justify-between gap-3 p-4 text-sm">
                        <div>
                            <div className="font-medium">{formatDate(l.date.slice(0, 10))}</div>
                            {l.reason && <div className="text-slate-500">{l.reason}</div>}
                            {l.decision_note && <div className="text-slate-500">หมายเหตุแอดมิน: {l.decision_note}</div>}
                        </div>
                        <div className="flex items-center gap-2">
                            <Badge status={l.status} />
                            {l.status === 'pending' && (
                                <button className="text-xs text-slate-500 underline hover:text-rose-700" onClick={() => cancel.mutate(l.id)}>ยกเลิก</button>
                            )}
                        </div>
                    </li>
                ))}
            </ul>
        </section>
    );
}

function RequestForm({ hospitalId, staffId }) {
    const queryClient = useQueryClient();
    const [date, setDate] = useState('');
    const [reason, setReason] = useState('');
    const submit = useMutation({
        mutationFn: () => api(`/hospitals/${hospitalId}/staff/${staffId}/unavailabilities`, { method: 'POST', body: { date, reason } }),
        onSuccess: () => {
            setDate('');
            setReason('');
            queryClient.invalidateQueries({ queryKey: ['unavailabilities', hospitalId] });
        },
    });
    const input = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm';

    return (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold">ขอลา</h2>
            <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); submit.mutate(); }}>
                <input className={input} type="date" min={isoDate(new Date())} value={date} onChange={(e) => setDate(e.target.value)} required aria-label="วันที่ลา" />
                <input className={input} placeholder="เหตุผล" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={100} />
                <button className="w-full rounded-md bg-slate-800 py-2 text-sm font-medium text-white disabled:opacity-40" disabled={submit.isPending}>ส่งคำขอลา</button>
            </form>
            {submit.isSuccess && <p className="mt-2 text-sm text-emerald-700">ส่งคำขอแล้ว รอแอดมินอนุมัติ</p>}
            {submit.isError && <p className="mt-2 text-sm text-rose-700">{errorMessages(submit.error).join(' ')}</p>}
        </section>
    );
}

export function Badge({ status }) {
    const s = LEAVE_STATUS[status];
    return <span className={`inline-block rounded-full border px-2 py-0.5 text-xs ${s.className}`}>{s.label}</span>;
}
