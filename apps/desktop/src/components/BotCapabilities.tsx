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
  const workspaceId = bot.workspaceId ?? settings.activeWorkspaceId ?? 'workspace_cloud';
  // 云工作区的详情只显示"云电脑已部署"的能力；本机进程(stdio)的 MCP/Skills 只在本地工作区出现。
  const isLocalWorkspace = workspaceId === 'workspace_local';
  const status = useCapabilityStatus(workspaceId);
  const servers = (settings.mcpServers ?? []).filter(s => s.workspaceId === workspaceId);
  const skills = (settings.skills ?? []).filter(s => s.workspaceId === workspaceId);
  const cloudServers = (status.cloudServers ?? []).filter(s => !s.botId || s.botId === bot.id);
  const cloudSkills = (status.cloudSkills ?? []).filter(s => !s.botId || s.botId === bot.id);
  const toggle = (field: 'mcpServerIds' | 'skillIds', id: string, enabled: boolean) => onChange({ [field]: enabled ? [...new Set([...(bot[field] ?? []), id])] : (bot[field] ?? []).filter(x => x !== id) });
  return <div className={`bot-capabilities ${inspector ? 'bot-capabilities--inspector' : ''}`}>
    <section className={inspector ? 'inspector-section' : 'editor-block'}>
      <div className="inspector-section__head"><h3>MCP 服务</h3>{inspector && isLocalWorkspace ? <Button size="sm" variant="ghost" icon="plus" data-testid="bot-cap-add" onClick={() => openSettings('capabilities')}>添加</Button> : null}</div>
      {isLocalWorkspace ? (!servers.length ? <p className="inspector-note">添加外部工具服务，再为这个 Bot 启用。</p> : <>
        {(() => {
          const own = servers.filter(s => bot.mcpServerIds?.includes(s.id) ?? false);
          const others = servers.filter(s => !(bot.mcpServerIds?.includes(s.id) ?? false));
          const renderRow = (server: { id: string; name: string; transport: string; command?: string; url?: string }) => {
            const state = status.servers.find(s => s.id === server.id);
            const enabled = bot.mcpServerIds?.includes(server.id) ?? false;
            const detail = `${STATES[state?.state ?? 'disconnected']} · ${server.transport === 'stdio' ? server.command ?? '本机进程' : server.url ?? '远程服务'}${state?.tools.length ? ` · ${state.tools.length} 工具` : ''}`;
            return <div className="capability-item" key={server.id} title={state?.error ?? detail}>
              <span className="capability-cloud-badge">{enabled ? '自有' : '未绑定'}</span>
              <div className="capability-item__main">
                <Toggle testId={`bot-cap-mcp-${server.id}`} label={server.name} hint={detail} checked={enabled} disabled={disabled} onChange={value => toggle('mcpServerIds', server.id, value)} />
              </div>
            </div>;
          };
          return <>
            {own.length ? <details className="cap-card" data-testid={`cap-local-own`}><summary className="cap-card__head"><span>自有 · 已启用</span><span className="cap-card__count">{own.length}</span></summary><div className="cap-card__body">{own.map(renderRow)}</div></details> : null}
            {others.length ? <details className="cap-card" data-testid={`cap-local-others`}><summary className="cap-card__head"><span>其它 · 可添加</span><span className="cap-card__count">{others.length}</span></summary><div className="cap-card__body">{others.map(renderRow)}</div></details> : null}
          </>;
        })()}
      </>) : cloudServers.length ? null : <p className="inspector-note">云电脑还没有部署 MCP 服务。</p>}
      {isLocalWorkspace ? null : cloudServers.length ? <details className="capability-cloud-block capability-cloud-block--fold">
        <summary className="capability-cloud-title">云电脑已部署 · MCP（{cloudServers.length}）</summary>
        <div className="capability-cloud-list">{cloudServers.map(server => <div className="capability-item" key={server.id}>
          <span className="capability-cloud-badge">{server.botId ? '自有' : '共享'}</span>
          <div><strong>{server.name}</strong><small>{server.transport === 'stdio' ? server.command : server.url} · {server.source}</small></div>
        </div>)}</div>
      </details> : null}
    </section>
    <section className={inspector ? 'inspector-section' : 'editor-block'}>
      <div className="inspector-section__head"><h3>Skills</h3>{inspector && isLocalWorkspace ? <Button size="sm" variant="ghost" icon="plus" data-testid="bot-cap-add" onClick={() => openSettings('capabilities')}>添加</Button> : null}</div>
      {isLocalWorkspace ? (!skills.length ? <p className="inspector-note">导入含 SKILL.md 的目录，让 Bot 按需使用技能。</p> : <>
        {(() => {
          const own = skills.filter(s => bot.skillIds?.includes(s.id) ?? false);
          const others = skills.filter(s => !(bot.skillIds?.includes(s.id) ?? false));
          const renderRow = (skill: { id: string; name: string; description: string }) => {
            const loaded = status.loadedSkills.find(s => s.botId === bot.id && s.skillId === skill.id);
            const enabled = bot.skillIds?.includes(skill.id) ?? false;
            const statusText = enabled ? (loaded ? `最近加载 ${new Date(loaded.loadedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : '已启用') : '未启用';
            return <div className="capability-item" key={skill.id} title={skill.description}>
              <span className="capability-cloud-badge">{enabled ? '自有' : '未绑定'}</span>
              <div className="capability-item__main">
                <Toggle testId={`bot-cap-skill-${skill.id}`} label={skill.name} hint={statusText} checked={enabled} disabled={disabled} onChange={value => toggle('skillIds', skill.id, value)} />
              </div>
            </div>;
          };
          return <>
            {own.length ? <details className="cap-card" data-testid={`cap-local-own`}><summary className="cap-card__head"><span>自有 · 已启用</span><span className="cap-card__count">{own.length}</span></summary><div className="cap-card__body">{own.map(renderRow)}</div></details> : null}
            {others.length ? <details className="cap-card" data-testid={`cap-local-others`}><summary className="cap-card__head"><span>其它 · 可添加</span><span className="cap-card__count">{others.length}</span></summary><div className="cap-card__body">{others.map(renderRow)}</div></details> : null}
          </>;
        })()}
      </>) : cloudSkills.length ? null : <p className="inspector-note">云电脑还没有部署 Skills。</p>}
      {isLocalWorkspace ? null : cloudSkills.length ? <details className="capability-cloud-block capability-cloud-block--fold">
        <summary className="capability-cloud-title">云电脑已部署 · 技能（{cloudSkills.length}）</summary>
        <div className="capability-cloud-list">{cloudSkills.map(skill => <div className="capability-item" key={skill.id}>
          <span className="capability-cloud-badge">{skill.botId ? '自有' : '共享'}</span>
          <div><strong>{skill.name}</strong><small>{skill.source}</small></div>
        </div>)}</div>
      </details> : null}
    </section>
    {!inspector ? <p className="inspector-note">在「设置 → MCP 与 Skills」添加或管理工作区能力。</p> : null}
  </div>;
}
