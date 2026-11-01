/**
 * 远程模型目录（models.dev）——运行时拉取 + 本地缓存。
 *
 * 目的：内置的 modelProfile 正则表永远追不上各家模型/中转站的命名，
 * 未识别模型的上下文窗口会落到保守默认值，导致过早压缩或（若默认偏大）撞墙。
 * models.dev 由社区维护，按 provider 记录每个模型的 context/output 上限，
 * DeepSeek Harness 官方生态同样采用这个数据源。
 *
 * 策略：
 *  - 首次 init 读磁盘缓存，随后在后台按 24h 过期刷新，绝不阻塞聊天链路。
 *  - 查找顺序：baseUrl 推断出的 provider 内精确/模糊匹配 → 全局同名模型取众数。
 *  - 拉取失败时保留旧缓存；没有任何缓存时返回 undefined，由调用方回退内置表。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ProviderConfig } from './types';

const MODELS_DEV_URL = 'https://models.dev/api.json';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 30_000;

type ModelLimits = { context?: number; output?: number };
type ProviderCatalog = Record<string, ModelLimits>;
type CatalogData = Record<string, ProviderCatalog>;

/** baseUrl 主机名 → models.dev provider id 的常见映射。 */
const HOST_HINTS: { test: RegExp; provider: string }[] = [
  { test: /dashscope\.aliyuncs\.com|bailian\.aliyuncs\.com/, provider: 'alibaba-cn' },
  { test: /dashscope-intl\.aliyuncs\.com/, provider: 'alibaba' },
  { test: /api\.deepseek\.com/, provider: 'deepseek' },
  { test: /openrouter\.ai/, provider: 'openrouter' },
  { test: /api\.anthropic\.com/, provider: 'anthropic' },
  { test: /api\.openai\.com/, provider: 'openai' },
  { test: /generativelanguage\.googleapis\.com/, provider: 'google' },
  { test: /api\.moonshot\.(cn|ai)/, provider: 'moonshotai' },
  { test: /open\.bigmodel\.cn/, provider: 'zhipuai' },
  { test: /api\.minimax(chat)?\.(com|chat)/, provider: 'minimax' },
  { test: /api\.siliconflow\.(cn|com)/, provider: 'siliconflow' },
  { test: /ark\.cn-beijing\.volces\.com|volcengineapi\.com/, provider: 'volcengine' },
  { test: /api\.x\.ai/, provider: 'xai' },
  { test: /api\.groq\.com/, provider: 'groq' },
  { test: /api\.mistral\.ai/, provider: 'mistral' },
];

function normalizeId(value: string): string {
  return value.toLowerCase().trim();
}

/** 去掉转发商前缀（`codearts/deepseek-v4.1-flash` → `deepseek-v4.1-flash`）。 */
function bareId(model: string): string {
  return normalizeId(model).split('/').pop() ?? normalizeId(model);
}

/** 去掉常见版本/渠道后缀，提高跨厂商命中率。 */
function strippedIds(bare: string): string[] {
  const out: string[] = [bare];
  const suffixes = [
    /-(?:\d{4}|\d{2,4}-\d{2}-\d{2})$/,
    /-(?:preview|latest|highspeed|fast|sol|terra|astra|turbo)$/,
    /:.*$/,
  ];
  let current = bare;
  for (const suffix of suffixes) {
    const next = current.replace(suffix, '');
    if (next && next !== current) { out.push(next); current = next; }
  }
  return out;
}

function matchIn(catalog: ProviderCatalog, bare: string): number | undefined {
  for (const id of strippedIds(bare)) {
    const exact = catalog[id];
    if (exact?.context) return exact.context;
  }
  // 最后尝试后缀包含匹配（如 `qwen3.8-flash-next` 命中 `qwen3.8-flash`）。
  for (const [id, limits] of Object.entries(catalog)) {
    if (!limits.context) continue;
    if (id.startsWith(bare) || bare.startsWith(id)) return limits.context;
  }
  return undefined;
}

export class RemoteModelCatalog {
  private data: CatalogData | undefined;
  private fetchedAt = 0;
  private file: string | undefined;
  private loading: Promise<void> | undefined;
  private lastError: string | undefined;

