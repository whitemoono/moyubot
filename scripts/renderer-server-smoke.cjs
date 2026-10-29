// Exercise the real static server against an ASAR archive using Electron's fs APIs.
const { app } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { startRendererServer } = require('../apps/desktop/dist-electron/renderer-server');
let server;
app.whenReady().then(async () => {
  const directory = path.resolve(__dirname, '../apps/desktop/release/win-unpacked/resources/app.asar/dist');
  server = await startRendererServer(directory);
  const response = await fetch(server.url);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), fs.readFileSync(path.join(directory, 'index.html'), 'utf8'));
  for (const name of fs.readdirSync(path.join(directory, 'assets'))) {
    const asset = await fetch(server.url + 'assets/' + name);
    assert.equal(asset.status, 200, name);
    assert.deepEqual(Buffer.from(await asset.arrayBuffer()), fs.readFileSync(path.join(directory, 'assets', name)));
  }
  const head = await fetch(server.url, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal((await fetch(server.url, { method: 'POST' })).status, 405);
  for (const relative of ['package.json', 'assets/missing.js', '../package.json']) assert.equal((await fetch(server.url + relative)).status, 404);
  console.log('Packaged renderer server passed: HTML/assets byte integrity, HEAD, methods and path isolation.');
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { server?.close(); app.exit(process.exitCode || 0); });
