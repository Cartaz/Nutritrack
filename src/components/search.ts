// Search dialog: ricerca OFF con debounce + AbortController + keyboard nav.
// Tabs: Preferiti / Salvati / Cerca OFF.
// Stato interno isolato (form state), emissione via store (open/close).
//
// Pattern anti-flicker: la shell del modal (overlay + header + tabs + search-box + list-container + footer)
// viene creata UNA volta quando si apre. Ad ogni cambio di stato, solo il contenuto dinamico
// (lista, footer, tabs active) viene aggiornato via innerHTML mirato. L'input #search-input non viene
// MAI toccato dopo la creazione per non perdere focus e cursore (causa del bug flickering).

import { escapeHtml, escapeAttr, debounce, safeId } from '../lib/utils';
import { searchOff, searchOffWithPartialMatch, getOffByBarcode } from '../lib/api';
import { buildFoodFromOff } from '../lib/normalize';
import { getItOverrideByBarcode } from '../lib/itOverride';
import { getState, getActiveDialog, closeFoodSearch, openFoodEditor, emitChange } from '../lib/store';
import { addFoodToDiary } from '../lib/diary';
import { toggleFoodFavorite, addCustomPortionToFood, removeCustomPortionFromFood, saveOffFood } from '../lib/foods';
import { showToast } from './toast';
import { imgTag } from './img';
import { openBarcodeScanner, isBarcodeScannerOpen } from './barcode-scanner';
import { SEARCH_DEBOUNCE_MS, SEARCH_MIN_QUERY, SEARCH_AUTO_RETRY_DELAY_MS } from '../lib/constants';
import type { FoodItem, CustomPortion, OffProduct } from '../types';
import { MEAL_ICONS, MEAL_LABELS } from '../types';

// ============ Internal dialog state (NON in store globale) ============

interface SearchDialogState {
  tab: 'favorites' | 'saved' | 'search';
  query: string;
  loading: boolean;
  results: FoodItem[];
  selectedId: string | null;
  gramsOverride: string;
  // Porzioni personalizzate create durante questa sessione per il food selezionato
  // (usate solo se il food non è ancora salvato; se è già salvato si persistono subito via store).
  pendingCustomPortions: CustomPortion[];
  // UI: form inline per creare una nuova porzione personalizzata
  creatingPortion: boolean;
  newPortionLabel: string;
  newPortionGrams: string;
  abortController: AbortController | null;
  // Fix MEDIUM bug: paginazione OFF — page corrente e totale risultati da OFF (count)
  page: number;
  totalCount: number;
  // Fix OFF-RETRY (issue #1): flag che indica se l'auto-retry UI-level è già stato
  // tentato per la query corrente. Evita retry infiniti su errori persistenti.
  autoRetryDone: boolean;
  // Fix PARTIAL-MATCH: query che ha effettivamente prodotto i risultati (può differire
  // da `query` se è stato applicato il suffix expansion, es. "melanzan" → "melanzane").
  // Usata per la paginazione (page > 1) per garantire coerenza dei risultati.
  effectiveQuery: string;
}

const _searchState: SearchDialogState = {
  tab: 'favorites',
  query: '',
  loading: false,
  results: [],
  selectedId: null,
  gramsOverride: '',
  pendingCustomPortions: [],
  creatingPortion: false,
  newPortionLabel: '',
  newPortionGrams: '',
  abortController: null,
  page: 1,
  totalCount: 0,
  autoRetryDone: false,
  effectiveQuery: '',
};

function getSearchDialog() {
  const dialog = getActiveDialog();
  return dialog?.type === 'food-search' ? dialog : null;
}

function isSearchOpen(): boolean {
  return getSearchDialog() !== null;
}

function resetSearchState(): void {
  if (_searchState.abortController) {
    try {
      _searchState.abortController.abort();
    } catch {
      /* noop */
    }
  }
  // Cancella il timer del debounce per evitare che parta una fetch a dialog chiuso.
  runSearch.cancel();
  _searchState.tab = 'favorites';
  _searchState.query = '';
  _searchState.loading = false;
  _searchState.results = [];
  _searchState.selectedId = null;
  _searchState.gramsOverride = '';
  _searchState.pendingCustomPortions = [];
  _searchState.creatingPortion = false;
  _searchState.newPortionLabel = '';
  _searchState.newPortionGrams = '';
  _searchState.abortController = null;
  _searchState.page = 1;
  _searchState.totalCount = 0;
  _searchState.autoRetryDone = false;
  _searchState.effectiveQuery = '';
}

// ============ Debounced search ============

