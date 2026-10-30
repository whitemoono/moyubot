"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAICompatibleProvider = void 0;
const sdk_1 = require("./sdk");
const transport_1 = require("./transport");
const types_1 = require("./types");
const sse_1 = require("./sse");
/** OpenAI-compatible /chat/completions provider: xAI, OpenAI, DeepSeek, OpenRouter, Ollama, … */
class OpenAICompatibleProvider {
    config;
    apiKey;
    kind = 'openai';
    constructor(config, apiKey) {
        this.config = config;
        this.apiKey = apiKey;
    }
    headers() {
        return {
            'content-type': 'application/json',
            ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
            ...(this.config.extraHeaders ?? {}),
        };
    }
    async chat(args, handlers) {
        return (0, sdk_1.sdkChat)(this.config, this.apiKey, args, handlers);
    }
    async listModels() {
        const res = await (0, transport_1.providerFetch)(this.config, `${this.config.baseUrl}/models`, { headers: this.headers() });
        if (!res.ok)
            throw new types_1.ProviderError(await (0, sse_1.readErrorMessage)(res), res.status);
        const payload = (await res.json());
        const ids = (payload.data ?? payload.models ?? []).map((item) => item.id ?? item.name).filter(Boolean);
        return ids.sort();
    }
    async test() {
        const startedAt = Date.now();
        try {
            const res = await (0, transport_1.providerFetch)(this.config, `${this.config.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: this.headers(),
                body: JSON.stringify({
                    model: this.config.defaultModel,
                    messages: [{ role: 'user', content: 'ping' }],
                    max_tokens: 8,
                    stream: false,
                }),
            });
            const latencyMs = Date.now() - startedAt;
            if (!res.ok)
                return { ok: false, message: await (0, sse_1.readErrorMessage)(res), latencyMs };
            return { ok: true, message: '连接正常', latencyMs };
        }
        catch (error) {
            return { ok: false, message: error.message, latencyMs: Date.now() - startedAt };
        }
    }
}
exports.OpenAICompatibleProvider = OpenAICompatibleProvider;
