import { useEffect, useMemo, useState } from 'react';
import { useMoyu } from '../state';
import { moyu } from '../lib/bridge';
import { Icon } from '../components/Icon';
import { BotAvatar } from '../components/BotAvatar';

/** 依赖云电脑的工具（需要唤醒共享云主机执行）。 */
const CLOUD_TOOLS = new Set(['cloud_exec', 'cloud_read', 'cloud_write', 'desktop_action']);
/** 系统级安装工具：默认启用（安装动作仍需审批），这里不再单独隐藏。 */
const HIDDEN_TOOLS = new Set<string>();
const GROUP_ICONS: Record<string, string> = { computer: 'terminal', edit: 'edit', office: 'grid', deliver: 'folder', local: 'folder', web: 'search', memory: 'history', task: 'check', schedule: 'clock', agent: 'users', install: 'plug', plan: 'sliders' };

/** 工具分组：按"用户会怎么想"分类，而不是按代码模块。 */
const GROUPS: { id: string; title: string; hint: string; tools: string[] }[] = [
  { id: 'computer', title: '电脑操作', hint: '在 Bot 所属的电脑上执行命令、读写文件', tools: ['cloud_exec', 'cloud_read', 'cloud_write', 'desktop_action'] },
  { id: 'edit', title: '代码编辑', hint: '批量读文件、一条补丁改多处', tools: ['read_files', 'apply_patch'] },
  { id: 'office', title: '文档生成', hint: '生成并交付 Excel / Word / PPT', tools: ['make_spreadsheet', 'make_document', 'make_slides'] },
  { id: 'deliver', title: '文件交付', hint: '把文件变成对话里的卡片、把本机附件送到云机', tools: ['deliver_file', 'cloud_stage_file'] },
  { id: 'local', title: '本机文件', hint: '直接读写你这台电脑的工作区，不唤醒云电脑', tools: ['local_read_file', 'local_list_files', 'local_write_file'] },
  { id: 'web', title: '联网', hint: '搜索、抓取网页、生成图片', tools: ['web_search', 'web_fetch', 'generate_image'] },
  { id: 'memory', title: '记忆与检索', hint: '长期记忆、历史对话搜索、项目状态', tools: ['remember', 'recall', 'history_search', 'project_list', 'project_upsert', 'project_switch'] },
  { id: 'task', title: '目标与清单', hint: '跨轮目标、待办清单、向用户提问', tools: ['set_goal', 'update_goal', 'todo_write', 'ask_user'] },
  { id: 'schedule', title: '定时任务', hint: '创建、查询、启停定时任务', tools: ['schedule_task', 'list_tasks', 'update_task'] },
  { id: 'agent', title: '多智能体', hint: '派子代理并行调研、脚本编排、运行中任务管控', tools: ['spawn_agent', 'run_script', 'subagent_fork', 'subagent_list_agents', 'subagent_control', 'job_list', 'job_kill'] },
  { id: 'install', title: '能力安装', hint: '对话内安装 MCP 服务与技能', tools: ['install_mcp', 'install_skill'] },
  { id: 'plan', title: '计划模式', hint: '计划模式下提交方案并请求批准', tools: ['exit_plan_mode'] },
];

