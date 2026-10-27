import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { PRIORITY, STATUS, api, errorMessages, isoDate, queueNo } from '../api';
import { useAuth } from '../auth';
import { byId, useDepartments, useSkills, useStaff } from '../useLookups';

const ROW_HEIGHT = 44;

export const clock = (value) => (value ? new Date(value).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '—');
export const waitMinutes = (t) => (t.called_at ? Math.round((new Date(t.called_at) - new Date(t.created_at)) / 60000) : null);

export default function TicketBoard({ hospitalId, date }) {
    // ตัวกรองอยู่ใน URL (/queue/list?date=&status=waiting&dept=1) — แชร์ลิงก์/กด back ได้
    const [params, setParams] = useSearchParams();
    // ค่าเริ่มต้น '' = ทั้งหมด: คิวที่ยังไม่เสร็จ (กำลังตรวจ + รอเรียก) ก่อน แล้วคิวที่เสร็จแล้วต่อท้ายเป็นสีเทา
    const status = params.get('status') ?? '';
    const all = status === '';
    const departmentId = params.get('dept') ?? '';
    const isToday = date === isoDate(new Date());
    const setFilter = (key, value) => {
        const next = new URLSearchParams(params);
        next.set(key, value);
        setParams(next, { replace: true });
    };
    const departmentList = useDepartments(hospitalId).data ?? [];
    const departments = byId(departmentList);
    // ค้นหา/กรอง (อยู่ใน URL): q = เลขคิวที่ผู้ป่วยเห็น เช่น 1004 → แผนกที่ขึ้นต้นด้วย 1 + คิวที่ 4 · pri = ความเร่งด่วน · doc = แพทย์
    const q = params.get('q') ?? '';
    const priority = params.get('pri') ?? '';
    const doctor = params.get('doc') ?? '';
    const search = (() => {
        const n = Number(q);
        if (!/^\d+$/.test(q) || n < 1) return {};
        const dept = q.length >= 4 ? departmentList.find((d) => d.queue_prefix === Math.floor(n / 1000)) : null;
        return dept ? { department_id: String(dept.id), number: String(n % 1000) } : { number: String(n) };
    })();
    const filters = {
        ...(departmentId ? { department_id: departmentId } : {}),
        ...search,
        ...(priority ? { priority } : {}),
        ...(doctor ? { staff_id: doctor } : {}),
    };
    const setOrClear = (key, value) => {
        const next = new URLSearchParams(params);
        value ? next.set(key, value) : next.delete(key);
        setParams(next, { replace: true });
    };
    const skillList = useSkills().data ?? [];
    const skills = byId(skillList);
    const staff = byId(useStaff(hospitalId).data);
    // แพทย์ที่อยู่เวรตอนนี้ตามตารางเวร — บอกว่าคิวที่ยังรอจะไปถึงใคร
    const onDuty = useQuery({
        queryKey: ['on-duty', hospitalId],
        queryFn: () => api(`/hospitals/${hospitalId}/on-duty`),
        enabled: isToday,
        refetchInterval: 60_000,
    }).data ?? [];
    const doctorCell = (t) => {
        if (t.staff_id) return <span className="truncate">{staff[t.staff_id]?.name ?? '…'}</span>;
        if (t.status !== 'waiting' || !isToday) return <span className="text-slate-400">—</span>;
        const able = onDuty
            .filter((d) => d.department_id === t.department_id)
            .filter((d) => !t.required_skill_id || staff[d.staff_id]?.skills.some((k) => k.id === t.required_skill_id));
        if (!able.length) return <span className="truncate text-xs font-medium text-red-600" title="ตามตารางเวร ไม่มีแพทย์ในแผนกนี้ที่รับคิวนี้ได้ตอนนี้">ไม่มีแพทย์เวรที่รับได้</span>;
        const names = able.map((d) => staff[d.staff_id]?.name).filter(Boolean).join(', ');
        return <span className="truncate text-xs text-slate-500" title={`แพทย์เวรตอนนี้ที่รับคิวนี้ได้: ${names}`}>เวร: {names}</span>;
    };
    const queryClient = useQueryClient();
    // พยาบาลคัดกรองแก้ความเร่งด่วน/ความเชี่ยวชาญของคิววันนี้ที่ยังรอเรียกได้ในแถวเลย (เช่น บัตรที่เวชระเบียนออกให้)
    const canTriage = useAuth().can('ticket.triage') && isToday;
    const triage = useMutation({
        mutationFn: ({ id, ...body }) => api(`/hospitals/${hospitalId}/tickets/${id}/triage`, { method: 'PATCH', body }),
        onSettled: () => queryClient.invalidateQueries({ queryKey: ['tickets', hospitalId] }),
    });

    // ตัวกรองส่งไปให้ server กรอง — ไม่โหลดทุกคิวมากรองใน browser
    const page = (statusParam) => ({ pageParam, signal }) => {
        const params = new URLSearchParams({ date, status: statusParam, ...filters });
        if (pageParam) params.set('cursor', pageParam);
        return api(`/hospitals/${hospitalId}/tickets?${params}`, { signal });
    };
    const paging = {
        initialPageParam: null,
        getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined, // keyset cursor จาก Laravel
        refetchInterval: isToday ? 15_000 : false, // เฉพาะวันนี้ · เดโมใช้ polling; ระบบจริงใช้ WebSocket (Laravel Reverb)
    };
    // ตัวกรองส่งไปให้ server กรอง — ไม่โหลดทุกคิวมากรองใน browser
    const tickets = useInfiniteQuery({ queryKey: ['tickets', hospitalId, date, all ? 'active' : status, filters], queryFn: page(all ? 'active' : status), ...paging });
    // โหมดทั้งหมด: โหลดคิวที่เสร็จแล้วหลังโหลดคิวที่ยังไม่เสร็จครบ
    const done = useInfiniteQuery({
        queryKey: ['tickets', hospitalId, date, 'completed', filters],
        queryFn: page('completed'),
        enabled: all && tickets.isSuccess && !tickets.hasNextPage,
        ...paging,
    });

    // คิวถัดไปของแพทย์ที่ล็อกอิน (เรียงแบบเดียวกับตอนกดเรียก) — ติดป้าย "ถัดไป" ในรายการ
    const { user, can } = useAuth();
    const myQueue = useQuery({
        queryKey: ['my-queue', hospitalId, user.staff_id],
        queryFn: () => api(`/hospitals/${hospitalId}/staff/${user.staff_id}/my-queue`),
        enabled: isToday && !!user.staff_id && can('ticket.call'),
        refetchInterval: 15_000,
    });
    const nextId = myQueue.data?.waiting[0]?.id;

    const activeRows = tickets.data?.pages.flatMap((p) => p.data) ?? [];
    const doneRows = all ? done.data?.pages.flatMap((p) => p.data) ?? [] : [];
    const rows = doneRows.length ? [...activeRows, { divider: true }, ...doneRows] : activeRows;
    const hasMore = tickets.hasNextPage || (all && (!done.isSuccess || done.hasNextPage));
    const fetching = tickets.isFetchingNextPage || done.isFetchingNextPage || (all && done.isFetching && !done.data);
    const scrollRef = useRef(null);

    // วาดเฉพาะแถวที่อยู่บนจอ (+ overscan) แม้โหลดมาหลายพันแถว
    const virtualizer = useVirtualizer({
        count: hasMore ? rows.length + 1 : rows.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => ROW_HEIGHT,
        overscan: 8,
    });
    const items = virtualizer.getVirtualItems();

    // infinite scroll: เลื่อนถึงแถวสุดท้ายแล้วค่อยโหลดหน้าถัดไป
    const lastIndex = items.at(-1)?.index ?? 0;
    useEffect(() => {
        if (lastIndex < rows.length - 1 || fetching) return;
        if (tickets.hasNextPage) tickets.fetchNextPage();
        else if (all && done.hasNextPage) done.fetchNextPage();
    }, [lastIndex, rows.length, fetching, tickets.hasNextPage, tickets.fetchNextPage, all, done.hasNextPage, done.fetchNextPage]);

    return (
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4">
                <h2 className="mr-auto text-lg font-semibold">
                    {isToday ? 'คิววันนี้' : `คิววันที่ ${new Date(`${date}T00:00:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })}`}
                </h2>
                <input
                    className="w-32 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    type="search"
                    inputMode="numeric"
                    placeholder="ค้นหาเลขคิว"
                    value={q}
                    onChange={(e) => setOrClear('q', e.target.value.replace(/\D/g, ''))}
                    aria-label="ค้นหาเลขคิว"
                />
                <select className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={priority} onChange={(e) => setOrClear('pri', e.target.value)} aria-label="ความเร่งด่วน">
                    <option value="">ทุกความเร่งด่วน</option>
                    {Object.entries(PRIORITY).map(([value, p]) => <option key={value} value={value}>{p.label}</option>)}
                </select>
                <select className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={doctor} onChange={(e) => setOrClear('doc', e.target.value)} aria-label="แพทย์">
                    <option value="">ทุกแพทย์</option>
                    {Object.values(staff).filter((m) => !departmentId || m.department_id === Number(departmentId)).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                {(q || priority || doctor) && <button className="text-xs text-slate-500 underline" onClick={() => { const next = new URLSearchParams(params); ['q', 'pri', 'doc'].forEach((k) => next.delete(k)); setParams(next, { replace: true }); }}>ล้างตัวกรอง</button>}
                <select className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={status} onChange={(e) => setFilter('status', e.target.value)} aria-label="สถานะ">
                    <option value="">ทั้งหมด (เสร็จแล้วอยู่ล่าง)</option>
                    {Object.entries(STATUS).map(([value, s]) => <option key={value} value={value}>{s.label}</option>)}
                </select>
            </div>

            <div className="grid grid-cols-[56px_1fr_1fr_1fr_1.3fr_52px_52px_44px_84px] gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-500">
                <span>คิว</span><span>แผนก</span><span>ความเร่งด่วน</span><span>ความเชี่ยวชาญ</span><span>แพทย์</span><span>ออกบัตร</span><span>เรียก</span><span>รอ (นาที)</span><span>สถานะ</span>
            </div>

            <div ref={scrollRef} className="h-[520px] overflow-auto">
                {tickets.isPending && <p className="p-4 text-sm text-slate-500">กำลังโหลด…</p>}
                {tickets.isError && <p className="p-4 text-sm text-red-600">{tickets.error.message}</p>}
                {tickets.isSuccess && rows.length === 0 && !hasMore && <p className="p-4 text-sm text-slate-500">ไม่มีคิว</p>}

                <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
                    {items.map((item) => {
                        const t = rows[item.index];
                        if (t?.divider) {
                            return (
                                <div key={item.key} className="absolute left-0 flex w-full items-end bg-slate-100 px-4 pb-1.5 text-xs font-medium text-slate-500" style={{ height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }}>
                                    เสร็จแล้ว ({doneRows.length}{done.hasNextPage ? '+' : ''})
                                </div>
                            );
                        }
                        // กำลังตรวจ = ม่วงอ่อน · เสร็จแล้ว = เทา · คิวถัดไปของฉัน = ขอบเขียว
                        const tone = t?.status === 'called' ? 'bg-violet-50' : t?.status === 'completed' ? 'bg-slate-50 text-slate-400' : t?.id === nextId ? 'bg-emerald-50' : '';
                        return (
                            <div
                                key={item.key}
                                className={`absolute left-0 grid w-full grid-cols-[56px_1fr_1fr_1fr_1.3fr_52px_52px_44px_84px] items-center gap-2 border-b border-slate-100 px-4 text-sm ${tone}`}
                                style={{ height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }}
                            >
                                {t ? (
                                    <>
                                        <span className="flex flex-col font-mono font-semibold leading-tight">
                                            {queueNo(departments[t.department_id], t.number)}
                                            {t.id === nextId && <span className="font-sans text-[10px] font-medium text-emerald-700">ถัดไป</span>}
                                        </span>
                                        <span>{departments[t.department_id]?.name ?? '…'}</span>
                                        {canTriage && t.status === 'waiting' ? (
                                            <>
                                                <select
                                                    className={`w-full rounded border px-1 py-0.5 text-xs ${PRIORITY[t.priority].className} border-slate-300`}
                                                    value={t.priority}
                                                    disabled={triage.isPending}
                                                    onChange={(e) => triage.mutate({ id: t.id, priority: Number(e.target.value), required_skill_id: t.required_skill_id })}
                                                    aria-label={`ความเร่งด่วนของคิว ${t.number}`}
                                                >
                                                    {Object.entries(PRIORITY).map(([value, p]) => <option key={value} value={value}>{p.label}</option>)}
                                                </select>
                                                <select
                                                    className="w-full rounded border border-slate-300 px-1 py-0.5 text-xs text-slate-600"
                                                    value={t.required_skill_id ?? ''}
                                                    disabled={triage.isPending}
                                                    onChange={(e) => triage.mutate({ id: t.id, priority: t.priority, required_skill_id: e.target.value ? Number(e.target.value) : null })}
                                                    aria-label={`ความเชี่ยวชาญที่ต้องการของคิว ${t.number}`}
                                                >
                                                    <option value="">— ไม่ระบุ</option>
                                                    {skillList.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
                                                </select>
                                            </>
                                        ) : (
                                            <>
                                                <span><Badge {...PRIORITY[t.priority]} /></span>
                                                <span className="truncate text-slate-500">{t.required_skill_id ? skills[t.required_skill_id]?.name : '—'}</span>
                                            </>
                                        )}
                                        {doctorCell(t)}
                                        <span className="font-mono text-xs">{clock(t.created_at)}</span>
                                        <span className="font-mono text-xs">{clock(t.called_at)}</span>
                                        <span className="font-mono text-xs">{waitMinutes(t) ?? '—'}</span>
                                        <span><Badge {...STATUS[t.status]} /></span>
                                    </>
                                ) : (
                                    <span className="col-span-9 text-slate-400">กำลังโหลดหน้าถัดไป…</span>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {canTriage && <p className="border-t border-slate-200 bg-sky-50 px-4 py-2 text-xs text-sky-900">คัดกรอง: เปลี่ยนความเร่งด่วน/ความเชี่ยวชาญของคิวที่ยังรอเรียกได้ในแถวเลย แพทย์จะได้คิวตามค่าใหม่ทันที</p>}
            {triage.isError && <p className="border-t border-slate-200 bg-rose-50 px-4 py-2 text-xs text-rose-800">{errorMessages(triage.error).join(' ')}</p>}
            <p className="border-t border-slate-200 px-4 py-2 text-xs text-slate-500">
                โหลดแล้ว {(activeRows.length + doneRows.length).toLocaleString()} คิว ({(tickets.data?.pages.length ?? 0) + (done.data?.pages.length ?? 0)} หน้า) · แถวที่วาดใน DOM จริง {items.length}
                {(tickets.isFetching || done.isFetching) && ' · กำลังอัปเดต…'}
            </p>
        </section>
    );
}

function Badge({ label, className }) {
    return <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${className}`}>{label}</span>;
}