const runSearch = debounce(async (query: string, page: number = 1) => {
  if (!isSearchOpen()) return;
  if (query.trim().length < SEARCH_MIN_QUERY) {
    _searchState.results = [];
    _searchState.loading = false;
    _searchState.page = 1;
    _searchState.totalCount = 0;
    emitChange();
    return;
  }
  if (_searchState.abortController) {
    try {
      _searchState.abortController.abort();
    } catch {
      /* noop */
    }
  }
  const ctrl = new AbortController();
  _searchState.abortController = ctrl;
  try {
    const trimmedQuery = query.trim();
    let products: OffProduct[];
    let count: number;
    if (page === 1) {
      const data = await searchOffWithPartialMatch(trimmedQuery, {
        signal: ctrl.signal,
        italianOnly: true,
        page,
      });
      _searchState.effectiveQuery = data.effectiveQuery;
      products = data.products;
      count = data.count;
    } else {
      const data = await searchOff(_searchState.effectiveQuery || trimmedQuery, {
        signal: ctrl.signal,
        italianOnly: true,
        page,
      });
      products = data.products;
      count = data.count;
    }
    if (ctrl.signal.aborted) return;
    if (!isSearchOpen()) return;
    const items: FoodItem[] = [];
    for (const p of products) {
      const f = buildFoodFromOff(p);
      if (f) items.push(f);
    }
    if (page === 1) {
      _searchState.results = items;
    } else {
      const existingIds = new Set(_searchState.results.map((r) => r.id));
      const newItems = items.filter((it) => !existingIds.has(it.id));
      _searchState.results = [..._searchState.results, ...newItems];
    }
    _searchState.page = page;
    _searchState.totalCount = count;
  } catch (e) {
    if (ctrl.signal.aborted) return;
    if (!isSearchOpen()) return;
    const err = e as { name?: string; message?: string };
    const msg = err?.message ?? (e instanceof Error ? e.message : String(e));
    const errName = err?.name ?? '';
    const errStatus = (e as { status?: number })?.status;
    const isTransient =
      errName === 'NetworkError' ||
      errName === 'TimeoutError' ||
      errName === 'OfflineError' ||
      (errStatus !== undefined && (errStatus >= 500 || errStatus === 429));
    if (isTransient && !_searchState.autoRetryDone && page === 1) {
      _searchState.autoRetryDone = true;
      _searchState.loading = true;
      emitChange();
      setTimeout(() => {
        if (!isSearchOpen()) return;
        _searchState.loading = true;
        emitChange();
        runSearch(query, 1);
      }, SEARCH_AUTO_RETRY_DELAY_MS);
      return;
    }

    if (errName === 'OfflineError' || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
      showToast('Sei offline. Verifica la connessione e riprova.', 'error');
    } else if (errName === 'NetworkError') {
      showToast('Open Food Facts non raggiungibile. Riprova tra qualche secondo.', 'error', 5000);
    } else if (errName === 'TimeoutError') {
      showToast('Risposta di Open Food Facts troppo lenta. Riprova tra poco.', 'error', 5000);
    } else if (msg && (msg.includes('non disponibile') || msg.includes('non JSON') || msg.includes('non valida'))) {
      showToast(
        'Database Open Food Facts temporaneamente non disponibile. Riprova tra qualche minuto, oppure crea un ingrediente custom.',
        'error',
        5000,
      );
    } else {
      showToast('Errore nella ricerca. Riprova tra poco.', 'error');
    }
    _searchState.results = [];
    _searchState.page = 1;
    _searchState.totalCount = 0;
  } finally {
    if (_searchState.abortController === ctrl) {
      _searchState.abortController = null;
    }
    _searchState.loading = false;
    if (isSearchOpen()) emitChange();
  }
}, SEARCH_DEBOUNCE_MS);

/** Carica la pagina successiva di risultati OFF (paginazione load-more). */
async function loadMoreResults(): Promise<void> {
  if (!isSearchOpen()) return;
  if (_searchState.loading) return;
  if (_searchState.query.trim().length < SEARCH_MIN_QUERY) return;
  const nextPage = _searchState.page + 1;
  const loaded = _searchState.results.length;
  if (_searchState.totalCount > 0 && loaded >= _searchState.totalCount) return;
  _searchState.loading = true;
  emitChange();
  await runSearch(_searchState.query, nextPage);
}

// ============ Event bindings (una sola volta) ============

let _boundSearch = false;

/** Abortisce qualsiasi ricerca OFF in corso + reset loading. */
function abortInFlightSearch(): void {
  if (_searchState.abortController) {
    try {
      _searchState.abortController.abort();
    } catch {
      /* noop */
    }
    _searchState.abortController = null;
  }
  _searchState.loading = false;
}

