// API client tipizzato con AbortController + timeout + fallback multi-istanza OFF.
// Pattern 9 dello standard: apiGet<T>() con timeout 10s e supporto AbortSignal esterno.

import type { OffProduct, OffSearchResponse } from '../types';
import { API_TIMEOUT_MS, OFF_INSTANCES, OFF_PAGE_SIZE } from './constants';

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
 */
export async function apiGetJson<T>(
  buildUrl: (base: string) => string,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? API_TIMEOUT_MS;

  // Signal esterno: se già aborted, throw subito
  if (opts.signal?.aborted) {
    throw new ApiError('Aborted', 'AbortError');
  }

  let lastError: Error | null = null;

  for (const base of OFF_INSTANCES) {
    // Fix B11: nuovo AbortController per ogni istanza
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    // Propaga abort esterno
    if (opts.signal) {
      opts.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    const url = buildUrl(base);
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      // 5xx: prova prossima istanza
      if (res.status >= 500 && res.status < 600) {
        lastError = new ApiError(`Server OFF ${base} non disponibile (${res.status})`, 'ApiError', res.status);
        continue;
      }
      // 4xx reale (404, 400): ritorna errore
      if (!res.ok) {
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) {
          lastError = new ApiError(`Risposta non valida da ${base}`, 'ApiError', res.status);
          continue;
        }
        throw new ApiError(`Errore ricerca: ${res.status}`, 'ApiError', res.status);
      }
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        lastError = new ApiError(`Risposta non JSON da ${base}`, 'ApiError');
        continue;
      }
      return (await res.json()) as T;
    } catch (e: unknown) {
      clearTimeout(timeoutId);
      if (e instanceof ApiError && e.message.startsWith('Errore ricerca:')) {
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
  opts: SearchOffOpts = {}
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

  const data = await apiGetJson<OffSearchResponse>(
    (base) => `${base}/cgi/search.pl?${params.toString()}`,
    { signal: opts.signal }
  );

  return {
    products: data.products ?? [],
    count: data.count ?? 0,
    page: data.page ?? 1,
    pageSize: data.page_size ?? pageSize,
  };
}

/** Recupera un prodotto per barcode */
export async function getOffByBarcode(barcode: string, signal?: AbortSignal): Promise<OffProduct | null> {
  try {
    const data = await apiGetJson<{ product?: OffProduct }>(
      (base) => `${base}/api/v2/product/${encodeURIComponent(barcode)}.json`,
      { signal }
    );
    return data.product ?? null;
  } catch {
    return null;
  }
}
