import { E2BClient } from './dist/e2b.js';
const client = new E2BClient({ apiKey: process.env.E2B_API_KEY });
const list = await client.listMachines();
const m = list.find(x => x.state === 'running') || list[0];
const s = await client.desktopStream(m.id, true);
const res = await fetch(s.url, { redirect: 'manual' });
console.log('url:', s.url);
console.log('status:', res.status);
console.log('--- 安全相关响应头 ---');
for (const [k, v] of res.headers.entries()) {
  if (/frame|content-security|x-content/i.test(k)) console.log(`${k}: ${v}`);
}
console.log('--- 全部头 ---');
for (const [k, v] of res.headers.entries()) console.log(`${k}: ${v.slice(0, 120)}`);
