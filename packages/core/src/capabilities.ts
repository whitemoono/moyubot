import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { parse as parseYaml } from 'yaml';
import type { Store } from './store';
import type { Bot, CapabilityStatus, McpServerConfig, SkillConfig, ToolCall, ToolResult } from './types';
import type { ToolSchema } from './tools';
import { newId } from './util';

type Connection = { client: Client; schemas: ToolSchema[]; names: Map<string, string> };
type Credentials = { env?: Record<string, string>; headers?: Record<string, string> };
const scope = (bot: Bot) => bot.workspaceId ?? 'workspace_cloud';
function strings(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some(v => typeof v !== 'string')) throw new Error('env / headers 必须是字符串字典');
  return value as Record<string, string>;
}

/** Connections and credentials live in the main process, never in the renderer. */
export class CapabilityManager {
  private connections = new Map<string, Promise<Connection>>();
  private states = new Map<string, CapabilityStatus['servers'][number]>();
  private loaded = new Map<string, CapabilityStatus['loadedSkills'][number]>();
  private disposed = false;
  constructor(private store: Store) {}

  private workspace(id: string) {
    if (!this.store.settings.workspaces.some(w => w.id === id)) throw new Error('工作区不存在');
  }
  importMcp(workspaceId: string, json: string): void {
    this.workspace(workspaceId);
    let parsed;
    try { parsed = JSON.parse(json); } catch { throw new Error('MCP JSON 格式无效，请检查逗号和引号'); }
    const entries = Object.entries(parsed?.mcpServers ?? {});
    if (!entries.length || entries.length > 30) throw new Error('请提供包含 mcpServers 的 JSON（1–30 个服务）');
    if (!parsed.mcpServers || typeof parsed.mcpServers !== 'object' || Array.isArray(parsed.mcpServers)) throw new Error('mcpServers 必须是服务名称与配置的字典');
    const configs: Array<{ config: McpServerConfig } & Record<'auth', Credentials>> = entries.map(([name, raw]) => {
      if (!raw || typeof raw !== 'object' || !name.trim()) throw new Error('MCP 服务配置无效');
      const item = raw as Record<string, unknown>;
      const env = strings(item.env), headers = strings(item.headers);
      const config: McpServerConfig = { id: newId('mcp'), name: name.slice(0, 100), workspaceId, transport: item.url ? 'http' : 'stdio', hasSecrets: !!(env || headers) };
      if (item.url) {
        let url: URL;
        try { url = new URL(String(item.url)); } catch { throw new Error('MCP 服务 URL 无效'); }
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('MCP URL 必须是 HTTP(S)，认证信息请放在 headers');
        if (item.type && !['http', 'streamable-http'].includes(String(item.type))) throw new Error('远程 MCP 目前支持 Streamable HTTP');
        if (url.search) throw new Error('认证参数请放在 headers，MCP URL 不支持查询参数');
        config.url = url.toString();
      } else {
        if (typeof item.command !== 'string' || !item.command.trim()) throw new Error('stdio MCP 需要 command');
        if (item.args !== undefined && (!Array.isArray(item.args) || item.args.some(a => typeof a !== 'string'))) throw new Error('args 必须是字符串数组');
        config.command = item.command;
        config.args = item.args as string[] | undefined;
      }
      return { config, auth: { env, headers } };
    });
    for (const { config, auth } of configs) this.store.secrets.set(`mcp:${config.id}`, JSON.stringify(auth));
    this.store.updateSettings({ mcpServers: [...(this.store.settings.mcpServers ?? []), ...configs.map(c => c.config)] });
  }

