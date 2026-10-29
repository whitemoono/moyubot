import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { UsageQuery, UsageReport, UsageRow } from '@moyu/core';
import { useMoyu } from '../state';
import { moyu } from '../lib/bridge';
import { Icon } from '../components/Icon';
import { Select } from '../components/Select';
import { BotAvatar } from '../components/BotAvatar';

const PERIODS = [['24h', '24 小时'], ['7d', '7 天'], ['30d', '30 天'], ['12w', '12 周'], ['12m', '12 个月'], ['custom', '自定义']] as const;
const COLORS = ['#6875ff', '#b18aff', '#42b9b0', '#f1ae65', '#e77fa4', '#72a9ec', '#a2bf6a', '#9b91a8'];
const compact = (value: number) => Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
const exact = (value: number) => value.toLocaleString('zh-CN');
function dayValue(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function rangeFor(period: string, from: string, to: string): Pick<UsageQuery, 'start' | 'end' | 'interval'> | undefined {
  const now = new Date(), start = new Date(now), end = new Date(now);
  if (period === '24h') { start.setTime(now.getTime() - 24 * 3600000); return { start: start.getTime(), end: now.getTime(), interval: 'hour' }; }
  start.setHours(0, 0, 0, 0); end.setHours(24, 0, 0, 0);
  if (period === 'custom') {
    if (!from || !to) return;
    const a = new Date(`${from}T00:00:00`), b = new Date(`${to}T00:00:00`);
    if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime()) || a > b) return;
    b.setDate(b.getDate() + 1);
    const days = (b.getTime() - a.getTime()) / 86400000;
    if (days > 3660) return;
    return { start: a.getTime(), end: b.getTime(), interval: days > 100 ? 'month' : days > 35 ? 'week' : 'day' };
  }
  if (period === '12m') { start.setDate(1); start.setMonth(start.getMonth() - 11); end.setFullYear(now.getFullYear(), now.getMonth() + 1, 1); end.setHours(0, 0, 0, 0); return { start: start.getTime(), end: end.getTime(), interval: 'month' }; }
  start.setDate(start.getDate() - (period === '7d' ? 6 : period === '30d' ? 29 : 83));
  return { start: start.getTime(), end: end.getTime(), interval: period === '12w' ? 'week' : 'day' };
}
function AnimatedNumber({ value, suffix = '' }: { value: number; suffix?: string }) {
  const { settings } = useMoyu();
  const [shown, setShown] = useState(0);
  const last = useRef(0);
  useEffect(() => {
    if (settings.ui.reduceMotion || matchMedia('(prefers-reduced-motion: reduce)').matches) { last.current = value; setShown(value); return; }
    const start = performance.now(), initial = last.current;
    let frame = 0;
    const tick = (now: number) => { const t = Math.min(1, (now - start) / 460); last.current = Math.round(initial + (value - initial) * (1 - (1 - t) ** 3)); setShown(last.current); if (t < 1) frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, [value, settings.ui.reduceMotion]);
  return <span title={exact(value)} data-value={value}>{compact(shown)}{suffix}</span>;
}

export function UsageView() {
  const { settings, activeWorkspace } = useMoyu();
  const [period, setPeriod] = useState('7d');
  const [from, setFrom] = useState(() => dayValue(new Date(Date.now() - 6 * 86400000)));
  const [to, setTo] = useState(() => dayValue(new Date()));
  const [botId, setBotId] = useState(''), [modelKey, setModelKey] = useState('');
  const [groupBy, setGroupBy] = useState<'bots' | 'models'>('bots');
  const [report, setReport] = useState<UsageReport>();
  const [error, setError] = useState(''), [refresh, setRefresh] = useState(0), [active, setActive] = useState<number>();
  const range = useMemo(() => rangeFor(period, from, to), [period, from, to, refresh]);
  useEffect(() => moyu().onEvent((event) => { if (event.type === 'run_end' || event.type === 'context_compaction' && event.phase === 'done') setRefresh((value) => value + 1); }), []);
  useEffect(() => {
    let cancelled = false;
    setReport(undefined); setError(''); setActive(undefined);
    if (range) void moyu().usage({ ...range, workspaceId: activeWorkspace?.id, botId: botId || undefined, modelKey: modelKey || undefined }).then((value) => { if (!cancelled) setReport(value); }).catch((failure: Error) => { if (!cancelled) setError(failure.message); });
    return () => { cancelled = true; };
  }, [range, botId, modelKey, activeWorkspace?.id]);
  const totals = report?.totals;
  const rows = report?.[groupBy] ?? [];
  const visible = rows.slice(0, 7);
  const series = visible.map((row, index) => ({ ...row, color: COLORS[index]! }));
  if (rows.length > 7) series.push({ ...rows[7]!, id: '__other', name: '其他', color: COLORS[7]! });
  const colorFor = (id: string) => COLORS[Math.max(0, rows.findIndex((row) => row.id === id)) % COLORS.length]!;
  const max = Math.max(1, ...report?.buckets.map((bucket) => bucket.totalTokens) ?? []);
  const ceiling = max === 1 ? 100 : Math.ceil(max / (10 ** Math.floor(Math.log10(max)))) * (10 ** Math.floor(Math.log10(max)));
  const selected = active === undefined ? undefined : report?.buckets[active];
  const dateLabel = (timestamp: number, long = false) => new Date(timestamp).toLocaleString('zh-CN', range?.interval === 'hour' ? { ...(long ? { month: 'numeric', day: 'numeric' } : {}), hour: '2-digit', minute: '2-digit', hour12: false } : range?.interval === 'month' ? { year: long ? 'numeric' : undefined, month: 'short' } : { month: 'numeric', day: 'numeric' });
  const reset = () => { setBotId(''); setModelKey(''); };
  const rankings = (kind: 'bots' | 'models', title: string) => <section className="usage-ranking" aria-label={`${title}用量排行`}>
    <header><h3>{title}<span>{report?.[kind].length ?? 0}</span></h3><small>Token / 占比</small></header>
    {!report?.[kind].length ? <p className="usage-rank-empty">暂无{title}用量</p> : report[kind].map((row: UsageRow, index) => {
      const bot = kind === 'bots' ? settings.bots.find((bot) => bot.id === row.id) : undefined;
      const percent = totals?.totalTokens ? row.totalTokens / totals.totalTokens * 100 : 0;
      return <button type="button" key={row.id} className="usage-rank-row" title={`查看 ${row.name} · ${exact(row.totalTokens)} Token · ${row.calls} 次调用`} onClick={() => kind === 'bots' ? setBotId(row.id) : setModelKey(row.id)} style={{ '--usage-color': COLORS[index % COLORS.length], '--usage-delay': `${Math.min(index, 8) * 30}ms` } as CSSProperties}>
        {bot ? <BotAvatar bot={bot} size="sm" animated={false} /> : <span className="usage-monogram">{row.name.charAt(0).toUpperCase()}</span>}
        <span className="usage-rank-name"><strong>{row.name}</strong>{row.detail ? <small>{row.detail}</small> : null}<span className="usage-meter"><i style={{ width: `${percent}%` }} /></span></span>
        <span className="usage-rank-value"><strong>{compact(row.totalTokens)}</strong><small>{percent.toFixed(0)}%</small></span>
      </button>;
    })}
  </section>;
  return <div className="usage-page">
    <div className="usage-toolbar"><div className="usage-periods" role="group" aria-label="用量时间范围">{PERIODS.map(([value, label]) => <button type="button" key={value} aria-pressed={period === value} onClick={() => { setPeriod(value); reset(); }}>{label}</button>)}</div><button type="button" className="usage-refresh" aria-label="刷新用量" title="刷新用量" onClick={() => setRefresh((value) => value + 1)}><Icon name="refresh" size={14} /></button></div>
    {period === 'custom' ? <div className="usage-dates"><label>开始日期<input type="date" aria-label="用量开始日期" value={from} onChange={(event) => setFrom(event.target.value)} /></label><span>—</span><label>结束日期<input type="date" aria-label="用量结束日期" value={to} onChange={(event) => setTo(event.target.value)} /></label><small>含起止日 · 本地时间</small></div> : null}
    <div className="usage-filters"><Select label="用量 Bot" value={botId} options={[{ value: '', label: '全部 Bot' }, ...report?.options.bots.map((item) => ({ value: item.id, label: settings.bots.find((bot) => bot.id === item.id)?.name ?? item.name })) ?? [], ...(botId && !report?.options.bots.some((item) => item.id === botId) ? [{ value: botId, label: settings.bots.find((bot) => bot.id === botId)?.name ?? '所选 Bot' }] : [])]} onChange={setBotId} /><Select label="用量模型" value={modelKey} options={[{ value: '', label: '全部模型' }, ...report?.options.models.map((item) => ({ value: item.id, label: item.name })) ?? [], ...(modelKey && !report?.options.models.some((item) => item.id === modelKey) ? [{ value: modelKey, label: '所选模型' }] : [])]} onChange={setModelKey} />{botId || modelKey ? <button type="button" className="usage-reset" onClick={reset}>重置筛选</button> : <span className="usage-local">本地统计<small>Token</small></span>}</div>
    {!range ? <div className="usage-status" role="alert">请选择有效的起止日期，结束日期不能早于开始日期（最多十年）。</div> : error ? <div className="usage-status" role="alert"><p>暂时无法读取用量：{error}</p><button type="button" onClick={() => setRefresh((value) => value + 1)}>重新加载</button></div> : !report ? <div className="usage-loading" aria-label="正在加载用量" role="status"><div /><div /><div /></div> : <>
      <section className="usage-stats" aria-label="Token 用量概览">
        <div className="usage-stat usage-stat--total"><small>{period === 'custom' ? '所选时间' : `最近 ${PERIODS.find(([value]) => value === period)?.[1]}`}<span>总消耗</span></small><strong><AnimatedNumber value={totals!.totalTokens} /><em>Token</em></strong><p>输入 {compact(totals!.promptTokens)} · 输出 {compact(totals!.completionTokens)}</p></div>
        <div className="usage-stat"><small>缓存命中率</small><strong>{totals!.cacheInputTokens ? <AnimatedNumber value={Math.round(totals!.cachedTokens / totals!.cacheInputTokens * 100)} suffix="%" /> : '—'}</strong><p>{totals!.cacheReportedCalls ? `已命中 ${compact(totals!.cachedTokens)} Token` : '供应商暂未提供'}</p></div>
        <div className="usage-stat"><small>输出 Token</small><strong><AnimatedNumber value={totals!.completionTokens} /></strong><p>包含已报告的推理用量</p></div>
        <div className="usage-stat"><small>调用次数</small><strong><AnimatedNumber value={totals!.calls} /></strong><p>{totals!.compactionCalls ? `含 ${totals!.compactionCalls} 次上下文压缩` : '包含工具调用中的模型请求'}</p></div>
      </section>
      <section className="usage-trend" aria-label="Token 趋势">
        <header><h3>Token 趋势<span>按{range.interval === 'hour' ? '小时' : range.interval === 'week' ? '周' : range.interval === 'month' ? '月' : '天'}</span></h3><div className="usage-switch" role="group" aria-label="趋势分组"><button type="button" aria-pressed={groupBy === 'bots'} onClick={() => { setGroupBy('bots'); setActive(undefined); }}>按 Bot</button><button type="button" aria-pressed={groupBy === 'models'} onClick={() => { setGroupBy('models'); setActive(undefined); }}>按模型</button></div></header>
        <div className="usage-chart" key={`${groupBy}-${range.start}-${botId}-${modelKey}`}>
          <div className="usage-axis"><span>{compact(ceiling)}</span><span>{compact(ceiling / 2)}</span><span>0</span></div>
          <div className="usage-plot"><div className="usage-grid"><i /><i /><i /></div><div className="usage-columns">{report.buckets.map((bucket, index) => {
            const parts = bucket[groupBy];
            const values = series.map((row) => row.id === '__other' ? Object.entries(parts).reduce((sum, [id, count]) => sum + (visible.some((row) => row.id === id) ? 0 : count), 0) : parts[row.id] ?? 0);
            return <button type="button" key={bucket.start} className={`usage-column ${active === index ? 'is-active' : ''}`} aria-label={`${dateLabel(bucket.start, true)}，${exact(bucket.totalTokens)} Token`} onMouseEnter={() => setActive(index)} onMouseLeave={() => setActive(undefined)} onFocus={() => setActive(index)} onBlur={() => setActive(undefined)} style={{ '--usage-delay': `${index * 9}ms` } as CSSProperties}>
              <span className="usage-stack">{series.map((row, part) => <i key={row.id} style={{ height: `${values[part]! / ceiling * 100}%`, background: row.color }} />)}{!bucket.totalTokens ? <b /> : null}</span>
              <span className="usage-tick">{index === 0 || index === report.buckets.length - 1 || index % Math.ceil(report.buckets.length / 7) === 0 ? dateLabel(bucket.start) : ''}</span>
            </button>;
          })}</div></div>
          {!totals!.calls ? <div className="usage-chart-empty"><Icon name="usage" size={24} /><strong>{botId || modelKey ? '此筛选下暂无调用' : '这段时间，还没有消耗'}</strong><span>与 Bot 对话后，用量会在这里汇总。</span></div> : null}
          {selected ? <div className="usage-tooltip" role="status"><strong>{dateLabel(selected.start, true)}<span>{compact(selected.totalTokens)} Token</span></strong>{Object.entries(selected[groupBy]).sort((a, b) => b[1] - a[1]).filter(([, value]) => value > 0).map(([id, value]) => <div key={id}><i style={{ background: colorFor(id) }} /><span>{rows.find((row) => row.id === id)?.name}</span><b>{compact(value)}</b></div>)}</div> : null}
        </div>
        <div className="usage-legend">{series.length ? series.map((row) => <span key={row.id}><i style={{ background: row.color }} />{row.name}</span>) : <span>暂无用量记录</span>}</div>
      </section>
      <div className="usage-rankings">{rankings('bots', 'Bot')}{rankings('models', '模型')}</div>
      <p className="usage-footnote">仅统计供应商返回的 Token，输入包含缓存读取。{totals!.calls > totals!.reportedCalls ? ` ${totals!.calls - totals!.reportedCalls} 次调用未返回完整用量。` : ''}{totals!.cacheReportedCalls < totals!.calls && totals!.cacheReportedCalls > 0 ? ' 缓存命中率仅基于提供缓存数据的请求。' : ''}{totals!.historicalCalls ? ' 历史记录仅回填已保存的用量，早期多步请求可能不完整。' : ''} 不含图片生成与供应商连接测试。</p>
    </>}
  </div>;
}
