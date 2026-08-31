// Search dialog: preferiti, salvati e ricerca esplicita Open Food Facts.
// La digitazione aggiorna solo stato UI locale: la rete viene usata esclusivamente
// quando l'utente preme Cerca/Invio, oppure richiede esplicitamente un'altra pagina.

import { escapeAttr, escapeHtml, safeId } from '../lib/utils';
import { getOffByBarcode, searchOff } from '../lib/api';
import { buildFoodFromOff } from '../lib/normalize';
import { getItOverrideByBarcode } from '../lib/itOverride';
import { closeFoodSearch, emitChange, getState, openFoodEditor } from '../lib/store';
import { addFoodToDiary } from '../lib/diary';
import { addCustomPortionToFood, removeCustomPortionFromFood, saveOffFood, toggleFoodFavorite } from '../lib/foods';
import { showToast } from './toast';
import { imgTag } from './img';
import { isBarcodeScannerOpen, openBarcodeScanner } from './barcode-scanner';
import { SEARCH_AUTO_RETRY_DELAY_MS, SEARCH_MIN_QUERY } from '../lib/constants';
import type { CustomPortion, FoodItem } from '../types';
import { MEAL_ICONS, MEAL_LABELS } from '../types';

type SearchTab = 'favorites' | 'saved' | 'search';

interface SearchDialogState {
  tab: SearchTab;
  query: string;
  /** Query dell'ultima ricerca effettivamente inviata a OFF. */
  submittedQuery: string;
  loading: boolean;
  results: FoodItem[];
  selectedId: string | null;
  gramsOverride: string;
  pendingCustomPortions: CustomPortion[];
  creatingPortion: boolean;
  newPortionLabel: string;
  newPortionGrams: string;
  abortController: AbortController | null;
  page: number;
  totalCount: number;
  barcodeRetryDone: boolean;
}

const _searchState: SearchDialogState = {
  tab: 'favorites',
  query: '',
  submittedQuery: '',
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
  barcodeRetryDone: false,
};

function abortInFlightSearch(): void {
  _searchState.abortController?.abort();
  _searchState.abortController = null;
  _searchState.loading = false;
}

function resetSearchState(): void {
  abortInFlightSearch();
  _searchState.tab = 'favorites';
  _searchState.query = '';
  _searchState.submittedQuery = '';
  _searchState.loading = false;
  _searchState.results = [];
  _searchState.selectedId = null;
  _searchState.gramsOverride = '';
  _searchState.pendingCustomPortions = [];
  _searchState.creatingPortion = false;
  _searchState.newPortionLabel = '';
  _searchState.newPortionGrams = '';
  _searchState.page = 1;
  _searchState.totalCount = 0;
  _searchState.barcodeRetryDone = false;
}

function clearSelection(): void {
  _searchState.selectedId = null;
  _searchState.gramsOverride = '';
  _searchState.pendingCustomPortions = [];
  _searchState.creatingPortion = false;
  _searchState.newPortionLabel = '';
  _searchState.newPortionGrams = '';
}

function currentList(): FoodItem[] {
  const state = getState();
  if (_searchState.tab === 'favorites') return state.foods.filter((food) => state.favoriteFoodIds.includes(food.id));
  if (_searchState.tab === 'saved') return state.foods;
  return _searchState.results;
}

function errorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'OfflineError' || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    return 'Sei offline. Verifica la connessione e riprova.';
  }
  if (name === 'RateLimitError')
    return 'Hai effettuato troppe ricerche ravvicinate. Attendi qualche secondo e riprova.';
  if (name === 'NetworkError') return 'Open Food Facts non raggiungibile. Riprova tra qualche secondo.';
  if (name === 'TimeoutError') return 'Risposta di Open Food Facts troppo lenta. Riprova tra poco.';
  return 'Database Open Food Facts temporaneamente non disponibile. Riprova tra poco.';
}

