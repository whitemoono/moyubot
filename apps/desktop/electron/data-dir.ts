/**
 * 数据目录（settings / 会话 / 记忆 / 密钥的落盘位置）解析与持久化。
 *
 * 优先级：环境变量 MOYU_DATA_DIR > 引导中选择的目录 > 便携默认（安装目录下 data，可写时）> 系统 userData。
 * 引导选择存到固定位置（userData/bootstrap.json），这样切换 dataDir 后依然能读到。
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

/** 引导选择文件的固定路径，不随 dataDir 变化。 */
export function bootstrapFile(): string {
  return path.join(app.getPath('userData'), 'bootstrap.json');
}

/** 安装/运行目录：打包后是可执行文件所在目录，开发时是仓库根。 */
export function installBaseDir(): string {
  return app.isPackaged ? path.dirname(app.getPath('exe')) : path.resolve(app.getAppPath(), '../..');
}

/** 便携式默认数据目录：<安装目录>/data。 */
export function portableDataDir(): string {
  return path.join(installBaseDir(), 'data');
}

/** 系统默认数据目录（便携目录不可写时的回退）。 */
export function userDataDir(): string {
  return path.join(app.getPath('userData'), 'moyu');
}

export function readBootstrapDataDir(): string | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(bootstrapFile(), 'utf8')) as { dataDir?: unknown };
    const dir = typeof raw?.dataDir === 'string' ? raw.dataDir.trim() : '';
    return dir && path.isAbsolute(dir) ? dir : undefined;
  } catch { return undefined; }
}

export function writeBootstrapDataDir(dir: string | undefined): void {
  const file = bootstrapFile();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!dir) { if (fs.existsSync(file)) fs.unlinkSync(file); return; }
    fs.writeFileSync(file, JSON.stringify({ dataDir: dir }, null, 2));
  } catch { /* 写失败时保持原数据目录 */ }
}

/** 目录是否可用作数据目录：能创建且可写。 */
export function ensureWritableDirectory(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.moyu-write-check-${process.pid}-${Date.now()}`);
    fs.writeFileSync(probe, '', { flag: 'wx' });
    fs.unlinkSync(probe);
    return true;
  } catch { return false; }
}

/** 读一份数据目录的"内容丰富度"：Bot 数量 + settings 写入时间，用于在两个候选之间选更完整的一份。 */
function richness(dir: string): { bots: number; at: number } | undefined {
  try {
    const file = path.join(dir, 'settings.json');
    if (!fs.existsSync(file)) return undefined;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { bots?: unknown[] };
    const bots = Array.isArray(raw.bots) ? raw.bots.length : 0;
    return { bots, at: fs.statSync(file).mtimeMs };
  } catch { return undefined; }
}

/** 两个数据目录都存在时，选更完整的那份（Bot 多者优先，其次 settings 更新者），避免升级后读到空壳目录。 */
function pickRicher(a: string, b: string): string {
  const left = richness(a), right = richness(b);
  if (!left) return right ? b : a;
  if (!right) return a;
  if (left.bots !== right.bots) return left.bots > right.bots ? a : b;
  return left.at >= right.at ? a : b;
}

/** 解析当前数据目录。 */
export function resolveDataDir(): string {
  if (process.env.MOYU_DATA_DIR) return process.env.MOYU_DATA_DIR;
  const chosen = readBootstrapDataDir();
  if (chosen) return chosen;
  // 兼容旧版本：userData 下已经有数据时继续用它，避免升级后看起来“数据消失”。
  const legacy = userDataDir();
  if (fs.existsSync(path.join(legacy, 'settings.json'))) return legacy;
  const portable = portableDataDir();
  if (ensureWritableDirectory(portable)) return portable;
  return legacy;
}

/** 当前数据目录的来源，用于界面展示。 */
export function dataDirSource(): 'env' | 'chosen' | 'legacy' | 'portable' | 'userData' {
  if (process.env.MOYU_DATA_DIR) return 'env';
  if (readBootstrapDataDir()) return 'chosen';
  if (fs.existsSync(path.join(userDataDir(), 'settings.json'))) return 'legacy';
  return ensureWritableDirectory(portableDataDir()) ? 'portable' : 'userData';
}
