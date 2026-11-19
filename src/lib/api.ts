// Client Open Food Facts (OFF).
//
// - apiGetJson(): lookup per barcode. Timeout per tentativo (API_TIMEOUT_MS), deadline
//   globale (API_GLOBAL_DEADLINE_MS), fallback su più istanze OFF e un retry con backoff
//   lineare sulla stessa istanza per errori transitori (rete, timeout, 5xx, 429).
// - searchOff(): ricerca testuale. Una azione utente = una sola richiesta, nessun
//   fallback/retry, e un limitatore client-side per rispettare il rate limit di OFF.
// Le risposte in cache del service worker restano raggiungibili anche offline:
// lo stato offline viene dedotto solo dopo un fetch fallito.
// Nota: `User-Agent` è un header vietato nei browser, quindi non viene inviato.

import type { OffProduct, OffSearchResponse } from '../types';
import {
  API_TIMEOUT_MS,
  API_GLOBAL_DEADLINE_MS,
  API_RETRY_PER_INSTANCE,
  API_RETRY_DELAY_MS,
  OFF_INSTANCES,
  OFF_PAGE_SIZE,
} from './constants';

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

/** Fetch con timeout interno + propagazione AbortSignal esterno.
 *  per-istanza AbortController — se la prima istanza hanga (TCP black hole),
 *  il timeout abortisce solo quella istanza e si passa alla successiva, non tutte.
 *  deadline globale cumulativa previene 40s di attesa se tutte le istanze hangano.
 *  retry con backoff sulla stessa istanza per errori transitori. */
export async function apiGetJson<T>(
  buildUrl: (base: string) => string,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? API_TIMEOUT_MS;

  // Signal esterno: se già aborted, throw subito
  if (opts.signal?.aborted) {
    throw new ApiError('Aborted', 'AbortError');
  }

  // Always let fetch reach the service worker: navigator.onLine cannot tell us
  // whether a cached response exists. Classify offline only after a failed fetch.

  // deadline globale
  const globalDeadline = Date.now() + API_GLOBAL_DEADLINE_MS;

  // singolo listener su opts.signal che abortisce il controller corrente
  let currentController: AbortController | null = null;
  const onAbortExternal = () => currentController?.abort();
  if (opts.signal) {
    opts.signal.addEventListener('abort', onAbortExternal, { once: true });
  }

  let lastError: Error | null = null;

  try {
    for (const base of OFF_INSTANCES) {
      // loop di retry sulla stessa istanza per errori transitori.
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

        // nuovo AbortController per ogni tentativo
        currentController = new AbortController();
        const timeoutId = setTimeout(() => currentController?.abort(), instanceTimeout);

        const url = buildUrl(base);
        try {
          const res = await fetch(url, {
            headers: { Accept: 'application/json' },
            signal: currentController.signal,
          });
          if (!res.ok && navigator.onLine === false) {
            throw new ApiError('Sei offline e il prodotto non è in cache.', 'OfflineError');
          }
          // 5xx: prova prossima istanza (o retry sulla stessa)
          // 429 (rate limit) → retry su stessa istanza poi prossima
          if ((res.status >= 500 && res.status < 600) || res.status === 429) {
            clearTimeout(timeoutId);
            lastError = new ApiError(`Server OFF ${base} non disponibile (${res.status})`, 'ApiError', res.status);
            // se ci sono ancora tentativi disponibili, aspetta e ritenta
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
          // leggi body PRIMA di clearTimeout (body read protetto da timeout)
          const json = (await res.json()) as T;
          clearTimeout(timeoutId);
          return json;
        } catch (e: unknown) {
          clearTimeout(timeoutId);
          if (e instanceof ApiError && e.name === 'OfflineError') throw e;
          // dispatch su status invece di message.startsWith
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
            // distingui tra timeout interno (questa istanza) e abort esterno
            if (opts.signal?.aborted) {
              // Abort esterno: propaga
              throw new ApiError('Aborted', 'AbortError');
            }
            // Timeout interno su QUESTO tentativo
            lastError = new ApiError(`Timeout su ${base}`, 'TimeoutError');
            // se ci sono tentativi disponibili, aspetta e ritenta
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
            if (navigator.onLine === false) {
              throw new ApiError('Sei offline e il prodotto non è in cache.', 'OfflineError');
            }
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
    // rimuovi sempre il listener esterno
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

  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok && navigator.onLine === false) {
      throw new ApiError('Sei offline e la ricerca non è in cache.', 'OfflineError');
    }
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
    if (err?.name === 'TypeError') {
      if (navigator.onLine === false) throw new ApiError('Sei offline e la ricerca non è in cache.', 'OfflineError');
      throw new ApiError('Network', 'NetworkError');
    }
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

  if (opts.signal?.aborted) throw new ApiError('Aborted', 'AbortError');
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

/** Test-only reset for deterministic rate-limit tests. */
export function __resetSearchLimiterForTesting(): void {
  _searchTimestamps.length = 0;
}

/** Recupera un prodotto per barcode.
 *  distingue 404 (prodotto non trovato, ritorna null) da altri errori
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
    // 404 = prodotto non trovato, ritorna null silenziosamente.
    // Altri errori (5xx, network, timeout) → propaga come ApiError per feedback UI corretto.
    if (e instanceof ApiError && e.status === 404) {
      return null;
    }
    // Per altri errori, logga e rilancia così il caller può distinguere "non trovato" da "servizio down"
    console.warn('[api] getOffByBarcode error (non-404)', e);
    throw e;
  }
}
