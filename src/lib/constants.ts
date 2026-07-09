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

/** Timeout default per fetch API (ms).
 *  Allineato al networkTimeoutSeconds del Service Worker (10s) per evitare
 *  race condition: prima apiGetJson abortiva a 8s mentre il SW NetworkFirst
 *  aspettava 10s, impedendo il fallback su cache. */
export const API_TIMEOUT_MS = 10_000;

/** Deadline globale cumulativo per tutte le istanze OFF + retry (ms).
 *  Bumpato da 15s a 20s per permettere al retry con backoff di completare
 *  almeno 2 tentativi sulla prima istanza. */
export const API_GLOBAL_DEADLINE_MS = 20_000;

/** Numero di retry per la stessa istanza OFF in caso di errore transitorio
 *  (network failure, timeout, 5xx, 429). Risolve il caso tipico in cui
 *  OFF ha un blip transitorio e "riprovare dopo un secondo funziona". */
export const API_RETRY_PER_INSTANCE = 1;

/** Delay iniziale tra retry della stessa istanza (ms).
 *  Backoff lineare: attempt N → delay = API_RETRY_DELAY_MS × N. */
export const API_RETRY_DELAY_MS = 500;

/** Debounce ricerca OFF (ms) */
export const SEARCH_DEBOUNCE_MS = 500;

/** Auto-retry UI-level della ricerca OFF dopo fallimento transitorio (ms).
 *  Se la prima ricerca fallisce con NetworkError/TimeoutError, ritenta una
 *  volta sola dopo questo delay. Mostra toast "Riprovo la ricerca...". */
export const SEARCH_AUTO_RETRY_DELAY_MS = 800;

/** Suffissi italiani da provare quando una query parziale ritorna 0 risultati.
 *  OFF con search_simple=1 non supporta matching parziale né wildcard (`*`
 *  ritorna 0 risultati). Quindi se l'utente cerca "melanzan" (incompleto)
 *  riceve 0 risultati, anche se "melanzane" ne ha 417.
 *
 *  Ordinati per frequenza nei nomi dei prodotti alimentari italiani:
 *    'e' = plurale femminile (melanzane, patate, mele — il più comune)
 *    'i' = plurale maschile (pomodori, biscotti, salumi)
 *    'a' = singolare femminile (pasta, carota, cipolla)
 *    'o' = singolare maschile (pomodoro, formaggio, olio)
 */
export const PARTIAL_MATCH_SUFFIXES = ['e', 'i', 'a', 'o'] as const;

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
