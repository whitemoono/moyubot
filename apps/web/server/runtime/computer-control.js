"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ComputerControl = void 0;
/** Coordinates all automatic operations on one shared computer. */
class ComputerControl {
    blocked = false;
    active = 0;
    changed = new Set();
    get paused() { return this.blocked; }
    notify() { for (const listener of [...this.changed])
        listener(); }
    wait(signal) {
        signal?.throwIfAborted();
        return new Promise((resolve, reject) => {
            const done = () => { cleanup(); resolve(); };
            const aborted = () => { cleanup(); reject(signal?.reason ?? new Error('已停止')); };
            const cleanup = () => { this.changed.delete(done); signal?.removeEventListener('abort', aborted); };
            this.changed.add(done);
            signal?.addEventListener('abort', aborted, { once: true });
        });
    }
    async acquire(signal) {
        while (this.blocked)
            await this.wait(signal);
        signal?.throwIfAborted();
        this.active++;
        let released = false;
        return () => { if (!released) {
            released = true;
            this.active--;
            this.notify();
        } };
    }
    block() { this.blocked = true; }
    async drain(signal) {
        this.block();
        while (this.active)
            await this.wait(signal);
        signal?.throwIfAborted();
    }
    resume() { this.blocked = false; this.notify(); }
}
exports.ComputerControl = ComputerControl;
