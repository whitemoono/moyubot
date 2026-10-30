import type { ProviderConfig, ToolCall, TokenUsage, ModelSettings, ProviderReplay } from '../types';

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type AgentMessage =
  | { role: 'user'; content: string; images?: { mimeType: string; dataUrl: string }[] }
  | { role: 'assistant'; content: string; reasoning?: string; toolCalls?: ToolCall[]; replay?: ProviderReplay }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface ChatArgs {
  model: string;
  system: string;
  messages: AgentMessage[];
  tools: ToolSchema[];
  temperature: number;
  maxTokens?: number;
  reasoning?: Pick<ModelSettings, 'reasoningControl' | 'reasoningEffort' | 'thinkingBudgetTokens' | 'outputTokenParameter' | 'reasoningReplay'>;
  signal?: AbortSignal;
}

export interface StreamHandlers {
  onUsage?(usage: TokenUsage): void;
  onText(chunk: string): void;
  onReasoning?(chunk: string): void;
  onToolCall(call: ToolCall): void;
}

export interface ChatOutcome {
  finishReason: string;
  usage?: TokenUsage;
  replay?: ProviderReplay;
}

export interface ChatProvider {
  readonly kind: ProviderConfig['kind'];
  chat(args: ChatArgs, handlers: StreamHandlers): Promise<ChatOutcome>;
  listModels(): Promise<string[]>;
  test(): Promise<{ ok: boolean; message: string; latencyMs: number }>;
}

export interface ProviderContext {
  config: ProviderConfig;
  apiKey: string;
}

export class ProviderError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code = 'provider_error') {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.code = code;
  }
}

/** A truncated response has no executable calls; raw arguments are diagnostic data only. */
export class OutputLimitError extends ProviderError {
  constructor(readonly partial: { text: string; reasoning: string; tools: { name: string; rawArguments: string }[] }) {
    super('模型单次输出额度已耗尽，自动恢复未能完成任务；已执行的工具结果已保留。', 502, 'output_limit');
    this.name = 'OutputLimitError';
  }
}

export function splitDataUrl(dataUrl: string): { base64: string; mimeType: string } | null {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  return { mimeType: match[1] ?? 'image/png', base64: match[2] ?? '' };
}

export function parseToolArguments(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return { __raw: raw };
  }
}

export function combineSignals(a: AbortSignal | undefined, b: AbortSignal | undefined): AbortSignal | undefined {
  if (!a) return b;
  if (!b) return a;
  const controller = new AbortController();
  const abort = () => controller.abort();
  a.addEventListener('abort', abort);
  b.addEventListener('abort', abort);
  return controller.signal;
}
