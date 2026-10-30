import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CapabilityManager, Store } from '../../packages/core/dist/index.js';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../..');
const stamp = String(Date.now());
fs.mkdirSync(path.join(root, 'workspace'), { recursive: true });
const store = new Store(path.join(root, '.work/real-capabilities/verification', stamp));
const manager = new CapabilityManager(store);
try {
  manager.importMcp('workspace_local', fs.readFileSync(path.join(directory, 'mcp.json'), 'utf8'));
  manager.importSkill('workspace_local', path.join(directory, 'frontend-design'));
  const bot = store.upsertBot({ ...store.settings.bots[0], id: 'real-check', workspaceId: 'workspace_local', mcpServerIds: [store.settings.mcpServers[0].id], skillIds: [store.settings.skills[0].id] });
  const schemas = await manager.schemas(bot);
  const invoke = (name, args) => manager.call(bot, { id: 'verify', name, arguments: args });
  assert.equal(manager.status('workspace_local').servers[0].state, 'connected');
  const tool = name => {
    const schema = schemas.find(s => s.description.includes(`] ${name}:`));
    assert.ok(schema, `Missing ${name}`); return schema.name;
  };
  const file = path.join(root, 'workspace', 'mcp-verification', stamp, 'hello.html');
  assert.equal((await invoke(tool('create_directory'), { path: path.dirname(file) })).ok, true);
  const html = '<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><title>Filesystem 实际验证</title><h1>真实 MCP 文件读写成功</h1></html>';
  assert.equal((await invoke(tool('write_file'), { path: file, content: html })).ok, true);
  const read = await invoke(tool('read_text_file'), { path: file });
  assert.equal(read.ok, true); assert.match(read.detail, /真实 MCP 文件读写成功/);
  const denied = await invoke(tool('read_text_file'), { path: path.join(root, 'package.json') });
  assert.equal(denied.ok, false, 'Files outside workspace must be denied');
  const skill = await invoke('load_skill', { skillId: bot.skillIds[0] });
  assert.equal(skill.ok, true); assert.match(skill.detail, /Frontend Design/);
  console.log(JSON.stringify({ state: 'connected', tools: manager.status('workspace_local').servers[0].tools.map(t => t.name), skill: store.settings.skills[0].name, createdFile: file, readBack: 'passed', outsideDirectory: 'denied' }, null, 2));
} finally { await manager.dispose(); }
