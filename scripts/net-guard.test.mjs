import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPublicHttpsUrl, fetchPublicText } from '../packages/core/dist/net-guard.js';

test('只放行公网 https，挡住本机/私网/元数据地址', () => {
  for (const bad of [
    'http://example.com',
    'https://localhost/',
    'https://foo.localhost/',
    'https://foo.local/',
    'https://foo.lan/',
    'https://127.0.0.1/',
    'https://0.0.0.0/',
    'https://10.1.2.3/',
    'https://172.16.0.1/',
    'https://192.168.1.1/',
    'https://169.254.169.254/latest/meta-data/',
    'https://100.64.0.1/',
    'https://198.18.0.1/',
    'https://224.0.0.1/',
    'https://[::1]/',
    'https://[fe80::1]/',
    'https://user:pass@example.com/',
  ]) {
    assert.throws(() => assertPublicHttpsUrl(bad), /https|内网|本机|账号密码/, bad + ' 应被拒绝');
  }
  for (const good of ['https://example.com/', 'https://1.1.1.1/', 'https://[2606:4700::1111]/']) {
    assert.equal(assertPublicHttpsUrl(good).protocol, 'https:', good + ' 应被接受');
  }
});

test('重定向到非 https 或内网时拒绝', async () => {
  const toPlain = async () => new Response(null, { status: 302, headers: { location: 'http://example.com/x' } });
  await assert.rejects(() => fetchPublicText(toPlain, 'https://1.1.1.1/', { maxBytes: 1024, timeoutMs: 5000 }), /非 https/);

  const toLoopback = async () => new Response(null, { status: 302, headers: { location: 'https://127.0.0.1:8443/admin' } });
  await assert.rejects(() => fetchPublicText(toLoopback, 'https://1.1.1.1/', { maxBytes: 1024, timeoutMs: 5000 }), /内网|本机/);
});

test('响应体按字节截断，且报告 truncated', async () => {
  const big = async () => new Response('x'.repeat(10_000), { status: 200 });
  const capped = await fetchPublicText(big, 'https://1.1.1.1/', { maxBytes: 128, timeoutMs: 5000 });
  assert.equal(capped.truncated, true);
  assert.equal(capped.text.length, 128);
  assert.equal(capped.ok, true);

  const small = async () => new Response('hello', { status: 200 });
  const kept = await fetchPublicText(small, 'https://1.1.1.1/', { maxBytes: 128, timeoutMs: 5000 });
  assert.equal(kept.truncated, false);
  assert.equal(kept.text, 'hello');
});

test('非 2xx 也原样回报状态码，交给调用方判断', async () => {
  const notFound = async () => new Response('nope', { status: 404 });
  const result = await fetchPublicText(notFound, 'https://1.1.1.1/', { maxBytes: 1024, timeoutMs: 5000 });
  assert.equal(result.status, 404);
  assert.equal(result.ok, false);
});