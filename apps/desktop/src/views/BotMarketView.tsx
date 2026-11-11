import { useCallback, useEffect, useState } from 'react';
import { useMoyu } from '../state';
import { moyu } from '../lib/bridge';
import { MARKET_INDEX_URL } from '../lib/market';
import type { BotTemplate, BotMarketState } from '@moyu/core';
import { Icon } from '../components/Icon';

/** 设置 → Bot 市场：打开即展示全部可导入模板（内置通用 + 远程），按来源分组。 */
export function BotMarketView() {
  const { saveBot, toast, activeWorkspace, workspaces, settings } = useMoyu();
  const [official, setOfficial] = useState<BotTemplate[]>([]);
  const [remote, setRemote] = useState<BotTemplate[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [submissions, setSubmissions] = useState<BotMarketState['submissions']>([]);
  // 导入目标工作区：默认当前激活工作区，用户可显式切换
  const [targetWorkspaceId, setTargetWorkspaceId] = useState<string>('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let active = true;
    moyu().listBotPresets().then((list) => { if (active) setOfficial(list ?? []); }).catch(() => {});
    moyu().marketSubmissions().then((state) => { if (active) setSubmissions(state?.submissions ?? []); }).catch(() => {});
    setTargetWorkspaceId(activeWorkspace?.id ?? 'workspace_cloud');
    // 自动拉取远程市场索引，让专用预设打开即见（无需手动点拉取）
    setRemoteLoading(true);
    moyu().fetchMarketRemote(MARKET_INDEX_URL)
      .then((list) => { if (active) setRemote(list ?? []); })
      .catch(() => { /* 远程不可用时静默降级，仅显示内置 */ })
      .finally(() => { if (active) setRemoteLoading(false); });
    return () => { active = false; };
  }, [activeWorkspace?.id]);

  const targetWorkspace = workspaces.find((w) => w.id === targetWorkspaceId) ?? activeWorkspace ?? workspaces[0];
  const workspaceId = targetWorkspace?.id ?? 'workspace_cloud';
  const workspaceLabel = targetWorkspace?.kind === 'cloud' ? '云电脑工作区' : '本地工作区';

  const importTemplate = useCallback(async (template: BotTemplate, targetWorkspaceId: string) => {
    const exists = settings.bots.some((bot) => bot.name === template.meta.name && (bot.workspaceId ?? 'workspace_cloud') === targetWorkspaceId);
    if (exists) { toast(`「${template.meta.name}」已在目标工作区`, 'warn'); return; }
    try {
      const bot = await moyu().importBotTemplate(template, targetWorkspaceId);
      await saveBot(bot, { stayInSettings: true });
      const ws = workspaces.find((w) => w.id === (bot.workspaceId ?? ''))?.kind === 'cloud' ? '云电脑工作区' : '本地工作区';
      toast(`已导入「${bot.name}」→ ${ws}`);
    } catch (error) {
      toast(error instanceof Error ? error.message : '导入失败', 'error');
    }
  }, [settings.bots, saveBot, workspaces, toast]);

  const term = query.trim().toLowerCase();
  // 分组：内置通用套 + 远程专用套（去重 handle）
  const groups: { key: string; title: string; note: string; templates: BotTemplate[] }[] = [];
  const allGeneral = [...official, ...remote];
  const seen = new Set<string>();
  const general = allGeneral.filter((t) => { if (seen.has(t.meta.handle)) return false; seen.add(t.meta.handle); return (t.meta.category ?? '通用') === '通用'; });
  const special = allGeneral.filter((t) => (t.meta.category ?? '通用') === 'moyubot 专用');
  if (general.length) groups.push({ key: 'general', title: '通用研发助手', note: '内置 · 任何项目可用', templates: general });
  if (special.length) groups.push({ key: 'special', title: 'MoyuBot 专用研发助手', note: '远程 · 标定本仓库', templates: special });
  const visibleGroups = groups.map(group => ({ ...group, templates: group.templates.filter(({ meta }) =>
    [meta.name, meta.handle, meta.description, ...(meta.tags ?? [])].some(value => value?.toLowerCase().includes(term)),
  ) })).filter(group => group.templates.length);

  return (
    <div className="market-page">
      <div className="catalog-stats">
        {[
          { icon: 'bots', value: official.length, label: '内置模板' },
          { icon: 'cloud', value: remote.length, label: '远程模板' },
          { icon: 'grid', value: submissions.length, label: '我上传的' },
          { icon: 'check', value: settings.bots.filter(bot => (bot.workspaceId ?? 'workspace_cloud') === workspaceId).length, label: '目标工作区 Bot' },
        ].map(item => <div className="catalog-stat" key={item.label}><Icon name={item.icon} size={16} /><strong>{item.value}</strong><span>{item.label}</span></div>)}
      </div>
      <div className="catalog-toolbar market-ws">
        <label className="catalog-search">
          <Icon name="search" size={16} />
          <input className="input" aria-label="搜索 Bot 模板" placeholder="搜索名称、标签或简介…" value={query} onChange={e => setQuery(e.target.value)} />
        </label>
        <label className="market-ws__target">
          <span className="market-ws__label">导入到</span>
          <select className="input" value={workspaceId} onChange={(e) => setTargetWorkspaceId(e.target.value)} aria-label="导入目标工作区">
          {(workspaces.length ? workspaces : [activeWorkspace]).filter(Boolean).map((w) => (
            <option key={w!.id} value={w!.id}>{w!.kind === 'cloud' ? '云电脑工作区' : '本地工作区'}</option>
          ))}
          </select>
        </label>
      </div>
      <p className="market-note"><Icon name="shield" size={15} />导入到{workspaceLabel}的 Bot 默认在执行操作前请求确认。</p>

      {visibleGroups.map((group) => (
        <section className="market-group" key={group.key}>
          <div className="market-group__head">
            <strong>{group.title}</strong>
            <small>{group.note} · {group.templates.length} 个</small>
          </div>
          <div className="market-grid">
            {group.templates.map((template) => {
              const installed = settings.bots.some((bot) => bot.name === template.meta.name && (bot.workspaceId ?? 'workspace_cloud') === workspaceId);
              const toolCount = template.bot.tools?.length ?? 0;
              return (
                <div className="tool-card market-card" key={template.meta.handle}>
                  <div className="tool-card__head">
                    <span className="catalog-icon"><Icon name={group.key === 'special' ? 'spark' : 'bots'} size={18} /></span>
                    <strong className="market-card__name">{template.meta.name}</strong>
                  </div>
                  <p className="market-card__desc">{template.meta.description || '这个模板还没有简介。'}</p>
                  <div className="market-card__meta">{template.meta.tags?.slice(0, 2).map(tag => <span className="catalog-tag" key={tag}>{tag}</span>)}{toolCount ? <span className="catalog-tag">{toolCount} 个工具</span> : null}</div>
                  <div className="market-card__foot">
                    <code title={template.meta.handle}>{template.meta.handle}</code>
                    <button type="button" className="market-card__import" aria-label={installed ? undefined : `导入「${template.meta.name}」`} disabled={installed} onClick={() => void importTemplate(template, workspaceId)}><Icon name={installed ? 'check' : 'plus'} size={14} />{installed ? '已导入' : '导入'}</button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
      {!visibleGroups.length ? <p className="catalog-empty" role="status">{remoteLoading ? '正在加载模板…' : term ? '没有匹配的模板，试试其他关键词。' : '暂无可用模板。'}</p> : null}

      <h3 className="settings-section-title">我上传的模板</h3>
      <div className="settings-card">
        {submissions.length ? (
          <div className="settings-rows">
            {submissions.map((sub) => (
              <div className="settings-row" key={sub.handle}>
                <div><strong>{sub.name}</strong><p><code>{sub.handle}</code>{sub.target ? <span> · {sub.target}</span> : null} · {new Date(sub.submittedAt).toLocaleDateString()}</p></div>
                <button type="button" className="market-card__import market-card__import--ghost" onClick={async () => { try { const s = await moyu().unsubmitTemplate(sub.handle); setSubmissions(s.submissions); toast('已移除记录'); } catch (e) { toast(e instanceof Error ? e.message : '操作失败', 'error'); } }}>移除</button>
              </div>
            ))}
          </div>
        ) : (
          <p className="catalog-empty">还没有上传记录。</p>
        )}
      </div>
    </div>
  );
}
