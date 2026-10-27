import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessages } from '../api';
import { byId, useDepartments, useSkills } from '../useLookups';

const formatDay = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' });

// หัวหน้าแผนก: รายชื่อแพทย์พร้อมรายละเอียด · เลือกคนเพื่อแก้ชื่อ/ความเชี่ยวชาญ · เพิ่มแพทย์ใหม่
// URL: /staff?dept=1&id=5 (id=new = ฟอร์มเพิ่มแพทย์)
export default function StaffPage({ hospitalId }) {
    const [params, setParams] = useSearchParams();
    const departments = useDepartments(hospitalId).data ?? [];
    const deptById = byId(departments);
    const directory = useQuery({ queryKey: ['staff-directory', hospitalId], queryFn: () => api(`/hospitals/${hospitalId}/staff-directory`) });

    const dept = Number(params.get('dept')) || null;
    const selected = params.get('id');
    const set = (changes) => {
        const next = new URLSearchParams(params);
        for (const [k, v] of Object.entries(changes)) v === null ? next.delete(k) : next.set(k, v);
        setParams(next, { replace: true });
    };
    const list = (directory.data ?? []).filter((s) => !dept || s.department_id === dept);
    const current = (directory.data ?? []).find((s) => String(s.id) === selected);

    return (
        <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
            <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4">
                    <h2 className="mr-auto text-lg font-semibold">แพทย์ ({list.length})</h2>
                    <select className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={dept ?? ''} onChange={(e) => set({ dept: e.target.value || null })} aria-label="แผนก">
                        <option value="">ทุกแผนก</option>
                        {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                    <button className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700" onClick={() => set({ id: 'new' })}>+ เพิ่มแพทย์</button>
                </div>

                {directory.isPending && <p className="p-4 text-sm text-slate-500">กำลังโหลด…</p>}
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-sm">
                        <thead className="bg-slate-50 text-left text-xs text-slate-500">
                            <tr>
                                <th className="p-3 font-medium">ชื่อ</th>
                                <th className="p-3 font-medium">แผนก</th>
                                <th className="p-3 font-medium">ความเชี่ยวชาญ</th>
                                <th className="p-3 font-medium">เวรเดือนนี้</th>
                                <th className="p-3 font-medium">เวรถัดไป</th>
                                <th className="p-3 font-medium">ลารออนุมัติ</th>
                            </tr>
                        </thead>
                        <tbody>
                            {list.map((s) => (
                                <tr
                                    key={s.id}
                                    onClick={() => set({ id: s.id })}
                                    className={`cursor-pointer border-t border-slate-100 hover:bg-indigo-50 ${String(s.id) === selected ? 'bg-indigo-50' : ''}`}
                                >
                                    <td className="p-3 font-medium">{s.name}</td>
                                    <td className="p-3 text-slate-600">{deptById[s.department_id]?.name}</td>
                                    <td className="p-3">
                                        <div className="flex flex-wrap gap-1">
                                            {s.skills.length ? s.skills.map((k) => <SkillChip key={k.id} name={k.name} />) : <span className="text-xs text-slate-400">—</span>}
                                        </div>
                                    </td>
                                    <td className="p-3 font-mono text-xs">{s.shifts_this_month} เวร · {s.hours_this_month} ชม.</td>
                                    <td className="p-3 text-xs">{s.next_shift ? `${formatDay(s.next_shift.date)} ${s.next_shift.name}` : <span className="text-slate-400">—</span>}</td>
                                    <td className="p-3 text-xs">{s.pending_leave > 0 ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900">{s.pending_leave} วัน</span> : <span className="text-slate-400">—</span>}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            {/* จอแคบ: แผงรายละเอียดขึ้นก่อนตาราง ไม่ต้องเลื่อนหาหลังคลิกชื่อ */}
            <div className={`xl:order-none ${selected ? 'order-first' : ''}`}>
                {selected === 'new' && <StaffForm key="new" hospitalId={hospitalId} departments={departments} defaultDept={dept} onDone={(s) => set({ id: s?.id ?? null })} />}
                {current && <StaffForm key={current.id} hospitalId={hospitalId} departments={departments} doctor={current} onDone={() => set({ id: null })} />}
                {!selected && (
                    <section className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                        คลิกชื่อแพทย์เพื่อดูรายละเอียดและแก้ไขความเชี่ยวชาญ
                    </section>
                )}
            </div>
        </div>
    );
}

// ฟอร์มเดียวใช้ทั้งเพิ่มแพทย์ใหม่ (ไม่มี doctor) และแก้ไขแพทย์ที่เลือก
function StaffForm({ hospitalId, departments, doctor, defaultDept, onDone }) {
    const queryClient = useQueryClient();
    const skills = useSkills().data ?? [];
    const [name, setName] = useState(doctor?.name ?? '');
    const [departmentId, setDepartmentId] = useState(doctor?.department_id ?? defaultDept ?? '');
    const [skillIds, setSkillIds] = useState(doctor?.skills.map((k) => k.id) ?? []);
    useEffect(() => { if (!departmentId && departments[0]) setDepartmentId(departments[0].id); }, [departments, departmentId]);

    const save = useMutation({
        mutationFn: () => doctor
            ? api(`/hospitals/${hospitalId}/staff/${doctor.id}`, { method: 'PATCH', body: { name, skill_ids: skillIds } })
            : api(`/hospitals/${hospitalId}/staff`, { method: 'POST', body: { name, department_id: Number(departmentId), skill_ids: skillIds } }),
        onSuccess: (saved) => {
            // รายชื่อแพทย์ใช้หลายหน้า (จัดเวร คิว) — ให้โหลดใหม่ทุกที่
            queryClient.invalidateQueries({ queryKey: ['staff-directory', hospitalId] });
            queryClient.invalidateQueries({ queryKey: ['staff', hospitalId] });
            queryClient.invalidateQueries({ queryKey: ['roster', hospitalId] });
            if (!doctor) onDone(saved);
        },
    });
    const toggle = (id) => setSkillIds(skillIds.includes(id) ? skillIds.filter((x) => x !== id) : [...skillIds, id]);
    const input = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm';
    const dirty = !doctor || name !== doctor.name || [...skillIds].sort().join() !== doctor.skills.map((k) => k.id).sort().join();

    return (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-start justify-between gap-2">
                <h2 className="text-lg font-semibold">{doctor ? doctor.name : 'เพิ่มแพทย์'}</h2>
                <button className="text-sm text-slate-400 hover:text-slate-700" onClick={() => onDone(null)} aria-label="ปิด">✕</button>
            </div>

            {doctor && (
                <dl className="mb-4 grid grid-cols-2 gap-2 text-sm">
                    <Info label="แผนก" value={departments.find((d) => d.id === doctor.department_id)?.name} />
                    <Info label="เวรเดือนนี้" value={`${doctor.shifts_this_month} เวร · ${doctor.hours_this_month} ชม.`} />
                    <Info label="เวรถัดไป" value={doctor.next_shift ? `${formatDay(doctor.next_shift.date)} ${doctor.next_shift.name}` : '—'} />
                    <Info label="ลารออนุมัติ" value={doctor.pending_leave ? `${doctor.pending_leave} วัน` : '—'} />
                    <Info label="บัญชีผู้ใช้" value={doctor.has_account ? 'มี (บทบาทแพทย์)' : 'ยังไม่มี'} />
                    <div className="col-span-2 flex flex-wrap gap-3 text-xs">
                        <Link className="text-indigo-700 underline" to={`/roster/calendar?dept=${doctor.department_id}&doctors=${doctor.id}`}>ดูปฏิทินเวร</Link>
                        {doctor.pending_leave > 0 && <Link className="text-indigo-700 underline" to="/requests/leave">ดูคำขอลา</Link>}
                    </div>
                </dl>
            )}

            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
                <label className="block text-sm">
                    <span className="mb-1 block font-medium text-slate-700">ชื่อ</span>
                    <input className={input} value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} placeholder="เช่น นพ. สมชาย ใจดี" />
                </label>
                {!doctor && (
                    <label className="block text-sm">
                        <span className="mb-1 block font-medium text-slate-700">แผนก</span>
                        <select className={input} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} required>
                            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                    </label>
                )}
                <fieldset className="text-sm">
                    <legend className="mb-1 font-medium text-slate-700">ความเชี่ยวชาญ</legend>
                    <div className="space-y-1">
                        {skills.map((k) => (
                            <label key={k.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-slate-50">
                                <input type="checkbox" checked={skillIds.includes(k.id)} onChange={() => toggle(k.id)} />
                                {k.name}
                            </label>
                        ))}
                    </div>
                </fieldset>
                {doctor && <p className="text-xs text-slate-500">เปลี่ยนความเชี่ยวชาญแล้ว ตารางเวรจะตรวจช่องที่ต้องการความเชี่ยวชาญใหม่ และการเรียกคิวจะใช้ค่าใหม่ทันที</p>}
                <button className="w-full rounded-md bg-slate-800 py-2 text-sm font-medium text-white disabled:opacity-40" disabled={!dirty || save.isPending}>
                    {save.isPending ? 'กำลังบันทึก…' : doctor ? 'บันทึก' : 'เพิ่มแพทย์'}
                </button>
                {save.isSuccess && doctor && !dirty && <p className="text-sm text-emerald-700">บันทึกแล้ว</p>}
                {save.isError && <p className="text-sm text-rose-700">{errorMessages(save.error).join(' ')}</p>}
            </form>
        </section>
    );
}

function Info({ label, value }) {
    return (
        <div>
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd>{value}</dd>
        </div>
    );
}

function SkillChip({ name }) {
    return <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-900 ring-1 ring-sky-200">{name}</span>;
}
