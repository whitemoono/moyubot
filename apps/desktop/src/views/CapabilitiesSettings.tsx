import { useEffect, useState } from 'react';
import type { WebSearchProvider, WebSearchSettings } from '@moyu/core';
import { useMoyu } from '../state';
import { moyu } from '../lib/bridge';
import { Button, Field, Panel } from '../components/Glass';
import { Select } from '../components/Select';
import { Icon } from '../components/Icon';
import { useCapabilityStatus } from '../components/BotCapabilities';

const SEARCH_PROVIDERS = [
  { value: 'bing-web', label: 'Bing 网页（免密钥，默认）' },
  { value: 'serper', label: 'Serper（Google 结果，需 Key）' },
  { value: 'brave', label: 'Brave Search（需 Key）' },
  { value: 'bing', label: 'Bing API（需 Key）' },
  { value: 'searxng', label: 'SearXNG 自建实例' },
  { value: 'duckduckgo', label: 'DuckDuckGo（免密钥，国内常不可达）' },
];

export function CapabilitiesSettings() {
  const { settings, activeWorkspace, saveSettings, toast } = useMoyu();
  const workspaceId = activeWorkspace?.id ?? 'workspace_cloud';
  const status = useCapabilityStatus(workspaceId);
  const [json, setJson] = useState('');
  const [showMcpImport, setShowMcpImport] = useState(false);
  // 云端部署动辄十几条（技能尤其多），默认折叠，先给数量概览。
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const toggleGroup = (key: string) => setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState<WebSearchSettings>(settings.webSearch ?? { provider: 'bing-web' });
  useEffect(() => { setSearch(settings.webSearch ?? { provider: 'bing-web' }); }, [settings.webSearch]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); await saveSettings({}); } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const servers = (settings.mcpServers ?? []).filter(s => s.workspaceId === workspaceId);
  const skills = (settings.skills ?? []).filter(s => s.workspaceId === workspaceId);
  const cloudMcp = status.cloudServers ?? [];
  const cloudSkill = status.cloudSkills ?? [];
  const isCloud = workspaceId === 'workspace_cloud';
  const importSkill = () => void run(async () => {
    const result = await moyu().importSkill(workspaceId);
    if (!result) return;
    toast(result.target === 'cloud' ? `已上传技能到云电脑：${result.name ?? ''}` : '已导入技能，可在 Bot 编辑页或右侧详情中启用');
  });

  /** 可折叠分组：标题带数量，默认收起（云端技能常有十几条）。 */
  const CapGroup = ({ id, title, count, children }: { id: string; title: string; count: number; children: React.ReactNode }) => {
    const open = !!openGroups[id];
    return <div className="cap-group">
      <button type="button" className="cap-group__head" data-testid={`cap-group-${id}`} aria-expanded={open} onClick={() => toggleGroup(id)}>
        <Icon name="chevron" size={13} className={open ? 'is-open' : ''} />
        <strong>{title}</strong>
        <span className="cap-group__count">{count}</span>
      </button>
      {open ? <div className="cap-group__body">{children}</div> : null}
    </div>;
  };

  /** 一行能力：名称 + 来源徽标 + 副标题（本机与云端合并展示）。 */
  const CapRow = ({ name, badge, detail, error, testid, children }: { name: string; badge: string; detail: string; error?: boolean; testid?: string; children?: React.ReactNode }) => (
    <div className="cap-item" data-testid={testid}>
      <span className="cap-badge">{badge}</span>
      <div className="cap-item__main">
        <strong>{name}</strong>
        <small className={error ? 'cap-item__error' : ''}>{detail}</small>
      </div>
      {children}
    </div>
  );

  return <div className="capabilities-settings">
    <div className="cap-split">
      {/* ── MCP 服务 ─────────────────────────────────────────── */}
      <Panel className="settings-card cap-column">
        <div className="cap-column__head">
          <h3>MCP 服务</h3>
          <Button size="sm" icon="plus" data-testid="cap-mcp-add" onClick={() => setShowMcpImport(true)}>添加</Button>
        </div>

        <div className="cap-list">
          {servers.length ? <CapGroup id="mcp-local" title={isCloud ? '工作区配置' : '本机配置'} count={servers.length}>{servers.map(server => {
            const state = status.servers.find(s => s.id === server.id);
            const detail = state?.state === 'connected' ? `已连接 · ${state.tools.length} 个工具`
              : state?.state === 'connecting' ? '连接中…'
              : state?.error ?? `${server.transport === 'stdio' ? server.command : server.url} · 未连接`;
            return <CapRow key={server.id} testid={`cap-mcp-row-${server.id}`} name={server.name} badge={isCloud ? '云机' : '本机'} detail={detail} error={!!state?.error}>
              <div className="cap-item__actions">
                <Button size="sm" variant="ghost" data-testid={`cap-mcp-test-${server.id}`} disabled={busy} onClick={() => void run(async () => { await moyu().testMcp(server.id); toast('MCP 连接成功'); })}>测试</Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => moyu().removeCapability('mcp', server.id))}>移除</Button>
              </div>
            </CapRow>;
          })}</CapGroup> : null}
          {cloudMcp.some(s => !s.botId) ? <CapGroup id="mcp-shared" title="云电脑 · 共享" count={cloudMcp.filter(s => !s.botId).length}>{cloudMcp.filter(s => !s.botId).map(server => <CapRow key={server.id} name={server.name} badge="共享"
            detail={`${server.transport === 'stdio' ? server.command : server.url} · ${server.source}`} />)}</CapGroup> : null}
          {cloudMcp.some(s => s.botId) ? <CapGroup id="mcp-own" title="云电脑 · 各 Bot 自有" count={cloudMcp.filter(s => s.botId).length}>{cloudMcp.filter(s => s.botId).map(server => <CapRow key={server.id} name={server.name} badge="自有"
            detail={`${server.transport === 'stdio' ? server.command : server.url} · ${server.source}`} />)}</CapGroup> : null}
          {!servers.length && !cloudMcp.length ? <p className="cap-hint">还没有 MCP 服务。点右上角「添加」，或让 Bot 在对话里安装。</p> : null}
        </div>

        {showMcpImport ? <div className="cap-inline-form">
          <Field label="mcpServers 配置" hint={isCloud ? '上传到云电脑 .moyu/shared/mcp.json' : 'env 和 headers 单独加密保存'}>
            <textarea className="textarea mono" data-testid="cap-mcp-json" aria-label="MCP JSON 配置" spellCheck={false} rows={6} value={json} onChange={e => setJson(e.target.value)} placeholder={'{\n  "mcpServers": {\n    "my-service": { "url": "https://example.com/mcp" }\n  }\n}'} />
          </Field>
          <div className="cap-inline-form__actions">
            <Button size="sm" variant="ghost" onClick={() => setShowMcpImport(false)}>取消</Button>
            <Button size="sm" icon="plus" data-testid="cap-mcp-submit" disabled={busy || !json.trim()} onClick={() => void run(async () => {
              const result = await moyu().importMcp(workspaceId, json);
              setJson(''); setShowMcpImport(false);
              toast(result.target === 'cloud' ? `已上传到云电脑：${result.names?.join('、')}` : '已导入 MCP，请测试连接并为 Bot 启用');
            })}>{isCloud ? '上传到云电脑' : '导入'}</Button>
          </div>
        </div> : null}
      </Panel>

      {/* ── 技能 ─────────────────────────────────────────────── */}
      <Panel className="settings-card cap-column">
        <div className="cap-column__head">
          <h3>技能</h3>
          <Button size="sm" icon="plus" data-testid="cap-skill-add" disabled={busy} onClick={importSkill}>添加</Button>
        </div>

        <div className="cap-list">
          {skills.length ? <CapGroup id="skill-local" title={isCloud ? '工作区配置' : '本地技能库'} count={skills.length}>{skills.map(skill => <CapRow key={skill.id} name={skill.name} badge={isCloud ? '云机' : '本机'} detail={skill.description}>
            <div className="cap-item__actions">
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => moyu().removeCapability('skill', skill.id))}>移除</Button>
            </div>
          </CapRow>)}</CapGroup> : null}
          {cloudSkill.some(s => !s.botId) ? <CapGroup id="skill-shared" title="云电脑 · 共享" count={cloudSkill.filter(s => !s.botId).length}>{cloudSkill.filter(s => !s.botId).map(skill => <CapRow key={skill.id} name={skill.name} badge="共享" detail={skill.source} />)}</CapGroup> : null}
          {cloudSkill.some(s => s.botId) ? <CapGroup id="skill-own" title="云电脑 · 各 Bot 自有" count={cloudSkill.filter(s => s.botId).length}>{cloudSkill.filter(s => s.botId).map(skill => <CapRow key={skill.id} name={skill.name} badge="自有" detail={skill.source} />)}</CapGroup> : null}
          {!skills.length && !cloudSkill.length ? <p className="cap-hint">还没有技能。点右上角「添加」上传含 SKILL.md 的文件夹。</p> : null}
        </div>
      </Panel>
    </div>

    <Panel className="settings-card">
      <h3>联网搜索 <small>web_search 工具</small></h3>
      <p className="settings-note">默认 DuckDuckGo 免密钥可用；换后端需填写密钥或实例地址。此处设置对所有工作区生效。</p>
      <Field label="搜索后端"><Select label="搜索后端" value={search.provider} options={SEARCH_PROVIDERS} onChange={(value) => setSearch({ ...search, provider: value as WebSearchProvider })} /></Field>
      {search.provider !== 'duckduckgo' && search.provider !== 'searxng' ? <Field label="API Key" hint="与供应商密钥同样加密保存在本机。"><input className="input mono" aria-label="搜索 API Key" type="password" value={search.apiKey ?? ''} placeholder="填写后保存" onChange={(event) => setSearch({ ...search, apiKey: event.target.value })} /></Field> : null}
      {search.provider === 'searxng' ? <Field label="实例地址" hint="该实例需允许 format=json 输出。"><input className="input mono" aria-label="SearXNG 地址" value={search.endpoint ?? ''} placeholder="https://searx.example.com" onChange={(event) => setSearch({ ...search, endpoint: event.target.value })} /></Field> : null}
      <Button disabled={busy} onClick={() => void run(async () => { await saveSettings({ webSearch: { ...search, apiKey: search.apiKey?.trim() || undefined, endpoint: search.endpoint?.trim() || undefined } }); toast('联网搜索设置已保存'); })}>保存搜索设置</Button>
    </Panel>
    {error ? <p className="capability-error" role="alert">{error}</p> : null}
  </div>;
}