async function executeSearch(query: string, page = 1): Promise<void> {
  if (!getState()._searchOpen) return;
  const trimmed = query.trim();
  if (trimmed.length < SEARCH_MIN_QUERY) {
    _searchState.results = [];
    _searchState.submittedQuery = '';
    _searchState.page = 1;
    _searchState.totalCount = 0;
    emitChange();
    return;
  }

  abortInFlightSearch();
  const controller = new AbortController();
  _searchState.abortController = controller;
  _searchState.loading = true;
  _searchState.submittedQuery = trimmed;
  if (page === 1) clearSelection();
  emitChange();

  try {
    const data = await searchOff(trimmed, {
      signal: controller.signal,
      italianOnly: true,
      page,
    });
    if (controller.signal.aborted || !getState()._searchOpen) return;
    const items = data.products.map(buildFoodFromOff).filter((food): food is FoodItem => food !== null);
    if (page === 1) {
      _searchState.results = items;
    } else {
      // OFF ids sono temporanei/random: dedupe per barcode, fallback name+brand.
      const identity = (food: FoodItem) =>
        food.barcode
          ? `barcode:${food.barcode}`
          : `name:${food.name.toLowerCase()}:${(food.brand ?? '').toLowerCase()}`;
      const existing = new Set(_searchState.results.map(identity));
      _searchState.results = [..._searchState.results, ...items.filter((food) => !existing.has(identity(food)))];
    }
    _searchState.page = page;
    _searchState.totalCount = data.count;
  } catch (error) {
    if (controller.signal.aborted || !getState()._searchOpen) return;
    if (page === 1) _searchState.results = [];
    showToast(errorMessage(error), 'error', 5000);
  } finally {
    if (_searchState.abortController === controller) _searchState.abortController = null;
    _searchState.loading = false;
    if (getState()._searchOpen) emitChange();
  }
}

function submitSearch(): void {
  const query = _searchState.query.trim();
  if (query.length < SEARCH_MIN_QUERY) {
    showToast(`Inserisci almeno ${SEARCH_MIN_QUERY} caratteri`, 'info');
    return;
  }
  void executeSearch(query, 1);
}

function loadMoreResults(): void {
  if (_searchState.loading) return;
  if (!_searchState.submittedQuery) return;
  if (_searchState.totalCount > 0 && _searchState.results.length >= _searchState.totalCount) return;
  void executeSearch(_searchState.submittedQuery, _searchState.page + 1);
}

let _boundSearch = false;

function hasUnsavedPortionChanges(): boolean {
  return _searchState.pendingCustomPortions.length > 0 || _searchState.creatingPortion;
}

function requestClose(): void {
  if (hasUnsavedPortionChanges() && !confirm('Hai modifiche non salvate alle porzioni. Chiudere comunque?')) return;
  closeFoodSearch();
  resetSearchState();
}

