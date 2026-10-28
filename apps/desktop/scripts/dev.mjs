import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { createServer } from 'vite';

const root = process.cwd();
const devUrl = 'http://localhost:5273';

async function main() {
  const server = await createServer({ root, configFile: path.join(root, 'vite.config.ts') });
  await server.listen();
  server.printUrls();

  const electronBinary = path.join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
  const child = spawn(electronBinary, ['.'], {
    cwd: root,
    env: { ...process.env, VITE_DEV_SERVER_URL: devUrl, ELECTRON_ENABLE_LOGGING: '1' },
    stdio: 'inherit',
  });

  const shutdown = async () => {
    child.kill();
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  child.on('exit', async (code) => {
    await server.close();
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});