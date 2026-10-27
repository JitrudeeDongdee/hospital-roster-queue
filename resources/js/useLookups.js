import { useQuery } from '@tanstack/react-query';
import { api } from './api';

// ข้อมูลอ้างอิงแทบไม่เปลี่ยน — cache 10 นาที ไม่โหลดซ้ำทุกครั้งที่สลับหน้าจอ
const LONG = 10 * 60 * 1000;

export function useHospitals() {
    return useQuery({ queryKey: ['hospitals'], queryFn: () => api('/hospitals'), staleTime: LONG });
}

export function useSkills() {
    return useQuery({ queryKey: ['skills'], queryFn: () => api('/skills'), staleTime: LONG });
}

export function useDepartments(hospitalId) {
    return useQuery({
        queryKey: ['departments', hospitalId],
        queryFn: () => api(`/hospitals/${hospitalId}/departments`),
        enabled: !!hospitalId,
        staleTime: LONG,
    });
}

export function useStaff(hospitalId) {
    return useQuery({
        queryKey: ['staff', hospitalId],
        queryFn: () => api(`/hospitals/${hospitalId}/staff`),
        enabled: !!hospitalId,
        staleTime: LONG,
    });
}

export const byId = (list = []) => Object.fromEntries(list.map((item) => [item.id, item]));
