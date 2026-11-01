import { useEffect, useRef, useState } from 'react';
import type { Bot, Conversation } from '@moyu/core';
import { useMoyu } from '../state';
import { DEFAULT_CONTEXT_WINDOW_TOKENS, contextWindowFor } from '../lib/model-window';
import { Icon } from './Icon';

type PanelKind = 'stats' | 'tokens' | 'context';

/** Last context_usage snapshot survives a restart (kept in localStorage per conversation). */
function storedSnapshot(conversationId: string): { systemTokens: number; toolTokens: number; historyTokens: number; windowTokens: number } | undefined {
  try {
    const raw = localStorage.getItem(`moyu:ctx:${conversationId}`);
    if (!raw) return undefined;
    const value = JSON.parse(raw);
    if (typeof value?.windowTokens === 'number' && typeof value?.systemTokens === 'number' && typeof value?.toolTokens === 'number' && typeof value?.historyTokens === 'number') return value;
  } catch { /* ignore */ }
  return undefined;
}

function fmtTokens(value: number): string {
  if (!value) return '0';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return String(Math.round(value));
}

function fmtCount(value: number): string {
  return Math.round(value).toLocaleString('zh-CN');
}

function fmtDuration(ms: number): string {
  if (!ms) return '—';
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分 ${Math.round(seconds % 60)} 秒`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

/**
 * DSH-style status bar under the composer capsule: three plain-text segments,
 * each opening its own hover popover (会话统计 / Token 用量 / 上下文已用).
 * Token & timing numbers aggregate this conversation's persisted messages;
 * the context split comes from the agent's `context_usage` event, so it matches
 * exactly what the model was sent.
 */
export function ContextMeter({ bot, conversation }: { bot: Bot; conversation: Conversation }) {
  const { contextUsage, settings } = useMoyu();
  const [open, setOpen] = useState<PanelKind | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const closeTimer = useRef(0);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const enter = (kind: PanelKind) => { window.clearTimeout(closeTimer.current); setOpen(kind); };
  const leave = () => { closeTimer.current = window.setTimeout(() => setOpen(null), 120); };

  const snapshot = contextUsage[conversation.id] ?? storedSnapshot(conversation.id);

  let promptSum = 0;
  let completionSum = 0;
  let cachedSum = 0;
  let cacheSamples = 0;
  let lastPrompt = 0;
  let modelMs = 0;
  let toolMs = 0;
  let ttftSum = 0;
  let ttftCount = 0;
  let rounds = 0;
  let steps = 0;
  for (const message of conversation.messages) {
    if (message.role === 'user') rounds++;
    steps += message.modelTurns?.length ?? (message.role === 'assistant' ? 1 : 0);
    modelMs += message.modelMs ?? 0;
    if (message.ttftMs !== undefined) { ttftSum += message.ttftMs; ttftCount++; }
    for (const result of message.toolResults ?? []) toolMs += result.durationMs ?? 0;
    const usage = message.usage;
    if (!usage) continue;
    promptSum += usage.promptTokens ?? 0;
    completionSum += usage.completionTokens ?? 0;
    if (usage.promptTokens !== undefined) lastPrompt = usage.promptTokens;
    if (usage.cachedTokens !== undefined && usage.promptTokens !== undefined) { cachedSum += usage.cachedTokens; cacheSamples++; }
  }
  if (!conversation.messages.length && !snapshot) return null;

  const provider = settings.providers.find((item) => item.id === bot.providerId);
  // 优先级：用户显式设置 > 后端快照（含 models.dev 远程目录解析结果）> 供应商模型目录 > 内置表 > 默认值。
  // 快照只在用户没显式设置时使用，这样改了配置会立刻生效，同时不丢后端的远程识别结果。
  const explicitWindow = provider?.modelSettings?.[bot.model]?.contextWindowTokens ?? provider?.contextWindowTokens;
  const catalogWindow = provider?.modelCatalog?.[bot.model]?.contextWindowTokens;
  const profileWindow = contextWindowFor(provider, bot.model);
  const windowTokens = explicitWindow ?? snapshot?.windowTokens ?? catalogWindow ?? profileWindow ?? DEFAULT_CONTEXT_WINDOW_TOKENS;
  // 既没有显式设置、后端也还没算过时才标「估算」，避免用户误以为这是真实窗口。
  const windowEstimated = explicitWindow === undefined && snapshot?.windowTokens === undefined;

  const systemTokens = snapshot?.systemTokens ?? 0;
  const toolTokens = snapshot?.toolTokens ?? 0;
  const historyTokens = snapshot?.historyTokens ?? 0;
  const hasSplit = !!snapshot;
  const usedTokens = hasSplit ? systemTokens + toolTokens + historyTokens : lastPrompt;
  const percent = windowTokens > 0 ? Math.min(100, Math.round((usedTokens / windowTokens) * 100)) : 0;

  const totalTokens = promptSum + completionSum;
  const uncachedInput = Math.max(0, promptSum - cachedSum);
  const hitRate = cacheSamples > 0 && promptSum > 0 ? Math.round((cachedSum / promptSum) * 100) : null;
  const tps = modelMs > 0 && completionSum > 0 ? Math.round(completionSum / (modelMs / 1000)) : null;
  const ttftAvg = ttftCount > 0 ? ttftSum / ttftCount : null;
  const width = (tokens: number) => `${windowTokens > 0 ? ((tokens / windowTokens) * 100).toFixed(2) : 0}%`;

  return (
    <div className="ctx-bar-row" ref={rootRef}>
      <div className="ctx-seg" onMouseEnter={() => enter('stats')} onMouseLeave={leave}>
        <button type="button" className="ctx-seg__trigger" aria-expanded={open === 'stats'} onClick={() => setOpen(open === 'stats' ? null : 'stats')}>
          <Icon name="clock" size={11} />
          <span>{rounds} 轮 {steps} 步{tps !== null ? ` · ${tps} tok/s` : ''}</span>
        </button>
        {open === 'stats' ? (
          <div className="ctx-pop ctx-pop--left" role="dialog" aria-label="会话统计">
            <div className="ctx-pop__title"><Icon name="clock" size={13} />会话统计</div>
            <dl className="ctx-rows">
              <div><dt>模型用时</dt><dd>{fmtDuration(modelMs)}</dd></div>
              <div><dt>工具调用用时</dt><dd>{fmtDuration(toolMs)}</dd></div>
              <div><dt>首 token 平均（TTFT）</dt><dd>{ttftAvg === null ? '—' : `${(ttftAvg / 1000).toFixed(1)} 秒`}</dd></div>
              <div><dt>输出速度（TPS）</dt><dd>{tps === null ? '—' : `${tps} tok/s`}</dd></div>
            </dl>
          </div>
        ) : null}
      </div>

      <div className="ctx-seg" onMouseEnter={() => enter('tokens')} onMouseLeave={leave}>
        <button type="button" className="ctx-seg__trigger" aria-expanded={open === 'tokens'} onClick={() => setOpen(open === 'tokens' ? null : 'tokens')}>
          <Icon name="usage" size={11} />
          <span>{fmtTokens(totalTokens)} tok · 缓存命中 {hitRate === null ? '—' : `${hitRate}%`}</span>
        </button>
        {open === 'tokens' ? (
          <div className="ctx-pop ctx-pop--center" role="dialog" aria-label="Token 用量">
            <div className="ctx-pop__title"><Icon name="usage" size={13} />Token 用量<b>{fmtCount(totalTokens)} tok</b></div>
            <dl className="ctx-rows">
              <div><dt>缓存命中</dt><dd>{hitRate === null ? '—' : `${hitRate}%`}</dd></div>
              <div><dt>未缓存输入</dt><dd>{fmtCount(uncachedInput)} tok</dd></div>
              <div><dt>缓存读取</dt><dd>{fmtCount(cachedSum)} tok</dd></div>
              <div><dt>输出</dt><dd>{fmtCount(completionSum)} tok</dd></div>
            </dl>
          </div>
        ) : null}
      </div>

      <div className="ctx-seg" onMouseEnter={() => enter('context')} onMouseLeave={leave}>
        <button type="button" className="ctx-seg__trigger" aria-expanded={open === 'context'} onClick={() => setOpen(open === 'context' ? null : 'context')}>
          <Icon name="gauge" size={11} />
          <span>{percent}%</span>
        </button>
        {open === 'context' ? (
          <div className="ctx-pop ctx-pop--right" role="dialog" aria-label="上下文已用">
            <div className="ctx-pop__head">
              <span>上下文已用</span>
              <strong>{percent}%</strong>
              <span className="ctx-pop__window">~{fmtTokens(usedTokens)} / {fmtTokens(windowTokens)}{windowEstimated ? '（估算）' : ''}</span>
            </div>
            <div className="ctx-bar" aria-hidden="true">
              {hasSplit ? <>
                <i className="ctx-bar__seg ctx-bar__seg--system" style={{ width: width(systemTokens) }} />
                <i className="ctx-bar__seg ctx-bar__seg--tools" style={{ width: width(toolTokens) }} />
                <i className="ctx-bar__seg ctx-bar__seg--messages" style={{ width: width(historyTokens) }} />
              </> : null}
            </div>
            <ul className="ctx-legend">
              <li><i className="ctx-dot ctx-dot--system" />系统提示词<b>{hasSplit ? `~${fmtTokens(systemTokens)}` : '—'}</b></li>
              <li><i className="ctx-dot ctx-dot--tools" />工具定义<b>{hasSplit ? `~${fmtTokens(toolTokens)}` : '—'}</b></li>
              <li><i className="ctx-dot ctx-dot--messages" />对话消息<b>{hasSplit ? `~${fmtTokens(historyTokens)}` : '—'}</b></li>
            </ul>
            {!hasSplit ? <p className="ctx-empty">发送一条消息后即可看到三段拆分。</p> : null}
            {windowEstimated ? <p className="ctx-empty">未识别「{bot.model}」的上下文窗口，按 {fmtTokens(DEFAULT_CONTEXT_WINDOW_TOKENS)} 估算。请在 设置 → 供应商 → 该模型 填写准确值，或点「获取模型」自动探测。</p> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
