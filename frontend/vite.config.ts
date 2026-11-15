import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8080' },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.ts'],
    css: false,
    // Console output plus an HTML report (test-report/index.html); view it with `npm run test:report`.
    reporters: ['default', 'html'],
    outputFile: { html: 'test-report/index.html' },
  },
});
