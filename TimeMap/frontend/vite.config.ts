import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';

const isWSL = process.platform === 'linux'
  && fs.existsSync('/proc/version')
  && fs.readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft');

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api': 'http://localhost:3001',
    },
    ...(isWSL && {
      watch: {
        usePolling: true,
        interval: 100,
      },
    }),
  },
  base: process.env.VITE_BASE_PATH ?? '/',
});
