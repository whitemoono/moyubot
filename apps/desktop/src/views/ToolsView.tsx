import { useEffect, useState } from 'react';
import { useMoyu } from '../state';
import { moyu } from '../lib/bridge';

/** 依赖云电脑的工具（需要唤醒共享云主机执行）。 */
const CLOUD_TOOLS = new Set(['cloud_exec', 'cloud_read', 'cloud_write', 'desktop_action']);
/** 系统级安装工具，不参与 Bot 工具列表展示。 */
const HIDDEN_TOOLS = new Set(['install_mcp', 'install_skill']);

export function ToolsView() {
  const { settings, activeWorkspace } = useMoyu();
  const [builtin, setBuiltin] = useState<{ name: string; description: string }[]>([]);
  useEffect(() => {
    let active = true;
    moyu().listTools().then((tools) => { if (active) setBuiltin(tools.filter((tool) => !HIDDEN_TOOLS.has(tool.name))); }).catch(() => {});
    return () => { active = false; };
  }, []);
  const workspaceId = activeWorkspace?.id ?? 'workspace_cloud';
  const mcp = (settings.mcpServers ?? []).filter((server) => server.workspaceId === workspaceId);
  const skills = (settings.skills ?? []).filter((skill) => skill.workspaceId === workspaceId);
  const bots = settings.bots.filter((bot) => (bot.workspaceId ?? 'workspace_cloud') === workspaceId);
  const defaultTools = builtin.map((tool) => tool.name);

  return (
    <div className="tools-page">
      <div className="tools-stats">
        <div className="stat-card"><strong>{builtin.length}</strong><span>内置工具</span></div>
        <div className="stat-card"><strong>{mcp.length}</strong><span>MCP 服务</span></div>
        <div className="stat-card"><strong>{skills.length}</strong><span>技能</span></div>
        <div className="stat-card"><strong>{bots.length}</strong><span>使用中的 Bot</span></div>
      </div>

      <h3 className="settings-section-title">内置工具</h3>
      <div className="tools-grid">
        {builtin.map((tool) => (
          <div className="tool-card" key={tool.name}>
            <div className="tool-card__head">
              <code>{tool.name}</code>
              {CLOUD_TOOLS.has(tool.name) ? <span className="tool-badge tool-badge--cloud">云电脑</span> : <span className="tool-badge">内置</span>}
            </div>
            <p title={tool.description}>{tool.description}</p>
          </div>
        ))}
      </div>

      <h3 className="settings-section-title">Bot 使用情况</h3>
      <div className="settings-card">
        <div className="settings-rows">
          {bots.map((bot) => {
            const tools = bot.tools.length ? bot.tools.filter((tool) => builtin.some((item) => item.name === tool)) : defaultTools;
            return (
              <div className="settings-row" key={bot.id}>
                <div><strong>{bot.name}</strong><p>{tools.length} 个工具 · {bot.mcpServerIds?.length ?? 0} 个 MCP · {bot.skillIds?.length ?? 0} 个技能</p></div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
