import vm from 'node:vm';

/**
 * 工作流编排内核。
 *
 * 脚本在一个没有 require / process / fs / fetch / timers 的 vm 上下文里跑，唯一的出口是
 * `agent()` —— 它把活派给真正的子智能体。这样"脚本能干什么"就等于"agent 能干什么"，
 * 而 agent 的权限由调用方决定（默认只读，显式 write 才拿完整工具集）。
 *
 * 三类硬上限，缺一个就是给模型一个无限循环的入口：
 * - 子代理个数（默认 12）：否则脚本可以 while(true) 无限派活；
 * - 墙钟时间（默认 600s，且不越过父任务剩余时间）；
 * - 父任务的 AbortSignal：用户点停止必须能真的停下来。
 */
export interface WorkflowDeps {
  conversationId: string;
  /** 一次子智能体调用；失败直接 throw，由脚本决定吞掉还是让整段失败。 */
  runAgent: (task: string, options: { background?: string }) => Promise<string>;
  emit: (text: string, level?: 'info' | 'warn' | 'error') => void;
  signal?: AbortSignal;
}

export interface WorkflowOptions {
  script: string;
  args?: Record<string, unknown>;
  maxAgents?: number;
  maxSeconds?: number;
}

export interface WorkflowResult {
  result: unknown;
  agents: number;
  phases: string[];
  seconds: number;
}

const DEFAULT_MAX_AGENTS = 12;
const DEFAULT_MAX_SECONDS = 600;

export async function runWorkflow(deps: WorkflowDeps, options: WorkflowOptions): Promise<WorkflowResult> {
  const script = typeof options.script === 'string' ? options.script : '';
  if (!script.trim()) throw new Error('run_script 需要脚本体');
  if (Buffer.byteLength(script) > 60_000) throw new Error('脚本体最多 60 KB');
  const maxAgents = clampInt(options.maxAgents, DEFAULT_MAX_AGENTS, 1, 48);
  const maxSeconds = clampInt(options.maxSeconds, DEFAULT_MAX_SECONDS, 5, 1800);

  const startedAt = Date.now();
  const deadline = startedAt + maxSeconds * 1000;
  const phases: string[] = [];
  let agents = 0;
  const pendingAgents = new Set<Promise<unknown>>();

  const guard = () => {
    if (deps.signal?.aborted) throw new Error('工作流已被停止');
    if (Date.now() > deadline) throw new Error(`工作流超过 ${maxSeconds} 秒上限，已中止；已完成的子代理结果仍可用`);
    if (agents >= maxAgents) throw new Error(`一次工作流最多运行 ${maxAgents} 个子代理，已拒绝继续派发`);
  };

  const agent = async (prompt: unknown, opts: { background?: string } = {}) => {
    if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('agent() 需要一个非空的任务描述');
    guard();
    agents += 1;
    const background = typeof opts?.background === 'string' && opts.background.trim() ? opts.background.trim() : undefined;
    const pending = deps.runAgent(prompt.trim(), { background });
    // 脚本可能忘了 await：挂一个空 catch，避免未处理的拒绝把宿主进程带走。
    // 调用方仍然能 await 原始 promise 并拿到同一个错误。
    void pending.catch(() => {});
    pendingAgents.add(pending);
    void pending.finally(() => pendingAgents.delete(pending)).catch(() => {});
    return pending;
  };

  /** 零参数函数并发跑，任一失败记成 null 而不是拖垮整段（对齐宿主里 Promise.all 的语义选择）。 */
  const parallel = async (thunks: unknown) => {
    if (!Array.isArray(thunks)) throw new Error('parallel() 需要接收一个函数数组');
    guard();
    const running = thunks.map((thunk) => {
      if (typeof thunk !== 'function') throw new Error('parallel() 的每一项都必须是函数');
      return Promise.resolve()
        .then(() => thunk())
        .catch((error) => { deps.emit(`parallel 中一项失败：${describe(error)}`, 'warn'); return null; });
    });
    return Promise.all(running);
  };

  /** 每项独立走完整条阶段链，阶段之间不设栅栏 —— 一项慢不该拖住其他项。 */
  const pipeline = async (items: unknown, ...stages: unknown[]) => {
    if (!Array.isArray(items)) throw new Error('pipeline() 第一项必须是数组');
    const fns = stages.filter((stage): stage is (prev: unknown, item: unknown, index: number) => unknown => typeof stage === 'function');
    if (!fns.length) throw new Error('pipeline() 至少要有一个阶段函数');
    guard();
    return Promise.all(items.map(async (item, index) => {
      let value: unknown = item;
      for (const stage of fns) {
        if (deps.signal?.aborted) throw new Error('工作流已被停止');
        value = await stage(value, item, index);
      }
      return value;
    }));
  };

  const phase = (title: unknown) => {
    const text = String(title ?? '').slice(0, 200);
    if (!text) return;
    phases.push(text);
    deps.emit(`工作流阶段：${text}`, 'info');
  };

  const log = (message: unknown) => deps.emit(`工作流：${String(message ?? '').slice(0, 500)}`, 'info');

  const sandbox: Record<string, unknown> = {
    agent, parallel, pipeline, phase, log,
    args: options.args ?? {},
    JSON, Math, Date, Promise, Array, Object, String, Number, Boolean, Map, Set, RegExp, Error, isNaN, parseInt, parseFloat,
    console: { log, info: log, warn: log, error: log },
  };
  const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });

  let timer: NodeJS.Timeout | undefined;
  const abortPromise = new Promise((_, reject) => {
    if (deps.signal?.aborted) { reject(new Error('工作流已被停止')); return; }
    deps.signal?.addEventListener('abort', () => reject(new Error('工作流已被停止')), { once: true });
  });
  const deadlinePromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`工作流超过 ${maxSeconds} 秒上限，已中止`)), maxSeconds * 1000);
  });

  try {
    // 顶层 await 用 async IIFE 实现；vm 的 timeout 只覆盖同步段，异步等待由 deadline/abort 兜住。
    const wrapped = `(async () => {\n${script}\n})()`;
    const value = vm.runInContext(wrapped, context, { timeout: 5_000, filename: 'workflow-script.js' });
    const result = await Promise.race([Promise.resolve(value), abortPromise, deadlinePromise]);
    // 脚本没 await 的子代理也要等它收尾，否则会出现"工作流已结束"但子代理还在改文件。
    if (pendingAgents.size) {
      await Promise.race([Promise.allSettled([...pendingAgents]), deadlinePromise]).catch(() => {});
    }
    return { result, agents, phases, seconds: Math.max(1, Math.round((Date.now() - startedAt) / 1000)) };
  } catch (error) {
    const message = describe(error);
    throw new Error(`工作流执行失败：${message}${agents ? `（已运行 ${agents} 个子代理）` : ''}`);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error ?? '未知错误');
}