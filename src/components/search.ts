// Search dialog: ricerca OFF con debounce + AbortController + keyboard nav.
// Tabs: Preferiti / Salvati / Cerca OFF.
// Stato interno isolato (form state), emissione via store (open/close).
//
// Pattern anti-flicker: la shell del modal (overlay + header + tabs + search-box + list-container + footer)
// viene creata UNA volta quando si apre. Ad ogni cambio di stato, solo il contenuto dinamico
// (lista, footer, tabs active) viene aggiornato via innerHTML mirato. L'input #search-input non viene
// MAI toccato dopo la creazione per non perdere focus e cursore (causa del bug flickering).

import { escapeHtml, escapeAttr, debounce } from '../lib/utils';
import { searchOff } from '../lib/api';
import { buildFoodFromOff } from '../lib/normalize';
import { getState, closeFoodSearch, openFoodEditor, emitChange } from '../lib/store';
import { addFoodToDiary } from '../lib/diary';
import { toggleFoodFavorite } from '../lib/foods';
import { showToast } from './toast';
import { imgTag } from './img';
import { SEARCH_DEBOUNCE_MS, SEARCH_MIN_QUERY } from '../lib/constants';
import type { FoodItem } from '../types';
import { MEAL_ICONS, MEAL_LABELS } from '../types';

// ============ Internal dialog state (NON in store globale) ============

interface SearchDialogState {
  tab: 'favorites' | 'saved' | 'search';
  query: string;
  loading: boolean;
  results: FoodItem[];
  selectedId: string | null;
  quantity: number;
  gramsOverride: string;
  abortController: AbortController | null;
}

const _local: SearchDialogState = {
  tab: 'favorites',
  query: '',
  loading: false,
  results: [],
  selectedId: null,
  quantity: 1,
  gramsOverride: '',
  abortController: null,
};

function resetLocal(): void {
  if (_local.abortController) {
    try { _local.abortController.abort(); } catch { /* noop */ }
  }
  _local.tab = 'favorites';
  _local.query = '';
  _local.loading = false;
  _local.results = [];
  _local.selectedId = null;
  _local.quantity = 1;
  _local.gramsOverride = '';
  _local.abortController = null;
}

// ============ Debounced search ============

const runSearch = debounce(async (query: string) => {
  if (query.trim().length < SEARCH_MIN_QUERY) {
    _local.results = [];
    _local.loading = false;
    emitChange();
    return;
  }
  if (_local.abortController) {
    try { _local.abortController.abort(); } catch { /* noop */ }
  }
  const ctrl = new AbortController();
  _local.abortController = ctrl;
  try {
    const data = await searchOff(query.trim(), { signal: ctrl.signal });
    if (ctrl.signal.aborted) return;
    const items: FoodItem[] = [];
    for (const p of data.products) {
      const f = buildFoodFromOff(p);
      if (f) items.push(f);
    }
    _local.results = items;
  } catch (e) {
    if (ctrl.signal.aborted) return;
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('non disponibile') || msg.includes('non JSON') || msg.includes('non valida')) {
      showToast('Database Open Food Facts temporaneamente non disponibile. Riprova tra qualche minuto, oppure crea un ingrediente custom.', 'error', 5000);
    } else if (msg === 'Timeout') {
      showToast('Ricerca troppo lenta. Riprova.', 'error');
    } else {
      showToast('Errore nella ricerca. Verifica la connessione e riprova.', 'error');
    }
    _local.results = [];
  } finally {
    if (_local.abortController === ctrl) {
      _local.abortController = null;
    }
    _local.loading = false;
    emitChange();
  }
}, SEARCH_DEBOUNCE_MS);

// ============ Event bindings (una sola volta) ============

let _boundSearch = false;

/** Fix B7: abortisce qualsiasi ricerca OFF in corso + reset loading */
function abortInFlightSearch(): void {
  if (_local.abortController) {
    try { _local.abortController.abort(); } catch { /* noop */ }
    _local.abortController = null;
  }
  _local.loading = false;
}

