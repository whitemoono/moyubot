/**
 * Bot 模板市场：模板的导出 / 导入 / 校验。
 *
 * 设计约束（对齐 docs/bot-template-market.md）：
 * 1. 只分享"人设 + 配置 + 工具/Skill/MCP 引用清单"，不携带任何密钥、记忆、对话历史或本机路径。
 * 2. 导入时强制 `approvalPolicy = 'ask'`——模板是可 "prompt injection" 的第三方文本，
 *    绝不能继承模板声明的 `never`，避免工具无审批自动执行。
 * 3. 引用清单只做展示，导入方需自行挑选 / 校验绑定；引用的 Skill/MCP 名称按当前工作区匹配。
 * 4. 需要一个持久化的「已安装模板」记录 + 「我上传的模板」记录（由调用方 Store / UI 层保存）。
 */

import { newId } from './util';
import { validateGeneration } from './generation';
import type { BotGenerationSettings } from './types';

/** 建模板时允许带进 Bot 的字段（白名单）。dev-only 字段（id/createdAt/updatedAt/dirName/sidebar）一律剔除。 */
export const TEMPLATE_BOT_FIELDS = [
  'name',
  'handle',
  'avatar',
  'providerId',
  'model',
  'temperature',
  'generation',
  'systemPrompt',
  'tools',
  'image',
  'wakeOnTask',
  'workspaceId',
  // 引用清单：只存"引用目标的名字/必要标识"，不存内容
  'skillIds',
  'mcpServerIds',
  // 模板作者可声明"建议定时任务"，导入时不自动注册
  'suggestedSchedules',
] as const;

export interface BotTemplateSchedule {
  title: string;
  prompt: string;
  /** 一经导入即会逐条向用户确认；rrule 只作建议。 */
  rrule?: string;
}

export interface BotTemplate {
  schemaVersion: 1;
  meta: {
    name: string;
    handle: string;
    author?: string;
    locale?: string;
    tags?: string[];
    description?: string;
    /** 模板自身版本，导入方据此判断升级。 */
    version?: string;
    examplePrompt?: string;
    /** 市场分组：如 '通用' / 'moyubot 专用'。 */
    category?: string;
  };
  bot: {
    systemPrompt: string;
    temperature?: number;
    generation?: Record<string, unknown>;
    image?: { aspect: string };
    workspaceId?: string;
    wakeOnTask?: boolean;
    tools?: string[];
    skillIds?: string[];
    mcpServerIds?: string[];
    suggestedSchedules?: BotTemplateSchedule[];
  };
}

/** 归一化后的、可交到 Store 写入的 Bot（含必填 runtime 字段）。 */
export interface ImportedBot {
  /** 导入时重新生成的 id（绝不复用模板/原 Bot 的 id）。 */
  id: string;
  name: string;
  handle: string;
  avatar: { from: string; to: string; glyph: string };
  providerId: string;
  model: string;
  temperature: number;
  systemPrompt: string;
  approvalPolicy: 'ask' | 'never';
  tools: string[];
  image: { aspect: '1:1' | '3:2' | '2:3' | '4:3' | '3:4' | '16:9' | '9:16' };
  wakeOnTask: boolean;
  workspaceId: string;
  mcpServerIds?: string[];
  skillIds?: string[];
  createdAt: number;
  updatedAt: number;
  generation?: Record<string, unknown>;
}

const ASPECTS = ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16'];
const TOOL_MAX = 200;

function isAspect(v: unknown): v is ImportedBot['image']['aspect'] {
  return typeof v === 'string' && (ASPECTS as readonly string[]).includes(v);
}

function sanitizeTags(tags?: string[]): string[] {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((t) => (typeof t === 'string' ? t.trim().slice(0, 20) : ''))
    .filter((t): t is string => !!t)
    .slice(0, 12);
}

/**
 * 把 Bot 导出为模板。
 * 只取白名单字段；剔除 id/createdAt/updatedAt/dirName/sidebar 等本机身份字段，
 * 以及 avatar.imageDataUrl（本机裁剪头像，不进公开模板）。
 * 通过把工具 / Skill / MCP 引用降级成「清单」，保证模板不带走任何本机绑定。
 */
