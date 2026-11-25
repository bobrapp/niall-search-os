import { initialBackup, type Backup } from './data';

export interface WorkspaceStore {
  load(): Promise<Backup>;
  save(data: Backup): Promise<void>;
}

export interface SyncProvider {
  reconcile(local: Backup): Promise<Backup>;
}

function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('niall-search-os', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('workspace');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const indexedWorkspace: WorkspaceStore = {
  async load() {
    const db = await database();
    try {
      return await new Promise<Backup>((resolve, reject) => {
        const read = db.transaction('workspace').objectStore('workspace').get('current');
        read.onsuccess = () => resolve(read.result ?? initialBackup());
        read.onerror = () => reject(read.error);
      });
    } finally { db.close(); }
  },
  async save(data) {
    const db = await database();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('workspace', 'readwrite');
        transaction.objectStore('workspace').put(data, 'current');
        transaction.oncomplete = () => resolve();
        transaction.onabort = transaction.onerror = () => reject(transaction.error);
      });
    } finally { db.close(); }
  },
};
