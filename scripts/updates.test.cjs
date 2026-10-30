const test = require('node:test');
const assert = require('node:assert/strict');
const { checkForUpdates } = require('../apps/desktop/dist-electron/updates.js');
const reply = (body, status = 200) => async () => new Response(JSON.stringify(body), { status });

test('only matching uploaded Windows x64 installers from this repository enable updates', async () => {
  const url = 'https://github.com/whitemoono/moyubot/releases/download/v1.0.0/';
  const installer = { name: 'MoyuBot.Setup.1.0.0.exe', browser_download_url: url + 'MoyuBot.Setup.1.0.0.exe', size: 123, digest: 'sha256:' + 'a'.repeat(64), state: 'uploaded' };
  const check = (asset, platform = 'win32', arch = 'x64') => checkForUpdates('0.1.0', reply({ tag_name: 'v1.0.0', assets: [asset] }), platform, arch);
  assert.equal((await check(installer)).installer.sha256, 'a'.repeat(64));
  for (const patch of [{ browser_download_url: 'https://other.example/setup.exe' }, { browser_download_url: url + '../MoyuBot.Setup.1.0.0.exe' }, { name: 'MoyuBot.Setup.2.0.0.exe' }, { digest: undefined }, { size: 0 }, { size: 1e10 }, { state: 'new' }]) assert.equal((await check({ ...installer, ...patch })).installer, undefined);
  assert.equal((await check(installer, 'linux')).installer, undefined);
  assert.equal((await check(installer, 'win32', 'arm64')).installer, undefined);
  const fallback = await checkForUpdates('0.1.0', reply({ tag_name: 'v1.0.0', assets: [{ ...installer, digest: undefined }, { name: 'SHA256SUMS.txt', state: 'uploaded', browser_download_url: url + 'SHA256SUMS.txt' }] }), 'win32', 'x64');
  assert.equal(fallback.installer.checksumUrl, url + 'SHA256SUMS.txt');
});

test('update checks use the project releases and compare numeric versions', async () => {
  const result = await checkForUpdates('0.9.0', async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/whitemoono/moyubot/releases/latest');
    assert.ok(options.signal);
    return new Response(JSON.stringify({ tag_name: 'v0.10.0', html_url: 'https://unrelated.example/file' }));
  });
  assert.equal(result.status, 'available');
  assert.equal(result.currentVersion, '0.9.0');
  assert.equal(result.latestVersion, '0.10.0');
  assert.equal(result.releaseUrl, 'https://github.com/whitemoono/moyubot/releases/tag/v0.10.0');
  assert.ok(result.checkedAt > 0);
});

test('equal and newer installed versions do not offer a downgrade; stable supersedes prerelease', async () => {
  for (const installed of ['1.0.0', '1.0.0+local', '1.1.0', '10.0.0']) {
    assert.equal((await checkForUpdates(installed, reply({ tag_name: 'v1.0.0' }))).status, 'current');
  }
  assert.equal((await checkForUpdates('1.0.0-beta.1', reply({ tag_name: 'v1.0.0' }))).status, 'available');
  assert.equal((await checkForUpdates('2.0.0-beta.1', reply({ tag_name: 'v1.0.0' }))).status, 'current');
});

test('unpublished repositories are distinct from a successful current-version check', async () => {
  const result = await checkForUpdates('0.1.0', reply({ message: 'Not Found' }, 404));
  assert.equal(result.status, 'unpublished');
  assert.equal(result.releaseUrl, undefined);
});

test('malformed, draft and prerelease responses never advertise a stable update', async () => {
  for (const data of [null, {}, { tag_name: 'latest' }, { tag_name: 'v1.2.3-beta.1' }, { tag_name: 'v1.2.3', draft: true }, { tag_name: 'v1.2.3', prerelease: true }]) {
    assert.equal((await checkForUpdates('0.1.0', reply(data))).status, 'error');
  }
});

test('rate limits, server failures, offline responses and timeouts remain retryable errors', async () => {
  for (const status of [403, 429, 500]) assert.equal((await checkForUpdates('0.1.0', reply({}, status))).status, 'error');
  assert.equal((await checkForUpdates('0.1.0', async () => { throw new Error('offline'); })).status, 'error');
  const timeout = await checkForUpdates('0.1.0', async () => { throw new DOMException('timeout', 'TimeoutError'); });
  assert.equal(timeout.status, 'error');
  assert.match(timeout.message, /超时/);
});
