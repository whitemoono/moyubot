"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InstaBoxClient = exports.InstaBoxError = void 0;
const util_1 = require("./util");
class InstaBoxError extends Error {
    status;
    code;
    retryable;
    hint;
    requestId;
    retryAfterSeconds;
    constructor(input) {
        super(input.message);
        this.name = 'InstaBoxError';
        this.status = input.status;
        this.code = input.code;
        this.retryable = input.retryable ?? false;
        this.hint = input.hint;
        this.requestId = input.requestId;
        this.retryAfterSeconds = input.retryAfterSeconds;
    }
}
exports.InstaBoxError = InstaBoxError;
const IDEMPOTENT_ACTIONS = new Set(['create', 'start', 'stop', 'suspend', 'resume', 'wake', 'delete']);
class InstaBoxClient {
    baseUrl;
    apiKey;
    constructor(options) {
        this.apiKey = options.apiKey;
        this.baseUrl = (0, util_1.normalizeBaseUrl)(options.baseUrl || 'https://api.instabox.sh');
    }
    hasKey() {
        return this.apiKey.trim().length > 0;
    }
    headers(extra = {}) {
        return {
            'content-type': 'application/json',
            'x-api-key': this.apiKey,
            'user-agent': 'MoyuBot/0.1',
            ...extra,
        };
    }
    async request(method, path, options = {}) {
        const query = new URLSearchParams();
        for (const [key, value] of Object.entries(options.query ?? {})) {
            if (value !== undefined && value !== null && value !== '')
                query.set(key, String(value));
        }
        const qs = query.toString();
        const url = `${this.baseUrl}${path}${qs ? `?${qs}` : ''}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 45_000);
        try {
            const res = await fetch(url, {
                method,
                headers: this.headers(options.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {}),
                body: options.body === undefined ? undefined : JSON.stringify(options.body),
                signal: controller.signal,
            });
            const text = await res.text();
            if (!res.ok) {
                let payload = {};
                try {
                    payload = JSON.parse(text);
                }
                catch {
                    /* non-JSON error body */
                }
                const error = payload?.error ?? {};
                throw new InstaBoxError({
                    status: res.status,
                    code: error.code || `http_${res.status}`,
                    message: error.message || text.slice(0, 400) || res.statusText,
                    retryable: Boolean(error.retryable),
                    hint: error.hint,
                    requestId: error.requestId,
                    retryAfterSeconds: error.retryAfterSeconds,
                });
            }
            return (text ? JSON.parse(text) : {});
        }
        catch (error) {
            if (error instanceof InstaBoxError)
                throw error;
            const message = error instanceof Error && error.name === 'AbortError'
                ? `请求 InstaBox 超时（${Math.round((options.timeoutMs ?? 45000) / 1000)}s）`
                : `无法连接 InstaBox：${error.message}`;
            throw new InstaBoxError({ status: 0, code: 'network_error', message, retryable: true });
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async listMachines() {
        const payload = await this.request('GET', '/v1/machines');
        const list = payload.machines ?? payload.data ?? [];
        return list.map(normalizeMachine);
    }
    desktopStart(id) {
        return this.request('POST', `/v1/machines/${encodeURIComponent(id)}/desktop`, {
            body: { action: 'start', width: 1280, height: 800 }, timeoutMs: 90_000,
        });
    }
    desktopStream(id, viewOnly) {
        return this.request('POST', `/v1/machines/${encodeURIComponent(id)}/desktop/stream`, {
            body: { viewOnly, ttlSeconds: 600 },
        });
    }
    async desktopRevoke(id) {
        await this.request('DELETE', `/v1/machines/${encodeURIComponent(id)}/desktop/stream`);
    }
    async getMachine(id) {
        const payload = await this.request('GET', `/v1/machines/${encodeURIComponent(id)}`);
        return normalizeMachine(payload.machine ?? payload);
    }
    async updateMachine(id, patch) {
        const payload = await this.request('PATCH', `/v1/machines/${encodeURIComponent(id)}`, { body: patch });
        return normalizeMachine(payload.machine ?? payload);
    }
    async createMachine(body) {
        const payload = await this.request('POST', '/v1/machines', {
            body,
            idempotencyKey: (0, util_1.newId)('idem'),
        });
        return {
            machine: payload.machine ? normalizeMachine(payload.machine) : undefined,
            operationId: payload.operation?.id ?? payload.operationId,
        };
    }
    /** start | stop | suspend | resume | wake */
    async act(id, action) {
        const body = action === 'stop' ? { timeoutSeconds: 20 } : undefined;
        const payload = await this.request('POST', `/v1/machines/${encodeURIComponent(id)}/${action}`, {
            body,
            idempotencyKey: IDEMPOTENT_ACTIONS.has(action) ? (0, util_1.newId)('idem') : undefined,
        });
        if (action === 'wake' && payload?.state) {
            // /wake answers with the machine, not an operation.
            return { id: '', state: 'succeeded', machineId: payload.id, phase: `machine:${payload.state}` };
        }
        return normalizeOperation(payload.operation ?? payload);
    }
    async getMachineState(id) {
        return (await this.getMachine(id)).state;
    }
    async getOperation(id, waitSeconds) {
        const payload = await this.request('GET', `/v1/operations/${encodeURIComponent(id)}`, {
            query: { wait: waitSeconds ? `${Math.min(waitSeconds, 30)}s` : undefined },
            timeoutMs: Math.min(waitSeconds ?? 0, 30) * 1000 + 30_000,
        });
        return normalizeOperation(payload.operation ?? payload);
    }
    async waitOperation(id, options = {}) {
        const deadline = Date.now() + (options.timeoutMs ?? 180_000);
        let delay = 400;
        for (;;) {
            const op = await this.getOperation(id, 20);
            if (op.phase && options.onPhase && op.phase !== 'done')
                options.onPhase(op.phase);
            if (op.state === 'failed') {
                throw new InstaBoxError({ status: 0, code: op.error?.code ?? 'operation_failed', message: op.error?.message ?? `云电脑操作 ${id} 失败` });
            }
            if (op.state === 'succeeded')
                return op;
            if (Date.now() > deadline) {
                throw new InstaBoxError({
                    status: 0,
                    code: 'operation_timeout',
                    message: `操作 ${id} 在 ${Math.round((options.timeoutMs ?? 180000) / 1000)}s 内未完成`,
                    retryable: true,
                });
            }
            await (0, util_1.sleep)(delay);
            delay = Math.min(delay * 1.6, 3000);
        }
    }
    async waitForState(id, accept, options = {}) {
        const deadline = Date.now() + (options.timeoutMs ?? 180_000);
        let delay = 500;
        for (;;) {
            const machine = await this.getMachine(id);
            options.onState?.(machine);
            if (accept.includes(machine.state))
                return machine;
            if (Date.now() > deadline) {
                throw new InstaBoxError({
                    status: 0,
                    code: 'state_timeout',
                    message: `云主机长时间停留在 ${machine.state} 状态`,
                    retryable: true,
                });
            }
            await (0, util_1.sleep)(delay);
            delay = Math.min(delay * 1.5, 2500);
        }
    }
    async exec(id, request, handlers = {}) {
        const body = { cmd: request.cmd, argv: request.argv, cwd: request.cwd, timeoutSeconds: request.timeoutSeconds, envs: request.envs };
        const stream = Boolean(handlers.onStdout || handlers.onStderr);
        const url = `${this.baseUrl}/v1/machines/${encodeURIComponent(id)}/exec`;
        const controller = new AbortController();
        const onAbort = () => controller.abort();
        handlers.signal?.addEventListener('abort', onAbort);
        const timeout = setTimeout(() => controller.abort(), ((request.timeoutSeconds ?? 120) + 25) * 1000);
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: this.headers(stream ? { accept: 'text/event-stream' } : {}),
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            if (!res.ok) {
                const text = await res.text();
                let payload = {};
                try {
                    payload = JSON.parse(text);
                }
                catch {
                    /* ignore */
                }
                throw new InstaBoxError({
                    status: res.status,
                    code: payload?.error?.code ?? `http_${res.status}`,
                    message: payload?.error?.message ?? text.slice(0, 300),
                    retryable: Boolean(payload?.error?.retryable),
                });
            }
            if (!stream) {
                const payload = (await res.json());
                const result = payload.result ?? payload;
                return {
                    stdout: result.stdout ?? '',
                    stderr: result.stderr ?? '',
                    exitCode: result.exitCode ?? 0,
                    timedOut: Boolean(result.timedOut),
                    truncated: Boolean(result.truncated),
                };
            }
            return await readExecStream(res, handlers);
        }
        finally {
            clearTimeout(timeout);
            handlers.signal?.removeEventListener('abort', onAbort);
        }
    }
    async writeFile(id, filePath, content, mode) {
        const query = new URLSearchParams({ path: filePath, parents: 'true' });
        if (mode)
            query.set('mode', mode);
        const res = await fetch(`${this.baseUrl}/v1/machines/${encodeURIComponent(id)}/files?${query.toString()}`, {
            method: 'PUT',
            headers: { 'x-api-key': this.apiKey, 'content-type': 'application/octet-stream' },
            body: (typeof content === 'string' ? content : new Blob([content])),
        });
        if (!res.ok) {
            const text = await res.text();
            throw new InstaBoxError({
                status: res.status,
                code: 'file_write_failed',
                message: text.slice(0, 300) || `写入失败 ${res.status}`,
            });
        }
    }
    async readFile(id, filePath) {
        const res = await fetch(`${this.baseUrl}/v1/machines/${encodeURIComponent(id)}/files/content?path=${encodeURIComponent(filePath)}`, { headers: { 'x-api-key': this.apiKey } });
        if (!res.ok) {
            const text = await res.text();
            throw new InstaBoxError({
                status: res.status,
                code: 'file_read_failed',
                message: text.slice(0, 300) || `读取失败 ${res.status}`,
            });
        }
        return new Uint8Array(await res.arrayBuffer());
    }
    async readText(id, filePath) {
        return new TextDecoder().decode(await this.readFile(id, filePath));
    }
}
exports.InstaBoxClient = InstaBoxClient;
function normalizeMachine(raw) {
    return {
        id: String(raw.id ?? raw.machineId ?? ''),
        name: String(raw.name ?? ''),
        state: (raw.state ?? 'error'),
        autoSuspendAfterSeconds: raw.autoSuspendAfterSeconds ?? null,
        maxRunMinutes: raw.maxRunMinutes ?? null,
        updatedAt: raw.updatedAt,
        createdAt: raw.createdAt,
        spec: raw.spec,
        template: raw.template,
    };
}
function normalizeOperation(raw) {
    return {
        id: String(raw.id ?? ''),
        state: (raw.state ?? 'failed'),
        phase: raw.phase,
        machineId: raw.machineId,
        error: raw.error,
    };
}
async function readExecStream(res, handlers) {
    if (!res.body)
        throw new InstaBoxError({ status: 0, code: 'no_body', message: 'exec 流式响应为空' });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let stdout = '';
    let stderr = '';
    let result = { stdout: '', stderr: '', exitCode: 0, timedOut: false, truncated: false };
    let eventName = 'message';
    const handle = (name, data) => {
        if (data === '[DONE]')
            return;
        let payload;
        try {
            payload = JSON.parse(data);
        }
        catch {
            return;
        }
        const kind = payload.type ?? name;
        if (kind === 'stdout' || kind === 'stderr') {
            const chunk = String(payload.data ?? '');
            if (kind === 'stdout') {
                stdout += chunk;
                handlers.onStdout?.(chunk);
            }
            else {
                stderr += chunk;
                handlers.onStderr?.(chunk);
            }
            return;
        }
        if (kind === 'exit' || kind === 'error' || kind === 'result') {
            const body = payload.result ?? payload;
            result = {
                stdout: body.stdout ?? stdout,
                stderr: body.stderr ?? stderr,
                exitCode: typeof body.exitCode === 'number' ? body.exitCode : kind === 'error' ? 1 : 0,
                timedOut: Boolean(body.timedOut),
                truncated: Boolean(body.truncated),
            };
        }
    };
    for (;;) {
        const { value, done } = await reader.read();
        if (done)
            break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        for (const line of lines) {
            if (line.startsWith('event:'))
                eventName = line.slice(6).trim();
            else if (line.startsWith('data:'))
                handle(eventName, line.slice(5).trim());
            else if (line.trim() === '')
                eventName = 'message';
        }
    }
    if (buffer.startsWith('data:'))
        handle(eventName, buffer.slice(5).trim());
    return {
        ...result,
        stdout: result.stdout || stdout,
        stderr: result.stderr || stderr,
    };
}
