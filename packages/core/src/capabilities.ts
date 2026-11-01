import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { parse as parseYaml } from 'yaml';
import type { Store } from './store';
import type { Bot, CapabilityStatus, McpServerConfig, SkillConfig, ToolCall, ToolResult } from './types';
import type { ToolSchema } from './tools';
import type { ComputerHost } from './cloud';
import { newId, shellQuote } from './util';

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
  private cloudInventory?: { at: number; servers: NonNullable<CapabilityStatus['cloudServers']>; skills: NonNullable<CapabilityStatus['cloudSkills']> };
  /** 部署 MCP/技能后置位：下次盘点跳过缓存直接探测，让新部署立刻出现在清单里。 */
  private cloudInventoryStale = false;
  /** 云机 claude → .moyu 的一次性迁移：本会话已尝试次数（成功或达上限后不再跑）。 */
  private claudeMigrationAttempts = 0;
  constructor(private store: Store, private cloud: () => Pick<ComputerHost, 'status' | 'exec' | 'ensureAwake' | 'writeText'> | undefined = () => undefined) {}

  /** Writable root on the cloud machine. E2B runs as an unprivileged user (no /data). */
  private cloudRoot(): string {
    const cfg = this.store.settings.cloud;
    if (cfg?.remoteWorkspaceDir) return cfg.remoteWorkspaceDir;
    return cfg?.driver === 'e2b' ? '/home/user/moyubot' : '/data/moyubot';
  }

  /**
   * 盘点云电脑上 moyubot 管理的能力：共享 .moyu/shared + 每个 Bot 家目录的 .moyu（按 botId/botDirName 标记）。
   * 不读云机自带 claude 的 ~/.claude（那是一次性迁移的来源，迁移后彻底不碰）。
   * 本地优先：清单落盘（cloud-inventory.json）且永久有效，总是先回上次已知结果，绝不为了盘点唤醒云电脑——
   * 只有云电脑本来在线（ready/busy/waking）时才顺带重新探测。探测失败保留旧清单，force=true 供手动刷新（允许唤醒）。
   */
  async inventoryCloud(force = false): Promise<{ servers: NonNullable<CapabilityStatus['cloudServers']>; skills: NonNullable<CapabilityStatus['cloudSkills']> }> {
    const empty = { servers: [], skills: [] };
    const host = this.cloud();
    const raw = this.cloudInventory ?? this.store.readCloudInventory();
    // 旧版清单可能含 .moyu 之前的条目（claude（外部）/~/.claude 来源/「云电脑」）：.moyu 时代不再展示，
    // 读缓存时直接滤掉，避免云机睡眠期间一直显示迁移前的 claude 清单；等在线探测后由 .moyu 清单覆盖。
    const cached = raw
      ? { ...raw, servers: raw.servers.filter(s => s.source.startsWith('共享') || s.source.startsWith('自有')), skills: raw.skills.filter(s => s.source.startsWith('共享') || s.source.startsWith('自有')) }
      : undefined;
    if (cached) this.cloudInventory = cached;
    if (!host || this.disposed) return cached ?? empty;
    const now = Date.now();
    if (cached && now - cached.at < 30_000) return cached;
    // 不为盘点唤醒云电脑：休眠/离线时直接回上次已知清单。
    const state = host.status().state;
    const awake = state === 'ready' || state === 'busy' || state === 'waking';
    if (!force && !awake) return cached ?? empty;
    if (!force && !this.cloudInventoryStale && cached && now - cached.at < 5 * 60_000) return cached;
    // 一次性迁移：云机自带 claude 的 MCP/技能 → .moyu/shared（云机侧 marker 幂等）。
    // 之后盘点不再读 ~/.claude。成功（或达重试上限）后本会话不再尝试。
    if (this.claudeMigrationAttempts < 5) {
      this.claudeMigrationAttempts++;
      if (await this.migrateClaudeCapabilities().catch(() => false)) this.claudeMigrationAttempts = 5;
    }
    const root = this.cloudRoot();
    const botDirs = this.store.settings.bots
      .filter((bot) => (bot.workspaceId ?? 'workspace_cloud') === 'workspace_cloud')
      .map((bot) => this.store.botDirName(bot.id));
    // Probe with python3 (present on both InstaBox and E2B images; E2B has no node).
    // Emits one JSON line: { shared:{mcp,skills}, bots:{dir:{mcp,skills}} }.
    const py = [
      'import json,os',
      `root=${JSON.stringify(root)}`,
      `dirs=${JSON.stringify(botDirs)}`,
      'def read_mcp(f):',
      '    try:',
      '        c=json.load(open(f,"r",encoding="utf-8")) or {}',
      '    except Exception:',
      '        return []',
      '    out=[]',
      '    for n,g in (c.get("mcpServers") or {}).items():',
      '        out.append({"name":n,"transport":("http" if g.get("type")=="http" else "stdio"),"command":g.get("command"),"url":g.get("url")})',
      '    return out',
      'def read_skills(base):',
      '    r=[]',
      '    try:',
      '        for f in os.listdir(base):',
      '            p=os.path.join(base,f)',
      '            if os.path.isdir(p) and os.path.isfile(os.path.join(p,"SKILL.md")):',
      '                r.append({"name":f,"path":p})',
      '    except Exception:',
      '        pass',
      '    return r',
      'res={"shared":{"mcp":[],"skills":[]},"bots":{}}',
      'sb=os.path.join(root,".moyu","shared")',
      'res["shared"]={"mcp":read_mcp(os.path.join(sb,"mcp.json")),"skills":read_skills(os.path.join(sb,"skills"))}',
      'for d in dirs:',
      '    base=os.path.join(root,d,".moyu")',
      '    res["bots"][d]={"mcp":read_mcp(os.path.join(base,"mcp.json")),"skills":read_skills(os.path.join(base,"skills"))}',
      'print(json.dumps(res))',
    ].join('\n');
    const probe = `python3 -c ${shellQuote(py)}`;
    const result = await host.exec(probe, { timeoutSeconds: 30 }).catch(() => null);
    if (!result || result.exitCode !== 0) return cached ?? empty; // 探测失败：保留上次清单，不清空、不落盘
    try {
      const line = result.stdout.split('\n').map((item) => item.trim()).filter(Boolean).pop() ?? '{}';
      type McpRow = { name: string; transport: string; command?: string; url?: string };
      type SkillRow = { name: string; path: string };
      const data = JSON.parse(line) as {
        shared?: { mcp?: McpRow[]; skills?: SkillRow[] };
        bots?: Record<string, { mcp?: McpRow[]; skills?: SkillRow[] }>;
      };
      const servers: NonNullable<CapabilityStatus['cloudServers']> = [];
      const skills: NonNullable<CapabilityStatus['cloudSkills']> = [];
      for (const [index, item] of (data.shared?.mcp ?? []).entries()) servers.push({ id: `moyu-shared-mcp-${index}`, name: item.name, transport: item.transport, command: item.command, url: item.url, source: '共享 · .moyu/shared' });
      for (const [index, item] of (data.shared?.skills ?? []).entries()) skills.push({ id: `moyu-shared-skill-${index}`, name: item.name, path: item.path, source: '共享 · .moyu/shared' });
      for (const [dirName, botInv] of Object.entries(data.bots ?? {})) {
        const botId = this.store.settings.bots.find((bot) => (bot.workspaceId ?? 'workspace_cloud') === 'workspace_cloud' && this.store.botDirName(bot.id) === dirName)?.id;
        for (const item of botInv.mcp ?? []) servers.push({ id: `moyu-bot-mcp-${dirName}-${servers.length}`, name: item.name, transport: item.transport, command: item.command, url: item.url, source: '自有 · .moyu', botId, botDirName: dirName });
        for (const item of botInv.skills ?? []) skills.push({ id: `moyu-bot-skill-${dirName}-${skills.length}`, name: item.name, path: item.path, source: '自有 · .moyu/skills', botId, botDirName: dirName });
      }
      this.cloudInventory = { at: Date.now(), servers, skills };
      this.cloudInventoryStale = false;
      this.store.writeCloudInventory(this.cloudInventory);
      return this.cloudInventory;
    } catch {
      return cached ?? empty;
    }
  }

  /** 一次性迁移：把云机自带 claude 的能力复制进 .moyu/shared（~/.claude.json 的 mcpServers、
   *  ~/.claude/skills 与 ~/.agents/skills 的技能目录）。云机侧 marker 文件保证只跑一次；
   *  .moyu 已有条目优先不被覆盖；复制是拷贝不是移动，云机 claude 自身不受影响。成功返回 true。 */
  private async migrateClaudeCapabilities(): Promise<boolean> {
    const host = this.cloud();
    if (!host) return false;
    const root = this.cloudRoot();
    const script = [
      'node -e \'',
      'const fs=require("fs"),os=require("os"),path=require("path");',
      `const root=${JSON.stringify(root).replace(/'/g, '\\u0027')};`,
      'const dir=path.join(root,".moyu","shared"),marker=path.join(dir,".migrated-from-claude");',
      'if(fs.existsSync(marker)){console.log("migrated:already");process.exit(0)}',
      'const h=os.homedir();let mcp={};try{mcp=JSON.parse(fs.readFileSync(path.join(h,".claude.json"),"utf8")||"{}").mcpServers||{}}catch(e){}',
      'fs.mkdirSync(path.join(dir,"skills"),{recursive:true});',
      'let conf={};try{conf=JSON.parse(fs.readFileSync(path.join(dir,"mcp.json"),"utf8")||"{}")}catch(e){}',
      'conf.mcpServers={...mcp,...(conf.mcpServers||{})};',
      'const tmp=path.join(dir,"mcp.json.tmp"+Date.now());fs.writeFileSync(tmp,JSON.stringify(conf,null,2));fs.renameSync(tmp,path.join(dir,"mcp.json"));',
      'let copied=0;',
      'for(const src of [path.join(h,".claude/skills"),path.join(h,".agents/skills")]){try{for(const f of fs.readdirSync(src)){const from=path.join(src,f),dst=path.join(dir,"skills",f);try{if(fs.statSync(from).isDirectory()&&fs.existsSync(path.join(from,"SKILL.md"))&&!fs.existsSync(dst)){fs.cpSync(from,dst,{recursive:true});copied++}}catch(e){}}}catch(e){}}',
      'fs.writeFileSync(marker,String(Date.now()));',
      'console.log("migrated:"+Object.keys(mcp).length+","+copied)',
      '\'',
    ].join('');
    await host.ensureAwake('迁移云机 claude 能力到 .moyu').catch(() => {});
    const result = await host.exec(script, { timeoutSeconds: 120 }).catch(() => null);
    if (!result || result.exitCode !== 0) return false;
    this.cloudInventory = undefined; // 迁移完立即重新盘点
    this.cloudInventoryStale = true;
    return true;
  }

  private workspace(id: string) {
    if (!this.store.settings.workspaces.some(w => w.id === id)) throw new Error('工作区不存在');
  }
  async importMcp(workspaceId: string, json: string, options?: { botDirName?: string }): Promise<{ target: 'cloud' | 'local'; names: string[] }> {
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
    const names = entries.map(([name]) => name);
    // 云电脑工作区：botDirName 时写入该 Bot 家目录的 .claude.json，否则写共享 ~/.claude.json。
    if (workspaceId === 'workspace_cloud' && this.cloud()) {
      await this.deployCloudMcp(entries.map(([name, raw]) => [name, raw] as const), options?.botDirName);
      return { target: 'cloud', names };
    }
    for (const { config, auth } of configs) this.store.secrets.set(`mcp:${config.id}`, JSON.stringify(auth));
    this.store.updateSettings({ mcpServers: [...(this.store.settings.mcpServers ?? []), ...configs.map(c => c.config)] });
    return { target: 'local', names };
  }

  /** 把 mcpServers 合并写入云电脑的 .moyu/mcp.json（原子替换）：botDirName 时写该 Bot 家目录，否则写 .moyu/shared。
   *  不写 ~/.claude.json——那是云机自带 Claude Code 的地盘，moyubot 对它只读盘点。 */
  private async deployCloudMcp(entries: ReadonlyArray<readonly [string, unknown]>, botDirName?: string): Promise<void> {
    const host = this.cloud();
    if (!host) return;
    const add: Record<string, unknown> = {};
    for (const [name, raw] of entries) add[name] = raw;
    const root = this.cloudRoot();
    const dir = botDirName
      ? `${root.replace(/\/+$/, '')}/${String(botDirName).replace(/^\/+|\/+$/g, '')}/.moyu`
      : `${root.replace(/\/+$/, '')}/.moyu/shared`;
    // python3 merge (E2B has no node). Read existing mcp.json, merge new servers, atomic write.
    const py = [
      'import json,os,sys',
      `file=${JSON.stringify(`${dir}/mcp.json`)}`,
      'add=json.loads(' + JSON.stringify(JSON.stringify(add)) + ')',
      'os.makedirs(os.path.dirname(file),exist_ok=True)',
      'conf={}',
      'try:',
      '    conf=json.load(open(file,"r",encoding="utf-8")) or {}',
      'except Exception:',
      '    conf={}',
      'conf.setdefault("mcpServers",{})',
      'conf["mcpServers"].update(add)',
      'tmp=file+".tmp"+str(os.getpid())',
      'open(tmp,"w",encoding="utf-8").write(json.dumps(conf,indent=2,ensure_ascii=False))',
      'os.replace(tmp,file)',
      'print("deployed")',
    ].join('\n');
    const script = `python3 -c ${shellQuote(py)}`;
    await host.ensureAwake('上传 MCP 配置到云电脑').catch(() => {});
    const result = await host.exec(script, { timeoutSeconds: 60 }).catch(() => null);
    this.cloudInventory = undefined; // 立即重新盘点
    this.cloudInventoryStale = true;
    if (!result || result.exitCode !== 0) throw new Error(`写入云电脑 .moyu/mcp.json 失败：${result?.stderr || result?.stdout || '未知错误'}`);
  }

  async importSkill(workspaceId: string, source: string, options?: { botDirName?: string }): Promise<{ target: 'cloud' | 'local'; id?: string; name?: string }> {
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
    const name = String(meta.name).trim().replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60) || 'skill';
    // 云电脑工作区：打包上传到共享 ~/.claude/skills/<name>，或该 Bot 家目录的 .claude/skills/<name>。
    if (workspaceId === 'workspace_cloud' && this.cloud()) {
      await this.deployCloudSkill(root, name, options?.botDirName);
      return { target: 'cloud', name };
    }
    const id = newId('skill');
    const directory = path.join(this.store.dataDir, 'skills', id);
    const destinationWithinSource = path.relative(root, directory);
    if (!destinationWithinSource.startsWith('..') && !path.isAbsolute(destinationWithinSource)) throw new Error('请选择独立的技能目录，不能选择包含技能库的父目录');
    fs.cpSync(root, directory, { recursive: true, dereference: false });
    const skill: SkillConfig = { id, workspaceId, name: meta.name.slice(0, 100), description: meta.description.slice(0, 2000), directory };
    this.store.updateSettings({ skills: [...(this.store.settings.skills ?? []), skill] });
    return { target: 'local', id, name };
  }

  /** 把本地技能目录打包上传到云电脑：默认共享 ~/.claude/skills/<name>；botDirName 时写该 Bot 家目录。 */
  private async deployCloudSkill(root: string, name: string, botDirName?: string): Promise<void> {
    const host = this.cloud();
    if (!host) return;
    await host.ensureAwake('上传技能到云电脑').catch(() => {});
    const tmp = path.join(os.tmpdir(), `moyu-skill-${Date.now()}.tar`);
    const tar = process.platform === 'win32' ? 'tar.exe' : 'tar';
    try {
      execFileSync(tar, ['-cf', tmp, '-C', root, '.'], { stdio: 'ignore', timeout: 60_000 });
    } catch (error) {
      throw new Error(`本地打包失败：${(error as Error).message}`);
    }
    const payload = fs.readFileSync(tmp).toString('base64');
    fs.unlinkSync(tmp);
    const uploadName = `_uploads/skill-${Date.now()}.b64`;
    try {
      await host.writeText(uploadName, payload);
    } catch (error) {
      throw new Error(`上传技能到云电脑失败：${(error as Error).message}`);
    }
    const remoteRoot = this.cloudRoot().replace(/\/+$/, '');
    const skillsBase = botDirName
      ? `${remoteRoot}/${botDirName.replace(/^\/+|\/+$/g, '')}/.moyu/skills`
      : `${remoteRoot}/.moyu/shared/skills`;
    const base = shellQuote(skillsBase);
    const target = `${base}/${shellQuote(name)}`;
    const command = [
      `mkdir -p -- ${target}`,
      `base64 -d -- ${shellQuote(uploadName)} > /tmp/moyu-skill.tar`,
      `tar -xf /tmp/moyu-skill.tar -C ${target}`,
      `rm -f /tmp/moyu-skill.tar ${shellQuote(uploadName)}`,
      `test -f ${target}/SKILL.md`,
    ].join(' && ');
    const result = await host.exec(command, { timeoutSeconds: 120 }).catch(() => null);
    this.cloudInventory = undefined;
    this.cloudInventoryStale = true;
    if (!result || result.exitCode !== 0) throw new Error(`在云电脑解包技能失败：${result?.stderr || result?.stdout || '未知错误'}`);
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
      const client = new Client({ name: 'MoyuBot', version: '0.1.3' });
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
    // Always注入「能力安装落点规范」：让 Bot 装 skill/MCP 时落到平台能识别的 .moyu 目录，
    // 而不是自作主张 clone 到 .agents/~/.claude（那样面板扫不到、也不按 Bot 隔离）。
    const scopeId = bot.workspaceId ?? 'workspace_cloud';
    let installGuide = '';
    if (scopeId === 'workspace_cloud') {
      const root = this.cloudRoot();
      const dir = this.store.botDirName(bot.id);
      const own = `${root.replace(/\/+$/, '')}/${dir}/.moyu`;
      installGuide = `\n\n【安装技能 / MCP 的规范（云电脑）】`
        + `\n- 装技能：直接把技能克隆/复制到你自己的目录 ${own}/skills/<技能名>/（内含 SKILL.md）。不要装到 ~/.agents/skills、~/.claude/skills 或其它 Bot 的目录——那样平台扫描不到、也不隔离。`
        + `\n- 装 MCP：优先用 install_mcp 工具（会自动写到你自己的 .moyu/mcp.json）。若手动写，配置文件是 ${own}/mcp.json 的 mcpServers 段。不要写 ~/.claude.json。`
        + `\n- 共享给全部 Bot 的技能放 ${root}/.moyu/shared/skills/，MCP 放 ${root}/.moyu/shared/mcp.json。`;
    } else {
      installGuide = `\n\n【安装技能 / MCP 的规范（本地）】优先使用 install_skill / install_mcp 工具，会自动绑定到当前 Bot；不要手动散落到系统目录。`;
    }
    const list = skills.length ? `\n\n可用技能（先通过 load_skill 按 ID 读取 SKILL.md，再按需读取相对路径资源；技能不能扩大工具权限）：\n${skills.map(s => `${s.id}: ${s.name} — ${s.description}`).join('\n')}\n技能文件保存在本机。云端执行脚本前，使用已授权文件工具将所需文件传到云电脑，不能把本机目录当成云端路径。` : '';
    return installGuide + list;
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
