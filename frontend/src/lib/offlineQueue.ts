import { authHeader } from './auth-token';

export interface OfflineOperation {
  id: string;
  resourceKey: string;
  type: 'shipment-milestone' | 'investment-draft';
  method: 'POST' | 'PATCH';
  endpoint: string;
  body: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  retryCount: number;
}

const DB_NAME = 'agrifi-offline';
const STORE_NAME = 'operations';
const DB_VERSION = 1;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB is unavailable'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('resourceKey', 'resourceKey', { unique: false });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open offline queue'));
  });
}

async function transaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T> | IDBRequest<T[]>,
): Promise<T | T[]> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, mode);
    const request = action(tx.objectStore(STORE_NAME));
    request.onerror = () => reject(request.error ?? new Error('Offline queue transaction failed'));
    tx.oncomplete = () => {
      database.close();
      resolve(request.result);
    };
    tx.onabort = () => {
      database.close();
      reject(tx.error ?? new Error('Offline queue transaction aborted'));
    };
    tx.onerror = () => {
      database.close();
      reject(tx.error ?? new Error('Offline queue transaction failed'));
    };
  });
}

export async function getOfflineOperations(): Promise<OfflineOperation[]> {
  const result = await transaction<OfflineOperation>('readonly', (store) => store.getAll());
  return result as OfflineOperation[];
}

export async function enqueueOfflineOperation(
  operation: Omit<OfflineOperation, 'id' | 'createdAt' | 'updatedAt' | 'retryCount'>,
): Promise<{ operation: OfflineOperation; conflict: boolean }> {
  const database = await openDatabase();
  const existing = await new Promise<OfflineOperation | undefined>((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).index('resourceKey').get(operation.resourceKey);
    request.onsuccess = () => resolve(request.result as OfflineOperation | undefined);
    request.onerror = () => reject(request.error ?? new Error('Unable to read offline queue'));
    tx.onabort = () => reject(tx.error ?? new Error('Unable to read offline queue'));
  });

  const conflict = Boolean(existing);
  if (conflict && typeof window !== 'undefined' && !window.confirm('A newer version of this offline transaction exists. Replace it with your latest edits?')) {
    database.close();
    return { operation: existing!, conflict: true };
  }

  const now = Date.now();
  const queued: OfflineOperation = {
    ...operation,
    id: existing?.id ?? crypto.randomUUID(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    retryCount: existing?.retryCount ?? 0,
  };

  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(queued);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('Unable to enqueue offline operation'));
    tx.onerror = () => reject(tx.error ?? new Error('Unable to enqueue offline operation'));
  });

  database.close();
  return { operation: queued, conflict };
}

export async function deleteOfflineOperation(id: string): Promise<void> {
  await transaction('readwrite', (store) => store.delete(id));
}

export async function markOfflineOperationRetry(id: string): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(id);
    request.onsuccess = () => {
      const operation = request.result as OfflineOperation | undefined;
      if (operation) {
        operation.retryCount += 1;
        store.put(operation);
      }
    };
    tx.oncomplete = () => {
      database.close();
      resolve();
    };
    tx.onerror = () => {
      database.close();
      reject(tx.error ?? new Error('Unable to update offline queue'));
    };
  });
}

export async function flushOfflineOperations(
  fetcher: (operation: OfflineOperation) => Promise<Response> = (operation) => fetch(operation.endpoint, {
    method: operation.method,
    headers: { ...authHeader(), 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(operation.body),
  }),
): Promise<{ synced: number; failed: number }> {
  if (!navigator.onLine) return { synced: 0, failed: 0 };

  const operations = await getOfflineOperations();
  let synced = 0;
  let failed = 0;

  for (const operation of operations) {
    if (operation.type === 'investment-draft') {
      continue;
    }

    try {
      const response = await fetcher(operation);
      if (!response.ok) throw new Error(`Sync failed with status ${response.status}`);
      await deleteOfflineOperation(operation.id);
      synced += 1;
    } catch {
      await markOfflineOperationRetry(operation.id);
      failed += 1;
    }
  }

  return { synced, failed };
}

export async function registerBackgroundSync(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
  const syncRegistration = registration as ServiceWorkerRegistration & {
    sync?: { register(tag: string): Promise<void> };
  };
  await syncRegistration.sync?.register('agrifi-offline-sync');
}
