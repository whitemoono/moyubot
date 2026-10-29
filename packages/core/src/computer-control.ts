/** Coordinates all automatic operations on one shared computer. */
export class ComputerControl {
  private blocked = false;
  private active = 0;
  private changed = new Set<() => void>();

  get paused(): boolean { return this.blocked; }

  private notify(): void { for (const listener of [...this.changed]) listener(); }

  private wait(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const done = () => { cleanup(); resolve(); };
      const aborted = () => { cleanup(); reject(signal?.reason ?? new Error('已停止')); };
      const cleanup = () => { this.changed.delete(done); signal?.removeEventListener('abort', aborted); };
      this.changed.add(done);
      signal?.addEventListener('abort', aborted, { once: true });
    });
  }

  async acquire(signal?: AbortSignal): Promise<() => void> {
    while (this.blocked) await this.wait(signal);
    signal?.throwIfAborted();
    this.active++;
    let released = false;
    return () => { if (!released) { released = true; this.active--; this.notify(); } };
  }

  block(): void { this.blocked = true; }

  async drain(signal?: AbortSignal): Promise<void> {
    this.block();
    while (this.active) await this.wait(signal);
    signal?.throwIfAborted();
  }

  resume(): void { this.blocked = false; this.notify(); }
}
