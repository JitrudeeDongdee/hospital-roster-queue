import { Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router';
import { DEMO } from './api';
import { useAuth } from './auth';
import TicketBoard from './components/TicketBoard';
import StaffPanel from './components/StaffPanel';
import IssueTicketForm from './components/IssueTicketForm';
import RosterPage from './components/RosterPage';
import LoginScreen from './components/LoginScreen';
import PermissionMatrix from './components/PermissionMatrix';

// เมนูหลัก: path + สิทธิ์ที่ต้องมี (ซ่อนเมนูที่ไม่มีสิทธิ์ และ RequirePermission กันการพิมพ์ URL เข้าตรง ๆ)
const SECTIONS = [
    { path: '/roster/table', match: '/roster', label: 'จัดเวรแพทย์', allowed: (can) => can('roster.view') },
    { path: '/queue', match: '/queue', label: 'คิวผู้ป่วย', allowed: (can) => can('queue.view') || can('ticket.issue') },
    { path: '/roles', match: '/roles', label: 'สิทธิ์ตามบทบาท', allowed: () => true },
];

export default function App() {
    return (
        <>
            {DEMO && (
                <div className="mx-auto mt-4 max-w-7xl px-4">
                    <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                        <strong>โหมดเดโม:</strong> หน้านี้อยู่บน GitHub Pages จึงใช้ API จำลองใน browser (ข้อมูลตัวอย่าง รีเฟรชแล้วเริ่มใหม่)
                        ตรรกะและสิทธิ์เหมือน Laravel API ใน{' '}
                        <a className="underline" href="https://github.com/JitrudeeDongdee/waka-crud">repo นี้</a>
                    </div>
                </div>
            )}
            <Routes>
                <Route path="/login" element={<LoginRoute />} />
                <Route element={<RequireAuth />}>
                    <Route element={<Layout />}>
                        <Route index element={<Home />} />
                        <Route path="roster" element={<Navigate to="/roster/table" replace />} />
                        <Route element={<RequirePermission allowed={(can) => can('roster.view')} />}>
                            <Route path="roster/table" element={<RosterRoute view="table" />} />
                            <Route path="roster/calendar" element={<RosterRoute view="calendar" />} />
                            <Route path="roster/doctors" element={<RosterRoute view="doctors" />} />
                            <Route path="roster/doctors/:staffId" element={<RosterRoute view="doctors" />} />
                        </Route>
                        <Route element={<RequirePermission allowed={(can) => can('queue.view') || can('ticket.issue')} />}>
                            <Route path="queue" element={<QueueRoute />} />
                        </Route>
                        <Route path="roles" element={<PermissionMatrix />} />
                        <Route path="*" element={<Message title="ไม่พบหน้านี้ (404)" text="ลิงก์อาจผิด หรือหน้านี้ถูกย้ายไปแล้ว" />} />
                    </Route>
                </Route>
            </Routes>
        </>
    );
}

function LoginRoute() {
    const { user, loading } = useAuth();
    const location = useLocation();
    if (loading) return <p className="p-8 text-slate-500">กำลังโหลด…</p>;
    // ล็อกอินแล้วกลับไปหน้าที่ตั้งใจจะเข้าตอนแรก
    if (user) return <Navigate to={location.state?.from ?? '/'} replace />;
    return <LoginScreen />;
}

function RequireAuth() {
    const { user, loading, signedOut } = useAuth();
    const location = useLocation();
    if (loading) return <p className="p-8 text-slate-500">กำลังโหลด…</p>;
    if (!user) return <Navigate to="/login" replace state={signedOut ? null : { from: location.pathname + location.search }} />;
    return <Outlet />;
}

function RequirePermission({ allowed }) {
    const { can } = useAuth();
    return allowed(can) ? <Outlet /> : <Message title="ไม่มีสิทธิ์เข้าหน้านี้ (403)" text="บทบาทของคุณไม่มีสิทธิ์ใช้งานส่วนนี้ ดูรายละเอียดได้ที่เมนูสิทธิ์ตามบทบาท" />;
}

function Home() {
    const { can } = useAuth();
    return <Navigate to={SECTIONS.find((s) => s.allowed(can)).path} replace />;
}

function Layout() {
    const { user, logout, can } = useAuth();
    const location = useLocation();

    return (
        <div className="mx-auto max-w-7xl px-4 py-6">
            <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold">ระบบจัดเวรแพทย์และจัดคิว</h1>
                    <p className="text-sm text-slate-500">{user.hospital.code} · {user.hospital.name}</p>
                </div>
                <nav className="flex rounded-lg border border-slate-300 bg-white p-1 text-sm" aria-label="เมนูหลัก">
                    {SECTIONS.filter((s) => s.allowed(can)).map((s) => (
                        <NavLink
                            key={s.path}
                            to={s.path}
                            className={`rounded-md px-4 py-1.5 ${location.pathname.startsWith(s.match) ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                        >
                            {s.label}
                        </NavLink>
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
            <Outlet />
        </div>
    );
}

function RosterRoute({ view }) {
    const { user } = useAuth();
    return <RosterPage hospitalId={user.hospital.id} view={view} />;
}

function QueueRoute() {
    const { user, can } = useAuth();
    const hospitalId = user.hospital.id;
    if (!can('queue.view')) return <div className="max-w-md"><IssueTicketForm hospitalId={hospitalId} /></div>;

    return (
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
            <TicketBoard hospitalId={hospitalId} />
            <div className="space-y-6">
                <StaffPanel hospitalId={hospitalId} />
                {can('ticket.issue') && <IssueTicketForm hospitalId={hospitalId} />}
            </div>
        </div>
    );
}

function Message({ title, text }) {
    return (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="mt-2 text-sm text-slate-500">{text}</p>
            <NavLink to="/" className="mt-4 inline-block rounded-md bg-slate-800 px-4 py-2 text-sm text-white">กลับหน้าแรก</NavLink>
        </div>
    );
}
