export function enqueueRequest<T extends { id: string }>(queue: readonly T[], request: T): readonly T[] {
  return queue.some((item) => item.id === request.id) ? queue : [...queue, request];
}

export function removeRequest<T extends { id: string }>(queue: readonly T[], id: string): readonly T[] {
  return queue.some((item) => item.id === id) ? queue.filter((item) => item.id !== id) : queue;
}

export function scopedSnapshots<T>(publish: (key: string, value: T) => void) {
  const pending = new Map<string, symbol>();
  return {
    set(key: string, value: T) {
      pending.delete(key);
      publish(key, value);
    },
    async load(key: string, read: () => Promise<T>) {
      const token = Symbol();
      pending.set(key, token);
      try {
        const value = await read();
        if (pending.get(key) === token) publish(key, value);
      } finally {
        if (pending.get(key) === token) pending.delete(key);
      }
    },
  };
}
