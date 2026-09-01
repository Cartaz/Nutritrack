// API client tipizzato con AbortController + timeout + fallback multi-istanza OFF
// + retry automatico con backoff per errori transitori.
// Pattern 9 dello standard: apiGet<T>() con timeout 10s e supporto AbortSignal esterno.
//
// Fix B-8-1 (T8): deadline globale 20s (cumulative timeout era 5×8s=40s worst case).
// Fix B-8-3 (T8): HTTP 429 → continue su prossima istanza (era trattato come 4xx fatal).
// Fix B-8-4 (T8): dispatch su e.status invece di e.message.startsWith (fragile).
// Fix B-8-6 (T8): invia OFF_USER_AGENT header.
// Fix B-8-8 (T8): singolo listener su opts.signal (no accumulo).
// Fix B-8-9 (T8): normalizza page/page_size/count a number.
// Fix B-8-10 (T8): pre-check navigator.onLine.
// Fix B-8-12 (T8): clearTimeout dopo res.json() (body read protetto).
// Fix B-8-13 (T8): guard contro data null.
//
// Fix OFF-RETRY (issue #1): retry automatico con backoff per errori transitori.
//   Quando OFF ha un blip (5xx, 429, network failure, timeout), riprova la stessa
//   istanza dopo API_RETRY_DELAY_MS×attempt prima di passare alla successiva.
//   Risolve il caso tipico in cui "riprovare dopo un secondo funziona".

import type { OffProduct, OffSearchResponse } from '../types';
import {
  API_TIMEOUT_MS,
  API_GLOBAL_DEADLINE_MS,
  API_RETRY_PER_INSTANCE,
  API_RETRY_DELAY_MS,
  OFF_INSTANCES,
  OFF_PAGE_SIZE,
} from './constants';

// Fix MEDIUM bug: OFF_USER_AGENT rimosso perché `User-Agent` è un forbidden header nei browser
// (silently stripped per fingerprinting protection). Era dead code. Se in futuro vorremo
// identificarci presso OFF, dovremo usare un header custom (es. `X-User-Agent`) o un proxy.

export class ApiError extends Error {
  status?: number;
  override name: string;
  constructor(message: string, name: string, status?: number) {
    super(message);
    this.name = name;
    this.status = status;
  }
}

/** Sleep non bloccante che rispetta l'AbortSignal esterno.
 *  Se il signal si abortisce durante l'attesa, la promise rejecta con AbortError. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ApiError('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ApiError('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Classifica un errore come "transitorio" (meritevole di retry):
 *  - NetworkError (TypeError di fetch: connection refused, DNS, ecc.)
 *  - TimeoutError (abort dal timeout interno)
 *  - HTTP 5xx e 429 (server error / rate limit)
 *  Non transitori: 4xx (eccetto 429) — errore del client, retry inutile. */
function isTransientError(e: unknown): boolean {
  if (e instanceof ApiError) {
    if (e.name === 'NetworkError' || e.name === 'TimeoutError') return true;
    if (e.status !== undefined && (e.status >= 500 || e.status === 429)) return true;
    return false;
  }
  const err = e as { name?: string };
  if (err?.name === 'AbortError' || err?.name === 'TypeError') return true;
  return false;
}

/** Fetch con timeout interno + propagazione AbortSignal esterno.
 *  Fix B11: per-istanza AbortController — se la prima istanza hanga (TCP black hole),
 *  il timeout abortisce solo quella istanza e si passa alla successiva, non tutte.
 *  Fix B-8-1: deadline globale cumulativa previene 40s di attesa se tutte le istanze hangano.
 *  Fix OFF-RETRY: retry con backoff sulla stessa istanza per errori transitori. */
