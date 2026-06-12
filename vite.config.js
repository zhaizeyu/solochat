import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: ['chat.animaseed.com', '167.86.104.36'],
    proxy: {
      '/api': 'http://localhost:3101',
      '/uploads': 'http://localhost:3101'
    }
  }
});
