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
  return <div className="capabilities-settings">
    <Panel className="settings-card">
      <h3>MCP 服务 <small>{activeWorkspace?.name}</small></h3>
      <p className="settings-note">{workspaceId === 'workspace_cloud' ? '导入的 mcpServers 配置写入云电脑的 .moyu/shared/mcp.json（moyubot 自有命名空间，全部 Bot 共用；与云机自带的 claude 配置分离）。Bot 在对话里自己安装的会写入它专属的 .moyu/mcp.json。' : '工作区内共享配置，每个 Bot 独立启用。stdio 在本机启动程序；远程服务使用 Streamable HTTP。'}</p>
      <Field label="导入 MCP JSON" hint={workspaceId === 'workspace_cloud' ? '上传到云电脑（.moyu/shared/mcp.json），支持常见的 mcpServers 配置。' : '支持常见的 mcpServers 配置，env 和 headers 单独加密保存。导入后点击连接测试会启动服务。'}>
        <textarea className="textarea mono" aria-label="MCP JSON 配置" spellCheck={false} rows={7} value={json} onChange={e => setJson(e.target.value)} placeholder={'{\n  "mcpServers": {\n    "my-service": { "url": "https://example.com/mcp" }\n  }\n}'} />
      </Field>
      <Button icon="plus" disabled={busy || !json.trim()} onClick={() => void run(async () => { const result = await moyu().importMcp(workspaceId, json); setJson(''); toast(result.target === 'cloud' ? `已上传到云电脑：${result.names?.join('、')}` : '已导入 MCP，请测试连接并为 Bot 启用'); })}>{workspaceId === 'workspace_cloud' ? '上传到云电脑' : '导入服务'}</Button>
      {servers.map(server => { const state = status.servers.find(s => s.id === server.id); return <div className="capability-config" key={server.id}>
        <div><strong>{server.name}</strong><small>{server.transport === 'stdio' ? `${server.command} · 本机进程` : server.url}{server.hasSecrets ? ' · 已保存认证配置' : ''}</small><small>{state?.state === 'connected' ? `已连接 · ${state.tools.length} 个工具` : state?.state === 'connecting' ? '连接中…' : state?.error ?? '等待连接测试'}</small></div>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(async () => { await moyu().testMcp(server.id); toast('MCP 连接成功'); })}>测试连接</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => moyu().removeCapability('mcp', server.id))}>移除</Button>
      </div>; })}
    </Panel>
    {workspaceId === 'workspace_cloud' && ((status.cloudServers?.length) || (status.cloudSkills?.length)) ? <Panel className="settings-card">
      <h3>云电脑已部署 <small>由云主机盘点 · 只读</small></h3>
      <p className="settings-note">云电脑上的能力分三档：自有（Bot 家目录的 .moyu）、共享（.moyu/shared，moyubot 管理）、claude（云机自带 ~/.claude，只读展示，moyubot 不写入）。</p>
      {status.cloudServers?.length ? <details className="capability-cloud-block capability-cloud-block--fold" open>
        <summary className="capability-cloud-title">MCP 服务（{status.cloudServers.length}）</summary>
        <div className="capability-cloud-list capability-cloud-list--grid">{status.cloudServers.map(server => <div className="capability-item" key={server.id}><span className="capability-cloud-badge">{server.botId ? '自有' : server.source.includes('claude') ? 'claude' : '共享'}</span><div><strong>{server.name}</strong><small>{server.transport === 'stdio' ? server.command : server.url} · {server.source}</small></div></div>)}</div>
      </details> : null}
      {status.cloudSkills?.length ? <details className="capability-cloud-block capability-cloud-block--fold" style={{ marginTop: 12 }}>
        <summary className="capability-cloud-title">技能（{status.cloudSkills.length}）</summary>
        <div className="capability-cloud-list capability-cloud-list--grid">{status.cloudSkills.map(skill => <div className="capability-item" key={skill.id}><span className="capability-cloud-badge">{skill.botId ? '自有' : skill.source.includes('claude') ? 'claude' : '共享'}</span><div><strong>{skill.name}</strong><small>{skill.source}</small></div></div>)}</div>
      </details> : null}
    </Panel> : null}
    <Panel className="settings-card">
      <div className="inspector-section__head"><h3>技能库</h3><Button size="sm" icon="plus" disabled={busy} onClick={() => void run(async () => { const result = await moyu().importSkill(workspaceId); toast(result.target === 'cloud' ? `已上传技能到云电脑：${result.name ?? ''}` : '已导入技能，可在 Bot 编辑页或右侧详情中启用'); })}>{workspaceId === 'workspace_cloud' ? '上传技能到云电脑' : '导入技能目录'}</Button></div>
      <p className="settings-note">{workspaceId === 'workspace_cloud' ? '选择含 SKILL.md 的目录，打包上传到云电脑 .moyu/shared/skills（全部 Bot 共用）。Bot 对话里安装的技能会放进它专属的 .moyu/skills。' : '选择含 SKILL.md 的目录，会连同参考资料和脚本复制到本地技能库。文件更新后需重新导入。技能使用 Bot 已有工具与权限。'}</p>
      {!skills.length ? <p className="inspector-note">还没有技能。导入后在 Bot 编辑页或右侧详情中启用。</p> : skills.map(skill => <div className="capability-config" key={skill.id}><div><strong>{skill.name}</strong><p>{skill.description}</p></div><Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => moyu().removeCapability('skill', skill.id))}>移除</Button></div>)}
    </Panel>
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
