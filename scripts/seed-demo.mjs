/**
 * Seed a demo dataset (3 bots, providers, schedules, memories) for screenshots or a first look.
 * Uses the offline cloud driver, so nothing here touches the network.
 *
 *   node scripts/seed-demo.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const core = await import('../packages/core/dist/index.js');

const dataDir = process.env.MOYU_DATA_DIR ?? path.join(process.cwd(), '.work', 'demo-data');
const store = new core.Store(dataDir);
const now = Date.now();

const providers = [
  ...store.getSettings().providers,
  {
    id: 'anthropic-demo',
    name: 'Anthropic',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-5',
    models: ['claude-sonnet-4-5', 'claude-haiku-4-5'],
    createdAt: now,
  },
  {
    id: 'gemini-demo',
    name: 'Google Gemini',
    kind: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    createdAt: now,
  },
];

const [first] = store.getSettings().bots;
const bots = [
  first,
  {
    ...first,
    id: 'bot_nova',
    name: 'Nova',
    handle: 'nova',
    avatar: { from: '#5eead4', to: '#60a5fa', glyph: 'N' },
    providerId: 'anthropic-demo',
    model: 'claude-sonnet-4-5',
    systemPrompt: '你是 Nova，擅长长文写作与结构化整理。用 cloud_write 把结果落到云电脑，再读回来确认。',
    approvalPolicy: 'ask',
    image: { ...first.image, backend: 'cloud' },
    createdAt: now,
    updatedAt: now,
  },
  {
    ...first,
    id: 'bot_orbit',
    name: 'Orbit',
    handle: 'orbit',
    avatar: { from: '#fbbf24', to: '#fb7185', glyph: 'O' },
    providerId: 'gemini-demo',
    model: 'gemini-2.5-flash',
    systemPrompt: '你是 Orbit，负责抓网页、跑脚本、盯定时任务。工具优先，结论简短。',
    approvalPolicy: 'never',
    tools: ['cloud_exec', 'web_fetch', 'schedule_task', 'remember', 'recall'],
    image: { ...first.image, backend: 'api' },
    createdAt: now,
    updatedAt: now,
  },
];

store.updateSettings({
  providers,
  bots,
  cloud: { ...store.getSettings().cloud, driver: 'mock', idleSuspendMinutes: 3 },
  activeBotId: first.id,
});

store.addMemory(first.id, '用户偏好 16:9 的宽幅海报', true);
store.addMemory(first.id, '所有产出物放在 /data/moyubot 下');
store.addMemory('bot_nova', '周报模板：本周进展 / 阻塞 / 下周计划');

const schedules = [
  { botId: 'bot_orbit', cron: '0 9 * * 1-5', prompt: '检查云电脑 /data/moyubot 下最新的文件并用三句话汇报。' },
  { botId: first.id, cron: '0 */2 * * *', prompt: '抓取 InstaBox 状态页，如果 api.instabox.sh 不可用就记一条记忆。' },
];
for (const item of schedules) {
  store.upsertSchedule({
    id: `sched_${Math.random().toString(36).slice(2, 10)}`,
    botId: item.botId,
    cron: item.cron,
    prompt: item.prompt,
    enabled: true,
    nextRunAt: core.nextCronTime(item.cron)?.getTime(),
    lastStatus: 'ok',
    lastRunAt: Date.now() - 3 * 3600_000,
  });
}

// A scripted conversation so an empty install still shows what a finished run looks like.
if (!store.listConversations(first.id).length) {
  // The thumbnail has to exist on disk, otherwise the artifact grid shows a broken image.
  const workspace = store.getSettings().cloud.workspaceDir;
  const posterPath = path.join(workspace, 'images', 'poster-169.svg');
  fs.mkdirSync(path.dirname(posterPath), { recursive: true });
  fs.writeFileSync(
    posterPath,
    `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#101a3a"/><stop offset="0.55" stop-color="#1d1546"/><stop offset="1" stop-color="#0a1026"/>
    </linearGradient>
    <radialGradient id="orb" cx="0.35" cy="0.3" r="0.75">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.95"/>
      <stop offset="0.45" stop-color="#9db8ff" stop-opacity="0.85"/>
      <stop offset="1" stop-color="#5b6cff" stop-opacity="0.15"/>
    </radialGradient>
  </defs>
  <rect width="1600" height="900" fill="url(#bg)"/>
  <circle cx="1120" cy="330" r="250" fill="url(#orb)"/>
  <circle cx="1120" cy="330" r="252" fill="none" stroke="#ffffff" stroke-opacity="0.35" stroke-width="1.5"/>
  <text x="130" y="700" font-family="Segoe UI, sans-serif" font-size="88" font-weight="600" fill="#f3f6ff">一台云电脑</text>
  <text x="130" y="790" font-family="Segoe UI, sans-serif" font-size="44" fill="#9fb0d9">所有 Bot 共用 · 用时唤醒 · 闲时休眠</text>
</svg>`,
    'utf8',
  );

  const conversation = store.createConversation(first.id, '画一张 16:9 的液态玻璃风海报，主题是多人共用的云电脑。');
  const messageId = `msg_${Math.random().toString(36).slice(2, 12)}`;
  const call = {
    id: 'call_seed',
    name: 'generate_image',
    arguments: { prompt: '液态玻璃风海报：多人共用的云电脑，16:9', aspect: '16:9' },
  };
  store.appendMessage(conversation.id, {
    id: `msg_${Math.random().toString(36).slice(2, 12)}`,
    role: 'user',
    content: '画一张 16:9 的液态玻璃风海报，主题是多人共用的云电脑。',
    createdAt: now - 90_000,
  });
  store.appendMessage(conversation.id, {
    id: messageId,
    role: 'assistant',
    // 说明为什么唤醒、产物落在哪，避免把工具回显混进正文。
    content: '云主机已就绪，海报出好了：分层玻璃质感的球体，标题压在下三分之一。\n原图已落在 `/data/moyubot/out/poster-169.svg`，本地也存了一份，点开可以看大图。',
    createdAt: now - 60_000,
    model: first.model,
    toolCalls: [call],
    toolResults: [
      {
        id: call.id,
        name: call.name,
        ok: true,
        summary: '云主机出图 · 16:9 · 唤云 2.1s',
        detail: 'wake 2.1s → generate_image → /data/moyubot/images/poster-169.svg',
        durationMs: 8400,
      },
    ],
    attachments: [
      { id: 'att_seed', kind: 'image', name: 'poster-169.svg', mimeType: 'image/svg+xml', path: 'images/poster-169.svg' },
    ],
    usage: { promptTokens: 812, completionTokens: 96 },
  });
  store.saveConversation(conversation.id);
}

console.log(`✓ 已写入演示数据：${dataDir}`);
console.log(`  Bot: ${bots.map((bot) => bot.name).join(', ')}`);
console.log(`  会话: ${store.listConversations().length} 个`);

