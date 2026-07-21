export interface EngineLifetimeToken {
  readonly lifecycle: number;
  readonly resource: string;
  readonly revision: number;
}

/** Arbitrates async reads and event continuations owned by one EngineAPI lifetime. */
export class EngineLifetimeCoordinator {
  private lifecycle = 0;
  private readonly revisions = new Map<string, number>();
  private active = true;

  isActive(): boolean {
    return this.active;
  }

  activate(): void {
    if (this.active) return;
    this.active = true;
    this.lifecycle += 1;
  }

  capture(resource: string): EngineLifetimeToken {
    return {
      lifecycle: this.lifecycle,
      resource,
      revision: this.revisions.get(resource) ?? 0,
    };
  }

  begin(resource: string): EngineLifetimeToken {
    this.invalidate(resource);
    return this.capture(resource);
  }

  invalidate(resource: string): void {
    if (!this.active) return;
    this.revisions.set(resource, (this.revisions.get(resource) ?? 0) + 1);
  }

  owns(token: EngineLifetimeToken): boolean {
    return (
      this.active &&
      token.lifecycle === this.lifecycle &&
      token.revision === (this.revisions.get(token.resource) ?? 0)
    );
  }

  apply(token: EngineLifetimeToken, mutation: () => void): boolean {
    if (!this.owns(token)) return false;
    mutation();
    return true;
  }

  async runLatest<T>(
    resource: string,
    read: () => Promise<T>,
    apply: (value: T) => void,
    reject?: (error: unknown) => void,
  ): Promise<void> {
    const token = this.begin(resource);
    await this.settle(token, read, apply, reject);
  }

  async settle<T>(
    token: EngineLifetimeToken,
    read: () => Promise<T>,
    apply: (value: T) => void,
    reject?: (error: unknown) => void,
  ): Promise<void> {
    try {
      const value = await read();
      this.apply(token, () => apply(value));
    } catch (error) {
      if (reject) this.apply(token, () => reject(error));
    }
  }

  dispose(): void {
    if (!this.active) return;
    this.active = false;
    this.lifecycle += 1;
  }
}
