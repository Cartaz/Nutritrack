import { getOffByBarcode, searchOff } from './api';
import { SEARCH_AUTO_RETRY_DELAY_MS } from './constants';
import { buildFoodFromOff } from './normalize';
import type { FoodItem, OffProduct } from '../types';

export type FoodSearchErrorKind = 'offline' | 'network' | 'timeout' | 'unavailable' | 'unknown';

export class FoodSearchError extends Error {
  readonly kind: FoodSearchErrorKind;

  constructor(kind: FoodSearchErrorKind, cause?: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause ?? kind);
    super(message);
    this.name = 'FoodSearchError';
    this.kind = kind;
  }
}

export interface FoodSearchContinuation {
  readonly effectiveQuery: string;
  readonly nextPage: number;
  readonly italianOnly: boolean;
}

export interface FoodSearchPage {
  foods: FoodItem[];
  totalCount: number;
  continuation: FoodSearchContinuation | null;
}

export type BarcodeFoodLookup = { kind: 'found'; food: FoodItem } | { kind: 'not-found' } | { kind: 'incomplete' };

interface SearchOptions {
  signal?: AbortSignal;
  italianOnly?: boolean;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function classifyError(error: unknown): FoodSearchErrorKind {
  const e = error as { name?: string; status?: number; message?: string };
  if (e?.name === 'OfflineError') return 'offline';
  if (e?.name === 'NetworkError' || e?.name === 'TypeError') return 'network';
  if (e?.name === 'TimeoutError') return 'timeout';
  if (e?.status === 429 || (typeof e?.status === 'number' && e.status >= 500)) return 'unavailable';

  const message = e?.message ?? '';
  if (message.includes('non disponibile') || message.includes('non JSON') || message.includes('non valida')) {
    return 'unavailable';
  }
  return 'unknown';
}

function isRetryable(kind: FoodSearchErrorKind): boolean {
  return kind !== 'unknown';
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const error = new Error('Aborted');
      error.name = 'AbortError';
      reject(error);
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      const error = new Error('Aborted');
      error.name = 'AbortError';
      reject(error);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function withSingleRetry<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) throw error;
    const kind = classifyError(error);
    if (!isRetryable(kind)) throw new FoodSearchError(kind, error);

    await abortableDelay(SEARCH_AUTO_RETRY_DELAY_MS, signal);
    try {
      return await operation();
    } catch (retryError) {
      if (signal?.aborted || isAbortError(retryError)) throw retryError;
      throw new FoodSearchError(classifyError(retryError), retryError);
    }
  }
}

function mapFoods(products: OffProduct[]): FoodItem[] {
  return products.map(buildFoodFromOff).filter((food): food is FoodItem => food !== null);
}

function continuationFor(
  effectiveQuery: string,
  page: number,
  pageSize: number,
  totalCount: number,
  italianOnly: boolean,
): FoodSearchContinuation | null {
  if (page * pageSize >= totalCount) return null;
  return { effectiveQuery, nextPage: page + 1, italianOnly };
}

/** Initial semantic food search. Text search is never retried automatically. */
export async function searchFoods(query: string, options: SearchOptions = {}): Promise<FoodSearchPage> {
  const effectiveInput = query.trim();
  const italianOnly = options.italianOnly ?? false;
  try {
    const result = await searchOff(effectiveInput, { signal: options.signal, italianOnly, page: 1 });
    return {
      foods: mapFoods(result.products),
      totalCount: result.count,
      continuation: continuationFor(effectiveInput, result.page, result.pageSize, result.count, italianOnly),
    };
  } catch (error) {
    if (options.signal?.aborted || isAbortError(error)) throw error;
    throw new FoodSearchError(classifyError(error), error);
  }
}

/** Continue a previous search. Pagination is another explicit user action and maps to one request. */
export async function continueFoodSearch(
  continuation: FoodSearchContinuation,
  options: Pick<SearchOptions, 'signal'> = {},
): Promise<FoodSearchPage> {
  try {
    const result = await searchOff(continuation.effectiveQuery, {
      signal: options.signal,
      italianOnly: continuation.italianOnly,
      page: continuation.nextPage,
    });
    return {
      foods: mapFoods(result.products),
      totalCount: result.count,
      continuation: continuationFor(
        continuation.effectiveQuery,
        result.page,
        result.pageSize,
        result.count,
        continuation.italianOnly,
      ),
    };
  } catch (error) {
    if (options.signal?.aborted || isAbortError(error)) throw error;
    throw new FoodSearchError(classifyError(error), error);
  }
}

/** Remote OFF barcode lookup. Saved/local database precedence remains a UI/application concern. */
export async function lookupFoodByBarcode(barcode: string, signal?: AbortSignal): Promise<BarcodeFoodLookup> {
  const product = await withSingleRetry(() => getOffByBarcode(barcode, signal), signal);
  if (!product) return { kind: 'not-found' };
  const food = buildFoodFromOff(product);
  return food ? { kind: 'found', food } : { kind: 'incomplete' };
}