export function bindSearchEvents(): void {
  if (_boundSearch) return;
  _boundSearch = true;

  document.addEventListener(
    'keydown',
    (event) => {
      if (!getState()._searchOpen || event.key !== 'Escape') return;
      const overlays = document.querySelectorAll('.modal-overlay');
      const top = overlays[overlays.length - 1] as HTMLElement | undefined;
      if (top?.dataset.modalId !== 'search-dialog') return;
      event.stopPropagation();
      event.preventDefault();
      requestClose();
    },
    true,
  );

  document.addEventListener('click', (event) => {
    if (!getState()._searchOpen) return;
    const rawTarget = event.target as HTMLElement;
    if (rawTarget.classList.contains('modal-overlay') && rawTarget.dataset.modalId === 'search-dialog') {
      requestClose();
      return;
    }

    const target = rawTarget.closest<HTMLElement>('[data-search-action]');
    if (!target) return;
    const action = target.dataset.searchAction;

    switch (action) {
      case 'switchTab': {
        const tab = target.dataset.tab as SearchTab | undefined;
        if (!tab || tab === _searchState.tab) return;
        if (_searchState.tab === 'search') abortInFlightSearch();
        _searchState.tab = tab;
        clearSelection();
        emitChange();
        return;
      }
      case 'submitSearch':
        submitSearch();
        return;
      case 'selectFood': {
        const food = currentList().find((item) => item.id === target.dataset.foodId);
        if (!food) return;
        if (_searchState.selectedId !== food.id) {
          clearSelection();
          _searchState.selectedId = food.id;
          _searchState.gramsOverride = String(food.servingSize || 100);
        }
        emitChange();
        return;
      }
      case 'toggleFav': {
        const id = target.dataset.foodId || '';
        if (!id) return;
        if (!getState().foods.some((food) => food.id === id)) {
          const offFood = currentList().find((food) => food.id === id);
          if (offFood?.source === 'openfoodfacts') {
            const saved = saveOffFood(offFood);
            toggleFoodFavorite(saved.id);
            showToast(`${saved.name} salvato nei tuoi alimenti`, 'success');
            return;
          }
        }
        toggleFoodFavorite(id);
        return;
      }
      case 'clearSelected':
        clearSelection();
        emitChange();
        return;
      case 'confirm':
        confirmAdd();
        return;
      case 'close':
        requestClose();
        return;
      case 'openAddCustom':
        openFoodEditor('new');
        return;
      case 'clearQuery': {
        abortInFlightSearch();
        _searchState.query = '';
        _searchState.submittedQuery = '';
        _searchState.results = [];
        _searchState.page = 1;
        _searchState.totalCount = 0;
        clearSelection();
        const input = document.querySelector<HTMLInputElement>('#search-input');
        if (input) {
          input.value = '';
          input.focus();
        }
        emitChange();
        return;
      }
      case 'scanBarcode':
        if (!isBarcodeScannerOpen()) {
          openBarcodeScanner({
            onDetected: (barcode) => void handleBarcodeDetected(barcode),
            onError: () => undefined,
          });
        }
        return;
      case 'loadMore':
        loadMoreResults();
        return;
      case 'usePortion': {
        const grams = Number(target.dataset.grams || '0');
        if (grams > 0) {
          _searchState.gramsOverride = String(grams);
          _searchState.creatingPortion = false;
          emitChange();
        }
        return;
      }
      case 'startCreatePortion':
        _searchState.creatingPortion = true;
        _searchState.newPortionLabel = '';
        _searchState.newPortionGrams = _searchState.gramsOverride || '';
        emitChange();
        requestAnimationFrame(() => document.querySelector<HTMLInputElement>('#new-portion-label')?.focus());
        return;
      case 'cancelCreatePortion':
        _searchState.creatingPortion = false;
        _searchState.newPortionLabel = '';
        _searchState.newPortionGrams = '';
        emitChange();
        return;
      case 'confirmCreatePortion':
        createCustomPortion();
        return;
      case 'deleteCustomPortion':
        deleteCustomPortion(target.dataset.foodId || '', target.dataset.portionId || '');
        return;
    }
  });

  document.addEventListener('input', (event) => {
    if (!getState()._searchOpen) return;
    const target = event.target as HTMLElement;
    if (target.id === 'search-input') {
      abortInFlightSearch();
      _searchState.query = (target as HTMLInputElement).value;
      _searchState.tab = 'search';
      _searchState.submittedQuery = '';
      _searchState.results = [];
      _searchState.page = 1;
      _searchState.totalCount = 0;
      clearSelection();
      emitChange();
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
    }
  });

  document.addEventListener('keydown', (event) => {
    if (!getState()._searchOpen) return;
    const target = event.target as HTMLElement;
    if (event.key === 'Enter' && target.id === 'search-input') {
      event.preventDefault();
      submitSearch();
      return;
    }
    if (event.key === 'Enter' && (target.id === 'new-portion-label' || target.id === 'new-portion-grams')) {
      event.preventDefault();
      createCustomPortion();
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && target.closest('[data-search-action="selectFood"]')) {
      event.preventDefault();
      (target.closest('[data-search-action="selectFood"]') as HTMLElement).click();
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && target.closest('[data-search-action="deleteCustomPortion"]')) {
      event.preventDefault();
      (target.closest('[data-search-action="deleteCustomPortion"]') as HTMLElement).click();
    }
  });
}

// ============ Barcode ============

