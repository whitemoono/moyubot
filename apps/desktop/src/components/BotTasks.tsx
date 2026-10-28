import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { Schedule, ScheduleUpdate } from '@moyu/core';
import { useMoyu } from '../state';
import { moyu } from '../lib/bridge';
import { cronLabel } from '../lib/format';
import { Icon } from './Icon';

const date = (time: number) => new Date(time).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
function timing(task: Schedule): string {
  if (task.kind === 'once') return `仅一次 ${task.runAt ? date(task.runAt) : '时间待确认'}`;
  const text = cronLabel(task.cron);
  return text === task.cron ? `自定义周期${task.nextRunAt ? ` · ${date(task.nextRunAt)}` : ''}` : text;
}

/** The task list is scoped to the current Bot; all changes use the same scheduler as chat tools. */
export function BotTasks({ botId }: { botId: string }) {
  const { schedules, toast } = useMoyu();
  const [expanded, setExpanded] = useState<string>();
  const [pending, setPending] = useState<Set<string>>(new Set());
  const tasks = schedules.filter((task) => task.botId === botId);
  const current = tasks.filter((task) => !task.closedAt && !task.completedAt);
  const history = tasks.filter((task) => task.closedAt || task.completedAt).sort((a, b) => (b.closedAt ?? b.completedAt ?? 0) - (a.closedAt ?? a.completedAt ?? 0));
  if (!tasks.length) return null;
  const update = async (task: Schedule, patch: ScheduleUpdate) => {
    if (pending.has(task.id)) return;
    setPending((previous) => new Set(previous).add(task.id));
    try { await moyu().updateSchedule(botId, task.id, patch); }
    catch (error) { toast((error as Error).message, 'error'); }
    finally { setPending((previous) => { const next = new Set(previous); next.delete(task.id); return next; }); }
  };
  const row = (task: Schedule, index: number, archived = false) => {
    const name = task.title || task.prompt;
    const running = task.lastStatus === 'running';
    const detail = expanded === task.id;
    const status = task.closedAt ? '已关闭' : task.completedAt ? task.lastStatus === 'error' ? '执行失败' : '已完成' : running ? task.enabled ? '正在执行' : '执行中 · 后续已暂停' : !task.enabled ? '已暂停' : task.lastStatus === 'error' ? '上次执行失败' : '';
    return <div key={task.id} data-task-id={task.id} className={`bot-task ${!task.enabled ? 'is-paused' : ''} ${running ? 'is-running' : ''} ${detail ? 'is-expanded' : ''}`} style={{ '--task-delay': `${Math.min(index, 6) * 35}ms` } as CSSProperties}>
      <div className="bot-task__row"><button type="button" className="bot-task__summary" aria-expanded={detail} aria-controls={`task-detail-${task.id}`} onClick={() => setExpanded(detail ? undefined : task.id)} title={name}>
        <strong>{running ? <i className="bot-task__pulse" /> : null}{name}</strong><span>{timing(task)}</span>
      </button>{!archived ? <button type="button" role="switch" aria-label={`${task.enabled ? '暂停' : '恢复'}任务 ${name}`} aria-checked={task.enabled} className="bot-task__switch" disabled={pending.has(task.id)} title={task.enabled ? '暂停后续执行，保留任务' : '恢复后续执行'} onClick={() => void update(task, { action: task.enabled ? 'pause' : 'resume' })}><i /></button> : <Icon name={task.closedAt ? 'close' : task.lastStatus === 'error' ? 'clock' : 'check'} size={13} className="bot-task__archive-icon" />}</div>
      {status ? <span className={`bot-task__status ${task.lastStatus === 'error' && !task.closedAt ? 'has-error' : ''}`}>{status}</span> : null}
      {detail ? <div id={`task-detail-${task.id}`} className="bot-task__detail">
        <p>{task.prompt}</p><dl>{task.enabled && task.nextRunAt ? <div><dt>下次执行</dt><dd>{date(task.nextRunAt)}</dd></div> : null}{task.lastRunAt ? <div><dt>最近执行</dt><dd>{date(task.lastRunAt)}</dd></div> : null}<div><dt>时区</dt><dd>{Intl.DateTimeFormat().resolvedOptions().timeZone}</dd></div></dl>
        {task.lastError ? <p className="bot-task__error" role="status">{task.lastError}</p> : null}
        {!archived ? <><small>在对话中描述修改、暂停、恢复或关闭这项任务。</small><div className="bot-task__actions"><button type="button" disabled={pending.has(task.id)} onClick={() => void update(task, { action: 'close' })}>关闭任务</button></div>{running ? <small>本次执行会继续，暂停或关闭会停止后续安排。</small> : null}</> : null}
      </div> : null}
    </div>;
  };
  return <section className="inspector-section bot-tasks" aria-label="当前 Bot 的定时任务">
    <div className="inspector-section__head"><h3>例行任务</h3><span>{current.length || ''}</span></div>
    {current.length ? <div className="bot-tasks__list">{current.map((task, index) => row(task, index))}</div> : <p className="bot-tasks__empty">暂无待执行任务</p>}
    {history.length ? <details className="bot-tasks__history"><summary><Icon name="clock" size={11} /><span>已结束的任务</span><small>{history.length}</small><Icon name="chevron" size={11} /></summary><div className="bot-tasks__list">{history.map((task, index) => row(task, index, true))}</div></details> : null}
    <p className="bot-tasks__hint">通过对话安排，结果会回到当前 Bot 的对话。<span>应用运行时执行 · {Intl.DateTimeFormat().resolvedOptions().timeZone}</span></p>
  </section>;
}
