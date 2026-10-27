import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, api, errorMessages, isoDate, queueNo } from '../api';
import { byId, useDepartments } from '../useLookups';
import Select from './Select';

export const APPOINTMENT_STATUS = {
    booked: { label: 'นัดแล้ว', className: 'bg-sky-100 text-sky-900' },
    checked_in: { label: 'check-in แล้ว', className: 'bg-emerald-100 text-emerald-900' },
    no_show: { label: 'ไม่มา', className: 'bg-slate-200 text-slate-600' },
    cancelled: { label: 'ยกเลิก', className: 'bg-rose-100 text-rose-800' },
};

const time = (dt) => dt.slice(11, 16);
const dateLabel = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

// นัดหมาย: นัดไว้ยังไม่ใช่คิว — มาถึงแล้ว check-in จึงได้บัตรคิว (ติดป้าย "นัด" และได้ลำดับก่อน walk-in เมื่อถึงเวลานัด)
// URL: /appointments?date=YYYY-MM-DD&dept=1
export default function AppointmentsPage({ hospitalId }) {
    const queryClient = useQueryClient();
    const [params, setParams] = useSearchParams();
    const today = isoDate(new Date());
    const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? params.get('date') : today;
    const dept = params.get('dept') ?? '';
    const departments = useDepartments(hospitalId).data ?? [];
    const deptById = byId(departments);
    const set = (changes) => {
        const next = new URLSearchParams(params);
        for (const [k, v] of Object.entries(changes)) v ? next.set(k, v) : next.delete(k);
        setParams(next, { replace: true });
    };

    const list = useQuery({
        queryKey: ['appointments', hospitalId, date, dept],
        queryFn: () => api(`/hospitals/${hospitalId}/appointments?date=${date}${dept ? `&department_id=${dept}` : ''}`),
        refetchInterval: date === today ? 30_000 : false,
    });
    const refresh = () => {
        queryClient.invalidateQueries({ queryKey: ['appointments', hospitalId] });
        queryClient.invalidateQueries({ queryKey: ['appointment-slots', hospitalId] });
        queryClient.invalidateQueries({ queryKey: ['tickets', hospitalId] });
    };
    const [message, setMessage] = useState(null);
    const act = useMutation({
        mutationFn: ({ id, action }) => api(`/hospitals/${hospitalId}/appointments/${id}/${action}`, { method: 'POST' }),
        onSuccess: (data, { action }) => {
            if (action === 'check-in') {
                const no = queueNo(deptById[data.appointment.department_id], data.ticket.number);
                setMessage(data.late ? { tone: 'amber', text: `มาสายเกินเวลาที่กำหนด เข้าคิวแบบ walk-in · ได้คิว ${no}` } : { tone: 'emerald', text: `check-in แล้ว · ได้คิว ${no} (คิวนัด)` });
            } else setMessage({ tone: 'slate', text: 'ยกเลิกนัดแล้ว' });
            refresh();
        },
        onError: (e) => setMessage({ tone: 'rose', text: errorMessages(e).join(' ') }),
    });

    const rows = list.data?.data ?? [];
    const counts = list.data?.counts ?? {};

    return (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4">
                    <h2 className="mr-auto text-lg font-semibold">นัดหมาย · {dateLabel(date)}</h2>
                    <div className="flex items-center gap-1 text-sm">
                        <button className="rounded-md border border-slate-300 px-2 py-1.5" onClick={() => set({ date: addDays(date, -1) })} aria-label="วันก่อน">‹</button>
                        <input type="date" className="rounded-md border border-slate-300 px-2 py-1.5" value={date} onChange={(e) => set({ date: e.target.value })} aria-label="วันที่" />
                        <button className="rounded-md border border-slate-300 px-2 py-1.5" onClick={() => set({ date: addDays(date, 1) })} aria-label="วันถัดไป">›</button>
                        {date !== today && <button className="rounded-md border border-slate-300 px-2 py-1.5" onClick={() => set({ date: null })}>วันนี้</button>}
                    </div>
                    <Select
                        className="w-40 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                        value={dept}
                        onChange={(v) => set({ dept: v })}
                        ariaLabel="แผนก"
                        options={[{ value: '', label: 'ทุกแผนก' }, ...departments.map((d) => ({ value: d.id, label: d.name }))]}
                    />
                </div>

                <div className="flex flex-wrap gap-2 px-4 pt-4 text-xs">
                    {Object.entries(APPOINTMENT_STATUS).map(([k, s]) => (
                        <span key={k} className={`rounded-full px-2 py-0.5 ${s.className}`}>{s.label} {counts[k] ?? 0}</span>
                    ))}
                </div>
                {message && (
                    <p className={`mx-4 mt-3 rounded-md px-3 py-2 text-sm ${{ emerald: 'bg-emerald-50 text-emerald-900', amber: 'bg-amber-50 text-amber-900', rose: 'bg-rose-50 text-rose-800', slate: 'bg-slate-100 text-slate-700' }[message.tone]}`}>{message.text}</p>
                )}

                {list.isPending && <p className="p-4 text-sm text-slate-500">กำลังโหลด…</p>}
                {list.isSuccess && rows.length === 0 && <p className="p-6 text-center text-sm text-slate-500">ไม่มีนัดในวันนี้</p>}
                <div className="overflow-x-auto p-4">
                    <table className="w-full min-w-[640px] text-sm">
                        <thead className="text-left text-xs text-slate-500">
                            <tr><th className="p-2 font-medium">เวลา</th><th className="p-2 font-medium">ผู้ป่วย</th><th className="p-2 font-medium">แผนก / แพทย์</th><th className="p-2 font-medium">ที่มา</th><th className="p-2 font-medium">สถานะ</th><th className="p-2" /></tr>
                        </thead>
                        <tbody>
                            {rows.map((a) => {
                                const s = APPOINTMENT_STATUS[a.status];
                                return (
                                    <tr key={a.id} className={`border-t border-slate-100 ${['no_show', 'cancelled'].includes(a.status) ? 'text-slate-400' : ''}`}>
                                        <td className="p-2 font-mono">{time(a.slot_start)}–{time(a.slot_end)}</td>
                                        <td className="p-2 font-mono">{a.patient_ref}{a.note && <div className="font-sans text-xs text-slate-500">{a.note}</div>}</td>
                                        <td className="p-2">{deptById[a.department_id]?.name}<div className="text-xs text-slate-500">{a.staff_name ?? 'ไม่ระบุแพทย์'}</div></td>
                                        <td className="p-2 text-xs">{a.source === 'his' ? 'HIS' : 'ลงในระบบ'}</td>
                                        <td className="p-2">
                                            <span className={`rounded-full px-2 py-0.5 text-xs ${s.className}`}>{s.label}</span>
                                            {a.ticket && <div className="mt-0.5 font-mono text-xs text-slate-600">คิว {queueNo(deptById[a.department_id], a.ticket.number)}</div>}
                                        </td>
                                        <td className="p-2 text-right whitespace-nowrap">
                                            {a.status === 'booked' && date === today && (
                                                <button className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-40" disabled={act.isPending} onClick={() => act.mutate({ id: a.id, action: 'check-in' })}>check-in</button>
                                            )}
                                            {a.status === 'booked' && (
                                                <button className="ml-2 text-xs text-slate-500 underline hover:text-rose-700 disabled:opacity-40" disabled={act.isPending} onClick={() => act.mutate({ id: a.id, action: 'cancel' })}>ยกเลิก</button>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </section>

            <div className="order-first space-y-6 xl:order-none">
                <BookingForm hospitalId={hospitalId} departments={departments} defaultDept={dept} defaultDate={date < today ? today : date} onBooked={refresh} />
                <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
                    <h2 className="mb-2 font-semibold text-slate-800">กติกานัดหมาย</h2>
                    <ul className="list-disc space-y-1 pl-5">
                        <li>รับนัดเฉพาะช่วงที่มีแพทย์อยู่เวร · ความจุ = แพทย์ที่อยู่เวรตลอดช่วง × จำนวนนัดต่อแพทย์</li>
                        <li>check-in แล้วจึงได้บัตรคิว (เลขชุดเดียวกับ walk-in ติดป้าย "นัด")</li>
                        <li>ถึงเวลานัดแล้ว (ก่อนเวลาไม่เกิน 15 นาที) ได้ก่อน walk-in ที่ความเร่งด่วนเท่ากัน · เคสเร่งด่วนยังมาก่อนเสมอ</li>
                        <li>นัดที่ระบุแพทย์ เฉพาะแพทย์คนนั้นเรียกได้</li>
                        <li>มาสายเกิน 30 นาทีหลังหมดช่วงนัด = เข้าคิวแบบ walk-in · ไม่มาเลย = ระบบปิดเป็น "ไม่มา"</li>
                    </ul>
                </section>
            </div>
        </div>
    );
}

function BookingForm({ hospitalId, departments, defaultDept, defaultDate, onBooked }) {
    const [department, setDepartment] = useState(defaultDept || '');
    const [date, setDate] = useState(defaultDate);
    const [slot, setSlot] = useState('');
    const [doctor, setDoctor] = useState('');
    const [patientRef, setPatientRef] = useState('');
    const [note, setNote] = useState('');
    const dept = department || departments[0]?.id || '';
    const slots = useQuery({
        queryKey: ['appointment-slots', hospitalId, dept, date],
        queryFn: () => api(`/hospitals/${hospitalId}/departments/${dept}/appointment-slots?date=${date}`),
        enabled: !!dept && !!date,
    });
    const now = new Date();
    const open = (slots.data ?? []).filter((s) => s.capacity > 0 && new Date(s.start.replace(' ', 'T')) > now);
    const chosen = open.find((s) => s.start === slot);
    const save = useMutation({
        mutationFn: () => api(`/hospitals/${hospitalId}/departments/${dept}/appointments`, { method: 'POST', body: { slot_start: slot, staff_id: doctor ? Number(doctor) : null, patient_ref: patientRef, note: note || null } }),
        onSuccess: () => { setPatientRef(''); setNote(''); setDoctor(''); onBooked(); slots.refetch(); },
    });
    const input = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm';

    return (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold">ลงนัด</h2>
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
                <label className="block text-sm"><span className="mb-1 block font-medium text-slate-700">แผนก</span>
                    <Select className={`block ${input}`} value={dept} onChange={(v) => { setDepartment(v); setSlot(''); setDoctor(''); }} ariaLabel="แผนกที่นัด" options={departments.map((d) => ({ value: d.id, label: d.name }))} />
                </label>
                <label className="block text-sm"><span className="mb-1 block font-medium text-slate-700">วันที่</span>
                    <input type="date" className={input} min={isoDate(new Date())} value={date} onChange={(e) => { setDate(e.target.value); setSlot(''); setDoctor(''); }} required />
                </label>
                <label className="block text-sm"><span className="mb-1 block font-medium text-slate-700">ช่วงเวลา</span>
                    <Select
                        className={`block ${input}`}
                        value={slot}
                        required
                        onChange={(v) => { setSlot(v); setDoctor(''); }}
                        placeholder={slots.isPending ? 'กำลังโหลด…' : open.length ? 'เลือกช่วงเวลา' : 'ไม่มีช่วงที่รับนัด (ไม่มีแพทย์อยู่เวร)'}
                        ariaLabel="ช่วงเวลานัด"
                        options={open.map((s) => ({ value: s.start, label: `${time(s.start)}–${time(s.end)} · ${s.booked >= s.capacity ? 'เต็ม' : `ว่าง ${s.capacity - s.booked}/${s.capacity}`}` }))}
                    />
                </label>
                <label className="block text-sm"><span className="mb-1 block font-medium text-slate-700">แพทย์ (ไม่บังคับ)</span>
                    <Select
                        className={`block ${input}`}
                        value={doctor}
                        onChange={setDoctor}
                        disabled={!chosen}
                        ariaLabel="แพทย์ที่นัด"
                        options={[{ value: '', label: 'ไม่ระบุ (แพทย์ที่อยู่เวรคนไหนก็ได้)' }, ...(chosen?.doctors ?? []).map((d) => ({ value: d.id, label: `${d.name} · นัดแล้ว ${d.booked}` }))]}
                    />
                </label>
                <label className="block text-sm"><span className="mb-1 block font-medium text-slate-700">รหัสผู้ป่วย (HN)</span>
                    <input className={input} value={patientRef} onChange={(e) => setPatientRef(e.target.value)} required maxLength={64} placeholder="เช่น HN000123" />
                </label>
                <input className={input} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="หมายเหตุ (ไม่บังคับ) เช่น ติดตามผลเลือด" aria-label="หมายเหตุ" />
                <button className="w-full rounded-md bg-slate-800 py-2 text-sm font-medium text-white disabled:opacity-40" disabled={save.isPending || !slot}>ลงนัด</button>
                {save.isSuccess && <p className="text-sm text-emerald-700">ลงนัดแล้ว</p>}
                {save.isError && <p className="text-sm text-rose-700">{errorMessages(save.error).join(' ')}</p>}
            </form>
        </section>
    );
}
