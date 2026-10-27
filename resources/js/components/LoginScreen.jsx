import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { useAuth } from '../auth';

const ROLE_ORDER = ['admin', 'doctor', 'nurse', 'registration'];

export default function LoginScreen() {
    const { login } = useAuth();
    const users = useQuery({ queryKey: ['demo-users'], queryFn: () => api('/demo-users') });
    const roles = useQuery({ queryKey: ['roles'], queryFn: () => api('/roles') });

    return (
        <div className="mx-auto max-w-4xl px-4 py-10">
            <h1 className="text-2xl font-semibold">ระบบจัดเวรแพทย์และจัดคิว</h1>
            <p className="mt-1 text-slate-500">เลือกผู้ใช้ทดลองเพื่อดูว่าแต่ละบทบาทเห็นและทำอะไรได้บ้าง (Demo Hospital 1)</p>

            {users.isError && <p className="mt-6 text-red-600">โหลดผู้ใช้ทดลองไม่ได้: {users.error.message} (ต้องตั้ง DEMO_LOGIN=true)</p>}

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
                {ROLE_ORDER.map((role) => {
                    const group = users.data?.filter((u) => u.role === role) ?? [];
                    const info = roles.data?.roles.find((r) => r.value === role);
                    if (!group.length) return null;
                    return (
                        <section key={role} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                            <h2 className="font-semibold">{info?.label ?? role}</h2>
                            <ul className="mt-1 mb-3 text-xs text-slate-500">
                                {info?.permissions.map((p) => <li key={p}>• {roles.data.permissions[p]}</li>)}
                            </ul>
                            <div className="flex flex-wrap gap-2">
                                {group.map((u) => (
                                    <button
                                        key={u.id}
                                        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:border-indigo-500 hover:bg-indigo-50 disabled:opacity-40"
                                        disabled={login.isPending}
                                        onClick={() => login.mutate(u.id)}
                                    >
                                        {u.name}
                                    </button>
                                ))}
                            </div>
                        </section>
                    );
                })}
            </div>
            {login.isError && <p className="mt-4 text-red-600">{login.error.message}</p>}
        </div>
    );
}
