import { createContext, useContext, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, getToken, setToken } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const queryClient = useQueryClient();
    // token อยู่ใน state ด้วย — เปลี่ยนผู้ใช้/หมดอายุแล้วหน้าเว็บ render ใหม่ทันที
    const [token, setTokenState] = useState(getToken);
    // ออกจากระบบเอง → หลังล็อกอินใหม่ไม่ต้องพากลับหน้าเดิม (ต่างจาก token หมดอายุ/เปิดลิงก์ตรง)
    const [signedOut, setSignedOut] = useState(false);
    const changeToken = (value) => { setToken(value); setTokenState(value); };
    const me = useQuery({ queryKey: ['me', token], queryFn: () => api('/me'), enabled: !!token, retry: false, staleTime: Infinity });

    useEffect(() => {
        const expire = () => { setToken(null); setTokenState(null); queryClient.clear(); };
        window.addEventListener('auth:expired', expire);
        return () => window.removeEventListener('auth:expired', expire);
    }, [queryClient]);

    const login = useMutation({
        mutationFn: (userId) => api('/demo-login', { method: 'POST', body: { user_id: userId } }),
        onSuccess: ({ token: newToken, user }) => {
            setSignedOut(false);
            queryClient.clear();
            queryClient.setQueryData(['me', newToken], user);
            changeToken(newToken);
        },
    });

    const logout = async () => {
        await api('/logout', { method: 'POST' }).catch(() => null);
        setSignedOut(true);
        changeToken(null);
        queryClient.clear();
    };

    const user = token ? me.data : null;
    const can = (permission) => !!user?.permissions.includes(permission);

    return <AuthContext.Provider value={{ user, loading: !!token && me.isLoading, login, logout, can, signedOut }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
