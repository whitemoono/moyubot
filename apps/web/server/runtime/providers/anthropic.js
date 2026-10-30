"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnthropicProvider = void 0;
const sdk_1 = require("./sdk");
const transport_1 = require("./transport");
const types_1 = require("./types");
const sse_1 = require("./sse");
class AnthropicProvider {
    config;
    apiKey;
    kind = 'anthropic';
    constructor(config, apiKey) {
        this.config = config;
        this.apiKey = apiKey;
    }
    headers() {
        return {
            'content-type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
            ...(this.config.extraHeaders ?? {}),
        };
    }
    async chat(args, handlers) {
        return (0, sdk_1.sdkChat)(this.config, this.apiKey, args, handlers);
    }
    async listModels() {
        const base = this.config.baseUrl.replace(/\/v1$/, '');
        const res = await (0, transport_1.providerFetch)(this.config, `${base}/v1/models`, { headers: this.headers() });
        if (!res.ok)
            throw new types_1.ProviderError(await (0, sse_1.readErrorMessage)(res), res.status);
        const payload = (await res.json());
        return (payload.data ?? []).map((item) => item.id);
    }
    async test() {
        const startedAt = Date.now();
        try {
            const base = this.config.baseUrl.replace(/\/v1$/, '');
            const res = await (0, transport_1.providerFetch)(this.config, `${base}/v1/messages`, {
                method: 'POST',
                headers: this.headers(),
                body: JSON.stringify({
                    model: this.config.defaultModel,
                    max_tokens: 8,
                    messages: [{ role: 'user', content: 'ping' }],
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
exports.AnthropicProvider = AnthropicProvider;
