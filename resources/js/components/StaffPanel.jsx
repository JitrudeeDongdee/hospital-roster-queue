import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PRIORITY, api, queueNo } from '../api';
import { clock } from './TicketBoard';
import { byId, useDepartments, useStaff } from '../useLookups';
import { useAuth } from '../auth';
import Select from './Select';

export default function StaffPanel({ hospitalId }) {
    const queryClient = useQueryClient();
    const staff = useStaff(hospitalId);
    const departments = byId(useDepartments(hospitalId).data);
    const { user, can } = useAuth();
    const canCall = can('ticket.call');
    const [chosen, setChosen] = useState('');
    const staffId = user.staff_id ?? chosen; // แพทย์ล็อกเป็นตัวเอง · แอดมิน/พยาบาลเลือกดูคิวของแพทย์คนไหนก็ได้
    const [current, setCurrent] = useState(null);
    const member = staff.data?.find((s) => s.id === Number(staffId));

    // ฟังก์ชันเสริม: หมอเห็นได้ตลอดว่ามีคิวไหนที่ตัวเองรับได้ + เวรถัดไป
    const myQueue = useQuery({
        queryKey: ['my-queue', hospitalId, staffId],
        queryFn: () => api(`/hospitals/${hospitalId}/staff/${staffId}/my-queue`),
        enabled: !!staffId,
        refetchInterval: 15_000,
    });

    // คิวปัจจุบัน: ค่าจาก server (รีเฟรชหน้า/เปิดดูของแพทย์คนอื่นก็ยังเห็น) · ค่าในเครื่องใช้ระหว่างกดเรียก/เสร็จสิ้น
    const shown = current ?? myQueue.data?.current ?? null;
    const isOwn = canCall && user.staff_id === Number(staffId);

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
            <h2 className="mb-3 text-lg font-semibold">{user.staff_id ? 'ห้องตรวจของฉัน' : 'คิวของแพทย์'}</h2>

            {!user.staff_id && <Select
                className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={staffId}
                onChange={(v) => { setChosen(v); setCurrent(null); callNext.reset(); }}
                placeholder="เลือกแพทย์"
                ariaLabel="แพทย์"
                options={(staff.data ?? []).map((s) => ({ value: s.id, label: `${departments[s.department_id]?.name ?? ''} · ${s.name}` }))}
            />}

            {member && (
                <div className="mt-2 flex flex-wrap gap-1">
                    {member.skills.map((skill) => (
                        <span key={skill.id} className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">{skill.name}</span>
                    ))}
                </div>
            )}

            {canCall && <button
                className="mt-4 w-full rounded-md bg-indigo-600 py-2.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
                disabled={!staffId || callNext.isPending || shown?.status === 'called'}
                title={shown?.status === 'called' ? 'กดเสร็จสิ้นคิวปัจจุบันก่อน' : undefined}
                onClick={() => callNext.mutate()}
            >
                {callNext.isPending ? 'กำลังเรียก…' : 'เรียกคิวถัดไป'}
            </button>}

            {callNext.isError && (
                <p className="mt-3 text-sm text-slate-500">
                    {callNext.error.status === 404 ? 'ไม่มีคิวที่เจ้าหน้าที่คนนี้รับได้' : callNext.error.message}
                </p>
            )}

            {member && (
                <div className={`mt-4 rounded-lg border p-4 text-center ${shown?.status === 'called' ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200'}`}>
                    <p className="text-xs font-medium text-slate-500">คิวปัจจุบัน</p>
                    {shown ? (
                        <>
                            <p className="font-mono text-5xl font-bold tracking-wider">{queueNo(departments[shown.department_id], shown.number)}</p>
                            <p className="mt-1 text-sm">
                                <span className={`rounded-full px-2 py-0.5 text-xs ${PRIORITY[shown.priority]?.className}`}>{PRIORITY[shown.priority]?.label}</span>
                                {shown.called_at && <span className="ml-2 text-xs text-slate-500">เรียกเมื่อ {clock(shown.called_at)} ({Math.max(0, Math.round((Date.now() - new Date(shown.called_at)) / 60000))} นาที)</span>}
                            </p>
                            {isOwn ? (
                                <button
                                    className="mt-3 w-full rounded-md border border-emerald-600 bg-white py-2 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
                                    disabled={shown.status !== 'called'}
                                    onClick={() => complete.mutate(shown)}
                                >
                                    {shown.status === 'completed' ? 'เสร็จสิ้นแล้ว ✓' : 'เสร็จสิ้น'}
                                </button>
                            ) : (
                                <p className="mt-2 text-xs text-slate-500">{shown.status === 'completed' ? 'ตรวจเสร็จแล้ว' : 'กำลังตรวจ'}</p>
                            )}
                            {complete.isError && <p className="mt-2 text-sm text-red-600">{complete.error.message}</p>}
                        </>
                    ) : (
                        <p className="py-3 text-sm text-slate-400">{myQueue.isPending ? 'กำลังโหลด…' : 'ยังไม่มีคิวที่กำลังตรวจ'}</p>
                    )}
                </div>
            )}

            {member && myQueue.data && (
                <div className="mt-3 flex items-center justify-between rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2.5">
                    <span className="text-xs font-medium text-emerald-800">{isOwn ? 'คิวถัดไปของคุณ' : 'คิวถัดไป'}</span>
                    {myQueue.data.waiting[0] ? (
                        <span className="flex items-center gap-2">
                            <span className="font-mono text-2xl font-bold text-emerald-900">{queueNo(departments[member.department_id], myQueue.data.waiting[0].number)}</span>
                            <span className={`rounded-full px-2 text-xs ${PRIORITY[myQueue.data.waiting[0].priority].className}`}>{PRIORITY[myQueue.data.waiting[0].priority].label}</span>
                            {myQueue.data.waiting[0].appointment_at && <span className="rounded-full bg-sky-100 px-2 text-xs text-sky-800">นัด {clock(myQueue.data.waiting[0].appointment_at)}</span>}
                        </span>
                    ) : (
                        <span className="text-sm text-slate-400">ไม่มีคิวที่รับได้</span>
                    )}
                </div>
            )}

            {member && myQueue.data && (
                <div className="mt-5 border-t border-slate-200 pt-4 text-sm">
                    {myQueue.data.appointments_left > 0 && <p className="mb-2 text-xs text-sky-800">นัดของ{isOwn ? 'คุณ' : 'แพทย์คนนี้'}วันนี้ที่ยังไม่มา {myQueue.data.appointments_left} คน</p>}
                    <h3 className="mb-2 font-medium">คิวที่รอคุณ ({myQueue.data.waiting.length}{myQueue.data.waiting.length === 20 ? '+' : ''})</h3>
                    <ol className="max-h-48 space-y-1 overflow-auto">
                        {myQueue.data.waiting.map((t) => (
                            <li key={t.id} className="flex justify-between">
                                <span className="font-mono">{queueNo(departments[member.department_id], t.number)}</span>
                                <span className="flex gap-1">
                                    {t.appointment_at && <span className="rounded-full bg-sky-100 px-2 text-xs text-sky-800">นัด {clock(t.appointment_at)}</span>}
                                    <span className={`rounded-full px-2 text-xs ${PRIORITY[t.priority].className}`}>{PRIORITY[t.priority].label}</span>
                                </span>
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
