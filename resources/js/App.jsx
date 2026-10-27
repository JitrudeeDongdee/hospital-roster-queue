import { Navigate, NavLink, Outlet, Route, Routes, useLocation, useParams } from 'react-router';
import { DEMO } from './api';
import { useAuth } from './auth';
import IssueTicketForm from './components/IssueTicketForm';
import RosterPage from './components/RosterPage';
import LoginScreen from './components/LoginScreen';
import PermissionMatrix from './components/PermissionMatrix';
import LeavePage, { usePendingLeaveCount } from './components/LeavePage';
import QueuePage from './components/QueuePage';
import ShiftRequestsPage, { useShiftRequestCount } from './components/ShiftRequestsPage';
import PreferencesPage from './components/PreferencesPage';
import StaffPage from './components/StaffPage';
import AppointmentsPage from './components/AppointmentsPage';

// เมนูหลัก: path + สิทธิ์ที่ต้องมี (ซ่อนเมนูที่ไม่มีสิทธิ์ และ RequirePermission กันการพิมพ์ URL เข้าตรง ๆ)
const SECTIONS = [
    { path: '/roster/table', match: '/roster', label: 'จัดเวรแพทย์', allowed: (can) => can('roster.view') },
    { path: '/staff', match: '/staff', label: 'แพทย์', allowed: (can) => can('staff.manage') },
    { path: '/requests', match: '/requests', label: 'ร้องขอ', allowed: (can) => canLeave(can) || canShiftRequest(can) },
    { path: '/preferences', match: '/preferences', label: 'เวรที่อยากลง', allowed: (can) => can('shift.request.own') },
    { path: '/queue/list', match: '/queue', label: 'คิวผู้ป่วย', allowed: (can) => can('queue.view') || can('ticket.issue') },
    { path: '/appointments', match: '/appointments', label: 'นัดหมาย', allowed: (can) => can('appointment.manage') },
    { path: '/roles', match: '/roles', label: 'สิทธิ์ตามบทบาท', allowed: () => true },
];

const canLeave = (can) => can('leave.approve') || can('leave.manage.own');
const canShiftRequest = (can) => can('shift.request.own') || can('shift.request.resolve');
// หน้า "ร้องขอ": เลือกว่าจะขอลา หรือขอย้าย/แลกเวร
const REQUEST_KINDS = [
    { kind: 'leave', label: 'ขอลา', allowed: canLeave },
    { kind: 'shifts', label: 'ขอย้าย/แลกเวร', allowed: canShiftRequest },
];

