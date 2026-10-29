import fs from 'node:fs';
import path from 'node:path';
import type { Bot, Conversation, TokenUsage, UsageQuery, UsageRecord, UsageReport, UsageRow, UsageTotals } from './types';
import type { ChatArgs, ChatOutcome, ChatProvider, StreamHandlers } from './providers/types';
import type { Store } from './store';
import { newId } from './util';

const count = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
export function normalizeUsage(usage?: TokenUsage): TokenUsage | undefined {
  if (!usage) return undefined;
  const promptTokens = count(usage.promptTokens), completionTokens = count(usage.completionTokens);
  const cached = count(usage.cachedTokens);
  if (promptTokens === undefined && completionTokens === undefined) return undefined;
  return { promptTokens, completionTokens, cachedTokens: cached === undefined || promptTokens === undefined ? undefined : Math.min(cached, promptTokens) };
}
export const modelUsageKey = (providerId: string, model: string): string => JSON.stringify([providerId, model]);
const emptyTotals = (): UsageTotals => ({ promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedTokens: 0, cacheInputTokens: 0, cacheReportedCalls: 0, calls: 0, reportedCalls: 0, compactionCalls: 0, historicalCalls: 0 });
function add(target: UsageTotals, record: UsageRecord) {
  const usage = record.usage;
  target.calls++;
  target.promptTokens += usage?.promptTokens ?? 0;
  target.completionTokens += usage?.completionTokens ?? 0;
  target.totalTokens = target.promptTokens + target.completionTokens;
  if (usage?.promptTokens !== undefined && usage.completionTokens !== undefined) target.reportedCalls++;
  if (usage?.cachedTokens !== undefined && usage.promptTokens !== undefined) {
    target.cachedTokens += usage.cachedTokens;
    target.cacheInputTokens += usage.promptTokens;
    target.cacheReportedCalls++;
  }
  if (record.purpose === 'compaction') target.compactionCalls++;
  if (record.purpose === 'historical') target.historicalCalls++;
}

