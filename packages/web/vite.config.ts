import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 6310,
    proxy: {
      '/ws': { target: 'http://localhost:6300', ws: true },
      '/api': { target: 'http://localhost:6300' },
      '/auth': { target: 'http://localhost:6300' },
      '/healthz': { target: 'http://localhost:6300' },
    },
  },
  build: {
    outDir: 'dist',
  },
});
