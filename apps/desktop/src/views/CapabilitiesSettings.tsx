import { useEffect, useState } from 'react';
import type { WebSearchProvider, WebSearchSettings } from '@moyu/core';
import { useMoyu } from '../state';
import { moyu } from '../lib/bridge';
import { Button, Field, Panel } from '../components/Glass';
import { Select } from '../components/Select';
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
  return <div className="capabilities-settings">
    <div className="cap-split">
      {/* ── MCP 服务 ─────────────────────────────────────────────── */}
      <Panel className="settings-card cap-column">
        <h3>MCP 服务 <small>{activeWorkspace?.name}</small></h3>
        <p className="settings-note">{workspaceId === 'workspace_cloud' ? '写入云电脑 .moyu/shared/mcp.json（全部 Bot 共用）；Bot 自己装的写进它专属 .moyu/mcp.json。' : '工作区内共享配置，每个 Bot 独立启用。stdio 在本机启动程序，远程服务用 Streamable HTTP。'}</p>

        <div className="cap-list">
          {servers.length ? servers.map(server => {
            const state = status.servers.find(s => s.id === server.id);
            const stateText = state?.state === 'connected' ? `已连接 · ${state.tools.length} 个工具` : state?.state === 'connecting' ? '连接中…' : state?.error ?? '等待连接测试';
            return <div className="cap-item" key={server.id}>
              <div className="cap-item__main">
                <strong>{server.name}</strong>
                <small>{server.transport === 'stdio' ? `${server.command} · ${workspaceId === 'workspace_cloud' ? '云机进程' : '本机进程'}` : server.url}</small>
                <small className={state?.error ? 'cap-item__error' : ''}>{stateText}{server.hasSecrets ? ' · 已保存认证' : ''}</small>
              </div>
              <div className="cap-item__actions">
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(async () => { await moyu().testMcp(server.id); toast('MCP 连接成功'); })}>测试</Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => moyu().removeCapability('mcp', server.id))}>移除</Button>
              </div>
            </div>;
          }) : <p className="inspector-note">还没有 MCP 服务。展开下方「导入」添加。</p>}
        </div>

        {workspaceId === 'workspace_cloud' && cloudMcp.length ? <details className="cap-cloud" open>
          <summary>云电脑已部署 · MCP（{cloudMcp.length}）</summary>
          <div className="cap-cloud__list">{cloudMcp.map(server => <div className="cap-item cap-item--cloud" key={server.id}>
            <span className="cap-badge">{server.botId ? '自有' : '共享'}</span>
            <div className="cap-item__main"><strong>{server.name}</strong><small>{server.transport === 'stdio' ? server.command : server.url} · {server.source}</small></div>
          </div>)}</div>
        </details> : null}

        <details className="cap-import">
          <summary>导入 MCP JSON</summary>
          <Field label="mcpServers 配置" hint={workspaceId === 'workspace_cloud' ? '上传到云电脑 .moyu/shared/mcp.json' : 'env 和 headers 单独加密保存'}>
            <textarea className="textarea mono" aria-label="MCP JSON 配置" spellCheck={false} rows={6} value={json} onChange={e => setJson(e.target.value)} placeholder={'{\n  "mcpServers": {\n    "my-service": { "url": "https://example.com/mcp" }\n  }\n}'} />
          </Field>
          <Button icon="plus" disabled={busy || !json.trim()} onClick={() => void run(async () => { const result = await moyu().importMcp(workspaceId, json); setJson(''); toast(result.target === 'cloud' ? `已上传到云电脑：${result.names?.join('、')}` : '已导入 MCP，请测试连接并为 Bot 启用'); })}>{workspaceId === 'workspace_cloud' ? '上传到云电脑' : '导入服务'}</Button>
        </details>
      </Panel>

      {/* ── 技能 ─────────────────────────────────────────────────── */}
      <Panel className="settings-card cap-column">
        <div className="cap-column__head">
          <h3>技能 <small>{activeWorkspace?.name}</small></h3>
          <Button size="sm" icon="plus" disabled={busy} onClick={() => void run(async () => { const result = await moyu().importSkill(workspaceId); if (!result) return; toast(result.target === 'cloud' ? `已上传技能到云电脑：${result.name ?? ''}` : '已导入技能，可在 Bot 编辑页或右侧详情中启用'); })}>{workspaceId === 'workspace_cloud' ? '上传到云机' : '导入目录'}</Button>
        </div>
        <p className="settings-note">{workspaceId === 'workspace_cloud' ? '含 SKILL.md 的目录上传到 .moyu/shared/skills（共用）；Bot 自己装的进它专属 .moyu/skills。' : '含 SKILL.md 的目录会连同参考资料一起复制到本地技能库，更新后需重新导入。'}</p>

        <div className="cap-list">
          {skills.length ? skills.map(skill => <div className="cap-item" key={skill.id}>
            <div className="cap-item__main"><strong>{skill.name}</strong><small title={skill.description}>{skill.description}</small></div>
            <div className="cap-item__actions">
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => moyu().removeCapability('skill', skill.id))}>移除</Button>
            </div>
          </div>) : <p className="inspector-note">还没有技能。点右上角「导入目录」上传含 SKILL.md 的文件夹。</p>}
        </div>

        {workspaceId === 'workspace_cloud' && cloudSkill.length ? <details className="cap-cloud" open>
          <summary>云电脑已部署 · 技能（{cloudSkill.length}）</summary>
          <div className="cap-cloud__list">{cloudSkill.map(skill => <div className="cap-item cap-item--cloud" key={skill.id}>
            <span className="cap-badge">{skill.botId ? '自有' : '共享'}</span>
            <div className="cap-item__main"><strong>{skill.name}</strong><small>{skill.source}</small></div>
          </div>)}</div>
        </details> : null}
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