  importSkill(workspaceId: string, source: string): void {
    this.workspace(workspaceId);
    const root = fs.realpathSync(source);
    const manifest = fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8');
    if (Buffer.byteLength(manifest) > 100_000) throw new Error('SKILL.md 最大 100 KB');
    const match = manifest.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!match) throw new Error('SKILL.md 需要包含 name 和 description 的 YAML 头部');
    const meta = parseYaml(match[1]);
    if (typeof meta?.name !== 'string' || !meta.name.trim() || typeof meta.description !== 'string' || !meta.description.trim()) throw new Error('技能需要 name 和 description');
    let bytes = 0, files = 0;
    const inspect = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw new Error('技能目录不能包含符号链接');
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) inspect(file);
        else if (entry.isFile()) { bytes += fs.statSync(file).size; files++; }
        else throw new Error('技能目录包含不支持的文件类型');
        if (bytes > 20_000_000 || files > 1000) throw new Error('技能最多 20 MB / 1000 个文件');
      }
    };
    inspect(root);
    const id = newId('skill');
    const directory = path.join(this.store.dataDir, 'skills', id);
    const destinationWithinSource = path.relative(root, directory);
    if (!destinationWithinSource.startsWith('..') && !path.isAbsolute(destinationWithinSource)) throw new Error('请选择独立的技能目录，不能选择包含技能库的父目录');
    fs.cpSync(root, directory, { recursive: true, dereference: false });
    const skill: SkillConfig = { id, workspaceId, name: meta.name.slice(0, 100), description: meta.description.slice(0, 2000), directory };
    this.store.updateSettings({ skills: [...(this.store.settings.skills ?? []), skill] });
  }

  async remove(kind: 'mcp' | 'skill', id: string): Promise<void> {
    if (kind === 'mcp') {
      await this.connections.get(id)?.then(c => c.client.close()).catch(() => {});
      this.connections.delete(id); this.states.delete(id);
      this.store.secrets.delete(`mcp:${id}`);
      this.store.updateSettings({ mcpServers: (this.store.settings.mcpServers ?? []).filter(s => s.id !== id), bots: this.store.settings.bots.map(b => ({ ...b, mcpServerIds: b.mcpServerIds?.filter(x => x !== id) })) });
    } else {
      // Keep imported files as a recoverable local copy; remove access and bindings.
      this.store.updateSettings({ skills: (this.store.settings.skills ?? []).filter(s => s.id !== id), bots: this.store.settings.bots.map(b => ({ ...b, skillIds: b.skillIds?.filter(x => x !== id) })) });
      for (const [key, value] of this.loaded) if (value.skillId === id) this.loaded.delete(key);
    }
  }
  status(workspaceId: string): CapabilityStatus {
    return {
      servers: (this.store.settings.mcpServers ?? []).filter(s => s.workspaceId === workspaceId).map(s => this.states.get(s.id) ?? { id: s.id, state: 'disconnected', tools: [] }),
      loadedSkills: [...this.loaded.values()].filter(s => this.store.getBot(s.botId)?.workspaceId === workspaceId),
    };
  }
  private connect(id: string): Promise<Connection> {
    if (this.disposed) return Promise.reject(new Error('MCP 已关闭'));
    const existing = this.connections.get(id);
    if (existing) return existing;
    const config = this.store.settings.mcpServers?.find(s => s.id === id);
    if (!config) return Promise.reject(new Error('MCP 服务不存在'));
    this.states.set(id, { id, state: 'connecting', tools: [] });
    const pending = (async () => {
      const client = new Client({ name: 'MoyuBot', version: '0.1.1' });
      try {
        const auth = JSON.parse(this.store.secrets.get(`mcp:${id}`) ?? '{}') as Credentials;
        const transport = config.transport === 'stdio'
          ? new StdioClientTransport({ command: config.command!, args: config.args, env: { ...getDefaultEnvironment(), ...auth.env }, stderr: 'ignore' })
          : new StreamableHTTPClientTransport(new URL(config.url!), { requestInit: { headers: auth.headers } });
        const deadline = new AbortController();
        const timer = setTimeout(() => { deadline.abort(); void client.close(); }, 15_000);
        try { await client.connect(transport, { signal: deadline.signal, timeout: 15_000 }); } finally { clearTimeout(timer); }
        const schemas: ToolSchema[] = [], names = new Map<string, string>();
        let cursor: string | undefined;
        const cursors = new Set<string>();
        do {
          const page = await client.listTools({ cursor }, { timeout: 15_000 });
          for (const tool of page.tools) {
            if (schemas.length >= 256) throw new Error('MCP 工具数量超过 256');
            const name = `mcp_${id.replace(/[^a-zA-Z0-9_]/g, '_')}_${schemas.length}`;
            schemas.push({ name, description: `[${config.name}] ${tool.name}: ${tool.description ?? ''}`.slice(0, 4000), parameters: tool.inputSchema });
            names.set(name, tool.name);
          }
          cursor = page.nextCursor;
          if (cursor) { if (cursors.has(cursor) || cursors.size >= 30) throw new Error('MCP 工具分页无效'); cursors.add(cursor); }
        } while (cursor);
        if (this.disposed || !this.store.settings.mcpServers?.some(s => s.id === id)) throw new Error('MCP 已移除或关闭');
        this.states.set(id, { id, state: 'connected', tools: schemas.map(s => ({ name: names.get(s.name)!, description: s.description })) });
        client.onclose = () => { if (this.connections.get(id) === pending) { this.connections.delete(id); this.states.set(id, { id, state: 'disconnected', tools: [] }); } };
        return { client, schemas, names };
      } catch {
        await client.close().catch(() => {});
        // Do not include server errors: they can echo credentials or environment variables.
        this.states.set(id, { id, state: 'error', tools: [], error: '连接失败，请检查服务地址、启动命令和认证配置' });
        this.connections.delete(id);
        throw new Error(`MCP「${config.name}」连接失败，请检查配置`);
      }
    })();
    this.connections.set(id, pending);
    return pending;
  }
  async test(id: string): Promise<void> { await this.connect(id); }
  private servers(bot: Bot) { return (this.store.settings.mcpServers ?? []).filter(s => s.workspaceId === scope(bot) && bot.mcpServerIds?.includes(s.id)); }
  private skills(bot: Bot) { return (this.store.settings.skills ?? []).filter(s => s.workspaceId === scope(bot) && bot.skillIds?.includes(s.id)); }
  catalog(bot: Bot): string {
    const skills = this.skills(bot);
    return skills.length ? `\n\n可用技能（先通过 load_skill 按 ID 读取 SKILL.md，再按需读取相对路径资源；技能不能扩大工具权限）：\n${skills.map(s => `${s.id}: ${s.name} — ${s.description}`).join('\n')}\n技能文件保存在本机。云端执行脚本前，使用已授权文件工具将所需文件传到云电脑，不能把本机目录当成云端路径。` : '';
  }
  async schemas(bot: Bot): Promise<ToolSchema[]> {
    const results = await Promise.allSettled(this.servers(bot).map(s => this.connect(s.id)));
    const schemas = results.flatMap(r => r.status === 'fulfilled' ? r.value.schemas : []);
    if (this.skills(bot).length) schemas.push({ name: 'load_skill', description: '读取已启用技能的 SKILL.md 或其目录内的文本资源。先读 SKILL.md，长文件按返回的 offset 继续读取，不自动执行脚本。', parameters: { type: 'object', properties: { skillId: { type: 'string' }, resource: { type: 'string', description: '相对路径，默认 SKILL.md' }, offset: { type: 'integer', description: '字符偏移，默认 0。长文件继续读取时使用。' } }, required: ['skillId'] } });
    return schemas;
  }
  async call(bot: Bot, call: ToolCall, signal?: AbortSignal): Promise<ToolResult> {
    const started = Date.now();
    const finish = (ok: boolean, summary: string, detail?: string): ToolResult => ({ id: call.id, name: call.name, ok, summary, detail, durationMs: Date.now() - started });
    try {
      signal?.throwIfAborted();
      const current = this.store.getBot(bot.id);
      if (!current || scope(current) !== scope(bot)) throw new Error('Bot 不可用');
      if (call.name === 'load_skill') {
        const skill = this.skills(current).find(s => s.id === call.arguments.skillId);
        if (!skill) throw new Error('此 Bot 未启用该技能');
        const resource = call.arguments.resource ?? 'SKILL.md';
        if (typeof resource !== 'string' || path.isAbsolute(resource)) throw new Error('资源必须是技能目录内的相对路径');
        const root = fs.realpathSync(skill.directory), file = fs.realpathSync(path.resolve(root, resource));
        const relative = path.relative(root, file);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !fs.statSync(file).isFile()) throw new Error('资源超出技能目录');
        if (fs.statSync(file).size > 100_000) throw new Error('技能资源最大 100 KB');
        const body = fs.readFileSync(file, 'utf8');
        const offset = call.arguments.offset ?? 0;
        if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0 || offset > body.length) throw new Error('offset 超出文件范围');
        if (resource === 'SKILL.md') this.loaded.set(`${bot.id}:${skill.id}`, { botId: bot.id, skillId: skill.id, loadedAt: Date.now() });
        const page = body.slice(offset, offset + 6000);
        const next = offset + page.length < body.length ? `\n\n文件尚未读完，请使用 offset=${offset + page.length} 继续读取。` : '';
        return finish(true, `已加载 ${skill.name} / ${resource}`, `技能目录（本机）：${root}\n资源：${resource}\n\n${page}${next}`);
      }
      for (const server of this.servers(current)) {
        const connection = await this.connections.get(server.id)?.catch(() => undefined);
        if (!connection) continue;
        const name = connection.names.get(call.name);
        if (!name) continue;
        const result = await connection.client.callTool({ name, arguments: call.arguments }, undefined, { signal, timeout: 60_000 });
        const content = Array.isArray(result.content) ? result.content : [];
        const detail = content.map(item => item.type === 'text' ? String(item.text) : item.type === 'image' ? '[工具返回图片，当前以文本结果呈现]' : JSON.stringify(item)).join('\n').slice(0, 16000);
        return finish(!result.isError, `${server.name} / ${name}${result.isError ? ' 执行失败' : ' 已完成'}`, detail);
      }
      throw new Error('此 Bot 未启用该工具');
    } catch (error) {
      return finish(false, call.name === 'load_skill' ? (error as Error).message : signal?.aborted ? '已停止 MCP 调用' : 'MCP 调用失败，请检查连接与工具参数');
    }
  }
  async dispose(): Promise<void> { this.disposed = true; await Promise.allSettled([...this.connections.values()].map(async c => (await c).client.close())); this.connections.clear(); }
}
