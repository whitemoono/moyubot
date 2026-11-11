import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob: moyu-asset:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  // 云电脑实时桌面通过 iframe 嵌入：InstaBox 用 dashboard.instabox.sh，
  // E2B 用 https://<port>-<sandboxId>.e2b.app（自建则是自己的沙箱域名）。
  "frame-src https://dashboard.instabox.sh https://*.e2b.app https://*.e2b.dev https:",
  "font-src 'self' data:",
].join('; ');

export default defineConfig(({ mode }) => ({
  // Share renderer-safe validation without bundling the Node core runtime.
  resolve: {
    alias: [
      { find: '@moyu/core/dist/generation', replacement: fileURLToPath(new URL('../../packages/core/src/generation.ts', import.meta.url)) },
      // The community avatar engine is only for local development; see docs/ASSETS.md.
      ...(mode === 'distribution' ? [{
        find: /^\.\.\/assets\/grok\/grok-engine$/,
        replacement: fileURLToPath(new URL('./src/assets/grok/grok-engine-distribution.ts', import.meta.url)),
      }] : []),
    ],
  },
  plugins: [
    react(),
    {
      name: 'moyu-csp',
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
}));
