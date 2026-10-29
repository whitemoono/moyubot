const { app, session } = require('electron');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { createChatProvider, Store } = require('../packages/core/dist/index.js');
const { initializeProviderNetworking } = require('../apps/desktop/dist-electron/provider-network.js');

app.setPath('userData', path.resolve(__dirname, '../.work/provider-network', String(Date.now())));
app.disableHardwareAcceleration();
let proxy, origin;
app.whenReady().then(async () => {
  const requests = [];
  proxy = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : undefined;
    requests.push({ url: req.url, authorization: req.headers.authorization, body });
    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'proxy-model' }] }));
    } else if (body.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'proxy-stream-ok' } }] })}\n\n`);
      if (body.messages.at(-1).content !== 'abort') res.end('data: [DONE]\n\n');
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'pong' } }] }));
    }
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  await session.defaultSession.setProxy({ proxyRules: `http=127.0.0.1:${proxy.address().port}` });
  initializeProviderNetworking();
  const provider = createChatProvider({ id: 'proxy', kind: 'openai', name: 'Proxy test', baseUrl: 'http://moyu-provider.invalid/v1', networkMode: 'system', defaultModel: 'proxy-model', models: [], createdAt: 0 }, 'local-test-key');
  assert.deepEqual(await provider.listModels(), ['proxy-model']);
  assert.equal((await provider.test()).ok, true);
  const args = { model: 'proxy-model', system: '', messages: [{ role: 'user', content: 'hello' }], tools: [], temperature: 0.7 };
  let text = '';
  await provider.chat(args, { onText: chunk => { text += chunk; }, onToolCall() {} });
  assert.equal(text, 'proxy-stream-ok');
  const controller = new AbortController();
  await assert.rejects(provider.chat({ ...args, messages: [{ role: 'user', content: 'abort' }], signal: controller.signal }, { onText() { controller.abort(); }, onToolCall() {} }));
  assert.equal(requests.length, 4, 'Models, connection test, streaming and cancellation all use the proxy');
  assert.ok(requests.every(request => request.authorization === 'Bearer local-test-key'));
  assert.ok(requests.every(request => request.url.startsWith('http://moyu-provider.invalid/v1/')));
  let directRequests = 0;
  origin = http.createServer((_req, res) => {
    directRequests++;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'direct-model' }] }));
  });
  await new Promise(resolve => origin.listen(0, '127.0.0.1', resolve));
  // Force loopback through the system proxy to prove explicit direct mode bypasses it.
  await session.defaultSession.setProxy({ proxyRules: `http=127.0.0.1:${proxy.address().port}`, proxyBypassRules: '<-loopback>' });
  const config = { id: 'direct', kind: 'openai', name: 'Direct test', baseUrl: `http://127.0.0.1:${origin.address().port}/v1`, networkMode: 'direct', defaultModel: 'direct-model', models: [], createdAt: 0 };
  const direct = createChatProvider(config, 'local-test-key');
  const system = createChatProvider({ ...config, id: 'system', networkMode: 'system' }, 'local-test-key');
  const defaults = createChatProvider({ ...config, id: 'default', networkMode: undefined }, 'local-test-key');
  const [directModels, systemModels, defaultModels] = await Promise.all([direct.listModels(), system.listModels(), defaults.listModels()]);
  assert.deepEqual(directModels, ['direct-model']);
  assert.deepEqual(systemModels, ['proxy-model']);
  assert.deepEqual(defaultModels, ['direct-model']);
  assert.equal(directRequests, 2, 'Explicit direct and default providers reach the origin');
  assert.equal(requests.length, 5, 'Concurrent system requests retain their proxy routing');
  const storePath = path.join(app.getPath('userData'), 'store');
  const store = new Store(storePath);
  store.updateSettings({ providers: [config, { ...config, id: 'system', networkMode: 'system' }] });
  const reopened = new Store(storePath);
  assert.equal(reopened.getProvider('direct').networkMode, 'direct');
  assert.equal(reopened.getProvider('system').networkMode, 'system');
  console.log('Provider networking smoke passed: per-provider proxy/direct isolation, defaults, persistence, authentication, streaming and cancellation.');
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  proxy?.closeAllConnections();
  proxy?.close();
  origin?.closeAllConnections();
  origin?.close();
  app.exit(process.exitCode || 0);
});
