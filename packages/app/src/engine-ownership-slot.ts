import { EngineLifetimeCoordinator } from './engine-lifetime-coordinator';

/** Synchronously replaces provider ownership when the EngineAPI identity changes. */
export class EngineOwnershipSlot<T extends object> {
  private current?: { engine: T; coordinator: EngineLifetimeCoordinator };

  claim(engine: T): EngineLifetimeCoordinator {
    if (!this.current || this.current.engine !== engine) {
      this.current?.coordinator.dispose();
      this.current = { engine, coordinator: new EngineLifetimeCoordinator() };
    }
    return this.current.coordinator;
  }
}
