"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sdkChat = sdkChat;
const node_url_1 = require("node:url");
const types_1 = require("./types");
const transport_1 = require("./transport");
const generation_1 = require("../generation");
// Core is CommonJS; preserve native import for the SDK's ESM packages, including in Electron.
const importModule = new Function('url', 'return import(url)');
const modules = new Map();
function sdk(name) {
    if (!modules.has(name))
        modules.set(name, importModule((0, node_url_1.pathToFileURL)(require.resolve(name)).href));
    return modules.get(name);
}
const baseUrl = (config) => config.baseUrl.replace(/\/+$/, '');
const record = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
/** Keep only protocol replay fields, never arbitrary provider options from a saved transcript. */
function metadata(value) {
    if (!record(value))
        return undefined;
    const out = {};
    for (const [namespace, fields] of Object.entries({ anthropic: ['signature', 'redactedData'], google: ['thoughtSignature'], openaiCompatible: ['thoughtSignature'] })) {
        if (!record(value[namespace]))
            continue;
        const entries = fields.flatMap(field => typeof value[namespace][field] === 'string' ? [[field, value[namespace][field]]] : []);
        if (entries.length)
            out[namespace] = Object.fromEntries(entries);
    }
    return Object.keys(out).length ? out : undefined;
}
function replayParts(config, args, message, reasoningReplay) {
    const replay = message.replay;
    if (!replay || replay.version !== 1 || replay.providerId !== config.id || replay.kind !== config.kind || replay.model !== args.model || replay.baseUrl !== baseUrl(config) || !Array.isArray(replay.parts))
        return undefined;
    const parts = [];
    for (const part of replay.parts) {
        if (!record(part))
            return undefined;
        const providerOptions = metadata(part.providerOptions);
        if ((part.type === 'text' || part.type === 'reasoning') && typeof part.text === 'string') {
            if (part.type === 'reasoning' && config.kind === 'openai' && !reasoningReplay)
                continue;
            if (part.type === 'reasoning' && config.kind === 'anthropic' && !providerOptions?.anthropic)
                continue;
            parts.push({ type: part.type, text: part.text, providerOptions });
        }
        else if (part.type === 'tool-call' && typeof part.toolCallId === 'string' && typeof part.toolName === 'string' && record(part.input)) {
            const call = message.toolCalls?.find(call => call.id === part.toolCallId && call.name === part.toolName);
            if (call)
                parts.push({ type: 'tool-call', toolCallId: call.id, toolName: call.name, input: call.arguments, providerOptions });
        }
        else
            return undefined;
    }
    // A malformed or incomplete saved replay must never silently drop visible content or calls.
    if (parts.map(part => part.type === 'text' ? part.text : '').join('') !== message.content ||
        (message.toolCalls ?? []).some(call => !parts.some(part => part.type === 'tool-call' && part.toolCallId === call.id)))
        return undefined;
    return parts;
}
function prompt(config, args, reasoningReplay) {
    const out = [];
    if (args.system.trim())
        out.push({ role: 'system', content: args.system });
    for (const message of args.messages) {
        if (message.role === 'user') {
            const content = [{ type: 'text', text: message.content }];
            for (const image of message.images ?? []) {
                const data = (0, types_1.splitDataUrl)(image.dataUrl);
                if (data)
                    content.push({ type: 'file', mediaType: data.mimeType, data: { type: 'data', data: data.base64 } });
            }
            out.push({ role: 'user', content });
        }
        else if (message.role === 'tool') {
            out.push({ role: 'tool', content: [{ type: 'tool-result', toolCallId: message.toolCallId, toolName: message.name, output: { type: 'text', value: message.content } }] });
        }
        else {
            const saved = replayParts(config, args, message, reasoningReplay);
            const content = saved ?? [
                ...(config.kind === 'openai' && reasoningReplay && message.reasoning ? [{ type: 'reasoning', text: message.reasoning }] : []),
                ...(message.content ? [{ type: 'text', text: message.content }] : []),
                ...(message.toolCalls ?? []).map(call => ({ type: 'tool-call', toolCallId: call.id, toolName: call.name, input: call.arguments })),
            ];
            if (content.length)
                out.push({ role: 'assistant', content: content });
        }
    }
    return out;
}
function usageFor(kind, value) {
    const raw = value.raw;
    let promptTokens = value.inputTokens.total, completionTokens = value.outputTokens.total, cachedTokens = value.inputTokens.cacheRead;
    // Missing counts are unknown, not zero: the task ledger reserves the request cap for them.
    if (raw && kind === 'openai') {
        promptTokens = count(raw.prompt_tokens);
        completionTokens = count(raw.completion_tokens);
        const details = raw.prompt_tokens_details;
        cachedTokens = count(record(details) ? details.cached_tokens : undefined) ?? count(raw.prompt_cache_hit_tokens);
    }
    else if (raw && kind === 'gemini') {
        promptTokens = count(raw.promptTokenCount);
        if (promptTokens !== undefined)
            promptTokens += count(raw.toolUsePromptTokenCount) ?? 0;
        completionTokens = count(raw.candidatesTokenCount);
        if (completionTokens !== undefined)
            completionTokens += count(raw.thoughtsTokenCount) ?? 0;
        cachedTokens = count(raw.cachedContentTokenCount);
    }
    return promptTokens === undefined && completionTokens === undefined ? undefined : { promptTokens, completionTokens, cachedTokens };
}
function providerError(error) {
    if (error instanceof types_1.ProviderError || (error instanceof Error && error.name === 'AbortError'))
        return error;
    const value = record(error) ? error : {};
    return new types_1.ProviderError(typeof value.message === 'string' ? value.message : '供应商返回了无效的数据流。', typeof value.statusCode === 'number' ? value.statusCode : 502);
}
/** SDK owns wire protocols; MoyuBot owns task execution, budgets, retries and approvals. */
async function sdkChat(config, apiKey, args, handlers) {
    if (!apiKey && !(config.kind === 'openai' && /localhost|127\.0\.0\.1|\[::1\]/i.test(config.baseUrl)))
        throw new types_1.ProviderError('该供应商还没有填写 API Key，请在设置里补上。', 401, 'missing_key');
    args.signal?.throwIfAborted();
    const replayReasoning = !!(args.tools.length && (args.reasoning?.reasoningReplay ?? (0, generation_1.modelSettings)(config, args.model).reasoningReplay));
    const thinking = args.reasoning?.thinkingBudgetTokens;
    const anthropicThinking = config.kind === 'anthropic' && args.reasoning?.reasoningControl === 'anthropic-budget' && thinking;
    if (anthropicThinking && thinking >= (args.maxTokens ?? 4096))
        throw new types_1.ProviderError('Anthropic 思考预算必须小于本次输出额度。', 400, 'invalid_thinking_budget');
    const settings = { apiKey, baseURL: baseUrl(config), headers: config.extraHeaders,
        fetch: ((input, init) => (0, transport_1.providerFetch)(config, input, init)) };
    let model;
    try {
        if (config.kind === 'anthropic') {
            const { createAnthropic } = await sdk('@ai-sdk/anthropic');
            model = createAnthropic({ ...settings, baseURL: /\/v1$/.test(settings.baseURL) ? settings.baseURL : `${settings.baseURL}/v1` })(args.model);
        }
        else if (config.kind === 'gemini') {
            const { createGoogle } = await sdk('@ai-sdk/google');
            model = createGoogle(settings)(args.model);
        }
        else {
            const { createOpenAICompatible } = await sdk('@ai-sdk/openai-compatible');
            model = createOpenAICompatible({ ...settings, name: 'openaiCompatible', includeUsage: true,
                transformRequestBody: (body) => {
                    const result = { ...body };
                    const field = args.reasoning?.outputTokenParameter ?? 'max_tokens';
                    if (field !== 'max_tokens') {
                        delete result.max_tokens;
                        Object.assign(result, Object.fromEntries([[field, args.maxTokens]]));
                    }
                    if (args.reasoning?.reasoningControl === 'openai-effort' && args.reasoning.reasoningEffort)
                        result.reasoning_effort = args.reasoning.reasoningEffort;
                    // DeepSeek requires even empty reasoning_content on assistant tool turns.
                    result.messages = body.messages.map((message) => message.role === 'assistant' && replayReasoning ? { ...message, reasoning_content: message.reasoning_content ?? '' } : message);
                    return result;
                },
            })(args.model);
        }
        const providerOptions = anthropicThinking ? { anthropic: { thinking: { type: 'enabled', budgetTokens: thinking } } }
            : config.kind === 'gemini' && args.reasoning?.reasoningControl === 'gemini-budget' && thinking ? { google: { thinkingConfig: { thinkingBudget: thinking } } } : {};
        const result = await model.doStream({ prompt: prompt(config, args, replayReasoning),
            tools: args.tools.length ? args.tools.map(tool => ({ type: 'function', name: tool.name, description: tool.description, inputSchema: tool.parameters })) : undefined,
            toolChoice: args.tools.length ? { type: 'auto' } : undefined,
            maxOutputTokens: args.maxTokens ?? (config.kind === 'anthropic' ? 4096 : undefined),
            temperature: anthropicThinking ? undefined : args.temperature,
            abortSignal: args.signal, providerOptions, includeRawChunks: true });
        const parts = [];
        const blocks = new Map();
        const pending = new Map();
        const calls = [];
        let text = '', reasoning = '', finishReason, usage, streamError;
        let length = false, ended = false;
        const merge = (part, value, signatureDelta = false) => {
            const options = metadata(value);
            if (!options)
                return;
            const previous = part.providerOptions ?? {};
            for (const [namespace, fields] of Object.entries(options)) {
                const prior = previous[namespace] ?? {};
                previous[namespace] = { ...prior, ...fields };
                if (signatureDelta && namespace === 'anthropic' && typeof fields.signature === 'string')
                    previous[namespace].signature = String(prior.signature ?? '') + fields.signature;
            }
            part.providerOptions = previous;
        };
        const reader = result.stream.getReader();
        try {
            while (true) {
                args.signal?.throwIfAborted();
                const { value: event, done } = await reader.read();
                if (done)
                    break;
                if (event.type === 'raw') {
                    const raw = event.rawValue;
                    if (raw?.choices?.[0]?.finish_reason === 'length' || raw?.delta?.stop_reason === 'max_tokens' || raw?.candidates?.[0]?.finishReason === 'MAX_TOKENS')
                        length = true;
                    ended ||= !!(raw?.choices?.[0]?.finish_reason || raw?.delta?.stop_reason || raw?.candidates?.[0]?.finishReason);
                    if (config.kind === 'openai' && raw?.usage) {
                        usage = { promptTokens: count(raw.usage.prompt_tokens), completionTokens: count(raw.usage.completion_tokens),
                            cachedTokens: count(raw.usage.prompt_tokens_details?.cached_tokens) ?? count(raw.usage.prompt_cache_hit_tokens) };
                        handlers.onUsage?.(usage);
                    }
                    else if (config.kind === 'anthropic' && (raw?.message?.usage || raw?.type === 'message_delta')) {
                        const value = raw.message?.usage ?? raw.usage;
                        if (value) {
                            const input = count(value.input_tokens);
                            usage = { promptTokens: input === undefined ? usage?.promptTokens : input + (count(value.cache_read_input_tokens) ?? 0) + (count(value.cache_creation_input_tokens) ?? 0),
                                completionTokens: count(value.output_tokens) ?? usage?.completionTokens, cachedTokens: count(value.cache_read_input_tokens) ?? usage?.cachedTokens };
                            handlers.onUsage?.(usage);
                        }
                    }
                }
                else if (event.type === 'error')
                    streamError ??= event.error;
                else if (event.type === 'text-start' || event.type === 'reasoning-start') {
                    const part = { type: event.type === 'text-start' ? 'text' : 'reasoning', text: '' };
                    parts.push(part);
                    blocks.set(`${part.type}:${event.id}`, part);
                    merge(part, event.providerMetadata);
                }
                else if (event.type === 'text-delta' || event.type === 'reasoning-delta') {
                    const type = event.type === 'text-delta' ? 'text' : 'reasoning';
                    let part = blocks.get(`${type}:${event.id}`);
                    if (!part || part.type === 'tool-call')
                        throw new types_1.ProviderError('供应商数据流的内容块顺序无效。', 502);
                    part.text += event.delta;
                    merge(part, event.providerMetadata, event.type === 'reasoning-delta' && event.delta === '');
                    if (type === 'text') {
                        text += event.delta;
                        if (event.delta)
                            handlers.onText(event.delta);
                    }
                    else {
                        reasoning += event.delta;
                        if (event.delta)
                            handlers.onReasoning?.(event.delta);
                    }
                }
                else if (event.type === 'text-end' || event.type === 'reasoning-end') {
                    const part = blocks.get(`${event.type === 'text-end' ? 'text' : 'reasoning'}:${event.id}`);
                    if (part)
                        merge(part, event.providerMetadata);
                }
                else if (event.type === 'tool-input-start') {
                    pending.set(event.id, { name: event.toolName, rawArguments: '' });
                }
                else if (event.type === 'tool-input-delta') {
                    const entry = pending.get(event.id);
                    if (entry)
                        entry.rawArguments += event.delta;
                }
                else if (event.type === 'tool-call') {
                    if (event.providerExecuted)
                        throw new types_1.ProviderError('此任务不支持供应商执行工具。', 502);
                    const entry = pending.get(event.toolCallId);
                    const raw = event.input;
                    pending.set(event.toolCallId, { name: event.toolName, rawArguments: raw || entry?.rawArguments || '' });
                    const part = { type: 'tool-call', toolCallId: event.toolCallId, toolName: event.toolName, input: {} };
                    parts.push(part);
                    merge(part, event.providerMetadata);
                }
                else if (event.type === 'finish') {
                    finishReason = event.finishReason.unified;
                    length ||= finishReason === 'length';
                    const normalized = usageFor(config.kind, event.usage);
                    if (normalized)
                        usage = { ...normalized, cachedTokens: normalized.cachedTokens ?? usage?.cachedTokens };
                    if (usage)
                        handlers.onUsage?.(usage);
                }
            }
        }
        catch (error) {
            streamError ??= error;
        }
        finally {
            await reader.cancel().catch(() => { });
            reader.releaseLock();
        }
        args.signal?.throwIfAborted();
        if (length)
            throw new types_1.OutputLimitError({ text, reasoning, tools: [...pending.values()] });
        if (streamError)
            throw providerError(streamError);
        if (!ended || !finishReason || finishReason === 'error' || finishReason === 'interrupted')
            throw new types_1.ProviderError('供应商数据流未正常结束，工具调用没有执行。', 502, 'incomplete_stream');
        for (const part of parts) {
            if (part.type !== 'tool-call')
                continue;
            const entry = pending.get(part.toolCallId);
            let input;
            try {
                input = JSON.parse(entry?.rawArguments || '{}');
            }
            catch {
                throw new types_1.ProviderError('模型生成了无效的工具参数，工具没有执行。', 502, 'invalid_tool_arguments');
            }
            if (!record(input))
                throw new types_1.ProviderError('工具参数必须是 JSON 对象，工具没有执行。', 502, 'invalid_tool_arguments');
            if (calls.some(call => call.id === part.toolCallId))
                throw new types_1.ProviderError('模型返回了重复的工具调用 ID。', 502, 'invalid_tool_arguments');
            part.input = input;
            calls.push({ id: part.toolCallId, name: part.toolName, arguments: input });
        }
        if (calls.length !== pending.size)
            throw new types_1.ProviderError('供应商返回了未完成的工具调用，工具没有执行。', 502, 'incomplete_stream');
        if (!text && !calls.length)
            throw new types_1.ProviderError('供应商返回了空回复。', 502, 'empty_response');
        for (const call of calls)
            handlers.onToolCall(call);
        return { finishReason, usage, replay: { version: 1, providerId: config.id, kind: config.kind, baseUrl: baseUrl(config), model: args.model, parts } };
    }
    catch (error) {
        throw providerError(error);
    }
}
