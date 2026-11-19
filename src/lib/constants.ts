// Costanti applicazione: chiavi storage, API base, timeout, config.

const APP_NAME = 'nutritrack';

/** Versione dello schema dati persistito. Un bump richiede una migrazione in migrations.ts. */
export const SCHEMA_VERSION = 2;

/** Database IndexedDB che contiene tutti i dati dell'app (documento, metadati, backup). */
export const IDB_NAME = APP_NAME;

/** Canale BroadcastChannel con cui le tab si avvisano a vicenda dei salvataggi. */
export const SYNC_CHANNEL = `${APP_NAME}-sync`;

/**
 * Chiavi localStorage usate dalle versioni precedenti (fino allo schema 2 compreso).
 * Al primo avvio i dati vengono migrati in IndexedDB e queste chiavi rimosse.
 */
export const LEGACY_STORAGE_KEYS = [`${APP_NAME}_data`, `${APP_NAME}_data_v1`] as const;
export const LEGACY_BACKUP_KEY = `${APP_NAME}_data_backup`;

/** Avviso quando l'uso stimato dello storage supera questa frazione della quota del browser. */
export const STORAGE_WARN_RATIO = 0.8;

/** Timeout default per fetch API (ms).
 *  Include un margine rispetto al fallback cache del Service Worker (10s):
 *  timeout simultanei potrebbero abortire prima che la cache venga restituita. */
export const API_TIMEOUT_MS = 11_000;

/** Deadline globale cumulativa per tutte le istanze OFF + retry (ms). */
export const API_GLOBAL_DEADLINE_MS = 20_000;

/** Numero di retry per la stessa istanza OFF in caso di errore transitorio. */
export const API_RETRY_PER_INSTANCE = 1;

/** Delay iniziale tra retry della stessa istanza (ms).
 *  Backoff lineare: attempt N → delay = API_RETRY_DELAY_MS × N. */
export const API_RETRY_DELAY_MS = 500;

/** Lunghezza minima query per avviare ricerca OFF */
export const SEARCH_MIN_QUERY = 2;

/** Page size default OFF search */
export const OFF_PAGE_SIZE = 30;

/** Istanze OFF da provare in ordine (fallback multi-istanza per resilienza) */
export const OFF_INSTANCES = [
  'https://it.openfoodfacts.org',
  'https://world.openfoodfacts.org',
  'https://fr.openfoodfacts.org',
  'https://es.openfoodfacts.org',
  'https://de.openfoodfacts.org',
] as const;

/** Limite guard per numero massimo entry diario (anti-abuso) */
export const MAX_DIARY_ENTRIES_PER_DAY = 200;
