"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OutputLimitError = exports.ProviderError = void 0;
exports.splitDataUrl = splitDataUrl;
exports.parseToolArguments = parseToolArguments;
exports.combineSignals = combineSignals;
class ProviderError extends Error {
    status;
    code;
    constructor(message, status, code = 'provider_error') {
        super(message);
        this.name = 'ProviderError';
        this.status = status;
        this.code = code;
    }
}
exports.ProviderError = ProviderError;
/** A truncated response has no executable calls; raw arguments are diagnostic data only. */
class OutputLimitError extends ProviderError {
    partial;
    constructor(partial) {
        super('模型单次输出额度已耗尽，自动恢复未能完成任务；已执行的工具结果已保留。', 502, 'output_limit');
        this.partial = partial;
        this.name = 'OutputLimitError';
    }
}
exports.OutputLimitError = OutputLimitError;
function splitDataUrl(dataUrl) {
    const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
    if (!match)
        return null;
    return { mimeType: match[1] ?? 'image/png', base64: match[2] ?? '' };
}
function parseToolArguments(raw) {
    if (!raw.trim())
        return {};
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    }
    catch {
        return { __raw: raw };
    }
}
function combineSignals(a, b) {
    if (!a)
        return b;
    if (!b)
        return a;
    const controller = new AbortController();
    const abort = () => controller.abort();
    a.addEventListener('abort', abort);
    b.addEventListener('abort', abort);
    return controller.signal;
}
