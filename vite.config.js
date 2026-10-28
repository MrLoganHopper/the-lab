import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: ['.trycloudflare.com', '.ngrok-free.app', '.ngrok.app'],
    proxy: {
      '/api': { target: 'http://127.0.0.1:3001', changeOrigin: false },
      '/auth': { target: 'http://127.0.0.1:3001', changeOrigin: false }
    }
  }
});
