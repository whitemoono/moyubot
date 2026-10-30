import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CapabilityManager, Store } from '../../packages/core/dist/index.js';

const demo = path.dirname(fileURLToPath(import.meta.url));
const store = new Store(path.resolve(demo, '../../.work/capability-demo', String(Date.now())));
const manager = new CapabilityManager(store);
try {
  manager.importMcp('workspace_cloud', fs.readFileSync(path.join(demo, 'mcp.json'), 'utf8'));
  manager.importSkill('workspace_cloud', path.join(demo, 'moyu-capability-check'));
  const bot = store.upsertBot({ ...store.settings.bots[0], mcpServerIds: [store.settings.mcpServers[0].id], skillIds: [store.settings.skills[0].id] });
  const schemas = await manager.schemas(bot);
  const call = (name, args) => manager.call(bot, { id: 'demo-check', name, arguments: args });
  assert.equal(manager.status('workspace_cloud').servers[0].state, 'connected');
  assert.equal(manager.status('workspace_cloud').servers[0].tools.length, 2);
  assert.ok((await call('load_skill', { skillId: bot.skillIds[0] })).ok);
  const reference = await call('load_skill', { skillId: bot.skillIds[0], resource: 'references/check-case.md' });
  assert.match(reference.detail, /ORANGE-42/);
  const echoName = schemas.find(s => s.description.includes('] echo:')).name;
  const addName = schemas.find(s => s.description.includes('] add_numbers:')).name;
  const echo = await call(echoName, { text: '摸鱼搭子已就位 · ORANGE-42' });
  assert.equal(echo.ok, true);
  const echoed = JSON.parse(echo.detail);
  assert.equal(echoed.text, '摸鱼搭子已就位 · ORANGE-42');
  assert.ok(Number.isFinite(Date.parse(echoed.calledAt)));
  const added = await call(addName, { a: 17, b: 25 });
  assert.equal(added.ok, true);
  assert.equal(JSON.parse(added.detail).sum, 42);
  const invalid = await call(addName, { a: '17', b: 25 });
  assert.equal(invalid.ok, false);
  console.log('Demo verified: 2 MCP tools, skill manifest + reference, echo timestamp, sum=42, invalid argument rejected.');
} finally { await manager.dispose(); }
