import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  base: process.env.VITE_BASE_PATH || './',
  plugins: [
    react(),
    {
      name: 'local-only-csp',
      transformIndexHtml(html) {
        const connections =
          command === 'serve' ? "'self' ws://127.0.0.1:* ws://localhost:*" : "'none'";
        const developmentPreamble = command === 'serve' ? " 'unsafe-inline'" : '';
        return html.replace(
          '<!-- CSP -->',
          `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'${developmentPreamble}; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src ${connections}; object-src 'none'; base-uri 'self'; form-action 'none'; frame-src 'none'">`,
        );
      },
    },
  ],
  worker: { format: 'es' },
  optimizeDeps: { include: ['h5wasm'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 1600 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 30000 },
}));
