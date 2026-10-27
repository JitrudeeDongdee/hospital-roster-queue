import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, PRIORITY } from '../api';
import { byId, useDepartments, useStaff } from '../useLookups';

export default function StaffPanel({ hospitalId }) {
    const queryClient = useQueryClient();
    const staff = useStaff(hospitalId);
    const departments = byId(useDepartments(hospitalId).data);
    const [staffId, setStaffId] = useState('');
    const [current, setCurrent] = useState(null);
    const member = staff.data?.find((s) => s.id === Number(staffId));

    // ฟังก์ชันเสริม: หมอเห็นได้ตลอดว่ามีคิวไหนที่ตัวเองรับได้ + เวรถัดไป
    const myQueue = useQuery({
        queryKey: ['my-queue', hospitalId, staffId],
        queryFn: () => api(`/hospitals/${hospitalId}/staff/${staffId}/my-queue`),
        enabled: !!staffId,
        refetchInterval: 15_000,
    });

    const refreshBoard = () => {
        queryClient.invalidateQueries({ queryKey: ['tickets', hospitalId] });
        queryClient.invalidateQueries({ queryKey: ['my-queue', hospitalId] });
    };

    const callNext = useMutation({
        mutationFn: () => api(`/hospitals/${hospitalId}/staff/${staffId}/call-next`, { method: 'POST' }),
        onSuccess: (ticket) => {
            setCurrent(ticket);
            refreshBoard();
        },
    });

    // optimistic update: เปลี่ยนสถานะบนจอทันที ถ้า server ตอบ error ค่อยย้อนกลับ
    const complete = useMutation({
        mutationFn: (ticket) => api(`/hospitals/${hospitalId}/tickets/${ticket.id}/complete`, { method: 'POST' }),
        onMutate: (ticket) => {
            setCurrent({ ...ticket, status: 'completed' });
            return { previous: ticket };
        },
        onError: (_error, _ticket, context) => setCurrent(context.previous),
        onSettled: refreshBoard,
    });

    return (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold">ห้องตรวจ</h2>

            <select
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={staffId}
                onChange={(e) => { setStaffId(e.target.value); setCurrent(null); callNext.reset(); }}
            >
                <option value="">เลือกเจ้าหน้าที่</option>
                {staff.data?.map((s) => (
                    <option key={s.id} value={s.id}>{departments[s.department_id]?.code} · {s.name}</option>
                ))}
            </select>

            {member && (
                <div className="mt-2 flex flex-wrap gap-1">
                    {member.skills.map((skill) => (
                        <span key={skill.id} className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">{skill.name}</span>
                    ))}
                </div>
            )}

            <button
                className="mt-4 w-full rounded-md bg-indigo-600 py-2.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
                disabled={!staffId || callNext.isPending || current?.status === 'called'}
                onClick={() => callNext.mutate()}
            >
                {callNext.isPending ? 'กำลังเรียก…' : 'เรียกคิวถัดไป'}
            </button>

            {callNext.isError && (
                <p className="mt-3 text-sm text-slate-500">
                    {callNext.error.status === 404 ? 'ไม่มีคิวที่เจ้าหน้าที่คนนี้รับได้' : callNext.error.message}
                </p>
            )}

            {current && (
                <div className="mt-4 rounded-lg border border-slate-200 p-4 text-center">
                    <p className="text-xs text-slate-500">กำลังให้บริการ</p>
                    <p className="font-mono text-4xl font-bold">
                        {departments[current.department_id]?.code}-{String(current.number).padStart(3, '0')}
                    </p>
                    <p className="mt-1 text-sm">{PRIORITY[current.priority]?.label}</p>
                    <button
                        className="mt-3 w-full rounded-md border border-emerald-600 py-2 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
                        disabled={current.status !== 'called'}
                        onClick={() => complete.mutate(current)}
                    >
                        {current.status === 'completed' ? 'เสร็จสิ้นแล้ว ✓' : 'เสร็จสิ้น'}
                    </button>
                    {complete.isError && <p className="mt-2 text-sm text-red-600">{complete.error.message}</p>}
                </div>
            )}

            {member && myQueue.data && (
                <div className="mt-5 border-t border-slate-200 pt-4 text-sm">
                    <h3 className="mb-2 font-medium">คิวที่รอคุณ ({myQueue.data.waiting.length}{myQueue.data.waiting.length === 20 ? '+' : ''})</h3>
                    <ol className="max-h-48 space-y-1 overflow-auto">
                        {myQueue.data.waiting.map((t) => (
                            <li key={t.id} className="flex justify-between">
                                <span className="font-mono">{departments[member.department_id]?.code}-{String(t.number).padStart(3, '0')}</span>
                                <span className={`rounded-full px-2 text-xs ${PRIORITY[t.priority].className}`}>{PRIORITY[t.priority].label}</span>
                            </li>
                        ))}
                        {myQueue.data.waiting.length === 0 && <li className="text-slate-400">ไม่มีคิวที่คุณรับได้</li>}
                    </ol>
                    <h3 className="mb-1 mt-4 font-medium">เวรถัดไปของคุณ</h3>
                    <ul className="space-y-1 text-slate-600">
                        {myQueue.data.next_shifts.map((s) => (
                            <li key={s.id}>{s.template.name} · {formatDateTime(s.starts_at)}</li>
                        ))}
                        {myQueue.data.next_shifts.length === 0 && <li className="text-slate-400">ยังไม่มีเวร</li>}
                    </ul>
                </div>
            )}
        </section>
    );
}

function formatDateTime(value) {
    const d = new Date(value);
    return d.toLocaleString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
