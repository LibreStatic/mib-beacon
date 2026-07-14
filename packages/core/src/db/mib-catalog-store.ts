import type { FileStore, StorageAdapter } from '@mibbeacon/transport';
import type { MibStore } from '@mibbeacon/smi';
import { contentAddress } from './content-address';

export async function persistMibCatalog(
  db: StorageAdapter,
  files: FileStore,
  store: MibStore,
  now: () => number = Date.now,
): Promise<void> {
  const directory = files.join(files.dataDir(), 'mibs');
  const documents = store.userSourceDocuments().map((document) => ({
    ...document,
    contentKey: contentAddress(document.content),
  }));
  await files.ensureDir(directory);
  await Promise.all(
    documents.map(async ({ contentKey, content }) => {
      const path = files.join(directory, `${contentKey}.mib`);
      if (!(await files.exists(path))) await files.writeText(path, content);
    }),
  );
  db.transaction(() => {
    db.run('DELETE FROM mib_modules');
    for (const document of documents) {
      db.run(
        'INSERT INTO mib_modules (name, content, content_key, loaded_at) VALUES (?, ?, ?, ?)',
        [document.name, document.content, document.contentKey, now()],
      );
    }
  });
}
