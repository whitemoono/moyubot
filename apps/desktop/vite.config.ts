import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob: mesh-asset:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "font-src 'self' data:",
].join('; ');

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'mesh-csp',
      transformIndexHtml(html, ctx) {
        if (ctx.server) return html;
        return html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
      },
    },
  ],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome136',
  },
  server: {
    port: 5273,
    strictPort: true,
  },
});