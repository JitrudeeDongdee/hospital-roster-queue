import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { addDays, api, isoDate } from '../api';
import { useAuth } from '../auth';

const WEEKDAYS = ['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'];
// สีตามลำดับเวร (เช้า / บ่าย / ดึก)
const SHIFT_STYLES = [
    'bg-amber-100 text-amber-900 border-amber-300',
    'bg-sky-100 text-sky-900 border-sky-300',
    'bg-indigo-100 text-indigo-900 border-indigo-300',
];

// ช่วงปฏิทิน: จันทร์ก่อน/ตรงวันที่ 1 ถึงอาทิตย์หลัง/ตรงวันสุดท้าย (ตรงกับสัปดาห์ที่ใช้นับชั่วโมงในกติกา)
export function calendarRange(monthStart, monthEnd) {
    const first = new Date(`${monthStart}T00:00:00`);
    const last = new Date(`${monthEnd}T00:00:00`);
    const start = addDays(monthStart, -((first.getDay() + 6) % 7));
    const end = addDays(monthEnd, (7 - last.getDay()) % 7);
    return [start, end];
}

const shortName = (name) => name.replace(/^Dr\.\s*/, '');
const dayNumber = (iso) => Number(iso.slice(8, 10));

function hoursOf(template) {
    const [sh, sm] = template.start_time.split(':').map(Number);
    const [eh, em] = template.end_time.split(':').map(Number);
    let minutes = eh * 60 + em - (sh * 60 + sm);
    if (minutes <= 0) minutes += 24 * 60;
    return minutes / 60;
}

