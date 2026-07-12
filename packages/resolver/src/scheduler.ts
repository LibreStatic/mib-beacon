interface PendingJob<T> {
  host: string;
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

/** Small runtime-neutral scheduler used by network sources. */
export class HostScheduler {
  private readonly maxConcurrent: number;
  private readonly maxPerHost: number;
  private active = 0;
  private readonly activeByHost = new Map<string, number>();
  private readonly pending: PendingJob<unknown>[] = [];

  constructor(options: { maxConcurrent?: number; maxPerHost?: number } = {}) {
    this.maxConcurrent = options.maxConcurrent ?? 3;
    this.maxPerHost = options.maxPerHost ?? 2;
    if (this.maxConcurrent < 1 || this.maxPerHost < 1) throw new Error('scheduler limits must be positive');
  }

  run<T>(host: string, task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('operation aborted'));
        return;
      }
      const job: PendingJob<unknown> = {
        host,
        task,
        resolve: resolve as (value: unknown) => void,
        reject,
        signal,
      };
      job.onAbort = () => {
        const index = this.pending.indexOf(job);
        if (index >= 0) {
          this.pending.splice(index, 1);
          reject(new Error('operation aborted'));
        }
      };
      signal?.addEventListener('abort', job.onAbort, { once: true });
      this.pending.push(job);
      this.pump();
    });
  }

  private pump(): void {
    while (this.active < this.maxConcurrent) {
      const index = this.pending.findIndex(
        (job) => (this.activeByHost.get(job.host) ?? 0) < this.maxPerHost,
      );
      if (index < 0) return;
      const [job] = this.pending.splice(index, 1);
      if (!job) return;
      if (job.onAbort) job.signal?.removeEventListener('abort', job.onAbort);
      this.active += 1;
      this.activeByHost.set(job.host, (this.activeByHost.get(job.host) ?? 0) + 1);
      void job
        .task()
        .then(job.resolve, job.reject)
        .finally(() => {
          this.active -= 1;
          const hostActive = (this.activeByHost.get(job.host) ?? 1) - 1;
          if (hostActive === 0) this.activeByHost.delete(job.host);
          else this.activeByHost.set(job.host, hostActive);
          this.pump();
        });
    }
  }
}