  /** 读磁盘缓存并触发后台刷新。dataDir 为空时只在内存中工作。 */
  init(dataDir: string): void {
    this.file = path.join(dataDir, 'models-dev-cache.json');
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as { fetchedAt?: number; providers?: CatalogData };
      if (raw?.providers && typeof raw.providers === 'object') {
        this.data = raw.providers;
        this.fetchedAt = Number(raw.fetchedAt) || 0;
      }
    } catch { /* 首次运行没有缓存 */ }
    void this.refreshIfStale();
  }

  /** 缓存过期时后台刷新；并发调用合并为一次请求。 */
  refreshIfStale(force = false): Promise<void> {
    if (this.loading) return this.loading;
    if (!force && this.data && Date.now() - this.fetchedAt < MAX_AGE_MS) return Promise.resolve();
    this.loading = (async () => {
      try {
        const res = await fetch(MODELS_DEV_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!res.ok) { this.lastError = `HTTP ${res.status}`; return; }
        const json = (await res.json()) as Record<string, { models?: Record<string, { limit?: ModelLimits }> }>;
        const providers: CatalogData = {};
        for (const [providerId, provider] of Object.entries(json)) {
          const models: ProviderCatalog = {};
          for (const [modelId, model] of Object.entries(provider?.models ?? {})) {
            const context = Number(model?.limit?.context);
            if (Number.isFinite(context) && context >= 4096) {
              const output = Number(model?.limit?.output);
              models[normalizeId(modelId)] = { context: Math.floor(context), ...(Number.isFinite(output) && output > 0 ? { output: Math.floor(output) } : {}) };
            }
          }
          if (Object.keys(models).length) providers[providerId] = models;
        }
        if (!Object.keys(providers).length) { this.lastError = 'empty catalog'; return; }
        this.data = providers;
        this.fetchedAt = Date.now();
        this.lastError = undefined;
        if (this.file) {
          try {
            fs.mkdirSync(path.dirname(this.file), { recursive: true });
            const tmp = `${this.file}.tmp${process.pid}`;
            fs.writeFileSync(tmp, JSON.stringify({ fetchedAt: this.fetchedAt, providers }));
            fs.renameSync(tmp, this.file);
          } catch { /* 落盘失败不影响内存使用 */ }
        }
      } catch (error) {
        this.lastError = (error as Error).message;
      } finally {
        this.loading = undefined;
      }
    })();
    return this.loading;
  }

  /** 是否已有可用数据。 */
  get ready(): boolean {
    return !!this.data;
  }

  get error(): string | undefined {
    return this.lastError;
  }

  /** 按供应商 + 模型查上下文窗口；查不到返回 undefined。 */
  lookup(provider: ProviderConfig | undefined, model: string): number | undefined {
    if (!this.data) return undefined;
    const bare = bareId(model);
    const hinted = provider ? HOST_HINTS.find((hint) => hint.test.test(provider.baseUrl ?? ''))?.provider : undefined;
    if (hinted && this.data[hinted]) {
      const hit = matchIn(this.data[hinted], bare);
      if (hit) return hit;
    }
    // 供应商无法识别（自建中转站）：跨 provider 找同名模型，取出现次数最多的窗口值。
    const counts = new Map<number, number>();
    for (const catalog of Object.values(this.data)) {
      const hit = matchIn(catalog, bare);
      if (hit) counts.set(hit, (counts.get(hit) ?? 0) + 1);
    }
    let best: number | undefined;
    let bestCount = 0;
    for (const [context, count] of counts) if (count > bestCount) { best = context; bestCount = count; }
    return best;
  }

  /** 按供应商 + 模型查最大输出；查不到返回 undefined。 */
  lookupOutput(provider: ProviderConfig | undefined, model: string): number | undefined {
    if (!this.data) return undefined;
    const bare = bareId(model);
    const hinted = provider ? HOST_HINTS.find((hint) => hint.test.test(provider.baseUrl ?? ''))?.provider : undefined;
    const catalogs = hinted && this.data[hinted] ? [this.data[hinted], ...Object.values(this.data)] : Object.values(this.data);
    for (const catalog of catalogs) {
      for (const id of strippedIds(bare)) {
        const output = catalog[id]?.output;
        if (output) return output;
      }
    }
    return undefined;
  }
}

export const remoteModelCatalog = new RemoteModelCatalog();
