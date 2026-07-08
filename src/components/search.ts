// Search dialog: ricerca OFF con debounce + AbortController + keyboard nav.
// Tabs: Preferiti / Salvati / Cerca OFF.
// Stato interno isolato (form state), emissione via store (open/close).
//
// Pattern anti-flicker: la shell del modal (overlay + header + tabs + search-box + list-container + footer)
// viene creata UNA volta quando si apre. Ad ogni cambio di stato, solo il contenuto dinamico
// (lista, footer, tabs active) viene aggiornato via innerHTML mirato. L'input #search-input non viene
// MAI toccato dopo la creazione per non perdere focus e cursore (causa del bug flickering).

import { escapeHtml, escapeAttr, debounce, safeId } from '../lib/utils';
import { searchOff } from '../lib/api';
import { buildFoodFromOff } from '../lib/normalize';
import { getState, closeFoodSearch, openFoodEditor, emitChange } from '../lib/store';
import { addFoodToDiary } from '../lib/diary';
import { toggleFoodFavorite, addCustomPortionToFood, removeCustomPortionFromFood } from '../lib/foods';
import { showToast } from './toast';
import { imgTag } from './img';
import { SEARCH_DEBOUNCE_MS, SEARCH_MIN_QUERY } from '../lib/constants';
import type { FoodItem, CustomPortion } from '../types';
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
};

function resetSearchState(): void {
  if (_searchState.abortController) {
    try { _searchState.abortController.abort(); } catch { /* noop */ }
  }
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
}

// ============ Debounced search ============

const runSearch = debounce(async (query: string) => {
  if (query.trim().length < SEARCH_MIN_QUERY) {
    _searchState.results = [];
    _searchState.loading = false;
    emitChange();
    return;
  }
  if (_searchState.abortController) {
    try { _searchState.abortController.abort(); } catch { /* noop */ }
  }
  const ctrl = new AbortController();
  _searchState.abortController = ctrl;
  try {
    const data = await searchOff(query.trim(), { signal: ctrl.signal });
    if (ctrl.signal.aborted) return;
    const items: FoodItem[] = [];
    for (const p of data.products) {
      const f = buildFoodFromOff(p);
      if (f) items.push(f);
    }
    _searchState.results = items;
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
    _searchState.results = [];
  } finally {
    if (_searchState.abortController === ctrl) {
      _searchState.abortController = null;
    }
    _searchState.loading = false;
    emitChange();
  }
}, SEARCH_DEBOUNCE_MS);

// ============ Event bindings (una sola volta) ============

let _boundSearch = false;

