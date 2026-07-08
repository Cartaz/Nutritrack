// API client tipizzato con AbortController + timeout + fallback multi-istanza OFF.
// Pattern 9 dello standard: apiGet<T>() con timeout 10s e supporto AbortSignal esterno.
//
// Fix B-8-1 (T8): deadline globale 15s (cumulative timeout era 5×8s=40s worst case).
// Fix B-8-3 (T8): HTTP 429 → continue su prossima istanza (era trattato come 4xx fatal).
// Fix B-8-4 (T8): dispatch su e.status invece di e.message.startsWith (fragile).
// Fix B-8-6 (T8): invia OFF_USER_AGENT header.
// Fix B-8-8 (T8): singolo listener su opts.signal (no accumulo).
// Fix B-8-9 (T8): normalizza page/page_size/count a number.
// Fix B-8-10 (T8): pre-check navigator.onLine.
// Fix B-8-12 (T8): clearTimeout dopo res.json() (body read protetto).
// Fix B-8-13 (T8): guard contro data null.

import type { OffProduct, OffSearchResponse } from '../types';
import { API_TIMEOUT_MS, OFF_INSTANCES, OFF_PAGE_SIZE } from './constants';

// Fix MEDIUM bug: OFF_USER_AGENT rimosso perché `User-Agent` è un forbidden header nei browser
// (silently stripped per fingerprinting protection). Era dead code. Se in futuro vorremo
// identificarci presso OFF, dovremo usare un header custom (es. `X-User-Agent`) o un proxy.

/** Deadline globale cumulativo per tutte le istanze OFF (ms). */
const GLOBAL_DEADLINE_MS = 15_000;

export class ApiError extends Error {
  status?: number;
  override name: string;
  constructor(message: string, name: string, status?: number) {
    super(message);
    this.name = name;
    this.status = status;
  }
}

/** Fetch con timeout interno + propagazione AbortSignal esterno.
 *  Fix B11: per-istanza AbortController — se la prima istanza hanga (TCP black hole),
 *  il timeout abortisce solo quella istanza e si passa alla successiva, non tutte.
 *  Fix B-8-1: deadline globale cumulativa previene 40s di attesa se tutte le istanze hangano. */
export async function apiGetJson<T>(
  buildUrl: (base: string) => string,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? API_TIMEOUT_MS;

  // Signal esterno: se già aborted, throw subito
  if (opts.signal?.aborted) {
    throw new ApiError('Aborted', 'AbortError');
  }

  // Fix B-8-10: pre-check navigator.onLine per feedback immediato
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ApiError('Sei offline. Verifica la connessione e riprova.', 'NetworkError');
  }

  // Fix B-8-1: deadline globale
  const globalDeadline = Date.now() + GLOBAL_DEADLINE_MS;

  // Fix B-8-8: singolo listener su opts.signal che abortisce il controller corrente
  let currentController: AbortController | null = null;
  const onAbortExternal = () => currentController?.abort();
  if (opts.signal) {
    opts.signal.addEventListener('abort', onAbortExternal, { once: true });
  }

  let lastError: Error | null = null;

  try {
    for (const base of OFF_INSTANCES) {
      const remaining = globalDeadline - Date.now();
      if (remaining < 500) {
        // Deadline globale quasi scaduto: esci
        lastError =
          lastError ?? new ApiError('Tutte le istanze OFF non disponibili (deadline globale)', 'TimeoutError');
        break;
      }
      const instanceTimeout = Math.min(timeoutMs, remaining);

      // Fix B11: nuovo AbortController per ogni istanza
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
        // 5xx: prova prossima istanza
        // Fix B-8-3: 429 (rate limit) → continue su prossima istanza (era fatal)
        if ((res.status >= 500 && res.status < 600) || res.status === 429) {
          clearTimeout(timeoutId);
          lastError = new ApiError(`Server OFF ${base} non disponibile (${res.status})`, 'ApiError', res.status);
          continue;
        }
        // 4xx reale (404, 400): ritorna errore
        if (!res.ok) {
          clearTimeout(timeoutId);
          const ct = res.headers.get('content-type') || '';
          if (!ct.includes('application/json')) {
            lastError = new ApiError(`Risposta non valida da ${base}`, 'ApiError', res.status);
            continue;
          }
          throw new ApiError(`Errore ricerca: ${res.status}`, 'ApiError', res.status);
        }
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) {
          clearTimeout(timeoutId);
          lastError = new ApiError(`Risposta non JSON da ${base}`, 'ApiError');
          continue;
        }
        // Fix B-8-12: leggi body PRIMA di clearTimeout (body read protetto da timeout)
        const json = (await res.json()) as T;
        clearTimeout(timeoutId);
        return json;
      } catch (e: unknown) {
        clearTimeout(timeoutId);
        // Fix B-8-4: dispatch su status invece di message.startsWith
        if (e instanceof ApiError && e.status !== undefined && e.status >= 400 && e.status < 500 && e.status !== 429) {
          throw e;
        }
        const err = e as { name?: string };
        if (err?.name === 'AbortError') {
          // Fix B11: distingui tra timeout interno (questa istanza) e abort esterno
          if (opts.signal?.aborted) {
            // Abort esterno: propaga
            throw new ApiError('Aborted', 'AbortError');
          }
          // Timeout interno su QUESTA istanza: prova la prossima
          lastError = new ApiError(`Timeout su ${base}`, 'TimeoutError');
          continue;
        }
        if (err?.name === 'TypeError') {
          // network failure: prova prossima istanza
          lastError = new ApiError('Network', 'NetworkError');
          continue;
        }
        lastError = e instanceof Error ? e : new Error(String(e));
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

/** Cerca prodotti su Open Food Facts con fallback multi-istanza */
export async function searchOff(
  query: string,
  opts: SearchOffOpts = {},
): Promise<{ products: OffProduct[]; count: number; page: number; pageSize: number }> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? OFF_PAGE_SIZE;
  const params = new URLSearchParams({
    search_terms: query,
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

  // Fix B-8-13: guard contro data null
  const data = (await apiGetJson<OffSearchResponse | null>((base) => `${base}/cgi/search.pl?${params.toString()}`, {
    signal: opts.signal,
  })) as OffSearchResponse | null;

  if (!data || typeof data !== 'object') {
    return { products: [], count: 0, page: 1, pageSize };
  }

  // Fix B-8-9: normalizza page/page_size/count a number (OFF a volte ritorna stringhe)
  const normalizeNum = (v: unknown, fallback: number): number => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
    return fallback;
  };

  return {
    products: Array.isArray(data.products) ? data.products : [],
    count: normalizeNum(data.count, 0),
    page: normalizeNum(data.page, 1),
    pageSize: normalizeNum(data.page_size, pageSize),
  };
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
