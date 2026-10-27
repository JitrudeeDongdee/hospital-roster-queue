import { useEffect, useState } from 'react';
import { DEMO } from './api';
import { useHospitals } from './useLookups';
import TicketBoard from './components/TicketBoard';
import StaffPanel from './components/StaffPanel';
import IssueTicketForm from './components/IssueTicketForm';
import RosterPage from './components/RosterPage';

export default function App() {
    const hospitals = useHospitals();
    const [hospitalId, setHospitalId] = useState(null);
    const [tab, setTab] = useState('roster');

    useEffect(() => {
        if (!hospitalId && hospitals.data?.length) setHospitalId(hospitals.data[0].id);
    }, [hospitals.data, hospitalId]);

    return (
        <div className="mx-auto max-w-7xl px-4 py-6">
            {DEMO && (
                <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    <strong>โหมดเดโม:</strong> หน้านี้อยู่บน GitHub Pages จึงใช้ API จำลองใน browser (ข้อมูลตัวอย่าง รีเฟรชแล้วเริ่มใหม่)
                    ตรรกะเหมือน Laravel API ใน{' '}
                    <a className="underline" href="https://github.com/JitrudeeDongdee/waka-crud">repo นี้</a>
                </div>
            )}
            <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold">ระบบจัดคิวโรงพยาบาล</h1>
                    <p className="text-sm text-slate-500">จัดเวรแพทย์ + จัดคิวผู้ป่วย · Laravel + React</p>
                </div>
                <nav className="flex rounded-lg border border-slate-300 bg-white p-1 text-sm">
                    {[['roster', 'จัดเวรแพทย์'], ['queue', 'คิวผู้ป่วย']].map(([value, label]) => (
                        <button
                            key={value}
                            className={`rounded-md px-4 py-1.5 ${tab === value ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                            onClick={() => setTab(value)}
                        >
                            {label}
                        </button>
                    ))}
                </nav>
                <label className="flex items-center gap-2 text-sm">
                    โรงพยาบาล
                    <select
                        className="rounded-md border border-slate-300 bg-white px-3 py-2"
                        value={hospitalId ?? ''}
                        onChange={(e) => setHospitalId(Number(e.target.value))}
                    >
                        {hospitals.data?.map((h) => (
                            <option key={h.id} value={h.id}>{h.code} · {h.name}</option>
                        ))}
                    </select>
                </label>
            </header>

            {hospitals.isError && <p className="text-red-600">โหลดรายชื่อโรงพยาบาลไม่ได้: {hospitals.error.message}</p>}
            {hospitals.data?.length === 0 && (
                <p className="rounded-md bg-amber-50 p-4 text-amber-800">ยังไม่มีข้อมูล รัน <code>php artisan queue:seed-demo</code> ก่อน</p>
            )}

            {hospitalId && (
                // key = hospitalId: สลับโรงพยาบาลแล้ว state ในแต่ละแผงเริ่มใหม่ ไม่มีข้อมูลค้างข้ามโรงพยาบาล
                <div key={hospitalId}>
                    {tab === 'roster' ? (
                        <RosterPage hospitalId={hospitalId} />
                    ) : (
                        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
                            <TicketBoard hospitalId={hospitalId} />
                            <div className="space-y-6">
                                <StaffPanel hospitalId={hospitalId} />
                                <IssueTicketForm hospitalId={hospitalId} />
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
