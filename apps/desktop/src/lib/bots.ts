import type { Bot, ProviderConfig } from '@moyu/core';

export const BOT_TOOLS = [
  { id: 'cloud_exec', label: '执行电脑命令', hint: '在所属工作区的电脑上执行命令' },
  { id: 'cloud_read', label: '读取电脑文件', hint: '读取所属工作区的文本文件' },
  { id: 'cloud_write', label: '写入电脑文件', hint: '把结果保存到所属工作区' },
  { id: 'generate_image', label: '绘图', hint: '使用图像 API 或已配置的云端绘图脚本' },
  { id: 'remember', label: '写长期记忆', hint: '记住偏好与重要事项' },
  { id: 'recall', label: '查长期记忆', hint: '关键词检索记忆' },
  { id: 'schedule_task', label: '定时任务', hint: '通过对话创建、查询、修改和启停任务' },
  { id: 'web_fetch', label: '网页抓取', hint: '只读 https 页面' },
];

export function deepSeekProvider(providers: ProviderConfig[]): ProviderConfig {
  const existing = providers.find((provider) => {
    try { return provider.kind === 'openai' && new URL(provider.baseUrl).hostname === 'api.deepseek.com'; }
    catch { return false; }
  });
  return existing ?? { id: `deepseek${providers.some((item) => item.id === 'deepseek') ? `-${crypto.randomUUID()}` : ''}`, name: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat', models: ['deepseek-chat', 'deepseek-reasoner'], createdAt: Date.now() };
}

export function newBot(provider: ProviderConfig | undefined, seed?: Bot): Bot {
  const now = Date.now();
  if (seed) return { ...seed, sidebar: undefined, avatar: { ...seed.avatar }, id: crypto.randomUUID(), name: `${seed.name} 副本`, handle: `${seed.handle}-copy`, createdAt: now, updatedAt: now };
  return {
    id: crypto.randomUUID(), name: '新 Bot', handle: 'bot',
    avatar: { shape: 'chibi', from: '#5890f0', to: '#5890f0', glyph: 'B' },
    providerId: provider?.id ?? '', model: provider?.defaultModel ?? '', temperature: .7,
    systemPrompt: `你是 {bot_name}，一个运行在 MoyuBot 里的通用智能体。
你有一台共享的云端 Linux 电脑，平时处于休眠状态，需要时会被自动唤醒。
- 涉及文件、命令、脚本、绘图的任务，用 cloud_* 工具在云电脑里完成；聊天闲聊不必唤醒云电脑。
- 需要生成图片时调用 generate_image，它会按配置走云主机或图像 API。
- 长任务先说明计划，再用工具一步步执行，每一步都给出可验证的结果。
- 不确定的信息要说明不确定，不要编造命令输出。`,
    approvalPolicy: 'never', tools: BOT_TOOLS.map((tool) => tool.id),
    image: { backend: 'api', aspect: '1:1', wakeHost: true, cloudCommand: 'mkdir -p "$(dirname {out})" && python3 /opt/moyubot/draw.py --prompt {prompt} --out {out}', cloudOutputPath: '/data/moyubot/out/{name}.png' },
    wakeOnTask: true, createdAt: now, updatedAt: now,
  };
}
