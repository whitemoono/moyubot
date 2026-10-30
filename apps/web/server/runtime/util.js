"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeRemoteDirectory = normalizeRemoteDirectory;
exports.newId = newId;
exports.sleep = sleep;
exports.clamp = clamp;
exports.truncate = truncate;
exports.safeJsonParse = safeJsonParse;
exports.shellQuote = shellQuote;
exports.formatDuration = formatDuration;
exports.summarize = summarize;
exports.nowIso = nowIso;
exports.normalizeBaseUrl = normalizeBaseUrl;
const node_crypto_1 = require("node:crypto");
const node_path_1 = __importDefault(require("node:path"));
function normalizeRemoteDirectory(value) {
    if (typeof value !== 'string' || !value.trim().startsWith('/') || /[\\\x00\r\n]/.test(value))
        throw new Error('云电脑工作路径需要是 Linux 绝对路径，例如 /data/moyubot');
    return node_path_1.default.posix.normalize(value.trim()).replace(/\/$/, '') || '/';
}
function newId(prefix) {
    return `${prefix}_${Date.now().toString(36)}${(0, node_crypto_1.randomBytes)(4).toString('hex')}`;
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
function truncate(text, max) {
    if (text.length <= max)
        return text;
    return `${text.slice(0, max)}\n…（已截断 ${text.length - max} 字符）`;
}
function safeJsonParse(text, fallback) {
    try {
        return JSON.parse(text);
    }
    catch {
        return fallback;
    }
}
/** Quote a value for bash single-quote context. */
function shellQuote(value) {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}
function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0)
        return '—';
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0)
        return `${h}h ${m}m`;
    if (m > 0)
        return `${m}m ${s}s`;
    return `${s}s`;
}
function summarize(value, max = 160) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (!text)
        return '';
    const flat = text.replace(/\s+/g, ' ').trim();
    return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
function nowIso() {
    return new Date().toISOString();
}
function normalizeBaseUrl(url) {
    return url.trim().replace(/\/+$/, '');
}
