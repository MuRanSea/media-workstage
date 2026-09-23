import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backendTarget = process.env.BACKEND_URL || 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/assets': {
        target: backendTarget,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: '../cmd/server/dist',
    emptyOutDir: true,
    assetsDir: 'static',
  },
});