export function exportBotToTemplate(
  bot: {
    name: string;
    handle: string;
    avatar?: { from?: string; to?: string; glyph?: string };
    providerId?: string;
    model?: string;
    temperature?: number;
    generation?: BotGenerationSettings | Record<string, unknown>;
    systemPrompt: string;
    tools?: string[];
    image?: { aspect?: string };
    wakeOnTask?: boolean;
    workspaceId?: string;
    mcpServerIds?: string[];
    skillIds?: string[];
  },
  opts?: {
    author?: string;
    tags?: string[];
    description?: string;
    version?: string;
    examplePrompt?: string;
    /** 额外的模板元信息覆盖。 */
    meta?: Partial<BotTemplate['meta']>;
  },
): BotTemplate {
  const meta: BotTemplate['meta'] = {
    name: bot.name?.trim()?.slice(0, 60) || '未命名 Bot',
    handle: bot.handle?.trim()?.slice(0, 48) || 'bot',
    ...(opts?.meta ?? {}),
    author: opts?.author ?? opts?.meta?.author,
    locale: opts?.meta?.locale ?? 'zh-CN',
    tags: sanitizeTags(opts?.tags ?? opts?.meta?.tags),
    description: opts?.description ?? opts?.meta?.description,
    version: opts?.version ?? opts?.meta?.version,
    examplePrompt: opts?.examplePrompt ?? opts?.meta?.examplePrompt,
  };

  const botOut: BotTemplate['bot'] = {
    systemPrompt: typeof bot.systemPrompt === 'string' ? bot.systemPrompt : '',
    temperature: typeof bot.temperature === 'number' ? bot.temperature : undefined,
    generation: bot.generation !== undefined ? (bot.generation as Record<string, unknown>) : undefined,
    image: bot.image?.aspect !== undefined ? { aspect: bot.image.aspect } : undefined,
    workspaceId: bot.workspaceId,
    wakeOnTask: bot.wakeOnTask,
    tools: Array.isArray(bot.tools) && bot.tools.length ? [...bot.tools] : undefined,
    skillIds: Array.isArray(bot.skillIds) && bot.skillIds.length ? [...bot.skillIds] : undefined,
    mcpServerIds: Array.isArray(bot.mcpServerIds) && bot.mcpServerIds.length ? [...bot.mcpServerIds] : undefined,
    suggestedSchedules: undefined,
  };

  return { schemaVersion: 1, meta, bot: botOut };
}

/**
 * 校验一个反序列化出的未知模板对象。
 * 抛错式校验（对齐 core 其它校验的严格风格），返回正常化后的 BotTemplate。
 */
export function validateBotTemplate(input: unknown): BotTemplate {
  if (!input || typeof input !== 'object') throw new Error('模板格式无效');
  const raw = input as Record<string, any>;
  if (raw.schemaVersion !== 1) throw new Error('不支持的模板版本');
  const meta = raw.meta ?? {};
  if (typeof meta.name !== 'string' || !meta.name.trim()) throw new Error('模板缺少名称');
  if (typeof meta.handle !== 'string' || !/^[a-zA-Z0-9_-]{1,48}$/.test(meta.handle.trim())) throw new Error('模板 handle 需要 1–48 位字母/数字/下划线/短横线');

  const bot = raw.bot ?? {};
  // systemPrompt 必填
  if (typeof bot.systemPrompt !== 'string' || !bot.systemPrompt.trim()) throw new Error('模板缺少人设（systemPrompt）');
  // 工具必须是字符串数组，且数量受限
  if (bot.tools !== undefined) {
    if (!Array.isArray(bot.tools) || bot.tools.length > TOOL_MAX || !bot.tools.every((t: unknown) => typeof t === 'string' && (t as string).length <= 80)) throw new Error('模板工具清单无效');
  }
  // 引用清单同上限
  for (const k of ['skillIds', 'mcpServerIds'] as const) {
    const list = bot[k] as unknown;
    if (list !== undefined && (!Array.isArray(list) || (list as unknown[]).length > TOOL_MAX || !(list as unknown[]).every((t: unknown) => typeof t === 'string' && (t as string).length <= 80))) throw new Error(`模板 ${k} 无效`);
  }
  // generation 若有，走统一校验
  if (bot.generation !== undefined) {
    // 前端/浏览器无 node 的 scene，但 core 是 Node，可直接调。
    validateGeneration(bot.generation as BotGenerationSettings);
  }
  if (bot.temperature !== undefined && (typeof bot.temperature !== 'number' || !Number.isFinite(bot.temperature) || bot.temperature < 0 || bot.temperature > 2)) throw new Error('模板 temperature 无效');
  if (bot.image !== undefined) {
    if (!bot.image || typeof bot.image !== 'object' || !isAspect(bot.image.aspect)) throw new Error('模板图片配置无效');
  }
  if (bot.wakeOnTask !== undefined && typeof bot.wakeOnTask !== 'boolean') throw new Error('模板 wakeOnTask 无效');
  if (bot.workspaceId !== undefined && typeof bot.workspaceId !== 'string') throw new Error('模板 workspaceId 无效');

  // 建议定时任务结构校验
  if (bot.suggestedSchedules !== undefined) {
    if (!Array.isArray(bot.suggestedSchedules) || bot.suggestedSchedules.length > 50) throw new Error('模板建议任务过多');
    for (const s of bot.suggestedSchedules) {
      if (!s || typeof s !== 'object') throw new Error('模板建议任务无效');
      if (typeof s.title !== 'string' || typeof s.prompt !== 'string') throw new Error('模板建议任务缺 title/prompt');
    }
  }

  // 归一化返回
  return {
    schemaVersion: 1,
    meta: {
      name: String(meta.name).trim().slice(0, 80),
      handle: String(meta.handle).trim(),
      author: typeof meta.author === 'string' ? meta.author.slice(0, 80) : undefined,
      locale: typeof meta.locale === 'string' ? meta.locale : 'zh-CN',
      tags: sanitizeTags(meta.tags),
      description: typeof meta.description === 'string' ? meta.description.slice(0, 500) : undefined,
      version: typeof meta.version === 'string' ? meta.version.slice(0, 32) : undefined,
      examplePrompt: typeof meta.examplePrompt === 'string' ? meta.examplePrompt.slice(0, 2000) : undefined,
      category: typeof meta.category === 'string' ? meta.category.slice(0, 40) : undefined,
    },
    bot: {
      systemPrompt: bot.systemPrompt.slice(0, 20000),
      temperature: bot.temperature !== undefined ? bot.temperature : undefined,
      generation: bot.generation ?? undefined,
      image: bot.image && isAspect(bot.image.aspect) ? { aspect: bot.image.aspect } : undefined,
      workspaceId: bot.workspaceId,
      wakeOnTask: bot.wakeOnTask,
      tools: bot.tools ?? undefined,
      skillIds: bot.skillIds ?? undefined,
      mcpServerIds: bot.mcpServerIds ?? undefined,
      suggestedSchedules: bot.suggestedSchedules ?? undefined,
    },
  };
}

