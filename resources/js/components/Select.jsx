import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const MAX_LIST = 240; // ความสูงสูงสุดของรายการ (px) — ยาวกว่านี้เลื่อนในกล่อง

// dropdown ที่ค้นหาได้ ใช้แทน <select> ทั้งระบบ
// options: [{ value, label }] · value เทียบเป็น string · onChange ได้ค่า string ('' = ไม่ได้เลือก)
// รายการแสดงผ่าน portal ด้วย position: fixed — ไม่โดนตารางที่ overflow ตัด และเปิดขึ้นด้านบนเมื่อด้านล่างไม่พอ
export default function Select({ value, onChange, options, placeholder = 'เลือก…', className = '', ariaLabel, disabled = false, required = false, title }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(0);
    const [pos, setPos] = useState(null);
    const buttonRef = useRef(null);
    const popRef = useRef(null);
    const listRef = useRef(null);
    const listId = useId();

    const current = options.find((o) => String(o.value) === String(value ?? ''));
    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return q ? options.filter((o) => String(o.label).toLowerCase().includes(q)) : options;
    }, [options, query]);

    const place = () => {
        const r = buttonRef.current?.getBoundingClientRect();
        if (!r) return;
        const below = window.innerHeight - r.bottom;
        const up = below < MAX_LIST + 56 && r.top > below;
        const width = Math.max(r.width, 200);
        // ไม่ให้ล้นขอบขวาของจอ (ปุ่มที่อยู่ชิดขวา เช่น ตัวกรองบนหัวตาราง)
        const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
        setPos({ left, width, top: up ? undefined : r.bottom + 4, bottom: up ? window.innerHeight - r.top + 4 : undefined });
    };

    useLayoutEffect(() => {
        if (!open) return;
        place();
        const onMove = () => place();
        window.addEventListener('resize', onMove);
        window.addEventListener('scroll', onMove, true); // ตามปุ่มเมื่อหน้า/ตารางเลื่อน
        return () => {
            window.removeEventListener('resize', onMove);
            window.removeEventListener('scroll', onMove, true);
        };
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const onDown = (e) => {
            if (!buttonRef.current?.contains(e.target) && !popRef.current?.contains(e.target)) setOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [open]);

    useEffect(() => {
        listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
    }, [active]);

    const openList = () => {
        if (disabled) return;
        setQuery('');
        setActive(Math.max(0, options.findIndex((o) => String(o.value) === String(value ?? ''))));
        setOpen(true);
    };
    const choose = (option) => {
        setOpen(false);
        buttonRef.current?.focus();
        if (String(option.value) !== String(value ?? '')) onChange(String(option.value));
    };
    const onKey = (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(filtered.length - 1, i + 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
        else if (e.key === 'Enter') { e.preventDefault(); if (filtered[active]) choose(filtered[active]); }
        else if (e.key === 'Escape' || e.key === 'Tab') { setOpen(false); buttonRef.current?.focus(); }
    };

    return (
        <span className={`relative inline-block ${className}`}>
            <button
                ref={buttonRef}
                type="button"
                title={title}
                disabled={disabled}
                aria-label={ariaLabel}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={open ? listId : undefined}
                onClick={() => (open ? setOpen(false) : openList())}
                onKeyDown={(e) => { if (!open && ['ArrowDown', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openList(); } }}
                className="flex w-full items-center justify-between gap-2 rounded-[inherit] bg-transparent text-left disabled:cursor-not-allowed disabled:opacity-50"
            >
                <span className={`truncate ${current ? '' : 'text-slate-400'}`}>{current ? current.label : placeholder}</span>
                <span aria-hidden className="shrink-0 text-slate-400">▾</span>
            </button>
            {/* ให้ฟอร์มยังบังคับเลือกได้แบบ required ของ <select> */}
            {required && <input tabIndex={-1} aria-hidden className="pointer-events-none absolute inset-0 opacity-0" required value={current ? String(current.value) : ''} onChange={() => {}} />}

            {open && pos && createPortal(
                <div
                    ref={popRef}
                    className="fixed z-50 rounded-md border border-slate-300 bg-white text-sm text-slate-800 shadow-lg"
                    style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width }}
                >
                    <input
                        autoFocus
                        className="w-full border-b border-slate-200 px-3 py-2 text-sm outline-none"
                        placeholder="ค้นหา…"
                        value={query}
                        onChange={(e) => { setQuery(e.target.value); setActive(0); }}
                        onKeyDown={onKey}
                        aria-label={`ค้นหา${ariaLabel ? ` ${ariaLabel}` : ''}`}
                        aria-controls={listId}
                    />
                    <ul ref={listRef} id={listId} role="listbox" className="overflow-y-auto py-1" style={{ maxHeight: MAX_LIST }}>
                        {filtered.map((o, i) => (
                            <li
                                key={o.value}
                                data-index={i}
                                role="option"
                                aria-selected={String(o.value) === String(value ?? '')}
                                onMouseEnter={() => setActive(i)}
                                onMouseDown={(e) => { e.preventDefault(); choose(o); }}
                                className={`cursor-pointer px-3 py-1.5 ${i === active ? 'bg-indigo-50' : ''} ${String(o.value) === String(value ?? '') ? 'font-medium text-indigo-700' : ''}`}
                            >
                                {o.label}
                            </li>
                        ))}
                        {filtered.length === 0 && <li className="px-3 py-2 text-slate-400">ไม่พบ</li>}
                    </ul>
                </div>,
                document.body,
            )}
        </span>
    );
}