export default function App() {
    return (
        <>
            {DEMO && (
                <div className="mx-auto mt-4 max-w-[1440px] px-4">
                    <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                        <strong>โหมดเดโม:</strong> หน้านี้อยู่บน GitHub Pages จึงใช้ API จำลองใน browser (ข้อมูลตัวอย่าง รีเฟรชแล้วเริ่มใหม่)
                        ตรรกะและสิทธิ์เหมือน Laravel API ใน{' '}
                        <a className="underline" href="https://github.com/JitrudeeDongdee/hospital-roster-queue">repo นี้</a>
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
                            <Route path="roster/doctors" element={<LegacyDoctorCalendar />} />
                            <Route path="roster/doctors/:staffId" element={<LegacyDoctorCalendar />} />
                        </Route>
                        <Route element={<RequirePermission allowed={(can) => can('queue.view') || can('ticket.issue')} />}>
                            <Route path="queue" element={<QueueRoute />} />
                            <Route path="queue/:view" element={<QueueRoute />} />
                        </Route>
                        <Route element={<RequirePermission allowed={(can) => canLeave(can) || canShiftRequest(can)} />}>
                            <Route path="requests" element={<RequestsRoute />} />
                            <Route path="requests/:kind" element={<RequestsRoute />} />
                        </Route>
                        {/* ลิงก์เก่า */}
                        <Route path="leave" element={<Navigate to={{ pathname: '/requests/leave', search: location.search }} replace />} />
                        <Route path="shifts" element={<Navigate to="/requests/shifts" replace />} />
                        <Route element={<RequirePermission allowed={(can) => can('shift.request.own')} />}>
                            <Route path="preferences" element={<PreferencesRoute />} />
                        </Route>
                        <Route element={<RequirePermission allowed={(can) => can('appointment.manage')} />}>
                            <Route path="appointments" element={<AppointmentsRoute />} />
                        </Route>
                        <Route element={<RequirePermission allowed={(can) => can('staff.manage')} />}>
                            <Route path="staff" element={<StaffRoute />} />
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
    const pending = usePendingLeaveCount(user.hospital.id, can('leave.approve')).data ?? 0;
    const shiftRequests = useShiftRequestCount(user.hospital.id, can('shift.request.own') || can('shift.request.resolve'));
    const badges = { '/requests': [pending + shiftRequests, `รอดำเนินการ ${pending + shiftRequests} รายการ`] };

    return (
        <div className="mx-auto max-w-[1440px] px-4 py-6 lg:flex lg:items-start lg:gap-6">
            {/* จอกว้าง: เมนูเป็นแถบด้านข้าง · มือถือ: แถบด้านบนเลื่อนซ้ายขวาได้ */}
            <aside className="mb-6 lg:sticky lg:top-6 lg:mb-0 lg:w-56 lg:shrink-0">
                <div className="mb-4">
                    <h1 className="text-xl font-semibold leading-tight">ระบบจัดเวรแพทย์และจัดคิว</h1>
                    <p className="text-sm text-slate-500">{user.hospital.code} · {user.hospital.name}</p>
                </div>
                <nav className="-mx-1 flex gap-1 overflow-x-auto rounded-lg border border-slate-300 bg-white p-1 text-sm lg:mx-0 lg:flex-col" aria-label="เมนูหลัก">
                    {SECTIONS.filter((s) => s.allowed(can)).map((s) => (
                        <NavLink
                            key={s.path}
                            to={s.path}
                            className={`flex shrink-0 items-center justify-between gap-2 whitespace-nowrap rounded-md px-3 py-2 ${location.pathname.startsWith(s.match) ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                        >
                            {s.label}
                            {badges[s.path]?.[0] > 0 && (
                                <span className="rounded-full bg-rose-600 px-1.5 text-xs text-white" aria-label={badges[s.path][1]}>{badges[s.path][0]}</span>
                            )}
                        </NavLink>
                    ))}
                </nav>
                <div className="mt-4 flex flex-wrap items-center gap-2 text-sm lg:flex-col lg:items-stretch">
                    <span>
                        {user.name}
                        <span className="ml-2 rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-800">{user.role_label}</span>
                    </span>
                    <button className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100" onClick={logout}>เปลี่ยนผู้ใช้</button>
                </div>
                <p className="mt-4 hidden text-xs text-slate-400 lg:block">
                    v{import.meta.env.VITE_APP_VERSION || '0.0.0-dev'}
                    {import.meta.env.VITE_APP_SHA && <> · {import.meta.env.VITE_APP_SHA.slice(0, 7)}</>}
                </p>
            </aside>
            <main className="min-w-0 flex-1">
                <Outlet />
                <footer className="mt-8 text-center text-xs text-slate-400 lg:hidden">
                    v{import.meta.env.VITE_APP_VERSION || '0.0.0-dev'}
                    {import.meta.env.VITE_APP_SHA && <> · {import.meta.env.VITE_APP_SHA.slice(0, 7)}</>}
                </footer>
            </main>
        </div>
    );
}

function RosterRoute({ view }) {
    const { user } = useAuth();
    return <RosterPage hospitalId={user.hospital.id} view={view} />;
}

// ลิงก์เก่าของปฏิทินรายแพทย์ (/roster/doctors/3) → ปฏิทินเดียวที่กรองแพทย์คนนั้น
function LegacyDoctorCalendar() {
    const { staffId } = useParams();
    const location = useLocation();
    const params = new URLSearchParams(location.search);
    if (staffId) params.set('doctors', staffId);
    return <Navigate to={{ pathname: '/roster/calendar', search: `?${params}` }} replace />;
}

function AppointmentsRoute() {
    const { user } = useAuth();
    return <AppointmentsPage hospitalId={user.hospital.id} />;
}

function StaffRoute() {
    const { user } = useAuth();
    return <StaffPage hospitalId={user.hospital.id} />;
}

function RequestsRoute() {
    const { user, can } = useAuth();
    const { kind } = useParams();
    const location = useLocation();
    const hospitalId = user.hospital.id;
    const kinds = REQUEST_KINDS.filter((k) => k.allowed(can));
    const pending = usePendingLeaveCount(hospitalId, can('leave.approve')).data ?? 0;
    const shiftRequests = useShiftRequestCount(hospitalId, canShiftRequest(can));
    const counts = { leave: pending, shifts: shiftRequests };
    if (!kinds.some((k) => k.kind === kind)) return <Navigate to={{ pathname: `/requests/${kinds[0].kind}`, search: location.search }} replace />;

    return (
        <>
            <nav className="mb-4 inline-flex rounded-lg border border-slate-300 bg-white p-1 text-sm" aria-label="ประเภทคำร้อง">
                {kinds.map((k) => (
                    <NavLink key={k.kind} to={`/requests/${k.kind}`} className={({ isActive }) => `rounded-md px-4 py-1.5 ${isActive ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                        {k.label}
                        {counts[k.kind] > 0 && <span className="ml-1.5 rounded-full bg-rose-600 px-1.5 text-xs text-white">{counts[k.kind]}</span>}
                    </NavLink>
                ))}
            </nav>
            {kind === 'leave' ? <LeavePage hospitalId={hospitalId} /> : <ShiftRequestsPage hospitalId={hospitalId} />}
        </>
    );
}

function QueueRoute() {
    const { user, can } = useAuth();
    const { view } = useParams();
    const hospitalId = user.hospital.id;
    // เวชระเบียนออกบัตรได้อย่างเดียว ไม่เห็นรายการคิว
    if (!can('queue.view')) return <div className="max-w-md"><IssueTicketForm hospitalId={hospitalId} /></div>;
    if (!['list', 'month', 'week', 'day'].includes(view)) return <Navigate to={{ pathname: '/queue/list', search: location.search }} replace />;
    return <QueuePage hospitalId={hospitalId} view={view} />;
}


function PreferencesRoute() {
    const { user } = useAuth();
    if (!user.staff_id) return <Message title="บัญชีนี้ไม่ได้ผูกกับแพทย์" text="เฉพาะแพทย์ที่ส่งเวรที่อยากลงได้" />;
    return <PreferencesPage hospitalId={user.hospital.id} staffId={user.staff_id} />;
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
