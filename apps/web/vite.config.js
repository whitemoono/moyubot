import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: './',
  server: { proxy: { '/api': 'http://localhost:8081' } },
});
