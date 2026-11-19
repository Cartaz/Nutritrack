// Accesso minimo a IndexedDB: un database, un object store chiave → stringa.
//
// Le letture e scritture che devono essere coerenti tra loro passano da `transact`, che
// esegue lettura, decisione e scrittura nella stessa transazione readwrite: IndexedDB
// serializza le transazioni sullo stesso store, quindi due tab non possono intrecciarsi.

import { IDB_NAME } from './constants';

const STORE = 'kv';
const DB_VERSION = 1;

let _dbPromise: Promise<IDBDatabase> | null = null;

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

export function openDb(): Promise<IDBDatabase> {
  if (_dbPromise) return _dbPromise;
  const promise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB non disponibile'));
      return;
    }
    const request = indexedDB.open(IDB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      const db = request.result;
      // Un'altra tab con una versione più nuova del DB chiede l'upgrade: chiudiamo per non bloccarla.
      db.onversionchange = () => {
        db.close();
        _dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    request.onblocked = () => reject(new Error("IndexedDB bloccato da un'altra scheda"));
  });
  _dbPromise = promise;
  promise.catch(() => {
    if (_dbPromise === promise) _dbPromise = null;
  });
  return promise;
}

export async function idbGet(key: string): Promise<string | undefined> {
  const db = await openDb();
  const value = await requestToPromise(db.transaction(STORE, 'readonly').objectStore(STORE).get(key));
  return typeof value === 'string' ? value : undefined;
}

/** Scritture da applicare: stringa = put, null = delete. Chiavi assenti restano invariate. */
export type IdbWrites = Record<string, string | null>;

/**
 * Transazione readwrite atomica: legge `keys`, chiama `decide` (sincrona) con i valori correnti,
 * applica le scritture restituite e risolve con `result` solo dopo il commit.
 */
export async function transact<T>(
  keys: readonly string[],
  decide: (values: ReadonlyMap<string, string | undefined>) => { writes: IdbWrites; result: T },
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const values = new Map<string, string | undefined>();
    let result: T;
    let pending = keys.length;
    let decided = false;

    const runDecision = (): void => {
      decided = true;
      try {
        const decision = decide(values);
        result = decision.result;
        for (const [key, value] of Object.entries(decision.writes)) {
          if (value === null) store.delete(key);
          else store.put(value, key);
        }
      } catch (error) {
        tx.abort();
        reject(error);
      }
    };

    for (const key of keys) {
      const request = store.get(key);
      request.onsuccess = () => {
        values.set(key, typeof request.result === 'string' ? request.result : undefined);
        pending -= 1;
        if (pending === 0) runDecision();
      };
    }
    if (keys.length === 0) runDecision();

    tx.oncomplete = () => {
      if (decided) resolve(result);
    };
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/** Solo test: chiude la connessione e cancella il database. */
export async function __deleteDatabaseForTesting(): Promise<void> {
  const pending = _dbPromise;
  _dbPromise = null;
  if (pending) {
    try {
      (await pending).close();
    } catch {
      /* già chiuso o mai aperto */
    }
  }
  if (typeof indexedDB === 'undefined') return;
  await requestToPromise(indexedDB.deleteDatabase(IDB_NAME) as IDBRequest<unknown>);
}
