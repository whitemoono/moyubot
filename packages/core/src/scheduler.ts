import type { Store } from './store';
import type { AgentRuntime } from './agent';

export interface ScheduleRunnerDeps {
  store: Store;
  runtime: AgentRuntime;
  onLog?: (level: 'info' | 'warn' | 'error', text: string) => void;
  now?: () => number;
}

interface ParsedCron {
  minute: number[];
  hour: number[];
  dom: (number | 'any')[];
  month: number[];
  dow: (number | 'any')[];
  domAny: boolean;
  dowAny: boolean;
}

function expandField(raw: string, min: number, max: number): number[] {
  const values = new Set<number>();
  for (const part of raw.split(',')) {
    const segment = part.trim();
    const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(segment);
    if (!match) throw new Error(`无法解析 cron 片段：${segment}`);
    const base = match[1]!;
    const endpoints = base.split('-').map(Number);
    const start = base === '*' ? min : endpoints[0]!;
    const end = base === '*' ? max : endpoints[1] ?? (match[2] ? max : start);
    const step = match[2] ? Number(match[2]) : 1;
    if (!Number.isSafeInteger(step) || step < 1 || step > max - min + 1) throw new Error('cron step 超出有效范围');
    if (start < min || end > max || end < start) throw new Error(`cron 字段超出范围 ${min}-${max}：${segment}`);
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return [...values].sort((a, b) => a - b);
}

export function parseCron(expression: string): ParsedCron {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('cron 必须是 5 段：分 时 日 月 周');
  const [minute, hour, dom, month, dow] = parts as [string, string, string, string, string];
  const dowValues = [...new Set(expandField(dow, 0, 7).map((day) => day === 7 ? 0 : day))];
  return {
    minute: expandField(minute, 0, 59),
    hour: expandField(hour, 0, 23),
    dom: expandField(dom, 1, 31),
    month: expandField(month, 1, 12),
    dow: dowValues,
    domAny: dom.trim() === '*',
    dowAny: dow.trim() === '*',
  };
}

export function nextCronTime(expression: string, from: Date = new Date()): Date | null {
  const parsed = parseCron(expression);
  const candidate = new Date(from.getTime());
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);
  const limit = 366 * 24 * 60;
  for (let i = 0; i < limit; i += 1) {
    if (!parsed.month.includes(candidate.getMonth() + 1)) {
      candidate.setMonth(candidate.getMonth() + 1, 1);
      candidate.setHours(0, 0, 0, 0);
      continue;
    }
    const dowMatch = parsed.dow.includes(candidate.getDay());
    const domMatch = parsed.dom.includes(candidate.getDate());
    const dayOk = parsed.domAny && parsed.dowAny ? true : parsed.domAny ? dowMatch : parsed.dowAny ? domMatch : domMatch || dowMatch;
    if (!dayOk) {
      candidate.setDate(candidate.getDate() + 1);
      candidate.setHours(0, 0, 0, 0);
      continue;
    }
    if (!parsed.hour.includes(candidate.getHours())) {
      candidate.setHours(candidate.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!parsed.minute.includes(candidate.getMinutes())) {
      candidate.setMinutes(candidate.getMinutes() + 1, 0, 0);
      continue;
    }
    return candidate;
  }
  return null;
}

export class ScheduleRunner {
  private timer: NodeJS.Timeout | undefined;
  private running = new Set<string>();

  constructor(private readonly deps: ScheduleRunnerDeps) {}

  start(): void {
    if (this.timer) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), 30_000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private tick(): void {
    const now = this.deps.now?.() ?? Date.now();
    for (const schedule of this.deps.store.listSchedules()) {
      if (!schedule.enabled || schedule.closedAt || schedule.completedAt || this.running.has(schedule.id)) continue;
      if (!this.deps.store.getBot(schedule.botId)) continue;
      // An active chat keeps its place; overdue jobs wait for the same Bot to become free.
      if (this.deps.runtime.isRunning(this.deps.store.botConversation(schedule.botId).id)) continue;
      let next = schedule.nextRunAt;
      if (!next) {
        try {
          const computed = schedule.kind === 'once' ? new Date(schedule.runAt ?? NaN) : nextCronTime(schedule.cron, new Date(now));
          next = computed && Number.isFinite(computed.getTime()) ? computed.getTime() : undefined;
          if (!next) throw new Error('没有有效的执行时间');
          this.deps.store.upsertSchedule({ ...schedule, nextRunAt: next });
        } catch (error) {
          this.deps.onLog?.('warn', `定时任务 ${schedule.cron} 解析失败：${(error as Error).message}`);
          this.deps.store.upsertSchedule({ ...schedule, enabled: false, lastStatus: 'error', lastError: (error as Error).message });
          continue;
        }
      }
      if (!next || now < next) continue;
      let nextRun: Date | null;
      try { nextRun = schedule.kind === 'once' ? null : nextCronTime(schedule.cron, new Date(now)); }
      catch (error) { this.deps.store.upsertSchedule({ ...schedule, enabled: false, lastStatus: 'error', lastError: (error as Error).message }); continue; }
      this.deps.store.upsertSchedule({
        ...schedule,
        lastRunAt: now,
        nextRunAt: nextRun ? nextRun.getTime() : undefined,
        lastStatus: 'running',
      });
      this.running.add(schedule.id);
      void (async () => {
        try {
          this.deps.onLog?.('info', `执行定时任务：${schedule.title || schedule.prompt.slice(0, 60)}`);
          await this.deps.runtime.runUnattended(schedule.botId, `[定时任务执行 · ${schedule.id}]\n${schedule.prompt}\n\n这是已到期任务的本次执行，请完成指令并汇报结果。不要再次创建相同的定时任务。`);
          const latest = this.deps.store.listSchedules().find((item) => item.id === schedule.id);
          if (latest) this.deps.store.upsertSchedule({ ...latest, ...(schedule.kind === 'once' ? { enabled: false, completedAt: this.deps.now?.() ?? Date.now(), nextRunAt: undefined } : {}), lastStatus: 'ok', lastError: undefined });
        } catch (error) {
          const latest = this.deps.store.listSchedules().find((item) => item.id === schedule.id);
          if (latest) {
            this.deps.store.upsertSchedule({ ...latest, ...(schedule.kind === 'once' ? { enabled: false, completedAt: this.deps.now?.() ?? Date.now(), nextRunAt: undefined } : {}), lastStatus: 'error', lastError: (error as Error).message });
          }
          this.deps.onLog?.('error', `定时任务失败：${(error as Error).message}`);
        } finally {
          this.running.delete(schedule.id);
        }
      })();
    }
  }

  create(botId: string, cron: string, prompt: string) {
    return this.deps.store.createSchedule(botId, { cron, prompt });
  }
}
