import { useState } from 'react';
import { DEMO } from './api';
import { useAuth } from './auth';
import TicketBoard from './components/TicketBoard';
import StaffPanel from './components/StaffPanel';
import IssueTicketForm from './components/IssueTicketForm';
import RosterPage from './components/RosterPage';
import LoginScreen from './components/LoginScreen';
import PermissionMatrix from './components/PermissionMatrix';

export default function App() {
    const { user, loading, logout, can } = useAuth();
    const [tab, setTab] = useState(null);

    const banner = DEMO && (
        <div className="mx-auto mt-4 max-w-7xl px-4">
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <strong>โหมดเดโม:</strong> หน้านี้อยู่บน GitHub Pages จึงใช้ API จำลองใน browser (ข้อมูลตัวอย่าง รีเฟรชแล้วเริ่มใหม่)
                ตรรกะและสิทธิ์เหมือน Laravel API ใน{' '}
                <a className="underline" href="https://github.com/JitrudeeDongdee/waka-crud">repo นี้</a>
            </div>
        </div>
    );

    if (loading) return <>{banner}<p className="p-8 text-slate-500">กำลังโหลด…</p></>;
    if (!user) return <>{banner}<LoginScreen /></>;

    const tabs = [
        can('roster.view') && ['roster', 'จัดเวรแพทย์'],
        (can('queue.view') || can('ticket.issue')) && ['queue', 'คิวผู้ป่วย'],
        ['roles', 'สิทธิ์ตามบทบาท'],
    ].filter(Boolean);
    const current = tabs.some(([v]) => v === tab) ? tab : tabs[0][0];
    const hospitalId = user.hospital.id;

    return (
        <>
            {banner}
            <div className="mx-auto max-w-7xl px-4 py-6">
                <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h1 className="text-2xl font-semibold">ระบบจัดเวรแพทย์และจัดคิว</h1>
                        <p className="text-sm text-slate-500">{user.hospital.code} · {user.hospital.name}</p>
                    </div>
                    <nav className="flex rounded-lg border border-slate-300 bg-white p-1 text-sm">
                        {tabs.map(([value, label]) => (
                            <button
                                key={value}
                                className={`rounded-md px-4 py-1.5 ${current === value ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                                onClick={() => setTab(value)}
                            >
                                {label}
                            </button>
                        ))}
                    </nav>
                    <div className="flex items-center gap-3 text-sm">
                        <span>
                            {user.name}
                            <span className="ml-2 rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-800">{user.role_label}</span>
                        </span>
                        <button className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100" onClick={logout}>เปลี่ยนผู้ใช้</button>
                    </div>
                </header>

                {current === 'roster' && <RosterPage hospitalId={hospitalId} />}
                {current === 'queue' && (
                    can('queue.view') ? (
                        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
                            <TicketBoard hospitalId={hospitalId} />
                            <div className="space-y-6">
                                <StaffPanel hospitalId={hospitalId} />
                                {can('ticket.issue') && <IssueTicketForm hospitalId={hospitalId} />}
                            </div>
                        </div>
                    ) : (
                        <div className="max-w-md"><IssueTicketForm hospitalId={hospitalId} /></div>
                    )
                )}
                {current === 'roles' && <PermissionMatrix />}
            </div>
        </>
    );
}