/** Append-only ledger contains metadata and counts, never prompts or credentials. */
export class UsageLedger {
  private records: UsageRecord[] = [];
  private ids = new Set<string>();
  private readonly file: string;
  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'usage.jsonl');
    if (!fs.existsSync(this.file)) return;
    const source = fs.readFileSync(this.file, 'utf8');
    let damaged = false;
    for (const line of source.split('\n').filter((line) => line.trim())) {
      try {
        const record = JSON.parse(line) as UsageRecord;
        if (!record.id || !Number.isFinite(record.createdAt) || typeof record.botId !== 'string' || typeof record.model !== 'string') throw new Error('invalid usage');
        if (!this.ids.has(record.id)) { this.ids.add(record.id); this.records.push({ ...record, usage: normalizeUsage(record.usage) }); }
      } catch { damaged = true; }
    }
    // Preserve recoverable records after an interrupted append before writing again.
    if (damaged || (source && !source.endsWith('\n'))) {
      fs.copyFileSync(this.file, `${this.file}.recovery`);
      fs.writeFileSync(this.file, this.records.map((record) => JSON.stringify(record) + '\n').join(''));
    }
  }
  append(record: UsageRecord): void {
    if (this.ids.has(record.id)) return;
    const normalized = { ...record, usage: normalizeUsage(record.usage) };
    fs.appendFileSync(this.file, JSON.stringify(normalized) + '\n', 'utf8');
    this.records.push(normalized); this.ids.add(record.id);
  }
  backfill(conversations: Iterable<Conversation>, bots: Bot[]): void {
    const tracked = new Set(this.records.flatMap((record) => record.messageId ? [record.messageId] : []));
    for (const conversation of conversations) {
      if (conversation.mergedInto) continue;
      for (const message of conversation.messages) {
        if (message.role !== 'assistant' || message.usageTracked || tracked.has(message.id) || !normalizeUsage(message.usage)) continue;
        const botId = message.botId ?? conversation.botId;
        this.append({ id: `historical:${message.id}`, messageId: message.id, createdAt: message.createdAt, botId,
          botName: message.botName ?? bots.find((bot) => bot.id === botId)?.name ?? '已移除的 Bot',
          providerId: 'historical', providerName: '历史记录 · 供应商未记录', model: message.model ?? '未知模型',
          workspaceId: bots.find((bot) => bot.id === botId)?.workspaceId ?? 'workspace_cloud', conversationId: conversation.id, purpose: 'historical', status: message.error ? 'error' : 'complete', usage: message.usage });
        tracked.add(message.id);
      }
    }
  }
  query(query: UsageQuery): UsageReport {
    if (!query || !Number.isFinite(query.start) || !Number.isFinite(query.end) || query.end <= query.start || query.end - query.start > 3660 * 86400000 || !['hour', 'day', 'week', 'month'].includes(query.interval)) throw new Error('请选择有效的时间范围（最多十年）');
    const buckets: UsageReport['buckets'] = [];
    let cursor = query.start;
    while (cursor < query.end) {
      if (buckets.length >= 400) throw new Error('时间范围过长，请切换更大的统计粒度');
      const date = new Date(cursor);
      if (query.interval === 'hour') date.setTime(cursor + 3600000);
      else if (query.interval === 'month') date.setMonth(date.getMonth() + 1, 1);
      else date.setDate(date.getDate() + (query.interval === 'week' ? 7 : 1));
      const end = Math.min(date.getTime(), query.end);
      buckets.push({ start: cursor, end, totalTokens: 0, bots: {}, models: {} }); cursor = end;
    }
    const bots = new Map<string, UsageRow>(), models = new Map<string, UsageRow>();
    const botOptions = new Map<string, string>(), modelOptions = new Map<string, string>();
    const totals = emptyTotals();
    for (const record of this.records) {
      if (query.workspaceId && (record.workspaceId ?? 'workspace_cloud') !== query.workspaceId) continue;
      if (record.createdAt < query.start || record.createdAt >= query.end) continue;
      const modelKey = modelUsageKey(record.providerId, record.model);
      botOptions.set(record.botId, record.botName); modelOptions.set(modelKey, `${record.model} · ${record.providerName}`);
      if (query.botId && query.botId !== record.botId || query.modelKey && query.modelKey !== modelKey) continue;
      add(totals, record);
      for (const [map, id, name, detail] of [[bots, record.botId, record.botName, undefined], [models, modelKey, record.model, record.providerName]] as const) {
        let row = map.get(id);
        if (!row) { row = { id, name, detail, ...emptyTotals() }; map.set(id, row); }
        add(row, record);
      }
      const bucket = buckets.find((bucket) => record.createdAt >= bucket.start && record.createdAt < bucket.end)!;
      const tokens = (record.usage?.promptTokens ?? 0) + (record.usage?.completionTokens ?? 0);
      bucket.totalTokens += tokens;
      bucket.bots[record.botId] = (bucket.bots[record.botId] ?? 0) + tokens;
      bucket.models[modelKey] = (bucket.models[modelKey] ?? 0) + tokens;
    }
    const ranked = (map: Map<string, UsageRow>) => [...map.values()].sort((a, b) => b.totalTokens - a.totalTokens || a.name.localeCompare(b.name));
    return { totals, bots: ranked(bots), models: ranked(models), buckets,
      options: { bots: [...botOptions].map(([id, name]) => ({ id, name })), models: [...modelOptions].map(([id, name]) => ({ id, name })) } };
  }
}

/** Each stream reports cumulative snapshots; persist exactly once, including failed streams. */
export async function trackedChat(store: Store, bot: Bot, conversationId: string, purpose: 'chat' | 'compaction', provider: ChatProvider, args: ChatArgs, handlers: StreamHandlers, messageId?: string): Promise<ChatOutcome> {
  const providerConfig = store.settings.providers.find((item) => item.id === bot.providerId);
  const record: UsageRecord = { id: newId('usage'), workspaceId: bot.workspaceId ?? 'workspace_cloud', createdAt: Date.now(), botId: bot.id, botName: bot.name, providerId: bot.providerId, providerName: providerConfig?.name ?? '已移除的供应商', model: args.model, conversationId, messageId, purpose, status: 'error' };
  try {
    const result = await provider.chat(args, { ...handlers, onUsage: (usage) => { record.usage = { ...record.usage, ...usage }; handlers.onUsage?.(usage); } });
    record.usage = { ...record.usage, ...result.usage }; record.status = 'complete';
    return { ...result, usage: normalizeUsage(record.usage) };
  } finally { store.usage.append(record); }
}
