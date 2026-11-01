import type { Bot, ProviderConfig } from '@moyu/core';

export const BOT_TOOLS = [
  { id: 'cloud_exec', label: '执行电脑命令', hint: '在所属工作区的电脑上执行命令' },
  { id: 'cloud_read', label: '读取电脑文件', hint: '读取所属工作区的文本文件' },
  { id: 'cloud_write', label: '写入电脑文件', hint: '把结果保存到所属工作区' },
  { id: 'generate_image', label: '绘图', hint: '使用当前供应商的图像 API 生成图片' },
  { id: 'remember', label: '写长期记忆', hint: '记住偏好与重要事项' },
  { id: 'recall', label: '查长期记忆', hint: '关键词检索记忆' },
  { id: 'schedule_task', label: '定时任务', hint: '通过对话创建、查询、修改和启停任务' },
  { id: 'set_goal', label: '跨轮目标', hint: '记住这次要完成什么，跨多轮推进直到完成或受阻' },
  { id: 'update_goal', label: '更新目标', hint: '标记目标完成或受阻，需要附上证据' },
  { id: 'web_fetch', label: '网页抓取', hint: '只读 https 页面' },
  { id: 'web_search', label: '网页搜索', hint: '返回标题/链接/摘要，默认 DuckDuckGo' },
  { id: 'spawn_agent', label: '子智能体', hint: '派只读的调研分身，并行分头查，不继承本对话历史' },
  { id: 'run_script', label: '工作流编排', hint: '用脚本并行调度多个子代理；写权限需脚本显式声明' },
  { id: 'todo_write', label: '任务清单', hint: '维护本会话的待办清单，做完一项勾一项' },
  { id: 'ask_user', label: '向用户提问', hint: '信息不足时停下来问你，等文字回答' },
  { id: 'install_mcp', label: '安装 MCP', hint: '对话里安装 MCP 服务并绑定（敏感操作，需确认）' },
  { id: 'install_skill', label: '安装 Skill', hint: '从工作区目录安装技能并绑定（需确认）' },
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
- 涉及文件、命令、脚本的任务，用 cloud_* 工具在云电脑里完成；聊天闲聊不必唤醒云电脑。
- 需要生成图片时调用 generate_image，通过供应商图像 API 出图，无需唤醒云电脑。
- 长任务先说明计划，再用工具一步步执行，每一步都给出可验证的结果。
- 不确定的信息要说明不确定，不要编造命令输出。`,
    approvalPolicy: 'never', tools: BOT_TOOLS.map((tool) => tool.id),
    image: { aspect: '1:1' },
    wakeOnTask: true, createdAt: now, updatedAt: now,
  };
}