export function bindSearchEvents(): void {
  if (_boundSearch) return;
  _boundSearch = true;

  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape') return;
      if (!isSearchOpen()) return;
      const overlays = document.querySelectorAll('.modal-overlay');
      if (overlays.length === 0) return;
      const top = overlays[overlays.length - 1] as HTMLElement;
      if (top.dataset.modalId !== 'search-dialog') return;
      e.stopPropagation();
      e.preventDefault();
      if (_searchState.selectedId || _searchState.pendingCustomPortions.length > 0) {
        if (!confirm('Hai modifiche non salvate. Chiudere comunque?')) return;
      }
      closeFoodSearch();
      resetSearchState();
    },
    true,
  );

  document.addEventListener('click', (e) => {
    if (!isSearchOpen()) return;
    const overlayEl = e.target as HTMLElement;
    if (overlayEl.classList.contains('modal-overlay') && overlayEl.dataset.modalId === 'search-dialog') {
      if (_searchState.selectedId || _searchState.pendingCustomPortions.length > 0) {
        if (!confirm('Hai modifiche non salvate. Chiudere comunque?')) return;
      }
      closeFoodSearch();
      resetSearchState();
      return;
    }
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-search-action]');
    if (!target) return;
    const action = target.dataset.searchAction;
    switch (action) {
      case 'switchTab': {
        const tab = target.dataset.tab as 'favorites' | 'saved' | 'search';
        if (tab && tab !== _searchState.tab) {
          if (_searchState.tab === 'search' && tab !== 'search') {
            abortInFlightSearch();
            _searchState.results = [];
          }
          _searchState.tab = tab;
          _searchState.selectedId = null;
          _searchState.pendingCustomPortions = [];
          emitChange();
          if (
            tab === 'search' &&
            _searchState.query.trim().length >= SEARCH_MIN_QUERY &&
            _searchState.results.length === 0
          ) {
            _searchState.loading = true;
            emitChange();
            runSearch(_searchState.query);
          }
        }
        return;
      }
      case 'selectFood': {
        const id = target.dataset.foodId || '';
        const list = currentList();
        const f = list.find((x) => x.id === id);
        if (f) {
          if (_searchState.selectedId !== f.id) {
            _searchState.selectedId = f.id;
            _searchState.gramsOverride = String(f.servingSize || 100);
            _searchState.pendingCustomPortions = [];
            _searchState.creatingPortion = false;
            _searchState.newPortionLabel = '';
            _searchState.newPortionGrams = '';
          }
          emitChange();
        }
        return;
      }
      case 'toggleFav': {
        const id = target.dataset.foodId || '';
        if (!id) return;
        const isSaved = getState().foods.some((x) => x.id === id);
        if (!isSaved) {
          const list = currentList();
          const offFood = list.find((x) => x.id === id);
          if (offFood && offFood.source === 'openfoodfacts') {
            const saved = saveOffFood(offFood);
            toggleFoodFavorite(saved.id);
            showToast(`${saved.name} salvato nei tuoi alimenti`, 'success');
            return;
          }
        }
        toggleFoodFavorite(id);
        return;
      }
      case 'clearSelected': {
        _searchState.selectedId = null;
        _searchState.pendingCustomPortions = [];
        _searchState.creatingPortion = false;
        emitChange();
        return;
      }
      case 'confirm': {
        confirmAdd();
        return;
      }
      case 'close': {
        if (_searchState.selectedId || _searchState.pendingCustomPortions.length > 0) {
          if (!confirm('Hai modifiche non salvate. Chiudere comunque?')) return;
        }
        closeFoodSearch();
        resetSearchState();
        return;
      }
      case 'openAddCustom': {
        openFoodEditor('new');
        return;
      }
      case 'clearQuery': {
        abortInFlightSearch();
        _searchState.query = '';
        _searchState.results = [];
        _searchState.page = 1;
        _searchState.totalCount = 0;
        const input = document.querySelector<HTMLInputElement>('#search-input');
        if (input) {
          input.value = '';
          input.focus();
        }
        emitChange();
        return;
      }
      case 'scanBarcode': {
        if (isBarcodeScannerOpen()) return;
        openBarcodeScanner({
          onDetected: (barcode) => {
            void handleBarcodeDetected(barcode);
          },
          onError: () => {
            /* toast/messaggio già gestito nel modal */
          },
        });
        return;
      }
      case 'loadMore': {
        void loadMoreResults();
        return;
      }
      case 'usePortion': {
        const grams = Number(target.dataset.grams || '0');
        if (grams > 0) {
          _searchState.gramsOverride = String(grams);
          _searchState.creatingPortion = false;
          emitChange();
        }
        return;
      }
      case 'startCreatePortion': {
        _searchState.creatingPortion = true;
        _searchState.newPortionLabel = '';
        _searchState.newPortionGrams = _searchState.gramsOverride || '';
        emitChange();
        requestAnimationFrame(() => {
          if (!isSearchOpen()) return;
          const inp = document.querySelector<HTMLInputElement>('#new-portion-label');
          if (inp && document.activeElement === document.body) inp.focus();
        });
        return;
      }
      case 'cancelCreatePortion': {
        _searchState.creatingPortion = false;
        _searchState.newPortionLabel = '';
        _searchState.newPortionGrams = '';
        emitChange();
        return;
      }
      case 'confirmCreatePortion': {
        createCustomPortion();
        return;
      }
      case 'deleteCustomPortion': {
        const portionId = target.dataset.portionId || '';
        const foodId = target.dataset.foodId || '';
        deleteCustomPortion(foodId, portionId);
        return;
      }
    }
  });

  document.addEventListener('input', (e) => {
    if (!isSearchOpen()) return;
    const target = e.target as HTMLElement;
    if (target.id === 'search-input') {
      _searchState.query = (target as HTMLInputElement).value;
      if (_searchState.tab !== 'search') {
        _searchState.tab = 'search';
      }
      _searchState.selectedId = null;
      _searchState.gramsOverride = '';
      _searchState.pendingCustomPortions = [];
      _searchState.autoRetryDone = false;
      _searchState.effectiveQuery = '';
      if (_searchState.query.trim().length < SEARCH_MIN_QUERY) {
        abortInFlightSearch();
        _searchState.results = [];
        emitChange();
        return;
      }
      _searchState.loading = true;
      emitChange();
      runSearch(_searchState.query);
      return;
    }
    if (target.id === 'grams-input') {
      _searchState.gramsOverride = (target as HTMLInputElement).value;
      emitChange();
      return;
    }
    if (target.id === 'new-portion-label') {
      _searchState.newPortionLabel = (target as HTMLInputElement).value;
      return;
    }
    if (target.id === 'new-portion-grams') {
      _searchState.newPortionGrams = (target as HTMLInputElement).value;
      return;
    }
  });

  document.addEventListener('keydown', (e) => {
    if (!isSearchOpen()) return;
    const target = e.target as HTMLElement;
    if (e.key === 'Enter') {
      if (target.id === 'new-portion-label' || target.id === 'new-portion-grams') {
        e.preventDefault();
        createCustomPortion();
        return;
      }
    }
    if ((e.key === 'Enter' || e.key === ' ') && target.closest('[data-search-action="selectFood"]')) {
      e.preventDefault();
      (target.closest('[data-search-action="selectFood"]') as HTMLElement).click();
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && target.closest('[data-search-action="deleteCustomPortion"]')) {
      e.preventDefault();
      (target.closest('[data-search-action="deleteCustomPortion"]') as HTMLElement).click();
      return;
    }
  });
}

