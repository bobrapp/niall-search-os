import { initialBackup, type Backup } from './data';

export interface WorkspaceStore {
  load(): Promise<{ data: Backup; revision: number }>;
  save(data: Backup, expectedRevision: number): Promise<number>;
}

export class WorkspaceConflict extends Error {}

export interface SyncProvider {
  reconcile(local: Backup): Promise<Backup>;
}

function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('niall-search-os', 2);
    request.onupgradeneeded = event => {
      if (event.oldVersion === 0) request.result.createObjectStore('workspace');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const indexedWorkspace: WorkspaceStore = {
  async load() {
    const db = await database();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction('workspace');
        const store = transaction.objectStore('workspace');
        const read = store.get('current'), revision = store.get('revision');
        transaction.oncomplete = () => resolve({ data: read.result ?? initialBackup(), revision: revision.result ?? 0 });
        transaction.onabort = transaction.onerror = () => reject(transaction.error);
      });
    } finally { db.close(); }
  },
  async save(data, expectedRevision) {
    const db = await database();
    try {
      return await new Promise<number>((resolve, reject) => {
        const transaction = db.transaction('workspace', 'readwrite');
        const store = transaction.objectStore('workspace');
        const revision = store.get('revision');
        let conflict = false;
        revision.onsuccess = () => {
          if ((revision.result ?? 0) !== expectedRevision) {
            conflict = true;
            transaction.abort();
            return;
          }
          store.put(data, 'current');
          store.put(expectedRevision + 1, 'revision');
        };
        transaction.oncomplete = () => resolve(expectedRevision + 1);
        transaction.onabort = transaction.onerror = () => reject(conflict ? new WorkspaceConflict() : transaction.error);
      });
    } finally { db.close(); }
  },
};
