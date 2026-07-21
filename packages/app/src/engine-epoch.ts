export class EngineEpochSlot<T extends object> {
  private readonly keys = new WeakMap<T, number>();
  private next = 1;

  key(engine: T): number {
    let key = this.keys.get(engine);
    if (key === undefined) {
      key = this.next++;
      this.keys.set(engine, key);
    }
    return key;
  }
}
