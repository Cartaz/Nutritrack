import { getOffByBarcode, searchOff } from './api';
import { buildFoodFromOff } from './normalize';
import type { FoodItem, OffProduct } from '../types';

export type FoodSearchErrorKind = 'offline' | 'network' | 'timeout' | 'rate_limited' | 'unavailable' | 'unknown';

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

/** Classifica per nome/status dell'ApiError; mai per sottostringhe del messaggio. */
function classifyError(error: unknown): FoodSearchErrorKind {
  const e = error as { name?: string; status?: number };
  if (e?.name === 'OfflineError') return 'offline';
  if (e?.name === 'RateLimitError' || e?.status === 429) return 'rate_limited';
  if (e?.name === 'NetworkError' || e?.name === 'TypeError') return 'network';
  if (e?.name === 'TimeoutError') return 'timeout';
  if (e?.name === 'ApiError') {
    // 4xx = richiesta rifiutata (errore nostro o prodotto inesistente), il resto = servizio giù.
    return typeof e.status === 'number' && e.status >= 400 && e.status < 500 ? 'unknown' : 'unavailable';
  }
  return 'unknown';
}

function toFoodSearchError(error: unknown, signal?: AbortSignal): unknown {
  if (signal?.aborted || isAbortError(error)) return error;
  return new FoodSearchError(classifyError(error), error);
}

/** Messaggio utente per un errore di ricerca o di lookup barcode. */
export function foodSearchErrorMessage(error: unknown, context: 'search' | 'barcode'): string {
  const kind = error instanceof FoodSearchError ? error.kind : 'unknown';
  switch (kind) {
    case 'offline':
      return 'Sei offline. Verifica la connessione e riprova.';
    case 'rate_limited':
      return 'Troppe ricerche ravvicinate: Open Food Facts ne consente circa 10 al minuto. Attendi qualche secondo e riprova.';
    case 'network':
      return 'Open Food Facts non raggiungibile. Riprova tra qualche secondo.';
    case 'timeout':
      return 'Risposta di Open Food Facts troppo lenta. Riprova tra poco.';
    case 'unavailable':
      return context === 'search'
        ? 'Database Open Food Facts temporaneamente non disponibile. Riprova tra qualche minuto, oppure crea un ingrediente custom.'
        : 'Servizio Open Food Facts non disponibile. Riprova tra poco.';
    default:
      return context === 'search' ? 'Errore nella ricerca. Riprova tra poco.' : 'Errore nella ricerca del prodotto.';
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
    throw toFoodSearchError(error, options.signal);
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
    throw toFoodSearchError(error, options.signal);
  }
}

/**
 * Lookup barcode remoto su OFF. I retry (per istanza e tra istanze) vivono in apiGetJson:
 * qui non se ne aggiunge un secondo livello. La precedenza degli alimenti salvati è della UI.
 */
export async function lookupFoodByBarcode(barcode: string, signal?: AbortSignal): Promise<BarcodeFoodLookup> {
  let product: OffProduct | null;
  try {
    product = await getOffByBarcode(barcode, signal);
  } catch (error) {
    throw toFoodSearchError(error, signal);
  }
  if (!product) return { kind: 'not-found' };
  const food = buildFoodFromOff(product);
  return food ? { kind: 'found', food } : { kind: 'incomplete' };
}
