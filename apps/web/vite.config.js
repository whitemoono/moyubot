import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const publicDir = fileURLToPath(new URL('./public/', import.meta.url));
export default defineConfig({
  base: './',
  server: { proxy: { '/api': 'http://localhost:8081' } },
  plugins: [{
    name: 'moyu-offline-shell',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = ['index.html', ...Object.keys(bundle).filter(name => name.startsWith('assets/')),
        ...readdirSync(publicDir).filter(name => /\.(png|svg|webp|webmanifest)$/.test(name))];
      const hash = createHash('sha256');
      for (const name of [...Object.keys(bundle)].sort()) {
        const item = bundle[name];
        hash.update(name).update(item.type === 'chunk' ? item.code : item.source);
      }
      for (const name of readdirSync(publicDir).sort()) hash.update(readFileSync(`${publicDir}/${name}`));
      const template = readFileSync(new URL('./src/sw.template.js', import.meta.url), 'utf8');
      hash.update(template);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: template
        .replace('__BUILD_ID__', hash.digest('hex').slice(0, 16))
        .replace('__PRECACHE_FILES__', JSON.stringify([...new Set(files)])) });
    },
  }],
});
