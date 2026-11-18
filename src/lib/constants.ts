// Costanti applicazione: chiavi storage, API base, timeout, config.

const APP_NAME = 'nutritrack';

/** Versione dello schema dati persistito. Un bump richiede una migrazione in migrations.ts. */
export const SCHEMA_VERSION = 2;

/**
 * Chiave primaria localStorage. È fissa: la versione dello schema sta dentro il documento
 * (`version`), così un bump di SCHEMA_VERSION migra i dati invece di leggere una chiave vuota.
 */
export const STORAGE_KEY = `${APP_NAME}_data`;

/** Chiavi primarie usate da versioni precedenti, lette una volta e poi rimosse. */
export const LEGACY_STORAGE_KEYS = [`${APP_NAME}_data_v1`] as const;

/** Chiave backup separato (snapshot precedente per recovery) */
export const BACKUP_KEY = `${APP_NAME}_data_backup`;

/** Prefisso comune a tutte le chiavi dell'app: serve a misurare l'uso reale dello storage. */
export const STORAGE_KEY_PREFIX = `${APP_NAME}_`;

/**
 * Soglia di avviso sull'uso reale di localStorage (primario + backup), in caratteri.
 * I browser concedono circa 5 milioni di caratteri per origine: avvisiamo all'80%.
 */
export const STORAGE_WARN_CHARS = 4_000_000;

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
