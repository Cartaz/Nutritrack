// API client Open Food Facts con timeout, abort e resilienza differenziata per tipo di endpoint.
// I lookup puntuali possono usare fallback multi-istanza; le ricerche testuali sono una singola
// richiesta remota per azione utente, in accordo con le regole di rate limiting OFF.

import type { OffProduct, OffSearchResponse } from '../types';
import {
  API_GLOBAL_DEADLINE_MS,
  API_RETRY_DELAY_MS,
  API_RETRY_PER_INSTANCE,
  API_TIMEOUT_MS,
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

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ApiError('Aborted', 'AbortError'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ApiError('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function isTransientError(error: unknown): boolean {
  if (error instanceof ApiError) {
    if (error.name === 'NetworkError' || error.name === 'TimeoutError') return true;
    return error.status !== undefined && (error.status >= 500 || error.status === 429);
  }
  const err = error as { name?: string };
  return err?.name === 'AbortError' || err?.name === 'TypeError';
}

interface ApiGetOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Endpoint da interrogare. Default: tutte le istanze note. */
  instances?: readonly string[];
  /** Retry per singola istanza. Default: API_RETRY_PER_INSTANCE. */
  retryPerInstance?: number;
  /** Deadline cumulativa. */
  globalDeadlineMs?: number;
  /** Su 429 non provare altri host: utile per non aggirare rate limit di ricerca. */
  stopOnRateLimit?: boolean;
}

/** Fetch JSON resiliente. Le policy di fallback sono parametri del chiamante, non hardcoded. */
export async function apiGetJson<T>(buildUrl: (base: string) => string, opts: ApiGetOptions = {}): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? API_TIMEOUT_MS;
  const instances = opts.instances ?? OFF_INSTANCES;
  const retryPerInstance = opts.retryPerInstance ?? API_RETRY_PER_INSTANCE;
  const globalDeadline = Date.now() + (opts.globalDeadlineMs ?? API_GLOBAL_DEADLINE_MS);

  if (opts.signal?.aborted) throw new ApiError('Aborted', 'AbortError');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ApiError('Sei offline. Verifica la connessione e riprova.', 'OfflineError');
  }

  let currentController: AbortController | null = null;
  const onAbortExternal = () => currentController?.abort();
  opts.signal?.addEventListener('abort', onAbortExternal, { once: true });
  let lastError: Error | null = null;

  try {
    for (const base of instances) {
      const maxAttempts = 1 + Math.max(0, retryPerInstance);
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const remaining = globalDeadline - Date.now();
        if (remaining < 500) {
          lastError = lastError ?? new ApiError('Deadline globale Open Food Facts superata', 'TimeoutError');
          break;
        }

        currentController = new AbortController();
        const timeoutId = setTimeout(() => currentController?.abort(), Math.min(timeoutMs, remaining));
        try {
          const response = await fetch(buildUrl(base), {
            headers: { Accept: 'application/json' },
            signal: currentController.signal,
          });

          if (response.status === 429) {
            clearTimeout(timeoutId);
            const rateError = new ApiError('Limite richieste Open Food Facts raggiunto', 'RateLimitError', 429);
            if (opts.stopOnRateLimit) throw rateError;
            lastError = rateError;
            if (attempt < maxAttempts - 1) {
              const delay = API_RETRY_DELAY_MS * (attempt + 1);
              if (Date.now() + delay < globalDeadline) {
                await sleep(delay, opts.signal);
                continue;
              }
            }
            break;
          }

          if (response.status >= 500 && response.status < 600) {
            clearTimeout(timeoutId);
            lastError = new ApiError(
              `Server OFF ${base} non disponibile (${response.status})`,
              'ApiError',
              response.status,
            );
            if (attempt < maxAttempts - 1) {
              const delay = API_RETRY_DELAY_MS * (attempt + 1);
              if (Date.now() + delay < globalDeadline) {
                await sleep(delay, opts.signal);
                continue;
              }
            }
            break;
          }

          if (!response.ok) {
            clearTimeout(timeoutId);
            throw new ApiError(`Errore Open Food Facts: ${response.status}`, 'ApiError', response.status);
          }

          const contentType = response.headers.get('content-type') || '';
          if (!contentType.includes('application/json')) {
            clearTimeout(timeoutId);
            lastError = new ApiError(`Risposta non JSON da ${base}`, 'ApiError');
            break;
          }

          const json = (await response.json()) as T;
          clearTimeout(timeoutId);
          return json;
        } catch (error: unknown) {
          clearTimeout(timeoutId);
          if (error instanceof ApiError && error.name === 'RateLimitError') throw error;
          if (
            error instanceof ApiError &&
            error.status !== undefined &&
            error.status >= 400 &&
            error.status < 500 &&
            error.status !== 429
          ) {
            throw error;
          }

          const err = error as { name?: string };
          if (err?.name === 'AbortError') {
            if (opts.signal?.aborted) throw new ApiError('Aborted', 'AbortError');
            lastError = new ApiError(`Timeout su ${base}`, 'TimeoutError');
          } else if (err?.name === 'TypeError') {
            lastError = new ApiError('Network', 'NetworkError');
          } else {
            lastError = error instanceof Error ? error : new Error(String(error));
          }

          if (isTransientError(lastError) && attempt < maxAttempts - 1) {
            const delay = API_RETRY_DELAY_MS * (attempt + 1);
            if (Date.now() + delay < globalDeadline) {
              await sleep(delay, opts.signal);
              continue;
            }
          }
          break;
        }
      }
    }
  } finally {
    opts.signal?.removeEventListener('abort', onAbortExternal);
  }

  throw lastError ?? new ApiError('Open Food Facts non disponibile', 'ApiError');
}

