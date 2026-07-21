/** Latest-run-wins guard for the complete mounted Tools refresh pipeline. */
export class ToolsRefreshCoordinator {
  private generation = 0;
  private active = true;

  async run<T>(
    task: (isCurrent: () => boolean) => Promise<T>,
    owns: () => boolean,
    apply: (value: T) => void,
  ): Promise<void> {
    if (!this.active) return;
    const generation = ++this.generation;
    const isCurrent = () => this.isCurrent(generation, owns);
    try {
      const value = await task(isCurrent);
      if (isCurrent()) apply(value);
    } catch (cause) {
      if (isCurrent()) throw cause;
    }
  }

  activate(): void {
    if (this.active) return;
    this.active = true;
    this.generation += 1;
  }

  invalidate(): void {
    if (this.active) this.generation += 1;
  }

  dispose(): void {
    if (!this.active) return;
    this.active = false;
    this.generation += 1;
  }

  private isCurrent(generation: number, owns: () => boolean): boolean {
    return this.active && this.generation === generation && owns();
  }
}