/** Fix B7: abortisce qualsiasi ricerca OFF in corso + reset loading */
function abortInFlightSearch(): void {
  if (_searchState.abortController) {
    try { _searchState.abortController.abort(); } catch { /* noop */ }
    _searchState.abortController = null;
  }
  _searchState.loading = false;
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
    resetSearchState();
  }, true); // capture phase per intercettare PRIMA di modal.ts

  document.addEventListener('click', (e) => {
    if (!getState()._searchOpen) return;
    // Background-click closing: se il click è direttamente sull'overlay (sfondo), chiudi
    const overlayEl = e.target as HTMLElement;
    if (overlayEl.classList.contains('modal-overlay') && overlayEl.dataset.modalId === 'search-dialog') {
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
          // Fix B7: se lasciamo il tab search, abortisce la ricerca in corso
          if (_searchState.tab === 'search' && tab !== 'search') {
            abortInFlightSearch();
            _searchState.results = [];
          }
          _searchState.tab = tab;
          _searchState.selectedId = null;
          emitChange();
        }
        return;
      }
      case 'selectFood': {
        const id = target.dataset.foodId || '';
        const list = currentList();
        const f = list.find((x) => x.id === id);
        if (f) {
          _searchState.selectedId = f.id;
          // Default: preimposta i grammi alla servingSize del food
          _searchState.gramsOverride = String(f.servingSize || 100);
          _searchState.pendingCustomPortions = [];
          _searchState.creatingPortion = false;
          _searchState.newPortionLabel = '';
          _searchState.newPortionGrams = '';
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
        closeFoodSearch();
        resetSearchState();
        return;
      }
      case 'openAddCustom': {
        openFoodEditor('new');
        return;
      }
      case 'clearQuery': {
        // Fix B7: abortisce ricerca in corso + reset loading
        abortInFlightSearch();
        _searchState.query = '';
        _searchState.results = [];
        const input = document.querySelector<HTMLInputElement>('#search-input');
        if (input) input.value = '';
        emitChange();
        return;
      }
      case 'usePortion': {
        // Imposta i grammi al valore di una porzione personalizzata
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
        // Autofocus sul campo label dopo il re-render
        setTimeout(() => {
          const inp = document.querySelector<HTMLInputElement>('#new-portion-label');
          if (inp) inp.focus();
        }, 0);
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
    if (!getState()._searchOpen) return;
    const target = e.target as HTMLElement;
    if (target.id === 'search-input') {
      _searchState.query = (target as HTMLInputElement).value;
      if (_searchState.tab !== 'search') {
        _searchState.tab = 'search';
      }
      if (_searchState.query.trim().length < SEARCH_MIN_QUERY) {
        // Fix B7: abortisce ricerca in corso + reset loading (niente spinner permanente)
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
    if (!getState()._searchOpen) return;
    if (e.key !== 'Enter') return;
    const target = e.target as HTMLElement;
    // Enter nel form di creazione porzione → conferma
    if (target.id === 'new-portion-label' || target.id === 'new-portion-grams') {
      e.preventDefault();
      createCustomPortion();
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

function confirmAdd(): void {
  const s = getState();
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
  const grams = Number(gramsRaw);
  if (!Number.isFinite(grams)) {
    showToast(`Grammi: valore non valido ("${gramsRaw}")`, 'error');
    return;
  }
  if (grams <= 0) {
    showToast('I grammi devono essere maggiori di 0', 'error');
    return;
  }
  // Se ci sono porzioni personalizzate pending (food non ancora salvato), allegale al food
  // così verranno persistite insieme al food quando addFoodToDiary lo salva.
  let foodToSave = f;
  if (_searchState.pendingCustomPortions.length > 0) {
    const existing = f.customPortions || [];
    foodToSave = {
      ...f,
      customPortions: [...existing, ..._searchState.pendingCustomPortions],
    };
  }
  addFoodToDiary({
    date: s._searchDate,
    meal: s._searchMeal,
    food: foodToSave,
    quantity: 1,
    gramsOverride: grams,
  });
  resetSearchState();
}

/** Crea una nuova porzione personalizzata per il food attualmente selezionato.
 *  Se il food è già salvato → persistenza immediata via store.
 *  Se il food non è salvato (OFF search result) → memorizza in pendingCustomPortions.
 *  NOTA: non aggiornare _searchState.results qui. Il merge di pendingCustomPortions
 *  avviene in renderSelectedFooter() e confirmAdd(), evitando duplicati. */
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
    // Food non ancora salvato: mantieni solo in pendingCustomPortions.
    // Il merge con selectedFood.customPortions avviene in renderSelectedFooter().
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

/** Elimina una porzione personalizzata (salvata o pending). */
function deleteCustomPortion(foodId: string, portionId: string): void {
  const isSaved = getState().foods.some((x) => x.id === foodId);
  if (isSaved) {
    removeCustomPortionFromFood(foodId, portionId);
    return;
  }
  // Pending: rimuovi solo da _searchState.pendingCustomPortions
  _searchState.pendingCustomPortions = _searchState.pendingCustomPortions.filter((p) => p.id !== portionId);
  emitChange();
}

// ============ Shell render (crea SOLO la struttura statica del modal) ============

export function renderSearchShell(): string {
  const s = getState();
  // La shell contiene placeholder vuoti che verranno riempiti da updateSearchContent
  return `
    <div class="modal-overlay modal-show" data-modal-id="search-dialog">
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
      <button type="button" class="tab-btn${_searchState.tab === id ? ' active' : ''}" data-search-action="switchTab" data-tab="${id}"${disabled ? ' disabled' : ''}>
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
    const shouldShow = _searchState.tab === 'search';
    const wasShowing = searchBoxEl.children.length > 0;
    if (shouldShow && !wasShowing) {
      // Crea il search box (con input vergine — non toccare _searchState.query per non duplicare)
      searchBoxEl.innerHTML = `
        <div class="search-box">
          <span class="search-icon" aria-hidden="true">🔍</span>
          <input id="search-input" type="search" placeholder="Cerca su Open Food Facts (es. pasta, yogurt…)" autocomplete="off" />
          ${_searchState.query ? '<button type="button" class="search-clear" data-search-action="clearQuery" aria-label="Pulisci">✕</button>' : '<button type="button" class="search-clear" data-search-action="clearQuery" aria-label="Pulisci" style="display:none">✕</button>'}
        </div>
        <p class="search-hint">Database gratuito collaborativo - milioni di prodotti. Powered by Open Food Facts.</p>
      `;
      // Inizializza il value dell'input solo alla creazione
      const input = searchBoxEl.querySelector<HTMLInputElement>('#search-input');
      if (input) input.value = _searchState.query;
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
      // Aggiorna solo visibility del clear button in base a _searchState.query.
      const clearBtn = searchBoxEl.querySelector<HTMLElement>('.search-clear');
      if (clearBtn) {
        clearBtn.style.display = _searchState.query ? '' : 'none';
      }
    }
  }

  // --- List ---
  const listEl = overlay.querySelector<HTMLElement>('[data-search-zone="list"]');
  if (listEl) {
    const listHtml = _searchState.loading
      ? `<div class="search-loading"><span class="spinner" aria-hidden="true"></span> Ricerca in corso…</div>`
      : list.length === 0
        ? `<div class="search-empty">${escapeHtml(renderEmptyHint())}</div>`
        : list.map((f) => renderFoodRow(f)).join('');
    if (listEl.innerHTML !== listHtml) {
      listEl.innerHTML = listHtml;
    }
  }

  // --- Footer (selected food panel o azioni) ---
  const footerEl = overlay.querySelector<HTMLElement>('[data-search-zone="footer"]');
  if (footerEl) {
    const selectedFood = _searchState.selectedId ? list.find((x) => x.id === _searchState.selectedId) : null;
    const footerHtml = selectedFood ? renderSelectedFooter(selectedFood) : renderActionsFooter();
    if (footerEl.innerHTML !== footerHtml) {
      footerEl.innerHTML = footerHtml;
    }
  }
}

function renderSelectedFooter(selectedFood: FoodItem): string {
  const selectedGrams = _searchState.gramsOverride ? Number(_searchState.gramsOverride) : selectedFood.servingSize;
  const selectedNutrition = {
    calories: Math.round((selectedFood.nutrition.calories * selectedGrams) / 100),
    protein: Math.round((selectedFood.nutrition.protein * selectedGrams) / 100),
    carbs: Math.round((selectedFood.nutrition.carbs * selectedGrams) / 100),
    fat: Math.round((selectedFood.nutrition.fat * selectedGrams) / 100),
  };
  // Combina le porzioni personalizzate salvate con quelle pending
  const allPortions: CustomPortion[] = [
    ...(selectedFood.customPortions || []),
    ..._searchState.pendingCustomPortions,
  ];
  const portionsHtml = allPortions.length > 0
    ? `
      <div class="portion-chips">
        ${allPortions.map((p) => `
          <button type="button" class="portion-chip${Number(_searchState.gramsOverride) === p.grams ? ' active' : ''}" data-search-action="usePortion" data-grams="${p.grams}">
            <span class="portion-chip-label">${escapeHtml(p.label)}</span>
            <span class="portion-chip-grams">${p.grams}g</span>
            <span class="portion-chip-del" data-search-action="deleteCustomPortion" data-food-id="${escapeAttr(selectedFood.id)}" data-portion-id="${escapeAttr(p.id)}" role="button" aria-label="Elimina porzione">✕</span>
          </button>
        `).join('')}
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
        <input id="grams-input" type="number" min="0" step="0.1" placeholder="es. 150" value="${escapeAttr(_searchState.gramsOverride)}" />
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

// Funzione utility per consentire ad altri moduli di aggiornare la lista dopo addCustomFood
export function refreshSearchAfterCustomFood(): void {
  _searchState.tab = 'saved';
  emitChange();
}
