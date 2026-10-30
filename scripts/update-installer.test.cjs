const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { AppUpdater } = require('../apps/desktop/dist-electron/update-installer');
const bytes = Buffer.from('MZ synthetic installer fixture; never executed');
const digest = createHash('sha256').update(bytes).digest('hex');
const base = 'https://github.com/whitemoono/moyubot/releases/download/v1.0.0/';
const name = 'MoyuBot.Setup.1.0.0.exe';
const release = { tag_name: 'v1.0.0', assets: [{ name, browser_download_url: base + name, size: bytes.length, digest: 'sha256:' + digest, state: 'uploaded' }] };
function fixture(t, overrides = {}) {
  const root = path.resolve('.work/test-temp'); fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, 'updater-'));
  const launched = []; let quits = 0;
  const updater = new AppUpdater({ directory, version: '0.1.0', canInstall: true, beforeInstall: () => {}, launch: async file => { launched.push(file); }, quit: () => { quits++; }, request: async url => String(url).endsWith('/latest') ? new Response(JSON.stringify(release)) : new Response(bytes), ...overrides });
  t.after(() => { updater.dispose(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { updater, directory, launched, quits: () => quits };
}
// Metadata matching is platform-specific; supply a previously verified main-process result.
async function select(updater, metadata = release) {
  const { checkForUpdates } = require('../apps/desktop/dist-electron/updates');
  updater.state.release = await checkForUpdates('0.1.0', async () => new Response(JSON.stringify(metadata)), 'win32', 'x64');
}
test('streamed download verifies bytes and hash; only explicit installation launches and quits', async t => {
  const f = fixture(t); await select(f.updater);
  assert.equal((await f.updater.download()).status, 'ready');
  assert.equal(f.updater.status().received, bytes.length); assert.equal(f.launched.length, 0);
  assert.deepEqual(fs.readFileSync(path.join(f.directory, fs.readdirSync(f.directory)[0])), bytes);
  assert.equal((await f.updater.check()).status, 'available');
  assert.equal(f.updater.status().status, 'ready', 'Rechecking keeps verified download');
  assert.equal((await f.updater.install()).status, 'installing');
  assert.equal(f.launched.length, 1); assert.equal(f.quits(), 1);
  await f.updater.install(); assert.equal(f.launched.length, 1);
});
test('hash mismatch, short response, excessive data and HTTP errors never launch or retain partial files', async t => {
  for (const response of [() => new Response(Buffer.alloc(bytes.length, 1)), () => new Response(bytes.subarray(1)), () => new Response(Buffer.concat([bytes, bytes])), () => new Response('', { status: 503 })]) {
    const f = fixture(t, { request: async () => response() }); await select(f.updater);
    assert.equal((await f.updater.download()).status, 'error');
    assert.deepEqual(fs.readdirSync(f.directory), []);
    await assert.rejects(f.updater.install(), /先下载/); assert.equal(f.quits(), 0);
  }
});
test('cancellation blocks duplicate downloads, removes partial data and permits retry', async t => {
  let requested = 0;
  const f = fixture(t, { request: async (_url, { signal }) => {
    requested++;
    if (requested > 1) return new Response(bytes);
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.subarray(0, 2)); signal.addEventListener('abort', () => controller.error(signal.reason), { once: true }); } }));
  } });
  await select(f.updater);
  const pending = f.updater.download();
  assert.equal((await f.updater.download()).status, 'downloading');
  while (!f.updater.status().received) await new Promise(resolve => setTimeout(resolve, 5));
  f.updater.cancel(); assert.equal((await pending).status, 'cancelled');
  assert.deepEqual(fs.readdirSync(f.directory), []);
  assert.equal((await f.updater.download()).status, 'ready'); assert.equal(requested, 2);
});
test('checksum manifest fallback requires exact filename and is size-bounded', async t => {
  for (const manifest of [`${digest}  ${name}\n`, `${digest}  wrong.exe\n`, 'a'.repeat(65537)]) {
    const f = fixture(t, { request: async url => new Response(String(url).endsWith('.txt') ? manifest : bytes) });
    await select(f.updater, { ...release, assets: [{ ...release.assets[0], digest: undefined }, { name: 'SHA256SUMS.txt', browser_download_url: base + 'SHA256SUMS.txt', state: 'uploaded' }] });
    assert.equal((await f.updater.download()).status, manifest.includes(name) ? 'ready' : 'error');
  }
});
test('active work, file tampering and installer launch failure keep application open', async t => {
  let busy = true;
  const f = fixture(t, { beforeInstall: () => { if (busy) throw new Error('任务运行'); } }); await select(f.updater); await f.updater.download();
  await assert.rejects(f.updater.install(), /任务运行/); assert.equal(f.updater.status().status, 'ready'); assert.equal(f.quits(), 0);
  busy = false; fs.writeFileSync(path.join(f.directory, fs.readdirSync(f.directory)[0]), 'changed');
  assert.equal((await f.updater.install()).status, 'error'); assert.equal(f.launched.length, 0);
  await f.updater.download();
  fs.unlinkSync(path.join(f.directory, fs.readdirSync(f.directory)[0]));
  assert.equal((await f.updater.install()).status, 'error');
  assert.match(f.updater.status().message, /重新下载/);
  const broken = fixture(t, { launch: async () => { throw new Error('启动失败'); } }); await select(broken.updater); await broken.updater.download();
  assert.equal((await broken.updater.install()).status, 'ready'); assert.match(broken.updater.status().message, /启动失败/); assert.equal(broken.quits(), 0);
});
test('preview builds cannot download or install; check requests share one operation', async t => {
  let checks = 0;
  const f = fixture(t, { canInstall: false, request: async () => { checks++; await new Promise(resolve => setTimeout(resolve, 10)); return new Response(JSON.stringify(release)); } });
  await Promise.all([f.updater.check(), f.updater.check()]); assert.equal(checks, 1);
  assert.equal(f.updater.status().release.installer, undefined);
  await assert.rejects(f.updater.download(), /检查/); await assert.rejects(f.updater.install(), /下载/);
});
