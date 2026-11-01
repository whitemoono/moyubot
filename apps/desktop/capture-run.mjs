import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const logPath = path.join(root, '..', '..', '_dev-capture.log');
fs.writeFileSync(logPath, '');
const out = fs.openSync(logPath, 'a');
const log = (msg) => fs.writeSync(out, `${new Date().toISOString()} ${msg}\n`);

const { createServer } = await import('vite');
const server = await createServer({ root, configFile: path.join(root, 'vite.config.ts') });
await server.listen();
log('[capture] vite up');

const electronBinary = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const env = {
  ...process.env,
  VITE_DEV_SERVER_URL: 'http://localhost:5273',
  ELECTRON_ENABLE_LOGGING: '1',
  MOYU_DATA_DIR: process.env.MOYU_DATA_DIR ?? path.join(process.env.APPDATA ?? '', '@moyu', 'desktop', 'moyu'),
};
delete env.ELECTRON_RUN_AS_NODE;
log(`[capture] MOYU_DATA_DIR=${env.MOYU_DATA_DIR}`);

const child = spawn(electronBinary, ['--no-sandbox', `--user-data-dir=${path.resolve(root, '..', '..', '.moyu-dev-chromium')}`, root], {
  cwd: root, env, stdio: ['ignore', out, out],
});
log(`[capture] electron pid=${child.pid}`);
child.on('exit', (code) => log(`[capture] electron exited ${code}`));
