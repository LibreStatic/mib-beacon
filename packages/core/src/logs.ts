import type { EventBus } from './events';
import type { LogEntry, LogLevel, LogQuery, LogsAPI } from './api/engine-api';
import type { FileStore } from '@mibbeacon/transport';

const CREDENTIAL_VALUE =
  /(["']?)(community|authKey|privKey|password|token)\1(\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi;
const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && Object.hasOwn(LEVEL_WEIGHT, value);
}

function validateLogQuery(filter: LogQuery): void {
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) {
    throw new TypeError('Log query filter must be an object');
  }
  if (filter.level !== undefined && !isLogLevel(filter.level)) {
    throw new TypeError(`Unknown log level: ${String(filter.level)}`);
  }
  if (filter.minLevel !== undefined && !isLogLevel(filter.minLevel)) {
    throw new TypeError(`Unknown minimum log level: ${String(filter.minLevel)}`);
  }
  if (filter.since !== undefined && !Number.isFinite(filter.since)) {
    throw new TypeError('Log query since must be a finite timestamp');
  }
  if (filter.until !== undefined && !Number.isFinite(filter.until)) {
    throw new TypeError('Log query until must be a finite timestamp');
  }
  if (filter.search !== undefined && typeof filter.search !== 'string') {
    throw new TypeError('Log query search must be a string');
  }
  if (filter.limit !== undefined && (!Number.isSafeInteger(filter.limit) || filter.limit < 0)) {
    throw new TypeError('Log query limit must be a non-negative integer');
  }
}

function redactLogMessage(message: string): string {
  return message.replace(
    CREDENTIAL_VALUE,
    (_match, quote: string, key: string, separator: string) =>
      `${quote}${key}${quote}${separator}***`,
  );
}

export class LogService {
  private readonly entries: LogEntry[] = [];
  private sequence = 0;
  private level: LogLevel = 'debug';

  constructor(
    private readonly bus: EventBus,
    private readonly now: () => number = Date.now,
    private readonly capacity = 1_000,
    private readonly files?: FileStore,
  ) {}

  write(level: LogLevel, message: string): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.level]) return;
    const entry: LogEntry = {
      id: `log-${++this.sequence}`,
      timestamp: this.now(),
      level,
      message: redactLogMessage(message),
    };
    this.entries.push(entry);
    if (this.entries.length > this.capacity)
      this.entries.splice(0, this.entries.length - this.capacity);
    this.bus.emit({ channel: 'logs', kind: 'entry', payload: entry });
  }

  readonly api: LogsAPI = {
    query: async (filter: LogQuery = {}) => {
      validateLogQuery(filter);
      const search = filter.search?.trim().toLocaleLowerCase();
      const matches = this.entries.filter(
        (entry) =>
          (!filter.level || entry.level === filter.level) &&
          (!filter.minLevel || LEVEL_WEIGHT[entry.level] >= LEVEL_WEIGHT[filter.minLevel]) &&
          (filter.since === undefined || entry.timestamp >= filter.since) &&
          (filter.until === undefined || entry.timestamp <= filter.until) &&
          (!search || entry.message.toLocaleLowerCase().includes(search)),
      );
      if (filter.limit === undefined) return matches;
      const limit = filter.limit;
      return limit === 0 ? [] : matches.slice(-limit);
    },
    setLevel: async (level) => {
      if (!isLogLevel(level)) throw new Error(`Unknown log level: ${String(level)}`);
      this.level = level;
      this.bus.emit({ channel: 'logs', kind: 'level', payload: { level } });
    },
    export: async (path) => {
      if (!this.files) throw new Error('Log export requires a file store');
      const output =
        path ?? this.files.join(this.files.dataDir(), 'logs', `engine-${this.now()}.jsonl`);
      await this.files.ensureDir(this.files.join(output, '..'));
      const content = this.entries.map((entry) => JSON.stringify(entry)).join('\n');
      await this.files.writeText(output, content ? `${content}\n` : '');
      return { path: output, count: this.entries.length };
    },
  };
}