export async function apiGetJson<T>(
  buildUrl: (base: string) => string,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? API_TIMEOUT_MS;

  // Signal esterno: se già aborted, throw subito
  if (opts.signal?.aborted) {
    throw new ApiError('Aborted', 'AbortError');
  }

  // Fix B-8-10: pre-check navigator.onLine per feedback immediato.
  // Questo è l'unico caso in cui il messaggio "Sei offline" è accurato.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ApiError('Sei offline. Verifica la connessione e riprova.', 'OfflineError');
  }

  // Fix B-8-1: deadline globale
  const globalDeadline = Date.now() + API_GLOBAL_DEADLINE_MS;

  // Fix B-8-8: singolo listener su opts.signal che abortisce il controller corrente
  let currentController: AbortController | null = null;
  const onAbortExternal = () => currentController?.abort();
  if (opts.signal) {
    opts.signal.addEventListener('abort', onAbortExternal, { once: true });
  }

  let lastError: Error | null = null;

  try {
    for (const base of OFF_INSTANCES) {
      // Fix OFF-RETRY: loop di retry sulla stessa istanza per errori transitori.
      // maxAttempts = 1 + API_RETRY_PER_INSTANCE (es. 2 tentativi totali se retry=1).
      const maxAttempts = 1 + API_RETRY_PER_INSTANCE;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const remaining = globalDeadline - Date.now();
        if (remaining < 500) {
          // Deadline globale quasi scaduto: esci
          lastError =
            lastError ?? new ApiError('Tutte le istanze OFF non disponibili (deadline globale)', 'TimeoutError');
          break;
        }
        const instanceTimeout = Math.min(timeoutMs, remaining);

        // Fix B11: nuovo AbortController per ogni tentativo
        currentController = new AbortController();
        const timeoutId = setTimeout(() => currentController?.abort(), instanceTimeout);

        const url = buildUrl(base);
        try {
          const res = await fetch(url, {
            headers: {
              Accept: 'application/json',
              // Fix MEDIUM bug: rimosso 'User-Agent' header — è forbidden dai browser (silently stripped).
              // Era dead code. Vedere nota nel commento in cima al file.
            },
            signal: currentController.signal,
          });
          // 5xx: prova prossima istanza (o retry sulla stessa)
          // Fix B-8-3: 429 (rate limit) → retry su stessa istanza poi prossima
          if ((res.status >= 500 && res.status < 600) || res.status === 429) {
            clearTimeout(timeoutId);
            lastError = new ApiError(`Server OFF ${base} non disponibile (${res.status})`, 'ApiError', res.status);
            // Fix OFF-RETRY: se ci sono ancora tentativi disponibili, aspetta e ritenta
            if (attempt < maxAttempts - 1) {
              const delay = API_RETRY_DELAY_MS * (attempt + 1);
              // Rispetta il deadline globale
              if (Date.now() + delay < globalDeadline) {
                await sleep(delay, opts.signal);
                continue;
              }
              break;
            }
            break; // tentativi esauriti per questa istanza, passa alla prossima
          }
          // 4xx reale (404, 400): ritorna errore
          if (!res.ok) {
            clearTimeout(timeoutId);
            const ct = res.headers.get('content-type') || '';
            if (!ct.includes('application/json')) {
              lastError = new ApiError(`Risposta non valida da ${base}`, 'ApiError', res.status);
              // 4xx non-JSON: probabilmente pagina HTML di errore — prova prossima istanza
              break;
            }
            throw new ApiError(`Errore ricerca: ${res.status}`, 'ApiError', res.status);
          }
          const ct = res.headers.get('content-type') || '';
          if (!ct.includes('application/json')) {
            clearTimeout(timeoutId);
            lastError = new ApiError(`Risposta non JSON da ${base}`, 'ApiError');
            // Non-transitorio (risposta valida ma content-type sbagliato): passa alla prossima
            break;
          }
          // Fix B-8-12: leggi body PRIMA di clearTimeout (body read protetto da timeout)
          const json = (await res.json()) as T;
          clearTimeout(timeoutId);
          return json;
        } catch (e: unknown) {
          clearTimeout(timeoutId);
          // Fix B-8-4: dispatch su status invece di message.startsWith
          if (
            e instanceof ApiError &&
            e.status !== undefined &&
            e.status >= 400 &&
            e.status < 500 &&
            e.status !== 429
          ) {
            throw e;
          }
          const err = e as { name?: string };
          if (err?.name === 'AbortError') {
            // Fix B11: distingui tra timeout interno (questa istanza) e abort esterno
            if (opts.signal?.aborted) {
              // Abort esterno: propaga
              throw new ApiError('Aborted', 'AbortError');
            }
            // Timeout interno su QUESTO tentativo
            lastError = new ApiError(`Timeout su ${base}`, 'TimeoutError');
            // Fix OFF-RETRY: se ci sono tentativi disponibili, aspetta e ritenta
            if (attempt < maxAttempts - 1) {
              const delay = API_RETRY_DELAY_MS * (attempt + 1);
              if (Date.now() + delay < globalDeadline) {
                try {
                  await sleep(delay, opts.signal);
                  continue;
                } catch {
                  // sleep abortita da signal esterno: propaga
                  throw new ApiError('Aborted', 'AbortError');
                }
              }
              break;
            }
            break; // tentativi esauriti, passa alla prossima istanza
          }
          if (err?.name === 'TypeError') {
            // network failure: retry sulla stessa istanza poi passa alla prossima
            lastError = new ApiError('Network', 'NetworkError');
            if (attempt < maxAttempts - 1) {
              const delay = API_RETRY_DELAY_MS * (attempt + 1);
              if (Date.now() + delay < globalDeadline) {
                try {
                  await sleep(delay, opts.signal);
                  continue;
                } catch {
                  throw new ApiError('Aborted', 'AbortError');
                }
              }
              break;
            }
            break;
          }
          // Errore non classificato: registralo e passa alla prossima istanza
          lastError = e instanceof Error ? e : new Error(String(e));
          break;
        }
      }
    }
  } finally {
    // Fix B-8-8: rimuovi sempre il listener esterno
    if (opts.signal) {
      opts.signal.removeEventListener('abort', onAbortExternal);
    }
  }

  throw lastError ?? new ApiError('Tutte le istanze OFF non disponibili', 'ApiError');
}

// ============ Endpoint wrappers ============

export interface SearchOffOpts {
  page?: number;
  pageSize?: number;
  italianOnly?: boolean;
  signal?: AbortSignal;
}

