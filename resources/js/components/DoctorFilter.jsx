// เลือกแพทย์ได้หลายคน (multi-select แบบ toggle chip) — ว่าง = ทุกคน
export default function DoctorFilter({ doctors, selected, onChange, highlight }) {
    const toggle = (id) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

    return (
        <div className="flex flex-wrap items-center gap-1.5 text-xs" role="group" aria-label="กรองตามแพทย์">
            <span className="mr-1 text-slate-500">แพทย์:</span>
            <button
                type="button"
                aria-pressed={selected.length === 0}
                onClick={() => onChange([])}
                className={`rounded-full border px-2.5 py-1 ${selected.length === 0 ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-100'}`}
            >
                ทุกคน
            </button>
            {doctors.map((d) => {
                const on = selected.includes(d.id);
                return (
                    <button
                        key={d.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggle(d.id)}
                        className={`rounded-full border px-2.5 py-1 ${on ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 text-slate-700 hover:bg-slate-100'}`}
                    >
                        {on && '✓ '}{d.name.replace(/^Dr\.\s*/, '')}{d.id === highlight ? ' (ฉัน)' : ''}
                    </button>
                );
            })}
        </div>
    );
}
