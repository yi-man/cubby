import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: 'http://localhost:3000', ws: true },
      '/api': { target: 'http://localhost:3000' },
      '/auth': { target: 'http://localhost:3000' },
      '/healthz': { target: 'http://localhost:3000' },
    },
  },
  build: {
    outDir: 'dist',
  },
});