function currentList(): FoodItem[] {
  const s = getState();
  if (_searchState.tab === 'favorites') {
    return s.foods.filter((f) => s.favoriteFoodIds.includes(f.id));
  }
  if (_searchState.tab === 'saved') return s.foods;
  return _searchState.results;
}

// ============ Barcode scan handler ============

async function handleBarcodeDetected(barcode: string): Promise<void> {
  if (!isSearchOpen()) return;
  if (_searchState.tab !== 'search') {
    _searchState.tab = 'search';
  }
  abortInFlightSearch();
  _searchState.loading = true;
  _searchState.query = barcode;
  _searchState.selectedId = null;
  _searchState.gramsOverride = '';
  _searchState.pendingCustomPortions = [];
  _searchState.autoRetryDone = false;
  _searchState.effectiveQuery = '';
  const inputEl = document.querySelector<HTMLInputElement>('#search-input');
  if (inputEl) inputEl.value = barcode;
  emitChange();

  try {
    const s = getState();
    const savedByBarcode = s.foods.find((f) => f.barcode === barcode);
    if (savedByBarcode) {
      _searchState.results = [savedByBarcode];
      _searchState.selectedId = savedByBarcode.id;
      _searchState.gramsOverride = String(savedByBarcode.servingSize || 100);
      _searchState.loading = false;
      emitChange();
      showToast(`${savedByBarcode.name} (tuo salvato)`, 'success', 2200);
      return;
    }

    const itFood = getItOverrideByBarcode(barcode);
    if (itFood) {
      _searchState.results = [itFood];
      _searchState.selectedId = itFood.id;
      _searchState.gramsOverride = String(itFood.servingSize || 100);
      _searchState.loading = false;
      emitChange();
      showToast(`${itFood.name} (DB italiano)`, 'success', 2200);
      return;
    }

    const product = await getOffByBarcode(barcode);
    if (!isSearchOpen()) return;
    if (!product) {
      _searchState.loading = false;
      _searchState.results = [];
      emitChange();
      showToast(
        `Nessun prodotto trovato per il codice ${barcode}. Puoi cercare per nome o creare un ingrediente custom.`,
        'info',
        4500,
      );
      return;
    }
    const food = buildFoodFromOff(product);
    if (!food) {
      _searchState.loading = false;
      _searchState.results = [];
      emitChange();
      showToast(`Prodotto trovato ma con dati nutrizionali incompleti (codice ${barcode}).`, 'info', 4500);
      return;
    }
    _searchState.results = [food];
    _searchState.selectedId = food.id;
    _searchState.gramsOverride = String(food.servingSize || 100);
    _searchState.loading = false;
    emitChange();
    showToast(`${food.name} trovato`, 'success', 2200);
  } catch (e) {
    if (!isSearchOpen()) return;

    const errName = e instanceof Error ? e.name : '';
    const errStatus = (e as { status?: number })?.status;
    const isTransient =
      errName === 'NetworkError' ||
      errName === 'TimeoutError' ||
      errName === 'OfflineError' ||
      (errStatus !== undefined && (errStatus >= 500 || errStatus === 429));
    if (isTransient && !_searchState.autoRetryDone) {
      _searchState.autoRetryDone = true;
      _searchState.loading = true;
      emitChange();
      setTimeout(() => {
        if (!isSearchOpen()) return;
        void handleBarcodeDetected(barcode);
      }, SEARCH_AUTO_RETRY_DELAY_MS);
      return;
    }

    _searchState.loading = false;
    _searchState.results = [];
    emitChange();
    const msg =
      errName === 'OfflineError' || (typeof navigator !== 'undefined' && navigator.onLine === false)
        ? 'Sei offline. Verifica la connessione e riprova.'
        : errName === 'NetworkError'
          ? 'Open Food Facts non raggiungibile. Riprova tra qualche secondo.'
          : errName === 'TimeoutError'
            ? 'Risposta di Open Food Facts troppo lenta. Riprova tra poco.'
            : e instanceof Error
              ? `Errore nella ricerca del prodotto: ${e.message}`
              : 'Servizio Open Food Facts non disponibile. Riprova tra poco.';
    showToast(msg, 'error', 5000);
  }
}

