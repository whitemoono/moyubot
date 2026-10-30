import type { AssistantMessage, Context, Model, Api, Usage, TextContent, ThinkingContent, ToolCall as PiToolCall } from '@earendil-works/pi-ai';
import type { ProviderConfig, ProviderReplay, TokenUsage } from '../types';
import type { ChatArgs, ChatOutcome, StreamHandlers } from './types';
import { ProviderError, OutputLimitError, splitDataUrl } from './types';
import { modelSettings } from '../generation';
import { providerFetch } from './transport';
import { googleTransport } from './pi-transport';

const nativeImport = new Function('url', 'return import(url)') as (url: string) => Promise<any>;
const modules = new Map<string, Promise<any>>();
function pi(file: string): Promise<any> {
  if (!modules.has(file)) modules.set(file, nativeImport(`@earendil-works/pi-ai/${file}`));
  return modules.get(file)!;
}
const emptyUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
const baseUrl = (config: ProviderConfig) => config.baseUrl.replace(/\/+$/, '');
const apiFor = (kind: ProviderConfig['kind']): Api => kind === 'anthropic' ? 'anthropic-messages' : kind === 'gemini' ? 'google-generative-ai' : 'openai-completions';

function replay(config: ProviderConfig, args: ChatArgs, message: Extract<ChatArgs['messages'][number], { role: 'assistant' }>, reasoningReplay: boolean): AssistantMessage['content'] | undefined {
  const saved = message.replay;
  if (!saved || saved.version !== 1 || saved.providerId !== config.id || saved.kind !== config.kind || saved.baseUrl !== baseUrl(config) || saved.model !== args.model || !Array.isArray(saved.parts)) return undefined;
  const content: AssistantMessage['content'] = [];
  for (const part of saved.parts) {
    if (!record(part)) return undefined;
    const options = part.providerOptions;
    const string = (namespace: string, key: string): string | undefined => typeof options?.[namespace]?.[key] === 'string' ? options[namespace][key] as string : undefined;
    if (part.type === 'text' && typeof part.text === 'string') content.push({ type: 'text', text: part.text, textSignature: string('google', 'thoughtSignature') ?? string('pi', 'textSignature') });
    else if (part.type === 'reasoning' && typeof part.text === 'string') {
      if (config.kind === 'openai' && !reasoningReplay) continue;
      const signature = string('anthropic', 'signature') ?? string('anthropic', 'redactedData') ?? string('google', 'thoughtSignature') ?? string('pi', 'thinkingSignature');
      if (config.kind === 'anthropic' && !signature) continue;
      content.push({ type: 'thinking', thinking: part.text, thinkingSignature: signature, redacted: !!string('anthropic', 'redactedData') });
    } else if (part.type === 'tool-call') {
      const call = message.toolCalls?.find(call => call.id === part.toolCallId && call.name === part.toolName);
      if (call) content.push({ type: 'toolCall', id: call.id, name: call.name, arguments: call.arguments as PiToolCall['arguments'], thoughtSignature: string('google', 'thoughtSignature') ?? string('pi', 'thoughtSignature') });
    } else return undefined;
  }
  if (content.map(part => part.type === 'text' ? part.text : '').join('') !== message.content || (message.toolCalls ?? []).some(call => !content.some(part => part.type === 'toolCall' && part.id === call.id))) return undefined;
  return content;
}

function context(config: ProviderConfig, args: ChatArgs, reasoningReplay: boolean): Context {
  return { systemPrompt: args.system, tools: args.tools.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters as any })), messages: args.messages.map(message => {
    if (message.role === 'user') {
      const content: (TextContent | { type: 'image'; data: string; mimeType: string })[] = [{ type: 'text', text: message.content }];
      for (const image of message.images ?? []) { const split = splitDataUrl(image.dataUrl); if (split) content.push({ type: 'image', data: split.base64, mimeType: split.mimeType }); }
      return { role: 'user' as const, content: content.length === 1 ? message.content : content, timestamp: 0 };
    }
    if (message.role === 'tool') return { role: 'toolResult' as const, toolCallId: message.toolCallId, toolName: message.name, content: [{ type: 'text' as const, text: message.content }], isError: false, timestamp: 0 };
    const content = replay(config, args, message, reasoningReplay) ?? [
      ...(config.kind === 'openai' && reasoningReplay && message.reasoning ? [{ type: 'thinking' as const, thinking: message.reasoning }] : []),
      ...(message.content ? [{ type: 'text' as const, text: message.content }] : []),
      ...(message.toolCalls ?? []).map(call => ({ type: 'toolCall' as const, id: call.id, name: call.name, arguments: call.arguments as PiToolCall['arguments'] })),
    ];
    return { role: 'assistant' as const, content, api: apiFor(config.kind), provider: config.id, model: args.model, usage: emptyUsage(), stopReason: 'stop' as const, timestamp: 0 };
  }) };
}

