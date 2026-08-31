// Ownership unico della cancellazione dei dati locali persistenti e delle cache runtime.

import { BACKUP_KEY, STORAGE_KEY } from './constants';

const USER_DATA_CACHE_NAMES = [
  'nutritrack-off-api',
  'nutritrack-off-img',
  'nutritrack-img',
] as const;

/** Cancella payload principale + backup localStorage. Idempotente. */
export function clearLocalStorageData(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage non disponibile: niente altro da fare */
  }
  try {
    localStorage.removeItem(BACKUP_KEY);
  } catch {
    /* storage non disponibile: niente altro da fare */
  }
}

/**
 * Cancella le cache runtime che possono contenere risposte/immagini derivanti
 * dall'attività dell'utente. Non rimuove la precache dell'app shell.
 */
export async function clearRuntimeDataCaches(): Promise<void> {
  if (typeof caches === 'undefined') return;
  await Promise.all(
    USER_DATA_CACHE_NAMES.map(async (name) => {
      try {
        await caches.delete(name);
      } catch {
        // Il reset dei dati non deve fallire perché CacheStorage è indisponibile.
      }
    }),
  );
}

/** Cancellazione completa dei dati utente locali. */
export function clearAllLocalUserData(): void {
  clearLocalStorageData();
  void clearRuntimeDataCaches();
}