async function handleBarcodeDetected(barcode: string): Promise<void> {
  if (!getState()._searchOpen) return;
  abortInFlightSearch();
  _searchState.tab = 'search';
  _searchState.loading = true;
  _searchState.query = barcode;
  _searchState.submittedQuery = barcode;
  _searchState.results = [];
  clearSelection();
  document.querySelector<HTMLInputElement>('#search-input')?.setAttribute('value', barcode);
  const input = document.querySelector<HTMLInputElement>('#search-input');
  if (input) input.value = barcode;
  emitChange();

  try {
    const state = getState();
    const saved = state.foods.find((food) => food.barcode === barcode);
    if (saved) {
      selectBarcodeResult(saved, '(tuo salvato)');
      return;
    }
    const local = getItOverrideByBarcode(barcode);
    if (local) {
      selectBarcodeResult(local, '(DB italiano)');
      return;
    }
    const product = await getOffByBarcode(barcode);
    if (!getState()._searchOpen) return;
    if (!product) {
      _searchState.results = [];
      showToast(`Nessun prodotto trovato per il codice ${barcode}.`, 'info', 4000);
      return;
    }
    const food = buildFoodFromOff(product);
    if (!food) {
      showToast('Prodotto trovato ma con dati nutrizionali incompleti.', 'info', 4000);
      return;
    }
    selectBarcodeResult(food, '');
  } catch (error) {
    if (!getState()._searchOpen) return;
    const name = error instanceof Error ? error.name : '';
    const status = (error as { status?: number }).status;
    const transient = name === 'NetworkError' || name === 'TimeoutError' || (status !== undefined && status >= 500);
    if (transient && !_searchState.barcodeRetryDone) {
      _searchState.barcodeRetryDone = true;
      setTimeout(() => {
        if (getState()._searchOpen) void handleBarcodeDetected(barcode);
      }, SEARCH_AUTO_RETRY_DELAY_MS);
      return;
    }
    showToast(errorMessage(error), 'error', 5000);
  } finally {
    _searchState.loading = false;
    if (getState()._searchOpen) emitChange();
  }
}

function selectBarcodeResult(food: FoodItem, suffix: string): void {
  _searchState.results = [food];
  _searchState.selectedId = food.id;
  _searchState.gramsOverride = String(food.servingSize || 100);
  _searchState.loading = false;
  showToast(`${food.name}${suffix ? ` ${suffix}` : ''}`, 'success', 2200);
}

// ============ Domain actions ============

function confirmAdd(): void {
  const state = getState();
  const food = _searchState.selectedId ? currentList().find((item) => item.id === _searchState.selectedId) : undefined;
  if (!food) {
    showToast('Seleziona un alimento', 'info');
    return;
  }
  const raw = _searchState.gramsOverride.trim();
  const grams = Number(raw.replace(',', '.'));
  if (!raw || !Number.isFinite(grams) || grams <= 0) {
    showToast('Inserisci una quantità in grammi valida', 'error');
    return;
  }
  if (grams > 10_000) {
    showToast('Grammi eccessivi (max 10 kg per singola voce)', 'error');
    return;
  }
  const foodToSave =
    _searchState.pendingCustomPortions.length > 0
      ? { ...food, customPortions: [...(food.customPortions || []), ..._searchState.pendingCustomPortions] }
      : food;
  addFoodToDiary({
    date: state._searchDate,
    meal: state._searchMeal,
    food: foodToSave,
    quantity: 1,
    gramsOverride: grams,
  });
  resetSearchState();
}