export function bindSearchEvents(): void {
  if (_boundSearch) return;
  _boundSearch = true;

  // Fix B7: ESC handler dedicato per il search dialog (prima di modal.ts ESC generico)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!getState()._searchOpen) return;
    // Solo se il search è il modal top (ultimo nel DOM)
    const overlays = document.querySelectorAll('.modal-overlay');
    if (overlays.length === 0) return;
    const top = overlays[overlays.length - 1] as HTMLElement;
    if (top.dataset.modalId !== 'search-dialog') return;
    e.stopPropagation();
    e.preventDefault();
    closeFoodSearch();
    resetLocal();
  }, true); // capture phase per intercettare PRIMA di modal.ts

  document.addEventListener('click', (e) => {
    if (!getState()._searchOpen) return;
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-search-action]');
    if (!target) return;
    const action = target.dataset.searchAction;
    switch (action) {
      case 'switchTab': {
        const tab = target.dataset.tab as 'favorites' | 'saved' | 'search';
        if (tab && tab !== _local.tab) {
          // Fix B7: se lasciamo il tab search, abortisce la ricerca in corso
          if (_local.tab === 'search' && tab !== 'search') {
            abortInFlightSearch();
            _local.results = [];
          }
          _local.tab = tab;
          _local.selectedId = null;
          emitChange();
        }
        return;
      }
      case 'selectFood': {
        const id = target.dataset.foodId || '';
        const list = currentList();
        const f = list.find((x) => x.id === id);
        if (f) {
          _local.selectedId = f.id;
          _local.quantity = 1;
          _local.gramsOverride = '';
          emitChange();
        }
        return;
      }
      case 'toggleFav': {
        const id = target.dataset.foodId || '';
        if (id) toggleFoodFavorite(id);
        return;
      }
      case 'clearSelected': {
        _local.selectedId = null;
        emitChange();
        return;
      }
      case 'confirm': {
        confirmAdd();
        return;
      }
      case 'close': {
        closeFoodSearch();
        resetLocal();
        return;
      }
      case 'openAddCustom': {
        openFoodEditor('new');
        return;
      }
      case 'clearQuery': {
        // Fix B7: abortisce ricerca in corso + reset loading
        abortInFlightSearch();
        _local.query = '';
        _local.results = [];
        const input = document.querySelector<HTMLInputElement>('#search-input');
        if (input) input.value = '';
        emitChange();
        return;
      }
    }
  });

  document.addEventListener('input', (e) => {
    if (!getState()._searchOpen) return;
    const target = e.target as HTMLElement;
    if (target.id === 'search-input') {
      _local.query = (target as HTMLInputElement).value;
      if (_local.tab !== 'search') {
        _local.tab = 'search';
      }
      if (_local.query.trim().length < SEARCH_MIN_QUERY) {
        // Fix B7: abortisce ricerca in corso + reset loading (niente spinner permanente)
        abortInFlightSearch();
        _local.results = [];
        emitChange();
        return;
      }
      _local.loading = true;
      emitChange();
      runSearch(_local.query);
      return;
    }
    if (target.id === 'qty-input') {
      _local.quantity = Math.max(0, Number((target as HTMLInputElement).value) || 0);
      emitChange();
      return;
    }
    if (target.id === 'grams-input') {
      _local.gramsOverride = (target as HTMLInputElement).value;
      emitChange();
      return;
    }
  });
}

function currentList(): FoodItem[] {
  const s = getState();
  if (_local.tab === 'favorites') {
    return s.foods.filter((f) => s.favoriteFoodIds.includes(f.id));
  }
  if (_local.tab === 'saved') return s.foods;
  return _local.results;
}

function confirmAdd(): void {
  const s = getState();
  const list = currentList();
  const f = _local.selectedId ? list.find((x) => x.id === _local.selectedId) : null;
  if (!f) {
    showToast('Seleziona un alimento', 'info');
    return;
  }
  const grams = _local.gramsOverride ? Number(_local.gramsOverride) : undefined;
  addFoodToDiary({
    date: s._searchDate,
    meal: s._searchMeal,
    food: f,
    quantity: _local.quantity,
    gramsOverride: grams,
  });
  resetLocal();
}

// ============ Shell render (crea SOLO la struttura statica del modal) ============

