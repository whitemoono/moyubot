"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeminiProvider = void 0;
exports.toolArgsFromRaw = toolArgsFromRaw;
const sdk_1 = require("./sdk");
const transport_1 = require("./transport");
const types_1 = require("./types");
const sse_1 = require("./sse");
class GeminiProvider {
    config;
    apiKey;
    kind = 'gemini';
    constructor(config, apiKey) {
        this.config = config;
        this.apiKey = apiKey;
    }
    headers() {
        return {
            'content-type': 'application/json',
            'x-goog-api-key': this.apiKey,
            ...(this.config.extraHeaders ?? {}),
        };
    }
    baseUrl() {
        // Accept both https://generativelanguage.googleapis.com/v1beta and .../v1
        return this.config.baseUrl.replace(/\/+$/, '');
    }
    async chat(args, handlers) {
        return (0, sdk_1.sdkChat)(this.config, this.apiKey, args, handlers);
    }
    async listModels() {
        const res = await (0, transport_1.providerFetch)(this.config, `${this.baseUrl()}/models?pageSize=200`, { headers: this.headers() });
        if (!res.ok)
            throw new types_1.ProviderError(await (0, sse_1.readErrorMessage)(res), res.status);
        const payload = (await res.json());
        return (payload.models ?? [])
            .filter((model) => !model.supportedGenerationMethods || model.supportedGenerationMethods.includes('generateContent'))
            .map((model) => model.name.replace(/^models\//, ''));
    }
    async test() {
        const startedAt = Date.now();
        try {
            const res = await (0, transport_1.providerFetch)(this.config, `${this.baseUrl()}/models/${encodeURIComponent(this.config.defaultModel)}`, {
                headers: this.headers(),
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
exports.GeminiProvider = GeminiProvider;
function toolArgsFromRaw(raw) {
    return (0, types_1.parseToolArguments)(typeof raw === 'string' ? raw : JSON.stringify(raw ?? {}));
}
