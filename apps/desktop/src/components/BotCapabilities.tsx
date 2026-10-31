import { useEffect, useState } from 'react';
import type { Bot, CapabilityStatus } from '@moyu/core';
import { moyu } from '../lib/bridge';
import { useMoyu } from '../state';
import { Button, Toggle } from './Glass';

export function useCapabilityStatus(workspaceId: string) {
  const [status, setStatus] = useState<CapabilityStatus>({ servers: [], loadedSkills: [] });
  useEffect(() => {
    let active = true, pending = false;
    setStatus({ servers: [], loadedSkills: [] });
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try { const next = await moyu().capabilityStatus(workspaceId); if (active) setStatus(next); } catch { /* next poll retries */ }
      finally { pending = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => { active = false; window.clearInterval(timer); };
  }, [workspaceId]);
  return status;
}

const STATES = { disconnected: '未连接', connecting: '连接中', connected: '已连接', error: '连接失败', deployed: '已部署' };

export function BotCapabilities({ bot, onChange, disabled = false, inspector = false }: { bot: Bot; onChange: (patch: Pick<Bot, 'mcpServerIds' | 'skillIds'>) => void; disabled?: boolean; inspector?: boolean }) {
  const { settings, openSettings, toast } = useMoyu();
  const [testing, setTesting] = useState<string | null>(null);
  const workspaceId = bot.workspaceId ?? settings.activeWorkspaceId ?? 'workspace_cloud';
  // 云工作区的详情只显示"云电脑已部署"的能力；本机进程(stdio)的 MCP/Skills 只在本地工作区出现。
  const isLocalWorkspace = workspaceId === 'workspace_local';
  const status = useCapabilityStatus(workspaceId);
  const servers = (settings.mcpServers ?? []).filter(s => s.workspaceId === workspaceId);
  const skills = (settings.skills ?? []).filter(s => s.workspaceId === workspaceId);
  const cloudServers = status.cloudServers ?? [];
  const cloudSkills = status.cloudSkills ?? [];
  const toggle = (field: 'mcpServerIds' | 'skillIds', id: string, enabled: boolean) => onChange({ [field]: enabled ? [...new Set([...(bot[field] ?? []), id])] : (bot[field] ?? []).filter(x => x !== id) });
  return <div className={`bot-capabilities ${inspector ? 'bot-capabilities--inspector' : ''}`}>
    <section className={inspector ? 'inspector-section' : 'editor-block'}>
      <div className="inspector-section__head"><h3>MCP 服务</h3>{inspector && isLocalWorkspace ? <Button size="sm" variant="ghost" icon="plus" onClick={() => openSettings('capabilities')}>添加</Button> : null}</div>
      {isLocalWorkspace ? (!servers.length ? <p className="inspector-note">添加外部工具服务，再为这个 Bot 启用。</p> : servers.map(server => {
        const state = status.servers.find(s => s.id === server.id);
        const enabled = bot.mcpServerIds?.includes(server.id) ?? false;
        return <div className="capability-item" key={server.id}>
          <Toggle label={server.name} hint={`${STATES[state?.state ?? 'disconnected']} · ${server.transport === 'stdio' ? '本机进程' : '远程服务'}${state?.state === 'connected' ? ` · ${state.tools.length} 个工具` : ''}`} checked={enabled} disabled={disabled} onChange={value => toggle('mcpServerIds', server.id, value)} />
          {state?.error ? <p className="capability-error">{state.error}</p> : null}
          {inspector && enabled && state?.state !== 'connected' ? <Button size="sm" variant="ghost" disabled={testing !== null} loading={testing === server.id} onClick={() => {
            setTesting(server.id);
            void moyu().testMcp(server.id).then(() => toast('MCP 连接成功')).catch((e: Error) => toast(e.message, 'error')).finally(() => setTesting(null));
          }}>测试连接</Button> : null}
          {state?.tools.length ? <details><summary>查看工具</summary><ul>{state.tools.map(tool => <li key={tool.name} title={tool.description}>{tool.name}</li>)}</ul></details> : null}
        </div>;
      })) : cloudServers.length ? null : <p className="inspector-note">云电脑还没有部署 MCP 服务。</p>}
      {isLocalWorkspace ? null : cloudServers.length ? <details className="capability-cloud-block capability-cloud-block--fold">
        <summary className="capability-cloud-title">云电脑已部署 · MCP（{cloudServers.length}）</summary>
        <div className="capability-cloud-list">{cloudServers.map(server => <div className="capability-item" key={server.id}>
          <span className="capability-cloud-badge">云端</span>
          <div><strong>{server.name}</strong><small>{server.transport === 'stdio' ? server.command : server.url} · 由云电脑管理</small></div>
        </div>)}</div>
      </details> : null}
    </section>
    <section className={inspector ? 'inspector-section' : 'editor-block'}>
      <div className="inspector-section__head"><h3>Skills</h3>{inspector && isLocalWorkspace ? <Button size="sm" variant="ghost" icon="plus" onClick={() => openSettings('capabilities')}>添加</Button> : null}</div>
      {isLocalWorkspace ? (!skills.length ? <p className="inspector-note">导入含 SKILL.md 的目录，让 Bot 按需使用技能。</p> : skills.map(skill => {
        const loaded = status.loadedSkills.find(s => s.botId === bot.id && s.skillId === skill.id);
        return <div className="capability-item" key={skill.id}>
          <Toggle label={skill.name} hint={bot.skillIds?.includes(skill.id) ? loaded ? `最近加载 ${new Date(loaded.loadedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : '已启用 · 按需加载' : '未启用'} checked={bot.skillIds?.includes(skill.id) ?? false} disabled={disabled} onChange={value => toggle('skillIds', skill.id, value)} />
          <details><summary>技能说明</summary><p>{skill.description}</p></details>
        </div>;
      })) : cloudSkills.length ? null : <p className="inspector-note">云电脑还没有部署 Skills。</p>}
      {isLocalWorkspace ? null : cloudSkills.length ? <details className="capability-cloud-block capability-cloud-block--fold">
        <summary className="capability-cloud-title">云电脑已部署 · 技能（{cloudSkills.length}）</summary>
        <div className="capability-cloud-list">{cloudSkills.map(skill => <div className="capability-item" key={skill.id}>
          <span className="capability-cloud-badge">云端</span>
          <div><strong>{skill.name}</strong><small>{skill.path} · {skill.source}</small></div>
        </div>)}</div>
      </details> : null}
    </section>
    {!inspector ? <p className="inspector-note">在「设置 → MCP 与 Skills」添加或管理工作区能力。</p> : null}
  </div>;
}
