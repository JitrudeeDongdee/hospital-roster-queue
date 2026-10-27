import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { useAuth } from '../auth';

// ตารางบทบาท × สิทธิ์ จาก /api/roles (แหล่งเดียวกับที่ backend ใช้ตรวจ)
export default function PermissionMatrix() {
    const { user } = useAuth();
    const roles = useQuery({ queryKey: ['roles'], queryFn: () => api('/roles'), staleTime: Infinity });
    if (!roles.data) return null;

    return (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold">สิทธิ์ตามบทบาท</h2>
            <p className="mb-3 text-sm text-slate-500">
                หน้าเว็บซ่อนปุ่มตามสิทธิ์เพื่อความสะดวก แต่ backend ตรวจสิทธิ์ทุก request (Laravel Gate) และจำกัดให้เห็นเฉพาะโรงพยาบาลของตัวเอง
            </p>
            <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                    <thead>
                        <tr className="border-b border-slate-200 text-left">
                            <th className="p-2 font-medium">สิทธิ์</th>
                            {roles.data.roles.map((r) => (
                                <th key={r.value} className={`p-2 text-center font-medium ${r.value === user.role ? 'bg-indigo-50 text-indigo-800' : ''}`}>{r.label}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {Object.entries(roles.data.permissions).map(([key, label]) => (
                            <tr key={key} className="border-b border-slate-100">
                                <td className="p-2">{label} <code className="ml-1 text-xs text-slate-400">{key}</code></td>
                                {roles.data.roles.map((r) => (
                                    <td key={r.value} className={`p-2 text-center ${r.value === user.role ? 'bg-indigo-50' : ''}`}>
                                        {r.permissions.includes(key) ? '✓' : <span className="text-slate-300">—</span>}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}