function confirmAdd(): void {
  const dialog = getSearchDialog();
  if (!dialog) return;
  const list = currentList();
  const f = _searchState.selectedId ? list.find((x) => x.id === _searchState.selectedId) : null;
  if (!f) {
    showToast('Seleziona un alimento', 'info');
    return;
  }
  const gramsRaw = _searchState.gramsOverride.trim();
  if (gramsRaw === '') {
    showToast('Inserisci i grammi', 'error');
    return;
  }
  const gramsNormalized = gramsRaw.replace(',', '.');
  const grams = Number(gramsNormalized);
  if (!Number.isFinite(grams)) {
    showToast(`Grammi: valore non valido ("${gramsRaw}")`, 'error');
    return;
  }
  if (grams <= 0) {
    showToast('I grammi devono essere maggiori di 0', 'error');
    return;
  }
  const MAX_GRAMS = 10_000;
  if (grams > MAX_GRAMS) {
    showToast(`Grammi eccessivi (max ${MAX_GRAMS}g = 10kg per singola entry)`, 'error');
    return;
  }
  let foodToSave = f;
  if (_searchState.pendingCustomPortions.length > 0) {
    const existing = f.customPortions || [];
    foodToSave = {
      ...f,
      customPortions: [...existing, ..._searchState.pendingCustomPortions],
    };
  }
  addFoodToDiary({
    date: dialog.date,
    meal: dialog.meal,
    food: foodToSave,
    quantity: 1,
    gramsOverride: grams,
  });
  resetSearchState();
}

