// build หน้าเว็บ React แบบ static สำหรับ GitHub Pages (ใช้ API จำลอง) — npm run build:pages
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
    root: 'resources/pages',
    base: '/waka-crud/',
    plugins: [react(), tailwindcss()],
    define: { 'import.meta.env.VITE_DEMO': JSON.stringify('true') },
    build: { outDir: '../../dist-pages', emptyOutDir: true },
});
