import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { AppUpdateProgress, AppUpdateResult } from '@moyu/core';
import { checkForUpdates } from './updates';

interface UpdateDependencies {
  directory: string;
  version: string;
  request: typeof fetch;
  canInstall: boolean;
  beforeInstall: () => void;
  launch: (installer: string) => Promise<void>;
  quit: () => void;
}

export class AppUpdater {
  private state: AppUpdateProgress = { status: 'idle', received: 0, message: '' };
  private controller?: AbortController;
  private checking?: Promise<AppUpdateResult>;
  private downloaded?: { file: string; sha256: string; size: number };
  constructor(private deps: UpdateDependencies) {}
  status(): AppUpdateProgress { return { ...this.state }; }
  private set(patch: Partial<AppUpdateProgress>): AppUpdateProgress { this.state = { ...this.state, ...patch }; return this.status(); }
  check(): Promise<AppUpdateResult> {
    if (this.state.release && (this.controller || ['downloading', 'verifying', 'ready', 'installing'].includes(this.state.status))) return Promise.resolve(this.state.release);
    return this.checking ??= checkForUpdates(this.deps.version, this.deps.request).then(release => {
      if (!this.deps.canInstall && release.installer) { delete release.installer; release.installHint = '开发预览版请下载安装包；安装版支持应用内更新。'; }
      this.downloaded = undefined;
      this.set({ status: 'idle', received: 0, total: undefined, message: '', release });
      return release;
    }).finally(() => { this.checking = undefined; });
  }
  cancel(): void { this.controller?.abort(); }
  dispose(): void { this.cancel(); }
  async download(): Promise<AppUpdateProgress> {
    if (this.controller || ['downloading', 'verifying', 'installing', 'ready'].includes(this.state.status)) return this.status();
    const installer = this.state.release?.installer;
    if (!this.deps.canInstall || this.state.release?.status !== 'available' || !installer) throw new Error('请先检查可安装的新版本');
    const controller = new AbortController();
    this.controller = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15 * 60_000)]);
    this.downloaded = undefined;
    this.set({ status: 'downloading', received: 0, total: installer.size, message: '正在下载更新，使用系统网络设置…' });
    let partial: string | undefined;
    let file: fs.promises.FileHandle | undefined;
    try {
      await fs.promises.mkdir(this.deps.directory, { recursive: true });
      // Unique app-owned filenames prevent concurrent launches from sharing partial files.
      partial = path.join(this.deps.directory, `update-${randomUUID()}.exe.part`);
      let expected = installer.sha256;
      if (!expected && installer.checksumUrl) {
        const response = await this.deps.request(installer.checksumUrl, { signal, cache: 'no-store' });
        if (!response.ok || !response.body) throw new Error('无法获取更新校验文件，请重试');
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = []; let length = 0;
        try {
          while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 65536) throw new Error('更新校验文件无效'); chunks.push(value); }
        } finally { await reader.cancel().catch(() => {}); }
        expected = Buffer.concat(chunks).toString('utf8').split(/\r?\n/).map(line => /^([a-f0-9]{64})\s+\*?(.+?)\s*$/i.exec(line)).find(match => match?.[2] === installer.name)?.[1]?.toLowerCase();
      }
      if (!expected || !/^[a-f0-9]{64}$/i.test(expected)) throw new Error('发行版缺少有效的 SHA256 校验值');
      const response = await this.deps.request(installer.url, { signal, cache: 'no-store' });
      if (!response.ok || !response.body) throw new Error(`更新下载失败（${response.status}），请重试`);
      file = await fs.promises.open(partial, 'wx', 0o600);
      const hash = createHash('sha256');
      const reader = response.body.getReader();
      let received = 0;
      try {
        while (true) {
          signal.throwIfAborted();
          const { done, value } = await reader.read(); if (done) break;
          received += value.length;
          if (received > installer.size) throw new Error('安装包大小与发行版不符');
          hash.update(value);
          let offset = 0;
          while (offset < value.length) { const written = await file.write(value, offset, value.length - offset); if (!written.bytesWritten) throw new Error('无法保存更新文件'); offset += written.bytesWritten; }
          this.set({ received });
        }
      } finally { await reader.cancel().catch(() => {}); }
      this.set({ status: 'verifying', message: '正在校验安装包…' });
      signal.throwIfAborted();
      if (received !== installer.size || hash.digest('hex') !== expected.toLowerCase()) throw new Error('安装包校验失败，请重新下载');
      await file.close(); file = undefined;
      signal.throwIfAborted();
      const complete = partial.slice(0, -5);
      await fs.promises.rename(partial, complete); partial = undefined;
      this.downloaded = { file: complete, sha256: expected.toLowerCase(), size: installer.size };
      return this.set({ status: 'ready', message: '更新已下载并通过校验，重启安装后保留聊天和设置。' });
    } catch (error) {
      return this.set({ status: controller.signal.aborted ? 'cancelled' : 'error', message: controller.signal.aborted ? '已取消下载，可以重新下载。' : signal.aborted ? '下载超时，请检查系统代理后重试。' : (error as Error).message });
    } finally {
      await file?.close().catch(() => {});
      if (partial) await fs.promises.unlink(partial).catch(() => {});
      this.controller = undefined;
    }
  }
  async install(): Promise<AppUpdateProgress> {
    if (this.state.status === 'installing') return this.status();
    if (!this.deps.canInstall || this.state.status !== 'ready' || !this.downloaded) throw new Error('请先下载并校验更新');
    this.deps.beforeInstall();
    const downloaded = this.downloaded;
    this.set({ status: 'installing', message: '正在启动更新安装，应用即将退出…' });
    try {
      const hash = createHash('sha256'); let size = 0;
      try { for await (const chunk of fs.createReadStream(downloaded.file)) { hash.update(chunk); size += chunk.length; } }
      catch { this.downloaded = undefined; throw new Error('无法读取安装包，请重新下载更新'); }
      if (size !== downloaded.size || hash.digest('hex') !== downloaded.sha256) { this.downloaded = undefined; throw new Error('安装包已变化，请重新下载更新'); }
      this.deps.beforeInstall();
      await this.deps.launch(downloaded.file);
      this.deps.quit();
      return this.status();
    } catch (error) {
      if (!this.downloaded) await fs.promises.unlink(downloaded.file).catch(() => {});
      return this.set({ status: this.downloaded ? 'ready' : 'error', message: (error as Error).message });
    }
  }
}