export function ToolsView() {
  const { settings, activeWorkspace } = useMoyu();
  const [builtin, setBuiltin] = useState<{ name: string; description: string }[]>([]);
  const [query, setQuery] = useState('');
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  // 默认全部折叠：39 个工具展开太占地方，先给总览，想看哪组再展开。
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [searchCollapsed, setSearchCollapsed] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let active = true;
    moyu().listTools().then((tools) => {
      if (!active) return;
      setBuiltin(tools.filter((tool) => !HIDDEN_TOOLS.has(tool.name)));
      setLoadState('ready');
    }).catch(() => { if (active) setLoadState('error'); });
    return () => { active = false; };
  }, []);
  const workspaceId = activeWorkspace?.id ?? 'workspace_cloud';
  const mcp = (settings.mcpServers ?? []).filter((server) => server.workspaceId === workspaceId);
  const skills = (settings.skills ?? []).filter((skill) => skill.workspaceId === workspaceId);
  const bots = settings.bots.filter((bot) => (bot.workspaceId ?? 'workspace_cloud') === workspaceId);
  const activeBotCount = (name: string) => bots.filter((bot) => !bot.tools.length || bot.tools.includes(name)).length;
  const byName = useMemo(() => new Map(builtin.map((tool) => [tool.name, tool])), [builtin]);
  // 未归组的工具兜底展示，避免新增工具"消失"
  const grouped = new Set(GROUPS.flatMap((group) => group.tools));
  const others = builtin.filter((tool) => !grouped.has(tool.name));
  const term = query.trim().toLowerCase();
  const visibleGroups = [...GROUPS, { id: 'others', title: '其他', hint: '还没归组的工具', tools: others.map((tool) => tool.name) }].map(group => ({
    ...group,
    names: group.tools.filter(name => {
      const tool = byName.get(name);
      return tool && [name, tool.description, group.title].some(text => text?.toLowerCase().includes(term));
    }),
  })).filter(group => group.names.length);
  const resultCount = visibleGroups.reduce((count, group) => count + group.names.length, 0);

  return (
    <div className="tools-page">
      <div className="catalog-stats">
        {[
          { icon: 'grid', value: builtin.length, label: '内置工具' },
          { icon: 'plug', value: mcp.length, label: '已配置 MCP' },
          { icon: 'spark', value: skills.length, label: '已配置技能' },
          { icon: 'bots', value: bots.length, label: '工作区 Bot' },
        ].map(item => <div className="catalog-stat" key={item.label}><Icon name={item.icon} size={16} /><strong>{item.value}</strong><span>{item.label}</span></div>)}
      </div>

      <div className="catalog-toolbar">
        <label className="catalog-search">
          <Icon name="search" size={15} />
          <input className="input" aria-label="搜索工具" placeholder="搜索工具名或说明…" value={query} onChange={(event) => { setQuery(event.target.value); setSearchCollapsed({}); }} />
        </label>
        <span className="tools-toolbar__hint" role="status">{term ? `找到 ${resultCount} 个工具` : `${visibleGroups.length} 组 · ${resultCount} 个工具`}</span>
      </div>

      <div className="tools-sections">
        {visibleGroups.map((group) => {
          const { names } = group;
          const isCollapsed = term ? !!searchCollapsed[group.id] : collapsed[group.id] ?? true;
          return (
            <section className="tools-section" key={group.id}>
              <button type="button" className="tools-section__head" aria-expanded={!isCollapsed} onClick={() => (term ? setSearchCollapsed : setCollapsed)((prev) => ({ ...prev, [group.id]: !isCollapsed }))}>
                <span className="catalog-icon"><Icon name={GROUP_ICONS[group.id] ?? 'grid'} size={16} /></span>
                <span className="tools-section__label"><strong>{group.title}</strong><small>{group.hint}</small></span>
                <span className="tools-section__count">{names.length}</span>
                <Icon name="chevron" size={14} className={isCollapsed ? '' : 'is-open'} />
              </button>
              {isCollapsed ? null : (
                <div className="tools-section__grid">
                  {names.map((name) => {
                    const tool = byName.get(name)!;
                    const users = activeBotCount(name);
                    return (
                      <div className="tool-card" key={name}>
                        <div className="tool-card__head">
                          <code>{name}</code>
                          {CLOUD_TOOLS.has(name) ? <span className="catalog-tag">{activeWorkspace?.kind === 'local' ? '本机' : '云电脑'}</span> : null}
                          {users ? <span className="tool-badge tool-badge--use">{users} 个 Bot</span> : <span className="tool-badge tool-badge--idle">未启用</span>}
                        </div>
                        <p title={tool.description}>{tool.description}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
        {!visibleGroups.length ? <p className="catalog-empty">{loadState === 'loading' ? '正在加载工具…' : loadState === 'error' ? '工具列表加载失败。' : term ? '没有匹配的工具，试试其他关键词。' : '当前没有可用工具。'}</p> : null}
      </div>

      <h3 className="settings-section-title">Bot 使用情况</h3>
      <div className="settings-card">
        <div className="settings-rows">
          {bots.map((bot) => {
            const tools = bot.tools.length ? bot.tools.filter((tool) => builtin.some((item) => item.name === tool)) : builtin.filter((item) => !HIDDEN_TOOLS.has(item.name)).map((item) => item.name);
            return (
              <div className="settings-row" key={bot.id}>
                <BotAvatar bot={bot} animated={false} />
                <div><strong>{bot.name}</strong><p>{tools.length} 个工具 · {bot.mcpServerIds?.length ?? 0} 个 MCP · {bot.skillIds?.length ?? 0} 个技能</p></div>
              </div>
            );
          })}
          {!bots.length ? <p className="catalog-empty">当前工作区还没有 Bot。</p> : null}
        </div>
      </div>
    </div>
  );
}
