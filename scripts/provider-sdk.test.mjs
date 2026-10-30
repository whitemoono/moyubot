import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { createChatProvider, Store } from '../packages/core/dist/index.js';
import { messagesFor } from '../packages/core/dist/context.js';
import { setProviderFetch } from '../packages/core/dist/providers/transport.js';

const args = { model: 'test-model', system: '中文助手', messages: [{ role: 'user', content: '执行' }],
  tools: [{ name: 'inspect', description: 'Inspect', parameters: { type: 'object', properties: { path: { type: 'string' } } } }], temperature: 0, maxTokens: 8192 };
const openai = (delta, finish_reason) => ({ choices: [{ delta, finish_reason }] });
function anthropic(blocks, stop = 'tool_use') {
  return [{ type: 'message_start', message: { id: 'msg-sdk', model: 'test-model', usage: { input_tokens: 20, output_tokens: 0 } } },
    ...blocks.flatMap((block, index) => [{ type: 'content_block_start', index, content_block: block.start },
      ...(block.deltas ?? []).map(delta => ({ type: 'content_block_delta', index, delta })), { type: 'content_block_stop', index }]),
    { type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 15 } }, { type: 'message_stop' }];
}
async function fixture(kind, events) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    requests.push(JSON.parse(raw));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const event of events) res.write(`${kind === 'anthropic' ? `event: ${event.type}\n` : ''}data: ${JSON.stringify(event)}\n\n`);
    res.end();
  });
  await new Promise(resolve => server.listen(0, 'localhost', resolve));
  const config = { id: `fixture-${kind}`, name: kind, kind, baseUrl: `http://localhost:${server.address().port}/v1`, defaultModel: args.model, models: [], createdAt: 0 };
  const provider = createChatProvider(config, 'fixture-only');
  async function chat(overrides = {}) {
    const calls = []; let text = '', reasoning = '';
    const outcome = await provider.chat({ ...args, ...overrides }, { onText: chunk => { text += chunk; }, onReasoning: chunk => { reasoning += chunk; }, onToolCall: call => calls.push(call) });
    return { outcome, calls, text, reasoning };
  }
  return { config, provider, requests, chat, close: () => new Promise(resolve => server.close(resolve)) };
}

test('Anthropic signed and redacted blocks retain order across persistence and model changes strip signatures', async () => {
  const events = anthropic([
    { start: { type: 'thinking', thinking: '' }, deltas: [{ type: 'thinking_delta', thinking: '检查页面' }, { type: 'signature_delta', signature: 'signed-' }, { type: 'signature_delta', signature: 'block' }] },
    { start: { type: 'redacted_thinking', data: 'opaque-redacted' } },
    { start: { type: 'text', text: '' }, deltas: [{ type: 'text_delta', text: '开始检查' }] },
    { start: { type: 'tool_use', id: 'inspect-1', name: 'inspect', input: {} }, deltas: [{ type: 'input_json_delta', partial_json: '{"path":"index.html"}' }] },
  ]);
  const f = await fixture('anthropic', events);
  try {
    const first = await f.chat();
    assert.equal(first.text, '开始检查'); assert.equal(first.reasoning, '检查页面'); assert.equal(first.calls.length, 1);
    const turn = { content: first.text, reasoning: first.reasoning, toolCalls: first.calls, replay: first.outcome.replay };
    const dir = path.resolve('.work/provider-sdk-tests', String(Date.now()));
    const store = new Store(dir), conversation = store.botConversation(store.settings.bots[0].id);
    store.appendMessage(conversation.id, { id: 'persisted-sdk', role: 'assistant', createdAt: 1, content: first.text, toolCalls: first.calls,
      modelTurns: [turn], toolResults: [{ id: 'inspect-1', name: 'inspect', ok: true, summary: '检查完成' }] });
    const restored = new Store(dir).getConversation(conversation.id);
    const messages = [...args.messages, ...messagesFor(restored.messages)];
    await f.chat({ messages });
    const blocks = f.requests[1].messages.find(message => message.role === 'assistant').content;
    assert.deepEqual(blocks.map(block => block.type), ['thinking', 'redacted_thinking', 'text', 'tool_use']);
    assert.equal(blocks[0].signature, 'signed-block'); assert.equal(blocks[1].data, 'opaque-redacted');
    assert.equal(blocks[3].input.path, 'index.html');
    await f.chat({ model: 'other-model', messages });
    assert.doesNotMatch(JSON.stringify(f.requests[2]), /signed-block|opaque-redacted/);
    const interrupted = structuredClone(restored.messages); interrupted[0].toolResults = [];
    await f.chat({ messages: [...args.messages, ...messagesFor(interrupted)] });
    assert.doesNotMatch(JSON.stringify(f.requests[3]), /tool_use/);
  } finally { await f.close(); }
});

