import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PRIORITY, api, queueNo } from '../api';
import { useDepartments, useSkills } from '../useLookups';
import { useAuth } from '../auth';

export default function IssueTicketForm({ hospitalId }) {
    const queryClient = useQueryClient();
    const { can } = useAuth();
    const canTriage = can('ticket.triage');
    const departments = useDepartments(hospitalId).data ?? [];
    const skills = useSkills().data ?? [];
    const [form, setForm] = useState({ department_id: '', patient_ref: '', priority: 0, required_skill_id: '' });
    const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

    const issue = useMutation({
        mutationFn: () => api(`/hospitals/${hospitalId}/departments/${form.department_id}/tickets`, {
            method: 'POST',
            body: {
                patient_ref: form.patient_ref,
                priority: Number(form.priority),
                required_skill_id: form.required_skill_id ? Number(form.required_skill_id) : null,
            },
        }),
        onSuccess: () => {
            setForm({ ...form, patient_ref: '' });
            queryClient.invalidateQueries({ queryKey: ['tickets', hospitalId] });
        },
    });

    const department = departments.find((d) => d.id === Number(form.department_id));
    const input = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm';

    return (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold">ออกบัตรคิว</h2>
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); issue.mutate(); }}>
                <select className={input} value={form.department_id} onChange={set('department_id')} required>
                    <option value="">เลือกแผนก</option>
                    {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <input className={input} placeholder="รหัสอ้างอิงผู้ป่วย เช่น P000123" value={form.patient_ref} onChange={set('patient_ref')} required maxLength={64} />
                {canTriage ? (
                    <>
                        <label className="block text-sm">
                            <span className="mb-1 block font-medium text-slate-700">ความเร่งด่วน</span>
                            <select className={input} value={form.priority} onChange={set('priority')}>
                                {Object.entries(PRIORITY).map(([value, p]) => <option key={value} value={value}>{p.label}</option>)}
                            </select>
                        </label>
                        <label className="block text-sm">
                            <span className="mb-1 block font-medium text-slate-700">ความเชี่ยวชาญที่ต้องการ</span>
                            <select className={input} value={form.required_skill_id} onChange={set('required_skill_id')}>
                                <option value="">ไม่ระบุ (แพทย์ทุกคนรับได้)</option>
                                {skills.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                        </label>
                    </>
                ) : (
                    <p className="text-xs text-slate-500">ออกบัตรคิวปกติ · พยาบาลคัดกรองจะกำหนดความเร่งด่วน/ความเชี่ยวชาญในรายการคิวภายหลัง</p>
                )}
                <button className="w-full rounded-md bg-slate-800 py-2.5 font-medium text-white hover:bg-slate-900 disabled:opacity-40" disabled={issue.isPending}>
                    {issue.isPending ? 'กำลังออกบัตร…' : 'ออกบัตรคิว'}
                </button>
            </form>
            {issue.isSuccess && (
                <p className="mt-3 rounded-md bg-emerald-50 p-3 text-center text-emerald-800">
                    ได้คิว <span className="font-mono text-lg font-bold">{queueNo(department, issue.data.number)}</span>
                </p>
            )}
            {issue.isError && <p className="mt-3 text-sm text-red-600">{issue.error.message}</p>}
        </section>
    );
}