function createCustomPortion(): void {
  const food = _searchState.selectedId ? currentList().find((item) => item.id === _searchState.selectedId) : undefined;
  if (!food) return;
  const label = _searchState.newPortionLabel.trim();
  const grams = Number(_searchState.newPortionGrams.replace(',', '.'));
  if (!label) {
    showToast('Inserisci un nome per la porzione', 'info');
    return;
  }
  if (!Number.isFinite(grams) || grams <= 0) {
    showToast('Inserisci i grammi della porzione', 'info');
    return;
  }

  if (getState().foods.some((item) => item.id === food.id)) {
    addCustomPortionToFood(food.id, label, grams);
  } else {
    const duplicate = _searchState.pendingCustomPortions.some(
      (portion) => portion.label.toLowerCase() === label.toLowerCase(),
    );
    if (duplicate) {
      showToast(`Porzione "${label}" già presente`, 'warning');
      return;
    }
    _searchState.pendingCustomPortions = [
      ..._searchState.pendingCustomPortions,
      { id: safeId('port_'), label, grams: Math.max(0.1, Math.round(grams * 10) / 10) },
    ];
  }
  _searchState.creatingPortion = false;
  _searchState.newPortionLabel = '';
  _searchState.newPortionGrams = '';
  emitChange();
}

function deleteCustomPortion(foodId: string, portionId: string): void {
  if (getState().foods.some((food) => food.id === foodId)) {
    removeCustomPortionFromFood(foodId, portionId);
  } else {
    _searchState.pendingCustomPortions = _searchState.pendingCustomPortions.filter(
      (portion) => portion.id !== portionId,
    );
    emitChange();
  }
}

// ============ Render ============

