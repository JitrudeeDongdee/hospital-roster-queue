// build หน้าเว็บ React แบบ static สำหรับ GitHub Pages (ใช้ API จำลอง) — npm run build:pages
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Pages ไม่มี server จึงเขียน version.json ไว้ข้างหน้าเว็บแทน endpoint /version
const version = {
    version: process.env.VITE_APP_VERSION || '0.0.0-dev',
    sha: process.env.VITE_APP_SHA || null,
    built_at: process.env.VITE_APP_BUILT_AT || null,
};

export default defineConfig({
    root: 'resources/pages',
    base: '/hospital-roster-queue/',
    plugins: [
        react(),
        tailwindcss(),
        { name: 'version-json', generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(version) }); } },
    ],
    define: {
        'import.meta.env.VITE_DEMO': JSON.stringify('true'),
        'import.meta.env.VITE_BASENAME': JSON.stringify('/hospital-roster-queue'),
    },
    build: { outDir: '../../dist-pages', emptyOutDir: true },
});