/**
 * 模板转 Bot（不可变，不写盘）。
 * 核心安全规则：
 *  - 强制 `approvalPolicy='ask'`；
 *  - 重新生成 id / handle（处理冲突由调用方决定）；
 *  - workspaceId 有则保留但由调用方校验，无则给默认；
 *  - 引用 Skill/MCP：传入 matchedSkillIds / matchedMcpIds（名称→当前工作区 id 的映射），
 *    只绑定匹配到的那部分，未匹配的不静默创建。
 */
export function templateToBot(
  template: BotTemplate,
  opts?: {
    /** 是否强制 ask（默认 true——任何第三方模板都应强制；false 仅供内部把官方内置模板作为不审批预设）。 */
    forceAsk?: boolean;
    workspaceId?: string;
    /** 模板声明的 skillIds → 当前工作区已存在的 skill id 映射（通常本地按同名解析）。 */
    skillIdByTemplate?: Record<string, string>;
    /** 模板声明的 mcpServerIds → 当前工作区已存在的 mcp id 映射（通常本地按同名解析）。 */
    mcpIdByRef?: Record<string, string>;
    imageAspectDefault?: ImportedBot['image']['aspect'];
  },
): ImportedBot {
  const bot = template.bot;
  const forceAsk = opts?.forceAsk ?? true;
  const now = Date.now();
  const imageAspect = bot.image && isAspect(bot.image.aspect) ? bot.image.aspect : (opts?.imageAspectDefault ?? '1:1');

  // 引用绑定：只保留命中的。模板的 skillIds/mcpServerIds 是"引用声明"，
  // 只有调用方提供了 模板id→本地id 的映射才绑定，未命中的不静默创建。
  const skillIds: string[] = [];
  if (opts?.skillIdByTemplate && Array.isArray(bot.skillIds)) {
    for (const ref of bot.skillIds) {
      const hit = opts.skillIdByTemplate[ref];
      if (hit) skillIds.push(hit);
    }
  }
  const mcpServerIds: string[] = [];
  if (opts?.mcpIdByRef && Array.isArray(bot.mcpServerIds)) {
    for (const ref of bot.mcpServerIds) {
      const hit = opts.mcpIdByRef[ref];
      if (hit) mcpServerIds.push(hit);
    }
  }

  const avatar = { from: '#5890f0', to: '#5890f0', glyph: 'B' };

  return {
    id: newId('bot'),
    name: template.meta.name.slice(0, 60) || '导入的 Bot',
    handle: template.meta.handle.slice(0, 48),
    avatar,
    providerId: '', // provider 由调用方 / 用户在本机配置；不携带原 Key
    model: '',
    temperature: bot.temperature !== undefined ? bot.temperature : 0.7,
    systemPrompt: bot.systemPrompt,
    approvalPolicy: forceAsk ? 'ask' : 'never',
    tools: Array.isArray(bot.tools) && bot.tools.length ? [...bot.tools] : [],
    image: { aspect: imageAspect },
    wakeOnTask: bot.wakeOnTask === undefined ? true : !!bot.wakeOnTask,
    workspaceId: opts?.workspaceId ?? bot.workspaceId ?? 'workspace_cloud',
    ...(skillIds.length ? { skillIds } : {}),
    ...(mcpServerIds.length ? { mcpServerIds } : {}),
    ...(bot.generation !== undefined ? { generation: bot.generation as Record<string, unknown> } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

/** 序列化模板为可分享文件文本。 */
export function serializeTemplate(template: BotTemplate): string {
  return JSON.stringify(template, null, 2);
}

/** 从文件文本解析模板；失败抛错。 */
export function parseTemplate(text: string): BotTemplate {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('模板文件不是有效的 JSON');
  }
  return validateBotTemplate(parsed);
}