// Sessione di ricerca alimenti su Open Food Facts, condivisa dal dialog "Aggiungi al diario"
// e dalla ricerca ingredienti dell'editor ricette.
//
// Politica unica: la ricerca parte solo su azione esplicita (pulsante Cerca / Invio), una
// azione = una richiesta (rispetta il rate limit di OFF), filtro sui prodotti venduti in Italia,
// paginazione con "Carica altri", errori mostrati con lo stesso messaggio ovunque.

import { SEARCH_MIN_QUERY } from '../lib/constants';
import {
  continueFoodSearch,
  foodSearchErrorMessage,
  searchFoods,
  type FoodSearchContinuation,
} from '../lib/food-search';
import type { FoodItem } from '../types';
import { showToast } from './toast';

export class FoodSearchSession {
  query = '';
  loading = false;
  results: FoodItem[] = [];
  totalCount = 0;
  /** True quando i risultati mostrati sono l'esito di una ricerca completata per `query`. */
  searched = false;
  private continuation: FoodSearchContinuation | null = null;
  private controller: AbortController | null = null;

  /**
   * @param onChange chiamata quando cambia lo stato visibile (loading, risultati).
   * @param isActive false quando la UI proprietaria è stata chiusa: le risposte tardive vengono ignorate.
   */
  constructor(
    private readonly onChange: () => void,
    private readonly isActive: () => boolean,
  ) {}

  get canLoadMore(): boolean {
    return this.continuation !== null && this.query.trim().length >= SEARCH_MIN_QUERY;
  }

  get remainingCount(): number {
    return Math.max(0, this.totalCount - this.results.length);
  }

  /** Nuovo testo digitato: i risultati precedenti non corrispondono più. Nessuna richiesta. */
  setQuery(query: string): void {
    this.cancel();
    this.query = query;
    this.results = [];
    this.totalCount = 0;
    this.continuation = null;
    this.searched = false;
  }

  /** Mostra risultati già noti (es. lookup barcode) come esito della ricerca corrente. */
  showResults(query: string, results: FoodItem[]): void {
    this.setQuery(query);
    this.results = results;
    this.searched = true;
  }

  /** Avvia la ricerca per la query corrente. Ritorna false se la query è troppo corta. */
  run(): boolean {
    const query = this.query;
    if (query.trim().length < SEARCH_MIN_QUERY) {
      showToast(`Inserisci almeno ${SEARCH_MIN_QUERY} caratteri`, 'info');
      return false;
    }
    const ctrl = this.start();
    void searchFoods(query, { signal: ctrl.signal, italianOnly: true })
      .then((page) => {
        if (!this.isCurrent(ctrl) || query !== this.query) return;
        this.results = page.foods;
        this.totalCount = page.totalCount;
        this.continuation = page.continuation;
        this.searched = true;
      })
      .catch((error: unknown) => {
        if (!this.isCurrent(ctrl) || query !== this.query) return;
        this.results = [];
        this.totalCount = 0;
        this.continuation = null;
        showToast(foodSearchErrorMessage(error, 'search'), 'error', 5000);
      })
      .finally(() => this.finish(ctrl));
    return true;
  }

  /** Pagina successiva della ricerca corrente (anche questa una sola richiesta esplicita). */
  loadMore(): void {
    const continuation = this.continuation;
    if (this.loading || !continuation) return;
    const ctrl = this.start();
    void continueFoodSearch(continuation, { signal: ctrl.signal })
      .then((page) => {
        if (!this.isCurrent(ctrl)) return;
        const known = new Set(this.results.map((food) => food.id));
        this.results = [...this.results, ...page.foods.filter((food) => !known.has(food.id))];
        this.totalCount = page.totalCount;
        this.continuation = page.continuation;
      })
      .catch((error: unknown) => {
        if (!this.isCurrent(ctrl)) return;
        showToast(foodSearchErrorMessage(error, 'search'), 'error', 5000);
      })
      .finally(() => this.finish(ctrl));
  }

  /** Annulla l'eventuale richiesta in corso. */
  cancel(): void {
    this.controller?.abort();
    this.controller = null;
    this.loading = false;
  }

  reset(): void {
    this.setQuery('');
  }

  private start(): AbortController {
    this.controller?.abort();
    const ctrl = new AbortController();
    this.controller = ctrl;
    this.loading = true;
    this.onChange();
    return ctrl;
  }

  private isCurrent(ctrl: AbortController): boolean {
    return !ctrl.signal.aborted && this.controller === ctrl && this.isActive();
  }

  private finish(ctrl: AbortController): void {
    if (this.controller !== ctrl) return;
    this.controller = null;
    this.loading = false;
    if (this.isActive()) this.onChange();
  }
}
