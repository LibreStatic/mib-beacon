import type { StorageAdapter, Transport } from '@mibbeacon/transport';
import type {
  OperationBookmark,
  OperationBookmarkInput,
  WalkSnapshot,
  WalkSnapshotInput,
  WalkSnapshotSummary,
} from '../api/engine-api';

interface BookmarkRow {
  id: string;
  name: string;
  agent_id: string;
  oid: string;
  operation: OperationBookmark['operation'];
  created_at: number;
  updated_at: number;
}

interface SnapshotRow {
  id: string;
  name: string;
  agent_name: string;
  base_oid: string;
  file_path: string;
  result_count: number;
  created_at: number;
}

export class QueryArtifactStore {
  constructor(
    private readonly db: StorageAdapter,
    private readonly transport: Transport,
    private readonly now: () => number = Date.now,
  ) {}

  listBookmarks(): OperationBookmark[] {
    return this.db
      .all<BookmarkRow>('SELECT * FROM operation_bookmarks ORDER BY updated_at DESC')
      .map(bookmarkFromRow);
  }

  createBookmark(input: OperationBookmarkInput): OperationBookmark {
    const timestamp = this.now();
    const id = this.id('bookmark');
    if (!input.name.trim() || !input.agentId || !input.oid.trim()) {
      throw new Error('Bookmark name, saved agent, and OID are required');
    }
    this.db.run(
      `INSERT INTO operation_bookmarks
       (id, name, agent_id, oid, operation, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.name.trim(),
        input.agentId,
        input.oid.trim(),
        input.operation,
        timestamp,
        timestamp,
      ],
    );
    return {
      id,
      name: input.name.trim(),
      agentId: input.agentId,
      oid: input.oid.trim(),
      operation: input.operation,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  deleteBookmark(id: string): void {
    this.db.run('DELETE FROM operation_bookmarks WHERE id = ?', [id]);
  }

  listSnapshots(): WalkSnapshotSummary[] {
    return this.db
      .all<SnapshotRow>('SELECT * FROM walk_snapshots ORDER BY created_at DESC')
      .map(snapshotSummaryFromRow);
  }

  async createSnapshot(input: WalkSnapshotInput): Promise<WalkSnapshotSummary> {
    if (!input.name.trim() || !input.baseOid.trim()) {
      throw new Error('Snapshot name and base OID are required');
    }
    const id = this.id('snapshot');
    const directory = this.transport.files.join(this.transport.files.dataDir(), 'snapshots');
    const filePath = this.transport.files.join(directory, `${id}.json`);
    await this.transport.files.ensureDir(directory);
    try {
      await this.transport.files.writeText(filePath, JSON.stringify(input.results));
    } catch (cause) {
      try {
        if (await this.transport.files.exists(filePath))
          await this.transport.files.remove(filePath);
      } catch (rollbackCause) {
        throw new Error(`Snapshot create rollback outcome unknown: ${message(rollbackCause)}`, {
          cause,
        });
      }
      throw cause;
    }
    const timestamp = this.now();
    try {
      this.db.run(
        `INSERT INTO walk_snapshots
         (id, name, agent_name, base_oid, file_path, result_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.name.trim(),
          input.agentName.trim() || 'Unknown agent',
          input.baseOid.trim(),
          filePath,
          input.results.length,
          timestamp,
        ],
      );
    } catch (cause) {
      try {
        const inserted = this.db.get<SnapshotRow>('SELECT * FROM walk_snapshots WHERE id = ?', [
          id,
        ]);
        if (inserted) {
          try {
            this.db.run('DELETE FROM walk_snapshots WHERE id = ?', [id]);
          } catch (rollbackCause) {
            const remaining = this.db.get<SnapshotRow>(
              'SELECT * FROM walk_snapshots WHERE id = ?',
              [id],
            );
            if (remaining) throw rollbackCause;
          }
          if (this.db.get<SnapshotRow>('SELECT * FROM walk_snapshots WHERE id = ?', [id])) {
            throw new Error('Snapshot metadata compensation did not remove the inserted row');
          }
        }
        await this.transport.files.remove(filePath);
      } catch (rollbackCause) {
        throw new Error(`Snapshot create rollback outcome unknown: ${message(rollbackCause)}`, {
          cause,
        });
      }
      throw cause;
    }
    return {
      id,
      name: input.name.trim(),
      agentName: input.agentName.trim() || 'Unknown agent',
      baseOid: input.baseOid.trim(),
      resultCount: input.results.length,
      createdAt: timestamp,
    };
  }

  async getSnapshot(id: string): Promise<WalkSnapshot | null> {
    const row = this.db.get<SnapshotRow>('SELECT * FROM walk_snapshots WHERE id = ?', [id]);
    if (!row) return null;
    const results = JSON.parse(
      await this.transport.files.readText(row.file_path),
    ) as WalkSnapshot['results'];
    return { ...snapshotSummaryFromRow(row), results };
  }

  async deleteSnapshot(id: string): Promise<void> {
    const row = this.db.get<SnapshotRow>('SELECT * FROM walk_snapshots WHERE id = ?', [id]);
    if (!row) return;
    const fileExists = await this.transport.files.exists(row.file_path);
    const content = fileExists ? await this.transport.files.readText(row.file_path) : undefined;
    if (fileExists) {
      try {
        await this.transport.files.remove(row.file_path);
      } catch (cause) {
        try {
          if (!(await this.transport.files.exists(row.file_path)))
            await this.transport.files.writeText(row.file_path, content!);
        } catch (rollbackCause) {
          throw new Error(`Snapshot delete rollback outcome unknown: ${message(rollbackCause)}`, {
            cause,
          });
        }
        throw cause;
      }
    }
    try {
      this.db.run('DELETE FROM walk_snapshots WHERE id = ?', [id]);
    } catch (cause) {
      try {
        const remaining = this.db.get<SnapshotRow>('SELECT * FROM walk_snapshots WHERE id = ?', [
          id,
        ]);
        if (remaining && content !== undefined)
          await this.transport.files.writeText(row.file_path, content);
      } catch (rollbackCause) {
        throw new Error(`Snapshot delete rollback outcome unknown: ${message(rollbackCause)}`, {
          cause,
        });
      }
      throw cause;
    }
  }

  private id(prefix: string): string {
    return `${prefix}-${[...this.transport.crypto.randomBytes(12)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')}`;
  }
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function bookmarkFromRow(row: BookmarkRow): OperationBookmark {
  return {
    id: row.id,
    name: row.name,
    agentId: row.agent_id,
    oid: row.oid,
    operation: row.operation,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function snapshotSummaryFromRow(row: SnapshotRow): WalkSnapshotSummary {
  return {
    id: row.id,
    name: row.name,
    agentName: row.agent_name,
    baseOid: row.base_oid,
    resultCount: row.result_count,
    createdAt: row.created_at,
  };
}
