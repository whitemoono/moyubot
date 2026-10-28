import type { Store } from './store';
import type { AgentRuntime } from './agent';
import { newId } from './util';

export interface ScheduleRunnerDeps {
  store: Store;
  runtime: AgentRuntime;
  onLog?: (level: 'info' | 'warn' | 'error', text: string) => void;
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
    if (!segment) continue;
    const stepMatch = /^(?:\*|(\d+)-(\d+))\/(\d+)$/.exec(segment);
    if (stepMatch) {
      const start = stepMatch[1] ? Number(stepMatch[1]) : min;
      const end = stepMatch[2] ? Number(stepMatch[2]) : max;
      const step = Number(stepMatch[3]);
      if (step <= 0) throw new Error('cron step 必须大于 0');
      for (let value = start; value <= end; value += step) values.add(value);
      continue;
    }
    if (segment.startsWith('*/')) {
      const step = Number(segment.slice(2));
      for (let value = min; value <= max; value += step) values.add(value);
      continue;
    }
    const range = /^(\d+)-(\d+)$/.exec(segment);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      for (let value = start; value <= end; value += 1) values.add(value);
      continue;
    }
    if (segment === '*') {
      for (let value = min; value <= max; value += 1) values.add(value);
      continue;
    }
    const single = Number(segment);
    if (!Number.isFinite(single)) throw new Error(`无法解析 cron 片段：${segment}`);
    values.add(single);
  }
  for (const value of values) {
    if (value < min || value > max) throw new Error(`cron 字段超出范围 ${min}-${max}：${value}`);
  }
  return [...values].sort((a, b) => a - b);
}

export function parseCron(expression: string): ParsedCron {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('cron 必须是 5 段：分 时 日 月 周');
  const [minute, hour, dom, month, dow] = parts as [string, string, string, string, string];
  const dowValues = expandField(dow.replace(/\b7\b/g, '0'), 0, 6);
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
    this.tick();
    this.timer = setInterval(() => this.tick(), 30_000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private tick(): void {
    const now = Date.now();
    for (const schedule of this.deps.store.listSchedules()) {
      if (!schedule.enabled || this.running.has(schedule.id)) continue;
      let next = schedule.nextRunAt;
      if (!next) {
        try {
          const computed = nextCronTime(schedule.cron);
          next = computed ? computed.getTime() : undefined;
          this.deps.store.upsertSchedule({ ...schedule, nextRunAt: next });
        } catch (error) {
          this.deps.onLog?.('warn', `定时任务 ${schedule.cron} 解析失败：${(error as Error).message}`);
          this.deps.store.upsertSchedule({ ...schedule, enabled: false, lastStatus: 'error', lastError: (error as Error).message });
          continue;
        }
      }
      if (!next || now < next) continue;
      this.running.add(schedule.id);
      const nextRun = nextCronTime(schedule.cron);
      this.deps.store.upsertSchedule({
        ...schedule,
        lastRunAt: now,
        nextRunAt: nextRun ? nextRun.getTime() : undefined,
        lastStatus: 'running',
      });
      void (async () => {
        try {
          this.deps.onLog?.('info', `执行定时任务：${schedule.cron}`);
          await this.deps.runtime.runUnattended(schedule.botId, schedule.prompt);
          const latest = this.deps.store.listSchedules().find((item) => item.id === schedule.id);
          if (latest) this.deps.store.upsertSchedule({ ...latest, lastStatus: 'ok', lastError: undefined });
        } catch (error) {
          const latest = this.deps.store.listSchedules().find((item) => item.id === schedule.id);
          if (latest) {
            this.deps.store.upsertSchedule({ ...latest, lastStatus: 'error', lastError: (error as Error).message });
          }
          this.deps.onLog?.('error', `定时任务失败：${(error as Error).message}`);
        } finally {
          this.running.delete(schedule.id);
        }
      })();
    }
  }

  create(botId: string, cron: string, prompt: string) {
    const next = nextCronTime(cron);
    return this.deps.store.upsertSchedule({
      id: newId('sched'),
      botId,
      cron,
      prompt,
      enabled: true,
      nextRunAt: next?.getTime(),
    });
  }
}