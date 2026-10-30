import { useState } from 'react';
import { useMoyu } from '../state';
import { moyu } from '../lib/bridge';
import { Button, Field, Panel } from '../components/Glass';
import { useCapabilityStatus } from '../components/BotCapabilities';

export function CapabilitiesSettings() {
  const { settings, activeWorkspace, saveSettings, toast } = useMoyu();
  const workspaceId = activeWorkspace?.id ?? 'workspace_cloud';
  const status = useCapabilityStatus(workspaceId);
  const [json, setJson] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
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
      <p className="settings-note">工作区内共享配置，每个 Bot 独立启用。stdio 在本机启动程序；远程服务使用 Streamable HTTP。</p>
      <Field label="导入 MCP JSON" hint="支持常见的 mcpServers 配置，env 和 headers 单独加密保存。导入后点击连接测试会启动服务。">
        <textarea className="textarea mono" aria-label="MCP JSON 配置" spellCheck={false} rows={7} value={json} onChange={e => setJson(e.target.value)} placeholder={'{\n  "mcpServers": {\n    "my-service": { "url": "https://example.com/mcp" }\n  }\n}'} />
      </Field>
      <Button icon="plus" disabled={busy || !json.trim()} onClick={() => void run(async () => { await moyu().importMcp(workspaceId, json); setJson(''); toast('已导入 MCP，请测试连接并为 Bot 启用'); })}>导入服务</Button>
      {servers.map(server => { const state = status.servers.find(s => s.id === server.id); return <div className="capability-config" key={server.id}>
        <div><strong>{server.name}</strong><small>{server.transport === 'stdio' ? `${server.command} · 本机进程` : server.url}{server.hasSecrets ? ' · 已保存认证配置' : ''}</small><small>{state?.state === 'connected' ? `已连接 · ${state.tools.length} 个工具` : state?.state === 'connecting' ? '连接中…' : state?.error ?? '等待连接测试'}</small></div>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(async () => { await moyu().testMcp(server.id); toast('MCP 连接成功'); })}>测试连接</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => moyu().removeCapability('mcp', server.id))}>移除</Button>
      </div>; })}
    </Panel>
    <Panel className="settings-card">
      <div className="inspector-section__head"><h3>技能库</h3><Button size="sm" icon="plus" disabled={busy} onClick={() => void run(() => moyu().importSkill(workspaceId))}>导入技能目录</Button></div>
      <p className="settings-note">选择含 SKILL.md 的目录，会连同参考资料和脚本复制到本地技能库。文件更新后需重新导入。技能使用 Bot 已有工具与权限。</p>
      {!skills.length ? <p className="inspector-note">还没有技能。导入后在 Bot 编辑页或右侧详情中启用。</p> : skills.map(skill => <div className="capability-config" key={skill.id}><div><strong>{skill.name}</strong><p>{skill.description}</p></div><Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => moyu().removeCapability('skill', skill.id))}>移除</Button></div>)}
    </Panel>
    {error ? <p className="capability-error" role="alert">{error}</p> : null}
  </div>;
}