function savedParts(content: AssistantMessage['content'], kind: ProviderConfig['kind']): ProviderReplay['parts'] {
  return content.map((part): ProviderReplay['parts'][number] => {
    if (part.type === 'toolCall') return { type: 'tool-call', toolCallId: part.id, toolName: part.name, input: part.arguments as Record<string, unknown>, ...(part.thoughtSignature ? { providerOptions: { google: { thoughtSignature: part.thoughtSignature } } } : {}) };
    if (part.type === 'text') return { type: 'text', text: part.text, ...(part.textSignature ? { providerOptions: { [kind === 'gemini' ? 'google' : 'pi']: { [kind === 'gemini' ? 'thoughtSignature' : 'textSignature']: part.textSignature } } } : {}) };
    return { type: 'reasoning', text: part.redacted ? '' : part.thinking, ...(part.thinkingSignature ? { providerOptions: kind === 'anthropic' ? { anthropic: { [part.redacted ? 'redactedData' : 'signature']: part.thinkingSignature } } : { [kind === 'gemini' ? 'google' : 'pi']: { [kind === 'gemini' ? 'thoughtSignature' : 'thinkingSignature']: part.thinkingSignature } } } : {}) };
  });
}

/** pi-ai handles protocols; MoyuBot owns task execution, approvals and budgets. */
export async function piChat(config: ProviderConfig, apiKey: string, args: ChatArgs, handlers: StreamHandlers): Promise<ChatOutcome> {
  if (!apiKey && !(config.kind === 'openai' && /localhost|127\.0\.0\.1|\[::1\]/i.test(config.baseUrl))) throw new ProviderError('该供应商还没有填写 API Key，请在设置里补上。', 401, 'missing_key');
  args.signal?.throwIfAborted();
  const reasoningReplay = !!(args.tools.length && (args.reasoning?.reasoningReplay ?? modelSettings(config, args.model).reasoningReplay));
  const model: Model<Api> = { id: args.model, name: args.model, api: apiFor(config.kind), provider: config.id, baseUrl: baseUrl(config), reasoning: true, input: ['text', 'image'],
    contextWindow: modelSettings(config, args.model).contextWindowTokens ?? 32768, maxTokens: args.maxTokens ?? 8192,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: config.kind === 'openai' ? { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: args.reasoning?.reasoningControl === 'openai-effort', supportsUsageInStreaming: true, supportsFinishReason: true,
      maxTokensField: args.reasoning?.outputTokenParameter ?? 'max_tokens', requiresReasoningContentOnAssistantMessages: reasoningReplay, supportsStrictMode: false }
      : config.kind === 'anthropic' ? { supportsStrictTools: false } : undefined };
  let ended = false, length = false, usage: TokenUsage | undefined, status = 502;
  const rawCalls = new Map<number, { name: string; rawArguments: string }>();
  let terminal: AssistantMessage | undefined;
  let transport: Awaited<ReturnType<typeof googleTransport>> | undefined;
  const raw = (value: any) => {
    ended ||= !!(value?.choices?.[0]?.finish_reason || value?.delta?.stop_reason || value?.candidates?.[0]?.finishReason);
    length ||= value?.choices?.[0]?.finish_reason === 'length' || value?.delta?.stop_reason === 'max_tokens' || value?.candidates?.[0]?.finishReason === 'MAX_TOKENS';
    if (config.kind === 'openai') {
      for (const call of value?.choices?.[0]?.delta?.tool_calls ?? []) { const previous = rawCalls.get(call.index) ?? { name: '', rawArguments: '' }; previous.name ||= call.function?.name ?? ''; previous.rawArguments += call.function?.arguments ?? ''; rawCalls.set(call.index, previous); }
      if (value?.usage) usage = { promptTokens: count(value.usage.prompt_tokens), completionTokens: count(value.usage.completion_tokens), cachedTokens: count(value.usage.prompt_tokens_details?.cached_tokens) ?? count(value.usage.prompt_cache_hit_tokens) };
    } else if (config.kind === 'anthropic') {
      const u = value?.message?.usage ?? value?.usage;
      if (u) { const input = count(u.input_tokens); usage = { promptTokens: input === undefined ? usage?.promptTokens : input + (count(u.cache_read_input_tokens) ?? 0) + (count(u.cache_creation_input_tokens) ?? 0), completionTokens: value.type === 'message_delta' ? count(u.output_tokens) : usage?.completionTokens, cachedTokens: count(u.cache_read_input_tokens) ?? usage?.cachedTokens }; }
      if (value.type === 'content_block_start' && value.content_block?.type === 'tool_use') rawCalls.set(value.index, { name: value.content_block.name, rawArguments: '' });
      if (value.delta?.type === 'input_json_delta') { const call = rawCalls.get(value.index); if (call) call.rawArguments += value.delta.partial_json; }
    } else if (value?.usageMetadata) {
      const u = value.usageMetadata, input = count(u.promptTokenCount), output = count(u.candidatesTokenCount);
      usage = { promptTokens: input, completionTokens: output === undefined ? undefined : output + (count(u.thoughtsTokenCount) ?? 0), cachedTokens: count(u.cachedContentTokenCount) };
    }
    if (usage) handlers.onUsage?.(usage);
  };
  try {
    const [{ stream }, { normalizeContext }] = await Promise.all([pi(`api/${model.api}`), pi('utils/transcript')]);
    const options: any = { apiKey: apiKey || 'local', headers: config.extraHeaders, maxTokens: args.maxTokens, temperature: args.temperature, signal: args.signal, maxRetries: 0,
      fetch: async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const response = await providerFetch(config, input, init);
        if (response.status >= 400) status = response.status;
        return response;
      },
      onResponse: (response: { status: number }) => { status = response.status >= 400 ? response.status : 502; }, onProviderStreamEvent: raw,
      onPayload: (payload: any) => {
        if (config.kind === 'openai' && !reasoningReplay) for (const message of payload.messages ?? []) delete message.reasoning_content;
        return payload;
      } };
    if (config.kind === 'anthropic') {
      // Anthropic's SDK appends /v1/messages itself.
      model.baseUrl = model.baseUrl.replace(/\/v1$/, '');
      if (args.reasoning?.reasoningControl === 'anthropic-budget' && args.reasoning.thinkingBudgetTokens) {
        if (args.reasoning.thinkingBudgetTokens >= (args.maxTokens ?? 4096)) throw new ProviderError('Anthropic 思考预算必须小于本次输出额度。', 400, 'invalid_thinking_budget');
        options.thinkingEnabled = true; options.thinkingBudgetTokens = args.reasoning.thinkingBudgetTokens;
      }
      options.maxTokens ??= 4096;
    } else if (config.kind === 'gemini') {
      transport = await googleTransport(config, code => { if (code >= 400) status = code; }); model.baseUrl = transport.baseUrl; delete options.fetch;
      if (args.reasoning?.reasoningControl === 'gemini-budget' && args.reasoning.thinkingBudgetTokens) options.thinking = { enabled: true, budgetTokens: args.reasoning.thinkingBudgetTokens };
    } else if (args.reasoning?.reasoningControl === 'openai-effort') options.reasoningEffort = args.reasoning.reasoningEffort;
    const events = stream(model, normalizeContext(context(config, args, reasoningReplay)), options);
    for await (const event of events) {
      args.signal?.throwIfAborted();
      if (event.type === 'text_delta') handlers.onText(event.delta);
      else if (event.type === 'thinking_delta') handlers.onReasoning?.(event.delta);
      else if (event.type === 'done') terminal = event.message;
      else if (event.type === 'error') terminal = event.error;
    }
    args.signal?.throwIfAborted();
    if (length || terminal?.stopReason === 'length') throw new OutputLimitError({ text: terminal?.content.filter((part): part is TextContent => part.type === 'text').map(part => part.text).join('') ?? '',
      reasoning: terminal?.content.filter((part): part is ThinkingContent => part.type === 'thinking').map(part => part.thinking).join('') ?? '', tools: [...rawCalls.values()] });
    if (!ended || !terminal || terminal.stopReason === 'error' || terminal.stopReason === 'pending') throw new ProviderError(`供应商数据流未正常结束，工具调用没有执行。${terminal?.errorMessage ?? ''}`, status, 'incomplete_stream');
    const calls = terminal.content.filter((part): part is PiToolCall => part.type === 'toolCall');
    for (const call of calls) if (call.argumentsError || !record(call.arguments)) throw new ProviderError('模型生成了无效的工具参数，工具没有执行。', 502, 'invalid_tool_arguments');
    if (new Set(calls.map(call => call.id)).size !== calls.length) throw new ProviderError('模型返回了重复的工具调用 ID。', 502, 'invalid_tool_arguments');
    if (rawCalls.size && rawCalls.size !== calls.length) throw new ProviderError('供应商返回了未完成的工具调用，工具没有执行。', 502, 'incomplete_stream');
    if (!calls.length && !terminal.content.some(part => part.type === 'text' && part.text)) throw new ProviderError('供应商返回了空回复。', 502, 'empty_response');
    for (const call of calls) handlers.onToolCall({ id: call.id, name: call.name, arguments: call.arguments as Record<string, unknown> });
    return { finishReason: terminal.stopReason, usage, replay: { version: 1, providerId: config.id, kind: config.kind, baseUrl: baseUrl(config), model: args.model, parts: savedParts(terminal.content, config.kind) } };
  } catch (error) {
    if (error instanceof ProviderError || args.signal?.aborted) throw error;
    throw new ProviderError(error instanceof Error ? error.message : '模型接口请求失败。', status);
  } finally { await transport?.close(); }
}