function createCustomPortion(): void {
  const list = currentList();
  const f = _searchState.selectedId ? list.find((x) => x.id === _searchState.selectedId) : null;
  if (!f) return;
  const label = _searchState.newPortionLabel.trim();
  const grams = Number(_searchState.newPortionGrams);
  if (!label) {
    showToast('Inserisci un nome per la porzione', 'info');
    return;
  }
  if (!Number.isFinite(grams) || grams <= 0) {
    showToast('Inserisci i grammi della porzione', 'info');
    return;
  }
  const isSaved = getState().foods.some((x) => x.id === f.id);
  if (isSaved) {
    addCustomPortionToFood(f.id, label, grams);
  } else {
    const portion: CustomPortion = {
      id: safeId('port_'),
      label,
      grams: Math.max(0.1, Math.round(grams * 10) / 10),
    };
    _searchState.pendingCustomPortions = [..._searchState.pendingCustomPortions, portion];
  }
  _searchState.creatingPortion = false;
  _searchState.newPortionLabel = '';
  _searchState.newPortionGrams = '';
  emitChange();
}

function deleteCustomPortion(foodId: string, portionId: string): void {
  const isSaved = getState().foods.some((x) => x.id === foodId);
  if (isSaved) {
    removeCustomPortionFromFood(foodId, portionId);
    return;
  }
  _searchState.pendingCustomPortions = _searchState.pendingCustomPortions.filter((p) => p.id !== portionId);
  emitChange();
}

// ============ Shell render ============

export function renderSearchShell(): string {
  const dialog = getSearchDialog();
  if (!dialog) return '';
  return `
    <div class="modal-overlay modal-show" data-modal-id="search-dialog">
      <div class="modal modal-search" role="dialog" aria-modal="true">
        <div class="modal-header">
          <h3 class="modal-title"><span aria-hidden="true">${MEAL_ICONS[dialog.meal]}</span> Aggiungi a ${escapeHtml(MEAL_LABELS[dialog.meal])}</h3>
          <button type="button" class="modal-close" data-search-action="close" aria-label="Chiudi">✕</button>
        </div>
        <div class="search-tabs" data-search-zone="tabs"></div>
        <div data-search-zone="searchbox"></div>
        <div class="search-list" data-search-zone="list"></div>
        <div class="modal-footer search-footer" data-search-zone="footer"></div>
      </div>
    </div>
  `;
}

// ============ Content render ============

export function updateSearchContent(overlay: HTMLElement): void {
  const s = getState();
  const list = currentList();

  const tabsEl = overlay.querySelector<HTMLElement>('[data-search-zone="tabs"]');
  if (tabsEl) {
    const favoritesCount = s.foods.filter((f) => s.favoriteFoodIds.includes(f.id)).length;
    const savedCount = s.foods.length;
    const tabBtn = (id: 'favorites' | 'saved' | 'search', label: string, icon: string, disabled: boolean) => `
      <button type="button" class="tab-btn${_searchState.tab === id ? ' active' : ''}" data-search-action="switchTab" data-tab="${id}"${disabled ? ' disabled' : ''}>
        <span aria-hidden="true">${icon}</span> ${escapeHtml(label)}
      </button>
    `;
    const tabsHtml = `
      ${tabBtn('favorites', 'Preferiti', '★', favoritesCount === 0)}
      ${tabBtn('saved', 'Salvati', '', savedCount === 0)}
      ${tabBtn('search', 'Cerca', '🔍', false)}
    `;
    if (tabsEl.innerHTML !== tabsHtml) tabsEl.innerHTML = tabsHtml;
    if (_searchState.tab === 'favorites' && favoritesCount === 0) {
      _searchState.tab = savedCount > 0 ? 'saved' : 'search';
      emitChange();
    }
  }

  const searchBoxEl = overlay.querySelector<HTMLElement>('[data-search-zone="searchbox"]');
  if (searchBoxEl) {
    const shouldShow = _searchState.tab === 'search';
    const wasShowing = searchBoxEl.children.length > 0;
    if (shouldShow && !wasShowing) {
      searchBoxEl.innerHTML = `
        <div class="search-row">
          <div class="search-box">
            <span class="search-icon" aria-hidden="true">🔍</span>
            <input id="search-input" type="search" placeholder="Cerca su Open Food Facts (es. pasta, yogurt…)" autocomplete="off" />
            ${_searchState.query ? '<button type="button" class="search-clear" data-search-action="clearQuery" aria-label="Pulisci">✕</button>' : '<button type="button" class="search-clear" data-search-action="clearQuery" aria-label="Pulisci" style="display:none">✕</button>'}
          </div>
          <button type="button" class="scan-btn" data-search-action="scanBarcode" aria-label="Scansiona codice a barre" title="Scansiona codice a barre">
            <span aria-hidden="true">📷</span>
          </button>
        </div>
        <p class="search-hint">Database gratuito collaborativo - milioni di prodotti. Powered by Open Food Facts. Usa 📷 per scansionare il codice a barre.</p>
      `;
      const input = searchBoxEl.querySelector<HTMLInputElement>('#search-input');
      if (input) input.value = _searchState.query;
      requestAnimationFrame(() => {
        if (!isSearchOpen()) return;
        const inp = searchBoxEl.querySelector<HTMLInputElement>('#search-input');
        if (inp && document.activeElement === document.body) inp.focus();
      });
    } else if (!shouldShow && wasShowing) {
      searchBoxEl.innerHTML = '';
    } else if (shouldShow && wasShowing) {
      const clearBtn = searchBoxEl.querySelector<HTMLElement>('.search-clear');
      if (clearBtn) clearBtn.style.display = _searchState.query ? '' : 'none';
    }
  }

  const listEl = overlay.querySelector<HTMLElement>('[data-search-zone="list"]');
  if (listEl) {
    let listHtml: string;
    if (_searchState.loading) {
      listHtml = `<div class="search-loading"><span class="spinner" aria-hidden="true"></span> Ricerca in corso…</div>`;
    } else if (list.length === 0) {
      listHtml = `<div class="search-empty">${escapeHtml(renderEmptyHint())}</div>`;
    } else {
      listHtml = list.map((f) => renderFoodRow(f)).join('');
      if (
        _searchState.tab === 'search' &&
        _searchState.totalCount > list.length &&
        _searchState.query.trim().length >= SEARCH_MIN_QUERY
      ) {
        const remaining = _searchState.totalCount - list.length;
        listHtml += `<div class="search-load-more"><button type="button" class="btn btn-outline btn-sm btn-block" data-search-action="loadMore">Carica altri risultati (${remaining} restanti)</button></div>`;
      }
    }
    if (listEl.innerHTML !== listHtml) listEl.innerHTML = listHtml;
  }

  const footerEl = overlay.querySelector<HTMLElement>('[data-search-zone="footer"]');
  if (footerEl) {
    const selectedFood = _searchState.selectedId ? list.find((x) => x.id === _searchState.selectedId) : null;
    const footerHtml = selectedFood ? renderSelectedFooter(selectedFood) : renderActionsFooter();
    if (footerEl.innerHTML !== footerHtml) footerEl.innerHTML = footerHtml;
  }
}