export function renderSearchShell(): string {
  const state = getState();
  return `
    <div class="modal-overlay modal-show" data-modal-id="search-dialog">
      <div class="modal modal-search" role="dialog" aria-modal="true">
        <div class="modal-header">
          <h3 class="modal-title"><span aria-hidden="true">${MEAL_ICONS[state._searchMeal]}</span> Aggiungi a ${escapeHtml(MEAL_LABELS[state._searchMeal])}</h3>
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

export function updateSearchContent(overlay: HTMLElement): void {
  const state = getState();
  const list = currentList();
  const favoritesCount = state.foods.filter((food) => state.favoriteFoodIds.includes(food.id)).length;
  const savedCount = state.foods.length;

  if (_searchState.tab === 'favorites' && favoritesCount === 0) {
    _searchState.tab = savedCount > 0 ? 'saved' : 'search';
  }

  const tabs = overlay.querySelector<HTMLElement>('[data-search-zone="tabs"]');
  if (tabs) {
    const tab = (id: SearchTab, label: string, icon: string, disabled = false) => `
      <button type="button" class="tab-btn${_searchState.tab === id ? ' active' : ''}" data-search-action="switchTab" data-tab="${id}"${disabled ? ' disabled' : ''}>
        <span aria-hidden="true">${icon}</span> ${escapeHtml(label)}
      </button>`;
    tabs.innerHTML = [
      tab('favorites', 'Preferiti', '★', favoritesCount === 0),
      tab('saved', 'Salvati', '', savedCount === 0),
      tab('search', 'Cerca', '🔍'),
    ].join('');
  }

  renderSearchBox(overlay);

  const listEl = overlay.querySelector<HTMLElement>('[data-search-zone="list"]');
  if (listEl) {
    if (_searchState.loading) {
      listEl.innerHTML = `<div class="search-loading"><span class="spinner" aria-hidden="true"></span> Ricerca in corso…</div>`;
    } else if (list.length === 0) {
      listEl.innerHTML = `<div class="search-empty">${escapeHtml(renderEmptyHint())}</div>`;
    } else {
      let html = list.map(renderFoodRow).join('');
      if (
        _searchState.tab === 'search' &&
        _searchState.submittedQuery &&
        _searchState.totalCount > _searchState.results.length
      ) {
        const remaining = _searchState.totalCount - _searchState.results.length;
        html += `<div class="search-load-more"><button type="button" class="btn btn-outline btn-sm btn-block" data-search-action="loadMore">Carica altri risultati (${remaining} restanti)</button></div>`;
      }
      listEl.innerHTML = html;
    }
  }

  const footer = overlay.querySelector<HTMLElement>('[data-search-zone="footer"]');
  if (footer) {
    const selected = _searchState.selectedId ? list.find((food) => food.id === _searchState.selectedId) : undefined;
    footer.innerHTML = selected ? renderSelectedFooter(selected) : renderActionsFooter();
  }
}

function renderSearchBox(overlay: HTMLElement): void {
  const zone = overlay.querySelector<HTMLElement>('[data-search-zone="searchbox"]');
  if (!zone) return;
  if (_searchState.tab !== 'search') {
    zone.innerHTML = '';
    return;
  }

  const existingInput = zone.querySelector<HTMLInputElement>('#search-input');
  if (!existingInput) {
    zone.innerHTML = `
      <div class="search-row">
        <div class="search-box">
          <span class="search-icon" aria-hidden="true">🔍</span>
          <input id="search-input" type="search" placeholder="Cerca su Open Food Facts" autocomplete="off" />
          <button type="button" class="search-clear" data-search-action="clearQuery" aria-label="Pulisci">✕</button>
        </div>
        <button type="button" class="btn btn-primary btn-sm" data-search-action="submitSearch">Cerca</button>
        <button type="button" class="scan-btn" data-search-action="scanBarcode" aria-label="Scansiona codice a barre" title="Scansiona codice a barre"><span aria-hidden="true">📷</span></button>
      </div>
      <p class="search-hint">Digita il termine e premi Cerca o Invio. Le ricerche non vengono inviate durante la digitazione.</p>`;
    const input = zone.querySelector<HTMLInputElement>('#search-input');
    if (input) input.value = _searchState.query;
    requestAnimationFrame(() => input?.focus());
  }
  const clear = zone.querySelector<HTMLElement>('.search-clear');
  if (clear) clear.style.display = _searchState.query ? '' : 'none';
}

function renderSelectedFooter(food: FoodItem): string {
  const parsed = Number(_searchState.gramsOverride.replace(',', '.'));
  const grams = Number.isFinite(parsed) && parsed > 0 ? parsed : food.servingSize;
  const nutrition = {
    calories: Math.round((food.nutrition.calories * grams) / 100),
    protein: Math.round((food.nutrition.protein * grams) / 100),
    carbs: Math.round((food.nutrition.carbs * grams) / 100),
    fat: Math.round((food.nutrition.fat * grams) / 100),
  };
  const portions = [...(food.customPortions || []), ..._searchState.pendingCustomPortions];
  const portionsHtml = portions
    .map(
      (portion) => `
        <button type="button" class="portion-chip${grams === portion.grams ? ' active' : ''}" data-search-action="usePortion" data-grams="${portion.grams}">
          <span class="portion-chip-label">${escapeHtml(portion.label)}</span>
          <span class="portion-chip-grams">${portion.grams}g</span>
          <span class="portion-chip-del" data-search-action="deleteCustomPortion" data-food-id="${escapeAttr(food.id)}" data-portion-id="${escapeAttr(portion.id)}" role="button" tabindex="0" aria-label="Elimina porzione">✕</span>
        </button>`,
    )
    .join('');
  const createPortion = _searchState.creatingPortion
    ? `<div class="portion-create-form">
        <div class="portion-create-grid">
          <input id="new-portion-label" type="text" placeholder="Nome (es. 1 fetta)" value="${escapeAttr(_searchState.newPortionLabel)}" />
          <input id="new-portion-grams" type="number" min="0.1" step="0.1" placeholder="Grammi" value="${escapeAttr(_searchState.newPortionGrams)}" />
        </div>
        <div class="portion-create-actions">
          <button type="button" class="btn btn-outline btn-sm" data-search-action="cancelCreatePortion">Annulla</button>
          <button type="button" class="btn btn-primary btn-sm" data-search-action="confirmCreatePortion">Salva porzione</button>
        </div>
      </div>`
    : `<button type="button" class="btn btn-outline btn-sm btn-block portion-create-btn" data-search-action="startCreatePortion"><span aria-hidden="true">＋</span> Crea porzione personalizzata</button>`;

  return `
    <div class="search-selected">
      <div class="selected-head">
        <div class="selected-info">
          <p class="selected-name">${escapeHtml(food.name)}</p>
          ${food.brand ? `<p class="selected-brand">${escapeHtml(food.brand)}</p>` : ''}
          <div class="badge-row">
            <span class="badge badge-secondary">${Math.round(food.nutrition.calories)} kcal / 100g</span>
            <span class="badge">P ${Math.round(food.nutrition.protein)}g</span>
            <span class="badge">C ${Math.round(food.nutrition.carbs)}g</span>
            <span class="badge">G ${Math.round(food.nutrition.fat)}g</span>
          </div>
        </div>
        <button type="button" class="icon-btn" data-search-action="clearSelected" aria-label="Deseleziona">✕</button>
      </div>
      <div class="qty-row-single">
        <label for="grams-input" class="field-label">Grammi / ml</label>
        <input id="grams-input" type="number" min="0.1" max="10000" step="0.1" value="${escapeAttr(_searchState.gramsOverride)}" />
      </div>
      <div class="portion-section">
        <p class="portion-section-title">Porzioni personalizzate</p>
        ${portionsHtml ? `<div class="portion-chips">${portionsHtml}</div>` : ''}
        ${createPortion}
      </div>
      <div class="stat-row">
        ${renderStatBox('kcal', String(nutrition.calories))}
        ${renderStatBox('Proteine', `${nutrition.protein}g`)}
        ${renderStatBox('Carbo', `${nutrition.carbs}g`)}
        ${renderStatBox('Grassi', `${nutrition.fat}g`)}
      </div>
    </div>
    <button type="button" class="btn btn-primary btn-block btn-lg" data-search-action="confirm">Aggiungi al diario</button>`;
}

function renderActionsFooter(): string {
  return `<div class="search-actions-row">
    <button type="button" class="btn btn-outline" data-search-action="openAddCustom"><span aria-hidden="true">＋</span> Crea ingrediente custom</button>
    <button type="button" class="btn btn-secondary" data-search-action="switchTab" data-tab="search"><span aria-hidden="true">🔍</span> Cerca su OFF</button>
  </div>`;
}

function renderEmptyHint(): string {
  if (_searchState.tab === 'search') {
    if (_searchState.query.trim().length < SEARCH_MIN_QUERY) return `Inserisci almeno ${SEARCH_MIN_QUERY} caratteri.`;
    if (!_searchState.submittedQuery) return 'Premi Cerca o Invio per interrogare Open Food Facts.';
    return 'Nessun risultato. Prova con un altro termine o crea un ingrediente custom.';
  }
  if (_searchState.tab === 'favorites') return 'Aggiungi ai preferiti i cibi che consumi spesso cliccando la stellina.';
  return 'Nessun alimento salvato. Cerca su Open Food Facts o crea un ingrediente custom.';
}

function renderFoodRow(food: FoodItem): string {
  const state = getState();
  const favorite = state.favoriteFoodIds.includes(food.id);
  const selected = _searchState.selectedId === food.id;
  return `
    <div class="food-row${selected ? ' selected' : ''}" data-search-action="selectFood" data-food-id="${escapeAttr(food.id)}" role="button" tabindex="0">
      ${imgTag(food.image, food.name, 'thumb', food.source === 'custom' ? '✏️' : '🥫')}
      <div class="food-row-info">
        <p class="food-row-name">${escapeHtml(food.name)}</p>
        ${food.brand ? `<p class="food-row-brand">${escapeHtml(food.brand)}</p>` : ''}
        <p class="food-row-meta"><strong>${Math.round(food.nutrition.calories)} kcal</strong> / 100g · P${Math.round(food.nutrition.protein)} C${Math.round(food.nutrition.carbs)} G${Math.round(food.nutrition.fat)}</p>
      </div>
      <button type="button" class="fav-btn${favorite ? ' active' : ''}" data-search-action="toggleFav" data-food-id="${escapeAttr(food.id)}" aria-label="${favorite ? 'Rimuovi dai' : 'Aggiungi ai'} preferiti">${favorite ? '★' : '☆'}</button>
    </div>`;
}

function renderStatBox(label: string, value: string): string {
  return `<div class="stat-box"><p class="stat-label">${escapeHtml(label)}</p><p class="stat-value">${escapeHtml(value)}</p></div>`;
}

export function refreshSearchAfterCustomFood(): void {
  _searchState.tab = 'saved';
  clearSelection();
  emitChange();
}
