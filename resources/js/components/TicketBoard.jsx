import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { api, PRIORITY, STATUS } from '../api';
import { byId, useDepartments, useSkills } from '../useLookups';

const ROW_HEIGHT = 44;

export default function TicketBoard({ hospitalId }) {
    // ตัวกรองอยู่ใน URL (/queue?status=waiting&dept=1) — แชร์ลิงก์/กด back ได้
    const [params, setParams] = useSearchParams();
    const status = params.has('status') ? params.get('status') : 'waiting';
    const departmentId = params.get('dept') ?? '';
    const setFilter = (key, value) => {
        const next = new URLSearchParams(params);
        next.set(key, value);
        setParams(next, { replace: true });
    };
    const departments = byId(useDepartments(hospitalId).data);
    const skills = byId(useSkills().data);

    // ตัวกรองส่งไปให้ server กรอง — ไม่โหลดทุกคิวมากรองใน browser
    const tickets = useInfiniteQuery({
        queryKey: ['tickets', hospitalId, status, departmentId],
        queryFn: ({ pageParam, signal }) => {
            const params = new URLSearchParams();
            if (status) params.set('status', status);
            if (departmentId) params.set('department_id', departmentId);
            if (pageParam) params.set('cursor', pageParam);
            return api(`/hospitals/${hospitalId}/tickets?${params}`, { signal });
        },
        initialPageParam: null,
        getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined, // keyset cursor จาก Laravel
        refetchInterval: 15_000, // เดโมใช้ polling; ระบบจริงใช้ WebSocket (Laravel Reverb) ส่งเฉพาะคิวที่เปลี่ยน
    });

    const rows = tickets.data?.pages.flatMap((page) => page.data) ?? [];
    const scrollRef = useRef(null);

    // วาดเฉพาะแถวที่อยู่บนจอ (+ overscan) แม้โหลดมาหลายพันแถว
    const virtualizer = useVirtualizer({
        count: tickets.hasNextPage ? rows.length + 1 : rows.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => ROW_HEIGHT,
        overscan: 8,
    });
    const items = virtualizer.getVirtualItems();

    // infinite scroll: เลื่อนถึงแถวสุดท้ายแล้วค่อยโหลดหน้าถัดไป
    const lastIndex = items.at(-1)?.index ?? 0;
    useEffect(() => {
        if (lastIndex >= rows.length - 1 && tickets.hasNextPage && !tickets.isFetchingNextPage) {
            tickets.fetchNextPage();
        }
    }, [lastIndex, rows.length, tickets.hasNextPage, tickets.isFetchingNextPage, tickets.fetchNextPage]);

    return (
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4">
                <h2 className="mr-auto text-lg font-semibold">คิววันนี้</h2>
                <select className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={status} onChange={(e) => setFilter('status', e.target.value)}>
                    <option value="">ทุกสถานะ</option>
                    {Object.entries(STATUS).map(([value, s]) => <option key={value} value={value}>{s.label}</option>)}
                </select>
                <select className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={departmentId} onChange={(e) => setFilter('dept', e.target.value)}>
                    <option value="">ทุกแผนก</option>
                    {Object.values(departments).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
            </div>

            <div className="grid grid-cols-[70px_1fr_1fr_1fr_110px] gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-500">
                <span>คิว</span><span>แผนก</span><span>ความเร่งด่วน</span><span>ต้องการความเชี่ยวชาญ</span><span>สถานะ</span>
            </div>

            <div ref={scrollRef} className="h-[520px] overflow-auto">
                {tickets.isPending && <p className="p-4 text-sm text-slate-500">กำลังโหลด…</p>}
                {tickets.isError && <p className="p-4 text-sm text-red-600">{tickets.error.message}</p>}
                {tickets.isSuccess && rows.length === 0 && <p className="p-4 text-sm text-slate-500">ไม่มีคิว</p>}

                <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
                    {items.map((item) => {
                        const t = rows[item.index];
                        return (
                            <div
                                key={item.key}
                                className="absolute left-0 grid w-full grid-cols-[70px_1fr_1fr_1fr_110px] items-center gap-2 border-b border-slate-100 px-4 text-sm"
                                style={{ height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }}
                            >
                                {t ? (
                                    <>
                                        <span className="font-mono font-semibold">{departments[t.department_id]?.code}-{String(t.number).padStart(3, '0')}</span>
                                        <span>{departments[t.department_id]?.name ?? '…'}</span>
                                        <span><Badge {...PRIORITY[t.priority]} /></span>
                                        <span className="text-slate-500">{t.required_skill_id ? skills[t.required_skill_id]?.name : '—'}</span>
                                        <span><Badge {...STATUS[t.status]} /></span>
                                    </>
                                ) : (
                                    <span className="col-span-5 text-slate-400">กำลังโหลดหน้าถัดไป…</span>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            <p className="border-t border-slate-200 px-4 py-2 text-xs text-slate-500">
                โหลดแล้ว {rows.length.toLocaleString()} คิว ({tickets.data?.pages.length ?? 0} หน้า) · แถวที่วาดใน DOM จริง {items.length}
                {tickets.isFetching && ' · กำลังอัปเดต…'}
            </p>
        </section>
    );
}

function Badge({ label, className }) {
    return <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${className}`}>{label}</span>;
}
