/** 手机端聊天：与 PWA 同一套执行协议（/api/chat/send + /api/chat/runs + 审批）。 */
import { useEffect, useState } from 'react';
import { api, currentSession, uuid } from './server';
import { getClient, putRecord, useSyncVersion } from './data';

export interface ChatJob { botId: string; conversationId: string; text: string; requestId: string; providerId: string; model: string }
export interface RunInfo { id: string; conversation: string; status: string; error?: string }
export interface Approval { id: string; tool: string; arguments: Record<string, unknown> }

export interface BotConfig { id: string; name: string; avatar?: { shape?: string; from?: string; glyph?: string }; providerId?: string; model?: string }

export async function sendChat(bot: BotConfig, conversationId: string, text: string): Promise<void> {
  const client = getClient();
  if (!client?.state.enabled) throw new Error('请先开启实时同步');
  const requestId = uuid();
  const job: ChatJob = { botId: bot.id, conversationId, text, requestId, providerId: bot.providerId ?? '', model: bot.model ?? '' };
  putRecord('messages', requestId, { id: requestId, conversationId, botId: bot.id, role: 'user', content: text, createdAt: Date.now() });
  await client.sync(true);
  if (Object.keys(client.state.outbox).length) throw new Error('仍有本机内容待上传，请稍候重试');
  await api('/api/chat/send', job);
}

export async function stopChat(conversationId: string, runs: RunInfo[]): Promise<void> {
  const job = runs.find((r) => r.conversation === conversationId && r.status === 'running');
  if (job) await api('/api/chat/stop', { id: job.id });
}

export function approve(id: string, allow: boolean): Promise<void> {
  return api('/api/chat/approve', { id, allow });
}

/** 服务器侧聊天运行态 + 工具审批（2.5s 轮询，仅挂载的屏幕消耗）。 */
export function useChatRuns(): { runs: RunInfo[]; approvals: Approval[] } {
  const [state, setState] = useState<{ runs: RunInfo[]; approvals: Approval[] }>({ runs: [], approvals: [] });
  useSyncVersion();
  useEffect(() => {
    let alive = true, busy = false;
    const tick = async () => {
      if (!alive || busy || !currentSession() || !getClient()?.state.enabled) return;
      busy = true;
      try {
        const next = await api('/api/chat/runs');
        if (alive) setState({ runs: next.runs ?? [], approvals: next.approvals ?? [] });
      } catch { /* 下次轮询重试 */ }
      finally { busy = false; }
    };
    const timer = setInterval(tick, 2500);
    void tick();
    return () => { alive = false; clearInterval(timer); };
  }, []);
  return state;
}