export default function RosterCalendar({ hospitalId, roster, doctors, monthStart, monthEnd, mode, doctorId: doctorFromUrl, onSelectDoctor }) {
    const { user } = useAuth();
    // ไม่ระบุแพทย์ใน URL → ตัวเอง (ถ้าเป็นแพทย์แผนกนี้) หรือคนแรกของแผนก
    const doctorId = doctorFromUrl ?? (doctors.some((d) => d.id === user.staff_id) ? user.staff_id : doctors[0]?.id);
    const [gridStart, gridEnd] = calendarRange(monthStart, monthEnd);
    const today = isoDate(new Date());

    const templates = roster.templates;
    const templateIndex = Object.fromEntries(templates.map((t, i) => [t.id, i]));
    const templateById = Object.fromEntries(templates.map((t) => [t.id, t]));

    const weeks = useMemo(() => {
        const out = [];
        for (let d = gridStart; d <= gridEnd; d = addDays(d, 7)) out.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
        return out;
    }, [gridStart, gridEnd]);

    const byDay = useMemo(() => {
        const map = {};
        for (const s of roster.shifts) (map[s.shift_date] ??= []).push(s);
        return map;
    }, [roster.shifts]);
    const gapByDay = useMemo(() => {
        const map = {};
        for (const g of roster.gaps) (map[g.date] ??= []).push(g);
        return map;
    }, [roster.gaps]);

    const leave = useQuery({
        queryKey: ['unavailabilities', hospitalId, doctorId, gridStart],
        queryFn: () => api(`/hospitals/${hospitalId}/staff/${doctorId}/unavailabilities?from=${gridStart}&to=${gridEnd}`),
        enabled: mode === 'doctor' && !!doctorId,
    });
    const leaveDays = new Map((leave.data ?? []).map((u) => [u.date.slice(0, 10), u.reason]));

    const mine = roster.shifts.filter((s) => s.staff_id === doctorId);
    const inMonth = (iso) => iso >= monthStart && iso <= monthEnd;
    const monthShifts = mine.filter((s) => inMonth(s.shift_date));
    const monthHours = monthShifts.reduce((sum, s) => sum + hoursOf(templateById[s.shift_template_id]), 0);
    const maxWeekly = roster.rules?.max_weekly_hours;

    return (
        <div className="p-4">
            {mode === 'doctor' && (
                <div className="mb-4 flex flex-wrap items-center gap-3">
                    <select className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={doctorId ?? ''} onChange={(e) => onSelectDoctor(Number(e.target.value))}>
                        {doctors.map((d) => <option key={d.id} value={d.id}>{d.name}{d.id === user.staff_id ? ' (ฉัน)' : ''}</option>)}
                    </select>
                    <div className="flex flex-wrap gap-2 text-sm">
                        <Stat label="เวรในเดือน" value={monthShifts.length} />
                        <Stat label="ชั่วโมงในเดือน" value={monthHours} />
                        {templates.map((t, i) => (
                            <Stat key={t.id} label={t.name} value={monthShifts.filter((s) => s.shift_template_id === t.id).length} className={SHIFT_STYLES[i % 3]} />
                        ))}
                        <Stat label="วันลา" value={[...leaveDays.keys()].filter(inMonth).length} />
                    </div>
                </div>
            )}

            <div className="mb-2 flex flex-wrap gap-3 text-xs text-slate-600">
                {templates.map((t, i) => (
                    <span key={t.id} className="flex items-center gap-1">
                        <span className={`inline-block h-3 w-3 rounded border ${SHIFT_STYLES[i % 3]}`} />
                        {t.name} {t.start_time.slice(0, 5)}–{t.end_time.slice(0, 5)}
                    </span>
                ))}
                {mode === 'all' && <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded border-2 border-red-400" />มีช่องที่ขาด</span>}
                {mode === 'doctor' && <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded border border-slate-300 bg-slate-200" />ลา / ไม่สะดวก</span>}
            </div>

            <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] table-fixed border-collapse text-xs">
                    <thead>
                        <tr>
                            {WEEKDAYS.map((d, i) => <th key={d} className={`p-1.5 text-center font-medium ${i >= 5 ? 'text-rose-600' : 'text-slate-500'}`}>{d}</th>)}
                            {mode === 'doctor' && <th className="w-20 p-1.5 text-center font-medium text-slate-500">ชม./สัปดาห์</th>}
                        </tr>
                    </thead>
                    <tbody>
                        {weeks.map((week) => {
                            const weekHours = mine
                                .filter((s) => s.shift_date >= week[0] && s.shift_date <= week[6])
                                .reduce((sum, s) => sum + hoursOf(templateById[s.shift_template_id]), 0);
                            return (
                                <tr key={week[0]}>
                                    {week.map((date) => {
                                        const outside = !inMonth(date);
                                        const gaps = gapByDay[date] ?? [];
                                        return (
                                            <td
                                                key={date}
                                                title={gaps.map((g) => `${templateById[g.shift_template_id]?.name}: ${g.problem}`).join('\n') || undefined}
                                                className={`h-24 border p-1 align-top ${outside ? 'bg-slate-50 text-slate-400' : 'bg-white'} ${mode === 'all' && gaps.length && !outside ? 'border-2 border-red-400' : 'border-slate-200'}`}
                                            >
                                                <div className={`mb-1 flex justify-between ${date === today ? 'font-bold text-indigo-700' : ''}`}>
                                                    <span>{dayNumber(date)}</span>
                                                    {date === today && <span>วันนี้</span>}
                                                </div>
                                                {mode === 'all'
                                                    ? <AllDay shifts={byDay[date] ?? []} templates={templates} templateIndex={templateIndex} highlight={user.staff_id} />
                                                    : <DoctorDay shifts={(byDay[date] ?? []).filter((s) => s.staff_id === doctorId)} templateById={templateById} templateIndex={templateIndex} leave={leaveDays.has(date) ? (leaveDays.get(date) || 'ลา') : null} />}
                                            </td>
                                        );
                                    })}
                                    {mode === 'doctor' && (
                                        <td className={`border border-slate-200 text-center font-mono text-sm ${maxWeekly && weekHours > maxWeekly ? 'text-red-600' : 'text-slate-700'}`}>
                                            {weekHours}
                                            {maxWeekly && <div className="text-[10px] text-slate-400">/ {maxWeekly}</div>}
                                        </td>
                                    )}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <p className="mt-2 text-xs text-slate-500">ปฏิทินแสดงอย่างเดียว · แก้ไขเวรได้ในมุมมองตาราง</p>
        </div>
    );
}

function AllDay({ shifts, templates, templateIndex, highlight }) {
    return (
        <div className="space-y-0.5">
            {templates.map((t) => {
                const people = shifts.filter((s) => s.shift_template_id === t.id);
                if (!people.length) return null;
                return (
                    <div key={t.id} className={`truncate rounded border px-1 py-0.5 ${SHIFT_STYLES[templateIndex[t.id] % 3]}`}>
                        <span className="font-semibold">{t.code}</span>{' '}
                        {people.map((s, i) => (
                            <span key={s.id} className={s.staff_id === highlight ? 'font-bold underline' : ''}>
                                {i > 0 && ', '}{shortName(s.staff_name)}
                            </span>
                        ))}
                    </div>
                );
            })}
        </div>
    );
}

function DoctorDay({ shifts, templateById, templateIndex, leave }) {
    return (
        <div className="space-y-0.5">
            {leave && <div className="truncate rounded border border-slate-300 bg-slate-200 px-1 py-0.5 text-slate-700">{leave}</div>}
            {shifts.map((s) => {
                const t = templateById[s.shift_template_id];
                return (
                    <div key={s.id} className={`rounded border px-1 py-0.5 ${SHIFT_STYLES[templateIndex[t.id] % 3]}`}>
                        <div className="font-semibold">{t.name}</div>
                        <div>{t.start_time.slice(0, 5)}–{t.end_time.slice(0, 5)}</div>
                    </div>
                );
            })}
        </div>
    );
}

function Stat({ label, value, className = 'bg-slate-50 text-slate-700 border-slate-200' }) {
    return (
        <span className={`rounded-md border px-2 py-1 ${className}`}>
            {label} <strong className="font-mono">{value}</strong>
        </span>
    );
}
