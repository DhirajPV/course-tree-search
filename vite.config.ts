import react from '@vitejs/plugin-react';
import type { ProxyOptions } from 'vite';
import { defineConfig } from 'vitest/config';

// The sandbox does not reliably send CORS headers, so the browser talks to
// /api on the Vite server and the request is forwarded with the prefix removed.
const proxy: Record<string, ProxyOptions> = {
  '/api': {
    target: 'https://coursetreesearch-service-sandbox.dev.tophat.com',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api/, ''),
  },
};

export default defineConfig({
  plugins: [react()],
  server: { proxy },
  preview: { proxy },
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
