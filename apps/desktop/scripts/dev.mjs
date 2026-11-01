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
  // Some shells/tools export ELECTRON_RUN_AS_NODE=1, which makes electron.exe run
  // as a plain Node process (Chromium flags get rejected, app.isPackaged crashes).
  const env = { ...process.env, VITE_DEV_SERVER_URL: devUrl, ELECTRON_ENABLE_LOGGING: '1' };
  delete env.ELECTRON_RUN_AS_NODE;

  if (process.platform !== 'win32') {
    const child = spawn(electronBinary, ['.'], { cwd: root, env, stdio: 'inherit' });
    const shutdown = async () => { child.kill(); await server.close(); process.exit(0); };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    child.on('exit', async (code) => { await server.close(); process.exit(code ?? 0); });
    return;
  }

  // Windows: a GUI-subsystem exe spawned directly from an automated console
  // often exits instantly with code 1 and no output (especially under sandboxed
  // runners). Launching through PowerShell's Start-Process (ShellExecute) is
  // reliable, so do that and keep dev alive by polling the PID.
  const electronArgs = ['--no-sandbox'];
  // A stale/protected Electron instance can hold the default userData lock
  // (%APPDATA%\@moyu\desktop) -> "Lock file can not be created! Error code: 5".
  // Use a workspace-local Chromium profile; pin the app data dir back to the
  // real profile so existing conversations/memories keep loading.
  // NOTE: Chromium's command line only binds values with '=' — a space-separated
  // value is parsed as the app path ("Unable to find Electron app at ...").
  const devProfile = path.resolve(root, '..', '..', '.moyu-dev-chromium');
  electronArgs.push(`--user-data-dir=${devProfile}`);
  if (!env.MOYU_DATA_DIR && process.env.APPDATA) {
    env.MOYU_DATA_DIR = path.join(process.env.APPDATA, '@moyu', 'desktop', 'moyu');
  }
  // App path must be explicit and absolute: without it Electron opens its
  // default welcome window, and a bare '.' can be dropped by the argument
  // marshalling below.
  electronArgs.push(root);

  const psQuote = (s) => `'${String(s).replaceAll("'", "''")}'`;
  const argList = electronArgs.map(psQuote).join(',');
  const ps = [
    `$p = Start-Process -FilePath ${psQuote(electronBinary)} -ArgumentList ${argList} -WorkingDirectory ${psQuote(root)} -PassThru;`,
    'Write-Output $p.Id',
  ].join(' ');
  const launcher = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    cwd: root, env, stdio: ['ignore', 'pipe', 'inherit'],
  });
  let pid = '';
  launcher.stdout.on('data', (d) => { pid += String(d).trim(); });
  launcher.on('exit', () => {
    pid = pid.split(/\r?\n/).filter(Boolean).pop() ?? '';
    if (pid) console.error(`[dev] electron started, pid=${pid}`);
    else console.error('[dev] electron launch failed (no pid)');
  });

  let stopping = false;
  const shutdown = async () => {
    stopping = true;
    if (pid) { try { process.kill(Number(pid)); } catch {} }
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  const poll = setInterval(() => {
    if (stopping || !pid) return;
    spawn('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], { stdio: 'ignore' }).on('exit', (code) => {
      // tasklist exits 0 when a match is printed, 1 when none
      if (code !== 0) {
        clearInterval(poll);
        console.error('[dev] electron exited; stopping dev server');
        void shutdown();
      }
    });
  }, 3000);
  poll.unref?.();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
