import type { PacketTraceEvent, PacketTraceServiceStatus } from '@mibbeacon/core/client';

export interface PacketBootstrapSinks {
  setHistory(events: PacketTraceEvent[]): void;
  append(event: PacketTraceEvent): void;
  clear(): void;
  setStatus(status: PacketTraceServiceStatus): void;
  clearStatus(): void;
}

export interface PacketBootstrapToken {
  readonly lifecycle: number;
  readonly revision: number;
}

/** Prevents bootstrap snapshots from overwriting events observed after their request began. */
export class PacketBootstrapCoordinator {
  private lifecycle = 0;
  private historyRevision = 0;
  private statusRevision = 0;
  private active = true;

  constructor(private readonly sinks: PacketBootstrapSinks) {}

  captureHistory(): PacketBootstrapToken {
    return { lifecycle: this.lifecycle, revision: this.historyRevision };
  }

  captureStatus(): PacketBootstrapToken {
    return { lifecycle: this.lifecycle, revision: this.statusRevision };
  }

  applyHistory(token: PacketBootstrapToken, events: PacketTraceEvent[]): void {
    if (
      this.active &&
      token.lifecycle === this.lifecycle &&
      token.revision === this.historyRevision
    )
      this.sinks.setHistory(events);
  }

  applyStatus(token: PacketBootstrapToken, status: PacketTraceServiceStatus): void {
    if (this.active && token.lifecycle === this.lifecycle && token.revision === this.statusRevision)
      this.sinks.setStatus(status);
  }

  packet(event: PacketTraceEvent): void {
    if (!this.active) return;
    this.historyRevision += 1;
    this.sinks.append(event);
  }

  cleared(): void {
    if (!this.active) return;
    this.historyRevision += 1;
    this.sinks.clear();
  }

  status(status: PacketTraceServiceStatus): void {
    if (!this.active) return;
    this.statusRevision += 1;
    this.sinks.setStatus(status);
  }

  clearStatus(): void {
    if (!this.active) return;
    this.statusRevision += 1;
    this.sinks.clearStatus();
  }

  dispose(): void {
    if (!this.active) return;
    this.active = false;
    this.lifecycle += 1;
  }
}