test('Gemini separates thoughts and replays text/tool signatures including an empty signature delta', async () => {
  const f = await fixture('gemini', [
    { candidates: [{ content: { parts: [{ text: '先检查', thought: true, thoughtSignature: 'cmVhc29uaW5nLXNpZw==' }] } }] },
    { candidates: [{ content: { parts: [{ text: '检查中' }] } }] },
    { candidates: [{ content: { parts: [{ text: '', thoughtSignature: 'dGV4dC1zaWc=' }] } }] },
    { candidates: [{ content: { parts: [{ functionCall: { id: 'google-call', name: 'inspect', args: { path: 'index.html' } }, thoughtSignature: 'dG9vbC1zaWc=' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 3, thoughtsTokenCount: 7 } },
  ]);
  try {
    const first = await f.chat();
    assert.equal(first.text, '检查中'); assert.equal(first.reasoning, '先检查'); assert.equal(first.outcome.usage.completionTokens, 10);
    const assistant = { role: 'assistant', content: first.text, reasoning: first.reasoning, toolCalls: first.calls, replay: JSON.parse(JSON.stringify(first.outcome.replay)) };
    const messages = [...args.messages, assistant, { role: 'tool', toolCallId: first.calls[0].id, name: 'inspect', content: 'ok' }];
    await f.chat({ messages });
    const parts = f.requests[1].contents.find(item => item.role === 'model').parts;
    assert.equal(parts.find(part => part.thought)?.thoughtSignature, 'cmVhc29uaW5nLXNpZw==');
    assert.equal(parts.find(part => part.text === '检查中')?.thoughtSignature, 'dGV4dC1zaWc=');
    assert.equal(parts.find(part => part.functionCall)?.thoughtSignature, 'dG9vbC1zaWc=');
    await f.chat({ model: 'another-model', messages });
    assert.doesNotMatch(JSON.stringify(f.requests[2]), /cmVhc29uaW5nLXNpZw==|dGV4dC1zaWc=|dG9vbC1zaWc=/);
  } finally { await f.close(); }
});

test('valid-looking calls on length exhaustion and malformed final arguments never execute', async () => {
  for (const [input, finish] of [['{"path":"index.html"}', 'length'], ['{"path":', 'tool_calls'], ['[]', 'tool_calls']]) {
    const f = await fixture('openai', [openai({ tool_calls: [{ index: 0, id: 'bad-call', function: { name: 'inspect', arguments: input } }] }, finish)]);
    let calls = 0;
    try {
      await assert.rejects(f.provider.chat(args, { onText() {}, onToolCall() { calls++; } }), finish === 'length' ? /输出额度/ : /工具参数/);
      assert.equal(calls, 0);
    } finally { await f.close(); }
  }
});

test('EOF without a finish reason rejects buffered calls and retains reported usage', async () => {
  const f = await fixture('openai', [openai({ tool_calls: [{ index: 0, id: 'eof-call', function: { name: 'inspect', arguments: '{}' } }] }),
    { choices: [], usage: { prompt_tokens: 20, completion_tokens: 15 } }]);
  let calls = 0, usage;
  try {
    await assert.rejects(f.provider.chat(args, { onText() {}, onToolCall() { calls++; }, onUsage(value) { usage = value; } }), /finish reason|正常结束/);
    assert.equal(calls, 0); assert.equal(usage.completionTokens, 15);
  } finally { await f.close(); }
});

test('native protocols never execute complete calls when output ends at the limit or the stream is cut off', async () => {
  for (const kind of ['anthropic', 'gemini']) {
    for (const stop of [true, false]) {
      const events = kind === 'anthropic' ? anthropic([
        { start: { type: 'tool_use', id: 'limit-tool', name: 'inspect', input: {} }, deltas: [{ type: 'input_json_delta', partial_json: '{}' }] },
      ], 'max_tokens') : [{ candidates: [{ content: { parts: [{ functionCall: { id: 'limit-tool', name: 'inspect', args: {} } }] },
        ...(stop ? { finishReason: 'MAX_TOKENS' } : {}) }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 } }];
      if (kind === 'anthropic' && !stop) events.splice(-2);
      const f = await fixture(kind, events); let calls = 0;
      try {
        await assert.rejects(f.provider.chat(args, { onText() {}, onToolCall() { calls++; } }), stop ? /输出额度/ : /正常结束/);
        assert.equal(calls, 0);
      } finally { await f.close(); }
    }
  }
});

test('SDK adapters use the selected network transport and propagate cancellation', async () => {
  const direct = globalThis.fetch; let systemCalls = 0, directCalls = 0;
  setProviderFetch((input, init) => { systemCalls++; return direct(input, init); }, (input, init) => { directCalls++; return direct(input, init); });
  try {
    for (const kind of ['openai', 'anthropic', 'gemini']) {
      const events = kind === 'openai' ? [openai({ content: 'ok' }, 'stop')] : kind === 'anthropic'
        ? anthropic([{ start: { type: 'text', text: '' }, deltas: [{ type: 'text_delta', text: 'ok' }] }], 'end_turn')
        : [{ candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] }];
      const f = await fixture(kind, events);
      try {
        f.config.networkMode = 'system'; await f.chat();
        f.config.networkMode = 'direct'; await f.chat();
        const controller = new AbortController(); let calls = 0;
        await assert.rejects(f.provider.chat({ ...args, signal: controller.signal }, { onText() { controller.abort(); }, onToolCall() { calls++; } }));
        assert.equal(calls, 0);
      } finally { await f.close(); }
    }
    assert.equal(systemCalls, 3); assert.equal(directCalls, 6);
  } finally { setProviderFetch(direct, direct); }
});
