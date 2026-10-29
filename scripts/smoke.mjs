/**
 * End-to-end smoke test against the real core pipeline, with a fake OpenAI-compatible
 * provider and the offline cloud driver. No API key or network required.
 *
 *   node scripts/smoke.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const core = await import('../packages/core/dist/index.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, '.work', 'smoke-data');
fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(dataDir, { recursive: true });

let call = 0;
let imageCalls = 0;
const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII=', 'base64');

const server = http.createServer(async (req, res) => {
  if (req.url === '/v1/models') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'moyu-demo' }] }));
    return;
  }
  if (req.url === '/v1/images/generations') {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    imageCalls += 1;
    if (!body.prompt || body.size !== '1536x1024') {
      res.writeHead(400).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ b64_json: imageBytes.toString('base64') }] }));
    return;
  }
  if (req.url !== '/v1/chat/completions') {
    res.writeHead(404).end();
    return;
  }
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  call += 1;
  const hasToolResult = (body.messages ?? []).some((message) => message.role === 'tool');

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

  if (!hasToolResult && call <= 1) {
    send({ choices: [{ index: 0, delta: { content: '好，我通过图像 API 生成海报。\n' } }] });
    send({
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_draw_1',
                type: 'function',
                function: {
                  name: 'generate_image',
                  arguments: JSON.stringify({
                    prompt: 'iOS 液态玻璃风格海报：一台悬浮的云电脑，玻璃质感，折射光，深蓝紫渐变',
                    aspect: '16:9',
                  }),
                },
              },
            ],
          },
        },
      ],
    });
    send({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  const toolMessage = (body.messages ?? []).find((message) => message.role === 'tool');
  const summary = toolMessage ? String(toolMessage.content).slice(0, 120) : '（无工具结果）';
  for (const piece of ['图片已经生成。', '\n\n', '绘图结果：', summary]) {
    send({ choices: [{ index: 0, delta: { content: piece } }] });
  }
  send({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
  send({ usage: { prompt_tokens: 128, completion_tokens: 46 } });
  res.write('data: [DONE]\n\n');
  res.end();
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

const port = server.address().port;

const store = new core.Store(dataDir);
store.updateSettings({
  cloud: { ...store.getSettings().cloud, driver: 'mock', workspaceDir: path.join(dataDir, 'workspace') },
});
const provider = store.getSettings().providers[0];
store.updateSettings({
  providers: [{ ...provider, baseUrl: `http://127.0.0.1:${port}/v1`, defaultModel: 'moyu-demo' }],
  bots: store.getSettings().bots.map((bot) => ({
    ...bot,
    model: 'moyu-demo',
    approvalPolicy: 'never',
    image: { aspect: '1:1' },
  })),
});
store.secrets.set(store.providerSecretKey(provider.id), 'demo-key');
store.addMemory(store.getSettings().bots[0].id, '用户偏好 16:9 的宽幅海报', true);

const events = [];
const cloud = new core.CloudHost({
  settings: store.getSettings().cloud,
  apiKey: 'mock',
  onStatus: (status) => events.push(`cloud:${status.state}`),
  onLog: (level, text) => events.push(`log:${level}:${text}`),
});

const runtime = new core.AgentRuntime({
  store,
  cloud,
  emit: (event) => events.push(event.type),
  requestApproval: async () => true,
});

console.log('→ 发送 API 绘图任务');
const { conversationId } = await runtime.send({
  botId: store.getSettings().bots[0].id,
  text: '画一张 16:9 的液态玻璃风海报，主题是多人共用的云电脑。',
});

const deadline = Date.now() + 60_000;
while (runtime.isRunning(conversationId) && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 300));
}

const conversation = store.getConversation(conversationId);
const assistant = conversation?.messages.find((message) => message.role === 'assistant');
const failures = [];

if (!assistant) failures.push('没有生成 assistant 消息');
if (!assistant?.toolCalls?.length) failures.push('没有触发 generate_image 工具');
if (!assistant?.toolResults?.[0]?.ok) failures.push('工具执行失败');
if (!assistant?.content?.includes('图片已经生成')) failures.push('模型二次回复缺失');
const artifact = assistant?.attachments?.[0]?.path;
if (!artifact) failures.push('没有图片附件');
else {
  const output = path.join(dataDir, 'workspace', artifact);
  if (!fs.existsSync(output)) failures.push(`图片文件不存在: ${artifact}`);
  else if (!fs.readFileSync(output).equals(imageBytes)) failures.push('落盘图片与 API 返回内容不一致');
}
if (imageCalls !== 1) failures.push(`图像 API 调用次数异常: ${imageCalls}`);
if (cloud.status().wakeCount !== 0 || events.includes('cloud:waking')) failures.push('API 绘图不应唤醒云电脑');

console.log('\n结果');
console.log('  会话:', conversationId);
console.log('  消息数:', conversation?.messages.length);
console.log('  工具:', assistant?.toolCalls?.map((item) => item.name).join(', ') || '无');
console.log('  工具结果:', assistant?.toolResults?.map((item) => `${item.name}:${item.ok}`).join(', ') || '无');
console.log('  附件:', artifact ?? '无');
console.log('  云唤醒次数:', cloud.status().wakeCount);
console.log('  事件:', [...new Set(events)].join(' '));

cloud.dispose();
server.close();

if (failures.length) {
  console.error('\n✗ 失败:', failures.join('；'));
  process.exit(1);
}
console.log('\n✓ 通过：工具调用 → 图像 API → 图片落盘 → 二次回复，全程无需唤醒云电脑');