// ============ Search endpoint ============

export interface SearchOffOpts {
  page?: number;
  pageSize?: number;
  italianOnly?: boolean;
  signal?: AbortSignal;
}

// OFF documenta 10 search/min/IP. Manteniamo un margine ed evitiamo di inviare
// richieste quando il client ha già prodotto 9 ricerche negli ultimi 60 secondi.
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

function normalizeResponseNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

/**
 * Una chiamata di searchOff corrisponde a una sola richiesta HTTP. Nessun suffix
 * expansion, nessun retry e nessun cambio host su 429: il rate limit è un contratto.
 */
export async function searchOff(
  query: string,
  opts: SearchOffOpts = {},
): Promise<{ products: OffProduct[]; count: number; page: number; pageSize: number }> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return { products: [], count: 0, page: 1, pageSize: opts.pageSize ?? OFF_PAGE_SIZE };

  acquireSearchSlot();
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? OFF_PAGE_SIZE;
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

  // L'istanza italiana è il primo endpoint coerente con l'app. Se fallisce, la UI
  // permette un nuovo tentativo esplicito invece di moltiplicare automaticamente le query.
  const searchInstance = [OFF_INSTANCES[0]] as const;
  const data = await apiGetJson<OffSearchResponse | null>((base) => `${base}/cgi/search.pl?${params.toString()}`, {
    signal: opts.signal,
    instances: searchInstance,
    retryPerInstance: 0,
    stopOnRateLimit: true,
    globalDeadlineMs: API_TIMEOUT_MS,
  });

  if (!data || typeof data !== 'object') return { products: [], count: 0, page: 1, pageSize };
  return {
    products: Array.isArray(data.products) ? data.products : [],
    count: normalizeResponseNumber(data.count, 0),
    page: normalizeResponseNumber(data.page, 1),
    pageSize: normalizeResponseNumber(data.page_size, pageSize),
  };
}

/** Compatibilità API: niente più espansione automatica, quindi effectiveQuery è la query originale. */
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

// ============ Product lookup ============

export async function getOffByBarcode(barcode: string, signal?: AbortSignal): Promise<OffProduct | null> {
  try {
    const data = await apiGetJson<{ product?: OffProduct } | null>(
      (base) => `${base}/api/v2/product/${encodeURIComponent(barcode)}.json`,
      { signal },
    );
    if (!data || typeof data !== 'object') return null;
    return data.product ?? null;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    console.warn('[api] getOffByBarcode error (non-404)', error);
    throw error;
  }
}

/** Reset limiter solo per isolamento dei test. */
export function __resetSearchLimiterForTesting(): void {
  _searchTimestamps.length = 0;
}

export { isTransientError };
