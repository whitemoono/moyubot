"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.iterSse = iterSse;
exports.readErrorMessage = readErrorMessage;
exports.iterNdjson = iterNdjson;
/** Iterate a fetch Response body as server-sent events. */
async function* iterSse(response) {
    if (!response.body)
        return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let event = 'message';
    let dataLines = [];
    const flush = () => {
        if (dataLines.length === 0 && event === 'message')
            return null;
        const payload = { event, data: dataLines.join('\n') };
        event = 'message';
        dataLines = [];
        return payload;
    };
    for (;;) {
        const { value, done } = await reader.read();
        if (done)
            break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        for (const line of lines) {
            if (!line) {
                const payload = flush();
                if (payload)
                    yield payload;
                continue;
            }
            if (line.startsWith(':'))
                continue;
            if (line.startsWith('event:'))
                event = line.slice(6).trim();
            else if (line.startsWith('data:'))
                dataLines.push(line.slice(5).trimStart());
        }
    }
    if (buffer.startsWith('data:'))
        dataLines.push(buffer.slice(5).trimStart());
    const tail = flush();
    if (tail)
        yield tail;
}
async function readErrorMessage(res) {
    let text = '';
    try {
        text = await res.text();
    }
    catch {
        return `HTTP ${res.status}`;
    }
    try {
        const payload = JSON.parse(text);
        const message = payload?.error?.message ??
            payload?.message ??
            payload?.error?.status ??
            (Array.isArray(payload) ? payload[0]?.error?.message : undefined);
        if (message)
            return String(message);
    }
    catch {
        /* plain text */
    }
    return text.slice(0, 400) || `HTTP ${res.status}`;
}
async function* iterNdjson(response) {
    if (!response.body)
        return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
        const { value, done } = await reader.read();
        if (done)
            break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        for (const line of lines)
            if (line.trim())
                yield line;
    }
    if (buffer.trim())
        yield buffer;
}
