import { useState } from 'react';
import { cronLabel } from '../lib/format';
import { useMesh } from '../state';
import { Button, Field, Panel, Sheet, Toggle } from '../components/Glass';
import { Icon } from '../components/Icon';

const PRESETS = [
  { label: '每天 09:00', cron: '0 9 * * *' },
  { label: '工作日 09:00', cron: '0 9 * * 1-5' },
  { label: '每 2 小时', cron: '0 */2 * * *' },
  { label: '每周一 09:00', cron: '0 9 * * 1' },
  { label: '每 15 分钟', cron: '*/15 * * * *' },
];

export function TasksView() {
  const { settings, schedules, deleteSchedule, toggleSchedule, addSchedule, toast } = useMesh();
  const [open, setOpen] = useState(false);
  const [botId, setBotId] = useState(settings.bots[0]?.id ?? '');
  const [cron, setCron] = useState('0 9 * * 1-5');
  const [prompt, setPrompt] = useState('检查云电脑 /data/meshbot 下最新的文件，用三句话汇报变化。');

  const submit = async () => {
    if (!botId) {
      toast('先选择一个 Bot', 'warn');
      return;
    }
    try {
      await addSchedule(botId, cron, prompt);
      setOpen(false);
      toast('定时任务已创建，到点会自己唤醒云电脑');
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  return (
    <div className="view">
      <header className="view-head">
        <div>
          <h1>定时任务</h1>
          <p>无人值守的自动化：到点后自动唤醒共享云电脑执行，执行完继续休眠。</p>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setOpen(true)}>
          新建任务
        </Button>
      </header>

      <Panel className="task-panel">
        {schedules.length === 0 ? (
          <div className="task-empty">
            <span className="task-empty__icon">
              <Icon name="clock" size={26} />
            </span>
            <h3>还没有定时任务</h3>
            <p>「每个工作日 9 点检查 CI」「每 2 小时抓一次竞品价格」都可以交给它。</p>
            <Button variant="glass" icon="plus" onClick={() => setOpen(true)}>
              创建第一个
            </Button>
          </div>
        ) : (
          <ul className="task-list">
            {schedules.map((schedule) => {
              const bot = settings.bots.find((item) => item.id === schedule.botId);
              return (
                <li key={schedule.id} className={`task-row ${schedule.enabled ? '' : 'is-off'}`.trim()}>
                  <span className="task-row__cron">
                    <Icon name="clock" size={16} />
                    {cronLabel(schedule.cron)}
                  </span>
                  <span className="task-row__prompt">
                    <strong>{schedule.prompt}</strong>
                    <span>
                      {bot?.name ?? '未知 Bot'} ·{' '}
                      {schedule.enabled
                        ? `下次 ${schedule.nextRunAt ? new Date(schedule.nextRunAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '待计算'}`
                        : '已暂停'}
                      {schedule.lastStatus ? ` · 上次 ${schedule.lastStatus}` : ''}
                    </span>
                  </span>
                  <span className={`task-row__status task-row__status--${schedule.lastStatus ?? 'idle'}`}>{schedule.lastStatus ?? '待运行'}</span>
                  <Toggle
                    checked={schedule.enabled}
                    onChange={() => void toggleSchedule(schedule.id)}
                    label=""
                  />
                  <button type="button" className="icon-btn" aria-label="删除" onClick={() => void deleteSchedule(schedule.id)}>
                    <Icon name="trash" size={16} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Sheet
        open={open}
        title="新建定时任务"
        subtitle="使用 5 段 cron（本地时区），到点由 Shared Cloud 执行"
        onClose={() => setOpen(false)}
        footer={
          <>
            <span className="spacer" />
            <Button variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button variant="primary" icon="check" onClick={() => void submit()}>
              创建
            </Button>
          </>
        }
      >
        <div className="editor-grid">
          <Field label="执行的 Bot">
            <select className="select" value={botId} onChange={(event) => setBotId(event.target.value)}>
              {settings.bots.map((bot) => (
                <option key={bot.id} value={bot.id}>
                  {bot.name} · {bot.model}
                </option>
              ))}
            </select>
          </Field>
          <Field label="频率">
            <div className="chips">
              {PRESETS.map((preset) => (
                <button key={preset.cron} type="button" className={`chip ${cron === preset.cron ? 'is-active' : ''}`} onClick={() => setCron(preset.cron)}>
                  {preset.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="cron 表达式" hint="分 时 日 月 周">
            <input className="input mono" value={cron} onChange={(event) => setCron(event.target.value)} />
          </Field>
          <Field label="指令">
            <textarea className="textarea" rows={5} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
          </Field>
          <p className="inline-hint">
            <Icon name="shield" size={14} /> 无人值守的任务会自动把审批策略降为「自动执行」，仅在 workspace 范围写入。
          </p>
        </div>
      </Sheet>
    </div>
  );
}