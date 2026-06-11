import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const DEFAULT_WEB_PORT = 6310;
const DEFAULT_DEV_BACKEND_PORT = 6300;
const devBackendTarget = `http://localhost:${portFromEnv(
  process.env.CUBBY_DEV_BACKEND_PORT,
  DEFAULT_DEV_BACKEND_PORT,
)}`;

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: portFromEnv(process.env.CUBBY_WEB_PORT, DEFAULT_WEB_PORT),
    proxy: {
      '/ws': { target: devBackendTarget, ws: true },
      '/api': { target: devBackendTarget },
      '/auth': { target: devBackendTarget },
      '/healthz': { target: devBackendTarget },
    },
  },
  build: {
    outDir: 'dist',
  },
});

function portFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) return fallback;
  return parsed;
}