function renderSelectedFooter(selectedFood: FoodItem): string {
  const gramsParsed = Number(_searchState.gramsOverride);
  const selectedGrams =
    _searchState.gramsOverride && Number.isFinite(gramsParsed) && gramsParsed > 0
      ? gramsParsed
      : selectedFood.servingSize;
  const selectedNutrition = {
    calories: Math.round((selectedFood.nutrition.calories * selectedGrams) / 100),
    protein: Math.round((selectedFood.nutrition.protein * selectedGrams) / 100),
    carbs: Math.round((selectedFood.nutrition.carbs * selectedGrams) / 100),
    fat: Math.round((selectedFood.nutrition.fat * selectedGrams) / 100),
  };
  const allPortions: CustomPortion[] = [...(selectedFood.customPortions || []), ..._searchState.pendingCustomPortions];
  const portionsHtml =
    allPortions.length > 0
      ? `
      <div class="portion-chips">
        ${allPortions
          .map(
            (p) => `
          <button type="button" class="portion-chip${Number(_searchState.gramsOverride) === p.grams ? ' active' : ''}" data-search-action="usePortion" data-grams="${p.grams}">
            <span class="portion-chip-label">${escapeHtml(p.label)}</span>
            <span class="portion-chip-grams">${p.grams}g</span>
            <span class="portion-chip-del" data-search-action="deleteCustomPortion" data-food-id="${escapeAttr(selectedFood.id)}" data-portion-id="${escapeAttr(p.id)}" role="button" aria-label="Elimina porzione">✕</span>
          </button>
        `,
          )
          .join('')}
      </div>
    `
      : '';

  const createPortionHtml = _searchState.creatingPortion
    ? `
      <div class="portion-create-form">
        <div class="portion-create-grid">
          <input id="new-portion-label" type="text" placeholder="Nome (es. 1 fetta, 1 tazza)" value="${escapeAttr(_searchState.newPortionLabel)}" />
          <input id="new-portion-grams" type="number" min="0" step="0.1" placeholder="Grammi" value="${escapeAttr(_searchState.newPortionGrams)}" />
        </div>
        <div class="portion-create-actions">
          <button type="button" class="btn btn-outline btn-sm" data-search-action="cancelCreatePortion">Annulla</button>
          <button type="button" class="btn btn-primary btn-sm" data-search-action="confirmCreatePortion">Salva porzione</button>
        </div>
      </div>
    `
    : `
      <button type="button" class="btn btn-outline btn-sm btn-block portion-create-btn" data-search-action="startCreatePortion">
        <span aria-hidden="true">＋</span> Crea porzione personalizzata
      </button>
    `;

  return `
    <div class="search-selected">
      <div class="selected-head">
        <div class="selected-info">
          <p class="selected-name">${escapeHtml(selectedFood.name)}</p>
          ${selectedFood.brand ? `<p class="selected-brand">${escapeHtml(selectedFood.brand)}</p>` : ''}
          <div class="badge-row">
            <span class="badge badge-secondary">${Math.round(selectedFood.nutrition.calories)} kcal / 100g</span>
            <span class="badge">P ${Math.round(selectedFood.nutrition.protein)}g</span>
            <span class="badge">C ${Math.round(selectedFood.nutrition.carbs)}g</span>
            <span class="badge">G ${Math.round(selectedFood.nutrition.fat)}g</span>
          </div>
        </div>
        <button type="button" class="icon-btn" data-search-action="clearSelected" aria-label="Deseleziona">✕</button>
      </div>
      <div class="qty-row-single">
        <label for="grams-input" class="field-label">Grammi / ml</label>
        <input id="grams-input" type="number" min="0" max="10000" step="0.1" placeholder="es. 150" value="${escapeAttr(_searchState.gramsOverride)}" />
      </div>
      <div class="portion-section">
        <p class="portion-section-title">Porzioni personalizzate</p>
        ${portionsHtml}
        ${createPortionHtml}
      </div>
      <div class="stat-row">
        ${renderStatBox('kcal', String(selectedNutrition.calories))}
        ${renderStatBox('Proteine', `${selectedNutrition.protein}g`)}
        ${renderStatBox('Carbo', `${selectedNutrition.carbs}g`)}
        ${renderStatBox('Grassi', `${selectedNutrition.fat}g`)}
      </div>
    </div>
    <button type="button" class="btn btn-primary btn-block btn-lg" data-search-action="confirm">Aggiungi al diario</button>
  `;
}

