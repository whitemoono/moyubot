import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { CodespacesHost } from '../packages/core/dist/index.js';

/** 模拟 Codespace 侧执行服务（协议契约：双重鉴权 + /exec /read /write）。 */
function startMock() {
  const hits = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      hits.push(`${req.method} ${req.url}`);
      const authed = req.headers.authorization === 'Bearer gh-test' && req.headers['x-moyu-token'] === 'moyu-test';
      const reply = (code, obj) => { const body = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(body); };
      if (!authed) return reply(401, { error: 'unauthorized' });
      if (req.url === '/exec') {
        const body = JSON.parse(raw);
        if (body.cmd.includes('MoyuBot-Codespace/大肥鱼')) return reply(200, { ok: true, exitCode: 0, stdout: 'cwd-ok\n', stderr: '' });
        return reply(200, { ok: true, exitCode: 0, stdout: `${body.cmd}\n`, stderr: '' });
      }
      if (req.url === '/read') {
        const body = JSON.parse(raw);
        if (body.path.includes('notes.md')) return reply(200, { contentB64: Buffer.from('笔记内容').toString('base64') });
        return reply(404, { error: 'no such file' });
      }
      if (req.url === '/write') return reply(200, { ok: true });
      return reply(404, { error: 'not found' });
    });
  });
  server.on('connection', (socket) => socket.unref?.());
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, hits })));
}

function makeHost(port, overrides = {}) {
  return new CodespacesHost({
    codespaceName: 'cs-test',
    botDirName: '大肥鱼',
    workspaceDir: '/tmp/ws',
    githubToken: () => 'gh-test',
    execToken: () => 'moyu-test',
    execBaseUrl: `http://127.0.0.1:${port}`,
    ...overrides,
  });
}

test('CodespacesHost：exec 走转发隧道并锚定 bot 工作目录', async () => {
  const { server, port } = await startMock();
  const host = makeHost(port);
  const r = await host.exec('echo hello', { timeoutSeconds: 30 });
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /hello/);
  const cwd = await host.exec('pwd', { subDirectory: '大肥鱼' });
  assert.match(r2(cwd), /cwd-ok/);
  server.close();
  function r2(x) { return x.stdout; }
});

test('CodespacesHost：读/写文件按 bot 目录隔离', async () => {
  const { server, port } = await startMock();
  const host = makeHost(port);
  await host.writeText('notes.md', '新内容', '大肥鱼');
  const text = await host.readText('notes.md', '大肥鱼');
  assert.equal(text, '笔记内容');
  await assert.rejects(() => host.readText('missing.md', '大肥鱼'), /no such file/);
  server.close();
});

test('CodespacesHost：双重鉴权缺失时拒绝执行', async () => {
  const { server, port } = await startMock();
  const host = makeHost(port, { githubToken: () => 'wrong-token' });
  await assert.rejects(() => host.exec('echo x'), /token|401/i);
  server.close();
});
