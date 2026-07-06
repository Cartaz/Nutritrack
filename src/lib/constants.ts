// Costanti applicazione: chiavi storage, API base, timeout, config.

export const APP_NAME = 'nutritrack';

/** Versione schema dati (bump su breaking changes per migrazione) */
export const SCHEMA_VERSION = 1;

/** Chiave primaria localStorage */
export const STORAGE_KEY = `${APP_NAME}_data_v${SCHEMA_VERSION}`;

/** Chiave backup separato (snapshot precedente per recovery) */
export const BACKUP_KEY = `${APP_NAME}_data_backup`;

/** Soglia di utilizzo localStorage oltre la quale avvisare l'utente (4.5MB) */
export const STORAGE_WARN_BYTES = 4.5 * 1024 * 1024;

/** Timeout default per fetch API (ms) */
export const API_TIMEOUT_MS = 8_000;

/** Debounce ricerca OFF (ms) */
export const SEARCH_DEBOUNCE_MS = 500;

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

/** User-Agent identificativo per OFF (best practice loro docs) */
export const OFF_USER_AGENT = 'NutriTrack/1.0 (PWA)';

/** Timeout worker (ms) prima di fallback main-thread */
export const WORKER_TIMEOUT_MS = 500;

/** Limite guard per numero massimo entry diario (anti-abuso) */
export const MAX_DIARY_ENTRIES_PER_DAY = 200;

/** Limite massivo per strip dati non critici su QuotaExceededError */
export const MAX_FOODS_BEFORE_PRUNE = 500;