// One semantic search action maps to one remote request.
// OFF documents a search rate limit of 10 requests/minute/IP; keep one slot of client-side margin.
const SEARCH_WINDOW_MS = 60_000;
const SEARCH_WINDOW_MAX = 9;
const _searchTimestamps: number[] = [];

function acquireSearchSlot(now = Date.now()): void {
  while (_searchTimestamps.length > 0 && now - _searchTimestamps[0] >= SEARCH_WINDOW_MS) {
    _searchTimestamps.shift();
  }
  if (_searchTimestamps.length >= SEARCH_WINDOW_MAX) {
    throw new ApiError('Troppe ricerche ravvicinate. Attendi qualche secondo e riprova.', 'RateLimitError', 429);
  }
  _searchTimestamps.push(now);
}

async function searchGetJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw new ApiError('Aborted', 'AbortError');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ApiError('Sei offline. Verifica la connessione e riprova.', 'OfflineError');
  }

  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (response.status === 429) {
      throw new ApiError('Limite richieste Open Food Facts raggiunto', 'RateLimitError', 429);
    }
    if (!response.ok) {
      throw new ApiError(`Errore Open Food Facts: ${response.status}`, 'ApiError', response.status);
    }
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new ApiError('Risposta Open Food Facts non JSON', 'ApiError');
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const err = error as { name?: string };
    if (err?.name === 'AbortError') {
      if (signal?.aborted) throw new ApiError('Aborted', 'AbortError');
      throw new ApiError('Timeout Open Food Facts', 'TimeoutError');
    }
    if (err?.name === 'TypeError') throw new ApiError('Network', 'NetworkError');
    throw error;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Cerca prodotti su Open Food Facts. Una chiamata corrisponde a una sola richiesta HTTP. */
export async function searchOff(
  query: string,
  opts: SearchOffOpts = {},
): Promise<{ products: OffProduct[]; count: number; page: number; pageSize: number }> {
  const normalizedQuery = query.trim();
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? OFF_PAGE_SIZE;
  if (!normalizedQuery) return { products: [], count: 0, page, pageSize };

  acquireSearchSlot();
  const params = new URLSearchParams({
    search_terms: normalizedQuery,
    search_simple: '1',
    action: 'process',
    json: '1',
    page: String(page),
    page_size: String(pageSize),
    sort_by: 'unique_scans_n',
  });
  if (opts.italianOnly) {
    params.set('tagtype_0', 'countries');
    params.set('tag_contains_0', 'contains');
    params.set('tag_0', 'italia');
  }

  const base = OFF_INSTANCES[0];
  const data = await searchGetJson<OffSearchResponse | null>(`${base}/cgi/search.pl?${params.toString()}`, opts.signal);
  if (!data || typeof data !== 'object') return { products: [], count: 0, page, pageSize };

  const normalizeNum = (value: unknown, fallback: number): number => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
  };

  return {
    products: Array.isArray(data.products) ? data.products : [],
    count: normalizeNum(data.count, 0),
    page: normalizeNum(data.page, page),
    pageSize: normalizeNum(data.page_size, pageSize),
  };
}

// ============ Search compatibility ============

/** Compatibility wrapper: automatic suffix expansion was removed to preserve the OFF rate-limit contract. */
export interface SearchOffResult {
  products: OffProduct[];
  count: number;
  page: number;
  pageSize: number;
  effectiveQuery: string;
}

export async function searchOffWithPartialMatch(query: string, opts: SearchOffOpts = {}): Promise<SearchOffResult> {
  const result = await searchOff(query, opts);
  return { ...result, effectiveQuery: query.trim() };
}

/** Test-only reset for deterministic rate-limit tests. */
export function __resetSearchLimiterForTesting(): void {
  _searchTimestamps.length = 0;
}

/** Recupera un prodotto per barcode.
 *  Fix MEDIUM bug: distingue 404 (prodotto non trovato, ritorna null) da altri errori
 *  (5xx, network, timeout) che ora propagano come ApiError per permettere alla UI di
 *  mostrare un messaggio appropriato invece del fuorviante "Nessun prodotto trovato". */
export async function getOffByBarcode(barcode: string, signal?: AbortSignal): Promise<OffProduct | null> {
  try {
    const data = await apiGetJson<{ product?: OffProduct } | null>(
      (base) => `${base}/api/v2/product/${encodeURIComponent(barcode)}.json`,
      { signal },
    );
    if (!data || typeof data !== 'object') return null;
    return data.product ?? null;
  } catch (e) {
    // Fix MEDIUM bug: 404 = prodotto non trovato, ritorna null silenziosamente.
    // Altri errori (5xx, network, timeout) → propaga come ApiError per feedback UI corretto.
    if (e instanceof ApiError && e.status === 404) {
      return null;
    }
    // Per altri errori, logga e rilancia così il caller può distinguere "non trovato" da "servizio down"
    console.warn('[api] getOffByBarcode error (non-404)', e);
    throw e;
  }
}

// Esportato per i test
export { isTransientError };
