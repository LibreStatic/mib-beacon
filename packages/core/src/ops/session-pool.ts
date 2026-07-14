interface Closable {
  close(): void;
}

interface PoolEntry<T extends Closable> {
  session: T;
  tail: Promise<void>;
}

/** Reuses a session per target and serializes work that shares that session. */
export class SerializedSessionPool<T extends Closable> {
  private readonly entries = new Map<string, PoolEntry<T>>();

  run<R>(key: string, create: () => T, task: (session: T) => Promise<R>): Promise<R> {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { session: create(), tail: Promise.resolve() };
      this.entries.set(key, entry);
    }
    const result = entry.tail.then(() => task(entry!.session));
    entry.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  invalidate(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    void entry.tail.finally(() => entry.session.close());
  }

  close(): void {
    for (const key of [...this.entries.keys()]) this.invalidate(key);
  }
}