export function renderSearchShell(): string {
  const s = getState();
  // La shell contiene placeholder vuoti che verranno riempiti da updateSearchContent
  return `
    <div class="modal-overlay modal-show" data-modal-id="search-dialog" data-search-sticky>
      <div class="modal modal-search" role="dialog" aria-modal="true">
        <div class="modal-header">
          <h3 class="modal-title"><span aria-hidden="true">${MEAL_ICONS[s._searchMeal]}</span> Aggiungi a ${escapeHtml(MEAL_LABELS[s._searchMeal])}</h3>
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

// ============ Content render (aggiorna SOLO le zone dinamiche) ============

export function updateSearchContent(overlay: HTMLElement): void {
  const s = getState();
  const list = currentList();

  // --- Tabs ---
  const tabsEl = overlay.querySelector<HTMLElement>('[data-search-zone="tabs"]');
  if (tabsEl) {
    const favoritesCount = s.foods.filter((f) => s.favoriteFoodIds.includes(f.id)).length;
    const savedCount = s.foods.length;
    const tabBtn = (id: 'favorites' | 'saved' | 'search', label: string, icon: string, disabled: boolean) => `
      <button type="button" class="tab-btn${_local.tab === id ? ' active' : ''}" data-search-action="switchTab" data-tab="${id}"${disabled ? ' disabled' : ''}>
        <span aria-hidden="true">${icon}</span> ${escapeHtml(label)}
      </button>
    `;
    const tabsHtml = `
      ${tabBtn('favorites', 'Preferiti', '★', favoritesCount === 0)}
      ${tabBtn('saved', 'Salvati', '', savedCount === 0)}
      ${tabBtn('search', 'Cerca', '🔍', false)}
    `;
    if (tabsEl.innerHTML !== tabsHtml) {
      tabsEl.innerHTML = tabsHtml;
    }
  }

  // --- Search box (solo per tab search) ---
  const searchBoxEl = overlay.querySelector<HTMLElement>('[data-search-zone="searchbox"]');
  if (searchBoxEl) {
    const shouldShow = _local.tab === 'search';
    const wasShowing = searchBoxEl.children.length > 0;
    if (shouldShow && !wasShowing) {
      // Crea il search box (con input vergine — non toccare _local.query per non duplicare)
      searchBoxEl.innerHTML = `
        <div class="search-box">
          <span class="search-icon" aria-hidden="true">🔍</span>
          <input id="search-input" type="search" placeholder="Cerca su Open Food Facts (es. pasta, yogurt…)" autocomplete="off" />
          ${_local.query ? '<button type="button" class="search-clear" data-search-action="clearQuery" aria-label="Pulisci">✕</button>' : '<button type="button" class="search-clear" data-search-action="clearQuery" aria-label="Pulisci" style="display:none">✕</button>'}
        </div>
        <p class="search-hint">Database gratuito collaborativo - milioni di prodotti. Powered by Open Food Facts.</p>
      `;
      // Inizializza il value dell'input solo alla creazione
      const input = searchBoxEl.querySelector<HTMLInputElement>('#search-input');
      if (input) input.value = _local.query;
      // Autofocus
      setTimeout(() => {
        const inp = searchBoxEl.querySelector<HTMLInputElement>('#search-input');
        if (inp) inp.focus();
      }, 0);
    } else if (!shouldShow && wasShowing) {
      // Rimuovi il search box
      searchBoxEl.innerHTML = '';
    } else if (shouldShow && wasShowing) {
      // Search box già presente: NON toccare l'input (preserva focus e cursore).
      // Aggiorna solo visibility del clear button in base a _local.query.
      const clearBtn = searchBoxEl.querySelector<HTMLElement>('.search-clear');
      if (clearBtn) {
        clearBtn.style.display = _local.query ? '' : 'none';
      }
    }
  }

  // --- List ---
  const listEl = overlay.querySelector<HTMLElement>('[data-search-zone="list"]');
  if (listEl) {
    const listHtml = _local.loading
      ? `<div class="search-loading"><span class="spinner" aria-hidden="true"></span> Ricerca in corso…</div>`
      : list.length === 0
        ? `<div class="search-empty">${escapeHtml(emptyHint())}</div>`
        : list.map((f) => foodRow(f)).join('');
    if (listEl.innerHTML !== listHtml) {
      listEl.innerHTML = listHtml;
    }
  }

  // --- Footer (selected food panel o azioni) ---
  const footerEl = overlay.querySelector<HTMLElement>('[data-search-zone="footer"]');
  if (footerEl) {
    const selectedFood = _local.selectedId ? list.find((x) => x.id === _local.selectedId) : null;
    const footerHtml = selectedFood ? renderSelectedFooter(selectedFood) : renderActionsFooter();
    if (footerEl.innerHTML !== footerHtml) {
      footerEl.innerHTML = footerHtml;
    }
  }
}

function renderSelectedFooter(selectedFood: FoodItem): string {
  const selectedGrams = _local.gramsOverride
    ? Number(_local.gramsOverride)
    : selectedFood.servingSize * _local.quantity;
  const selectedNutrition = {
    calories: Math.round((selectedFood.nutrition.calories * selectedGrams) / 100),
    protein: Math.round((selectedFood.nutrition.protein * selectedGrams) / 100),
    carbs: Math.round((selectedFood.nutrition.carbs * selectedGrams) / 100),
    fat: Math.round((selectedFood.nutrition.fat * selectedGrams) / 100),
  };
  return `
    <div class="search-selected">
      <div class="selected-head">
        <div class="selected-info">
          <p class="selected-name">${escapeHtml(selectedFood.name)}</p>
          ${selectedFood.brand ? `<p class="selected-brand">${escapeHtml(selectedFood.brand)}</p>` : ''}
          <div class="badge-row">
            <span class="badge badge-secondary">${selectedFood.nutrition.calories} kcal / 100g</span>
            <span class="badge">P ${selectedFood.nutrition.protein}g</span>
            <span class="badge">C ${selectedFood.nutrition.carbs}g</span>
            <span class="badge">G ${selectedFood.nutrition.fat}g</span>
          </div>
        </div>
        <button type="button" class="icon-btn" data-search-action="clearSelected" aria-label="Deseleziona">✕</button>
      </div>
      <div class="qty-row">
        <div>
          <label for="qty-input" class="field-label">Porzioni ${escapeHtml(selectedFood.servingLabel ? `(${selectedFood.servingLabel})` : `(${selectedFood.servingSize}g)`)}</label>
          <input id="qty-input" type="number" min="0" step="0.5" value="${_local.quantity}" ${_local.gramsOverride ? 'disabled' : ''} />
        </div>
        <div>
          <label for="grams-input" class="field-label">Oppure grammi/ml esatti</label>
          <input id="grams-input" type="number" min="0" placeholder="es. 150" value="${escapeAttr(_local.gramsOverride)}" />
        </div>
      </div>
      <div class="stat-row">
        ${statBox('kcal', String(selectedNutrition.calories))}
        ${statBox('Proteine', `${selectedNutrition.protein}g`)}
        ${statBox('Carbo', `${selectedNutrition.carbs}g`)}
        ${statBox('Grassi', `${selectedNutrition.fat}g`)}
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

function emptyHint(): string {
  if (_local.tab === 'search') {
    if (_local.query.trim().length < SEARCH_MIN_QUERY) {
      return 'Inizia a digitare per cercare prodotti reali nel database Open Food Facts.';
    }
    return 'Nessun risultato. Prova con un altro termine o crea un ingrediente custom.';
  }
  if (_local.tab === 'favorites') return 'Aggiungi ai preferiti i cibi che consumi spesso cliccando la stellina.';
  return 'Nessun alimento salvato. Cerca su Open Food Facts o crea un ingrediente custom.';
}

function foodRow(f: FoodItem): string {
  const s = getState();
  const isFav = s.favoriteFoodIds.includes(f.id);
  const isSelected = _local.selectedId === f.id;
  return `
    <div class="food-row${isSelected ? ' selected' : ''}" data-search-action="selectFood" data-food-id="${escapeAttr(f.id)}" role="button" tabindex="0">
      ${imgTag(f.image, f.name, 'thumb', f.source === 'custom' ? '✏️' : '🥫')}
      <div class="food-row-info">
        <p class="food-row-name">${escapeHtml(f.name)}</p>
        ${f.brand ? `<p class="food-row-brand">${escapeHtml(f.brand)}</p>` : ''}
        <p class="food-row-meta">
          <strong>${f.nutrition.calories} kcal</strong> / 100g
          · P${f.nutrition.protein} C${f.nutrition.carbs} G${f.nutrition.fat}
        </p>
      </div>
      <button type="button" class="fav-btn${isFav ? ' active' : ''}" data-search-action="toggleFav" data-food-id="${escapeAttr(f.id)}" aria-label="Aggiungi ai preferiti">
        ${isFav ? '★' : '☆'}
      </button>
    </div>
  `;
}

function statBox(label: string, value: string): string {
  return `<div class="stat-box"><p class="stat-label">${escapeHtml(label)}</p><p class="stat-value">${escapeHtml(value)}</p></div>`;
}

// Funzione utility per consentire ad altri moduli di aggiornare la lista dopo addCustomFood
export function refreshSearchAfterCustomFood(): void {
  _local.tab = 'saved';
  emitChange();
}
