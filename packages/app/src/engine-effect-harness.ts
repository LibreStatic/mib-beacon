import { EngineLifetimeCoordinator, type EngineLifetimeToken } from './engine-lifetime-coordinator';

/** Ownership harness used by one concrete AppRoot [engine] effect setup. */
export class EngineEffectHarness {
  private readonly lifetime = new EngineLifetimeCoordinator();

  constructor(private readonly providerOwns: () => boolean) {}

  capture(resource: string): EngineLifetimeToken {
    return this.lifetime.capture(resource);
  }

  begin(resource: string): EngineLifetimeToken {
    return this.lifetime.begin(resource);
  }

  invalidate(resource: string): void {
    this.lifetime.invalidate(resource);
  }

  owns(token: EngineLifetimeToken): boolean {
    return this.providerOwns() && this.lifetime.owns(token);
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
    this.lifetime.dispose();
  }
}