function renderActionsFooter(): string {
  return `
    <div class="search-actions-row">
      <button type="button" class="btn btn-outline" data-search-action="openAddCustom">
        <span aria-hidden="true">＋</span> Crea ingrediente custom
      </button>
      <button type="button" class="btn btn-secondary" data-search-action="switchTab" data-tab="search">
        <span aria-hidden="true">🔍</span> Cerca su OFF
      </button>
    </div>
  `;
}

function renderEmptyHint(): string {
  if (_searchState.tab === 'search') {
    if (_searchState.query.trim().length < SEARCH_MIN_QUERY) {
      return 'Inizia a digitare per cercare prodotti reali nel database Open Food Facts.';
    }
    return 'Nessun risultato. Prova con un altro termine o crea un ingrediente custom.';
  }
  if (_searchState.tab === 'favorites') return 'Aggiungi ai preferiti i cibi che consumi spesso cliccando la stellina.';
  return 'Nessun alimento salvato. Cerca su Open Food Facts o crea un ingrediente custom.';
}

function renderFoodRow(f: FoodItem): string {
  const s = getState();
  const isFav = s.favoriteFoodIds.includes(f.id);
  const isSelected = _searchState.selectedId === f.id;
  return `
    <div class="food-row${isSelected ? ' selected' : ''}" data-search-action="selectFood" data-food-id="${escapeAttr(f.id)}" role="button" tabindex="0">
      ${imgTag(f.image, f.name, 'thumb', f.source === 'custom' ? '✏️' : '🥫')}
      <div class="food-row-info">
        <p class="food-row-name">${escapeHtml(f.name)}</p>
        ${f.brand ? `<p class="food-row-brand">${escapeHtml(f.brand)}</p>` : ''}
        <p class="food-row-meta">
          <strong>${Math.round(f.nutrition.calories)} kcal</strong> / 100g
          · P${Math.round(f.nutrition.protein)} C${Math.round(f.nutrition.carbs)} G${Math.round(f.nutrition.fat)}
        </p>
      </div>
      <button type="button" class="fav-btn${isFav ? ' active' : ''}" data-search-action="toggleFav" data-food-id="${escapeAttr(f.id)}" aria-label="Aggiungi ai preferiti">
        ${isFav ? '★' : '☆'}
      </button>
    </div>
  `;
}

function renderStatBox(label: string, value: string): string {
  return `<div class="stat-box"><p class="stat-label">${escapeHtml(label)}</p><p class="stat-value">${escapeHtml(value)}</p></div>`;
}

// Aggiorna la lista del parent dopo la creazione di un alimento custom figlio.
export function refreshSearchAfterCustomFood(): void {
  if (!isSearchOpen()) return;
  _searchState.tab = 'saved';
  emitChange();
}
