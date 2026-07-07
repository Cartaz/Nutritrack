// Modal: editor ricetta. Form nome/desc/servings + lista ingredienti con ricerca OFF.

import { getState, closeRecipeEditor, addRecipe, updateRecipe, openFoodEditor, emitChange } from '../lib/store';
import { showToast } from '../components/toast';
import { showModal, closeModalById } from '../components/modal';
import { escapeHtml, escapeAttr, safeId, debounce, round } from '../lib/utils';
import { scaleNutrition, sumNutrition } from '../lib/nutrition';
import { searchOff } from '../lib/api';
import { buildFoodFromOff } from '../lib/normalize';
import { imgTag } from '../components/img';
import { SEARCH_DEBOUNCE_MS, SEARCH_MIN_QUERY } from '../lib/constants';
import type { FoodItem, RecipeIngredient } from '../types';

interface EditorState {
  name: string;
  description: string;
  servings: string;
  ingredients: RecipeIngredient[];
  // ingredient search sub-dialog
  searchOpen: boolean;
  searchTab: 'favorites' | 'saved' | 'search';
  searchQuery: string;
  searchLoading: boolean;
  searchResults: FoodItem[];
  searchAbort: AbortController | null;
}

const _es: EditorState = {
  name: '', description: '', servings: '1',
  ingredients: [],
  searchOpen: false, searchTab: 'favorites', searchQuery: '',
  searchLoading: false, searchResults: [], searchAbort: null,
};

let _bound = false;

function resetEditor(): void {
  Object.assign(_es, {
    name: '', description: '', servings: '1', ingredients: [],
    searchOpen: false, searchTab: 'favorites', searchQuery: '',
    searchLoading: false, searchResults: [], searchAbort: null,
  });
}

function loadFromRecipe(recipeId: string): void {
  const r = getState().recipes.find((x) => x.id === recipeId);
  if (!r) { resetEditor(); return; }
  _es.name = r.name;
  _es.description = r.description || '';
  _es.servings = String(r.servings);
  _es.ingredients = r.ingredients.map((ing) => ({ ...ing }));
}

export function renderRecipeEditorModal(recipeId: string | null): void {
  if (recipeId && recipeId !== 'new') loadFromRecipe(recipeId);
  else resetEditor();

  const editing = !!recipeId && recipeId !== 'new';
  showModal({
    modalId: 'recipe-editor',
    title: editing ? 'Modifica ricetta' : 'Crea ricetta custom',
    bodyHtml: editorBody(),
    actions: [
      { label: 'Annulla', action: 'close', variant: 'outline' },
      { label: editing ? 'Salva ricetta' : 'Crea ricetta', action: 'confirm', variant: 'primary' },
    ],
    onConfirm: () => {
      // Fix B5: ritorna false per bloccare chiusura se validazione fallisce
      return handleSave(recipeId);
    },
    // Fix B6: cleanup state quando il modal viene chiuso
    onClose: () => closeRecipeEditor(),
  });

  bindEvents();
}

function editorBody(): string {
  const totals = computeTotals(_es.ingredients);
  const servings = Number(_es.servings) || 1;
  const per = {
    calories: servings > 0 ? round(totals.calories / servings, 1) : 0,
    protein:  servings > 0 ? round(totals.protein  / servings, 1) : 0,
    carbs:    servings > 0 ? round(totals.carbs    / servings, 1) : 0,
    fat:      servings > 0 ? round(totals.fat      / servings, 1) : 0,
  };
  const ingsHtml = _es.ingredients.length === 0
    ? `<div class="empty-block">Nessun ingrediente. Clicca "Aggiungi ingrediente" per cercare su Open Food Facts, usare un alimento salvato o crearne uno custom.</div>`
    : `<div class="ing-list">${_es.ingredients.map((ing) => ingRow(ing)).join('')}</div>`;

  return `
    <div class="form">
      <label class="field">
        <span>Nome ricetta *</span>
        <input id="re-name" type="text" value="${escapeAttr(_es.name)}" placeholder="es. Pasta al pomodoro" />
      </label>
      <label class="field">
        <span>Descrizione / Note</span>
        <textarea id="re-desc" rows="2" placeholder="Preparazione, trucchi, ecc.">${escapeHtml(_es.description)}</textarea>
      </label>
      <label class="field field-sm">
        <span>Porzioni *</span>
        <input id="re-servings" type="number" min="1" max="50" value="${escapeAttr(_es.servings)}" />
      </label>
      <div class="separator"></div>
      <div class="ing-head">
        <h4>Ingredienti (${_es.ingredients.length})</h4>
        <button type="button" class="btn btn-outline btn-sm" data-action="re-open-search"><span aria-hidden="true">＋</span> Aggiungi ingrediente</button>
      </div>
      ${ingsHtml}
      <div class="separator"></div>
      <div class="totals-grid">
        <div class="totals-block muted">
          <p class="totals-label">Totale ricetta</p>
          <div class="stat-row">
            ${macroBox('kcal', String(Math.round(totals.calories)))}
            ${macroBox('P', `${round(totals.protein, 1)}g`)}
            ${macroBox('C', `${round(totals.carbs, 1)}g`)}
            ${macroBox('G', `${round(totals.fat, 1)}g`)}
          </div>
        </div>
        <div class="totals-block highlight">
          <p class="totals-label">Per porzione (${servings} porz.)</p>
          <div class="stat-row">
            ${macroBox('kcal', String(Math.round(per.calories)), true)}
            ${macroBox('P', `${per.protein}g`, true)}
            ${macroBox('C', `${per.carbs}g`, true)}
            ${macroBox('G', `${per.fat}g`, true)}
          </div>
        </div>
      </div>
    </div>
  `;
}

function ingRow(ing: RecipeIngredient): string {
  const scaled = scaleNutrition(ing.foodSnapshot.nutrition, ing.grams);
  return `
    <div class="ing-row">
      ${imgTag(ing.foodSnapshot.image, ing.foodSnapshot.name, 'thumb', ing.foodSnapshot.source === 'custom' ? '✏️' : '🥫')}
      <div class="ing-info">
        <p class="ing-name">${escapeHtml(ing.foodSnapshot.name)}</p>
        ${ing.foodSnapshot.brand ? `<p class="ing-brand">${escapeHtml(ing.foodSnapshot.brand)}</p>` : ''}
        <p class="ing-meta">${scaled.calories} kcal · P${scaled.protein}g · C${scaled.carbs}g · G${scaled.fat}g</p>
      </div>
      <div class="ing-qty">
        <input type="number" min="0" value="${ing.grams}" data-action="re-ing-grams" data-ing-id="${escapeAttr(ing.id)}" />
        <span>g</span>
      </div>
      <button type="button" class="icon-btn danger" data-action="re-ing-remove" data-ing-id="${escapeAttr(ing.id)}" aria-label="Rimuovi">🗑</button>
    </div>
  `;
}

function macroBox(label: string, value: string, highlight = false): string {
  return `<div class="stat-box${highlight ? ' highlight' : ''}"><p class="stat-label">${escapeHtml(label)}</p><p class="stat-value">${escapeHtml(value)}</p></div>`;
}

function computeTotals(ingredients: RecipeIngredient[]) {
  const nutritions = ingredients.map((ing) => scaleNutrition(ing.foodSnapshot.nutrition, ing.grams));
  return sumNutrition(nutritions);
}

// ============ Sub-dialog: ingredient search (proper modal with zone updates) ============
// Pattern: il sub-search è un modal top-level registrato via showModal().
// La shell (overlay + header con X + zone vuote) viene creata UNA volta.
// Ad ogni cambio di stato, solo le zone dinamiche (tabs, list) vengono aggiornate.
// L'input #re-search-input non viene MAI toccato dopo la creazione per non perdere focus.

let _subOverlay: HTMLElement | null = null;

function openSubSearch(): void {
  const state = getState();
  _es.searchOpen = true;
  _es.searchTab = state.favoriteFoodIds.length > 0 ? 'favorites' : (state.foods.length > 0 ? 'saved' : 'search');
  _es.searchQuery = '';
  _es.searchResults = [];
  _es.searchLoading = false;

  _subOverlay = showModal({
    modalId: 'recipe-search-sub',
    title: 'Aggiungi ingrediente',
    bodyHtml: subSearchShell(),
    actions: [],
    onClose: () => {
      _es.searchOpen = false;
      _subOverlay = null;
      // Abort ricerca in corso
      if (_es.searchAbort) {
        try { _es.searchAbort.abort(); } catch { /* noop */ }
        _es.searchAbort = null;
      }
      _es.searchLoading = false;
    },
  });

  updateSubSearchContent();

  // Focus sul campo di ricerca se siamo sul tab search
  if (_es.searchTab === 'search') {
    setTimeout(() => {
      const inp = _subOverlay?.querySelector<HTMLInputElement>('#re-search-input');
      if (inp) inp.focus();
    }, 100);
  }
}

function subSearchShell(): string {
  return `
    <div class="search-tabs" data-sub-zone="tabs"></div>
    <div data-sub-zone="searchbox"></div>
    <div class="search-list-scroll" data-sub-zone="list"></div>
    <div class="modal-footer">
      <button type="button" class="btn btn-outline btn-block" data-action="re-search-custom">✏️ Oppure crea ingrediente custom</button>
    </div>
  `;
}

function updateSubSearchContent(): void {
  if (!_subOverlay) return;
  const state = getState();
  const favorites = state.foods.filter((f) => state.favoriteFoodIds.includes(f.id));

  // --- Tabs ---
  const tabsEl = _subOverlay.querySelector<HTMLElement>('[data-sub-zone="tabs"]');
  if (tabsEl) {
    const tabBtn = (id: 'favorites' | 'saved' | 'search', label: string, disabled: boolean) => `
      <button type="button" class="tab-btn${_es.searchTab === id ? ' active' : ''}" data-action="re-search-tab" data-tab="${id}"${disabled ? ' disabled' : ''}>${escapeHtml(label)}</button>
    `;
    tabsEl.innerHTML = `
      ${tabBtn('favorites', '★ Preferiti', favorites.length === 0)}
      ${tabBtn('saved', 'Salvati', state.foods.length === 0)}
      ${tabBtn('search', '🔍 Cerca', false)}
    `;
  }

  // --- Searchbox (only on search tab) — created once, never touched after ---
  const boxEl = _subOverlay.querySelector<HTMLElement>('[data-sub-zone="searchbox"]');
  if (boxEl) {
    const shouldShow = _es.searchTab === 'search';
    const hasContent = boxEl.children.length > 0;
    if (shouldShow && !hasContent) {
      // Crea il searchbox con input vergine
      boxEl.innerHTML = `
        <div class="search-box">
          <span class="search-icon">🔍</span>
          <input id="re-search-input" type="search" placeholder="Cerca su Open Food Facts…" autocomplete="off" />
        </div>
      `;
      // Autofocus
      setTimeout(() => {
        const inp = boxEl.querySelector<HTMLInputElement>('#re-search-input');
        if (inp) inp.focus();
      }, 0);
    } else if (!shouldShow && hasContent) {
      // Rimuovi il searchbox
      boxEl.innerHTML = '';
    }
    // Se shouldShow && hasContent: NON toccare l'input (preserva focus e cursore)
  }

  // --- List ---
  updateSubSearchList();
}

function updateSubSearchList(): void {
  if (!_subOverlay) return;
  const state = getState();
  const favorites = state.foods.filter((f) => state.favoriteFoodIds.includes(f.id));
  const list = _es.searchTab === 'favorites' ? favorites
    : _es.searchTab === 'saved' ? state.foods
    : _es.searchResults;
  const listHtml = _es.searchLoading
    ? `<div class="search-loading"><span class="spinner"></span> Ricerca…</div>`
    : list.length === 0
      ? `<div class="search-empty">${_es.searchTab === 'search' ? 'Inizia a cercare un prodotto reale.' : 'Nessun alimento qui.'}</div>`
      : `<div class="search-list">${list.map((f) => searchRow(f)).join('')}</div>`;
  const listEl = _subOverlay.querySelector<HTMLElement>('[data-sub-zone="list"]');
  if (listEl) listEl.innerHTML = listHtml;
}

function searchRow(f: FoodItem): string {
  return `
    <button type="button" class="food-row" data-action="re-search-pick" data-food-id="${escapeAttr(f.id)}">
      ${imgTag(f.image, f.name, 'thumb', f.source === 'custom' ? '✏️' : '🥫')}
      <div class="food-row-info">
        <p class="food-row-name">${escapeHtml(f.name)}</p>
        ${f.brand ? `<p class="food-row-brand">${escapeHtml(f.brand)}</p>` : ''}
        <p class="food-row-meta">${Math.round(f.nutrition.calories)} kcal · P${Math.round(f.nutrition.protein)} C${Math.round(f.nutrition.carbs)} G${Math.round(f.nutrition.fat)}</p>
      </div>
      <span class="pick-icon" aria-hidden="true">＋</span>
    </button>
  `;
}

function rerenderEditorBody(): void {
  const overlay = document.querySelector('[data-modal-id="recipe-editor"]');
  if (!overlay) return;
  const body = overlay.querySelector('.modal-body') as HTMLElement;
  if (body) body.innerHTML = editorBody();
}

const runSubSearch = debounce(async (query: string) => {
  if (query.trim().length < SEARCH_MIN_QUERY) {
    _es.searchResults = [];
    _es.searchLoading = false;
    updateSubSearchList();
    return;
  }
  if (_es.searchAbort) {
    try { _es.searchAbort.abort(); } catch { /* noop */ }
  }
  const ctrl = new AbortController();
  _es.searchAbort = ctrl;
  try {
    const data = await searchOff(query.trim(), { signal: ctrl.signal });
    if (ctrl.signal.aborted) return;
    _es.searchResults = data.products.map(buildFoodFromOff).filter((f): f is FoodItem => f !== null);
  } catch (e) {
    if (ctrl.signal.aborted) return;
    const msg = e instanceof Error ? e.message : String(e);
    showToast(msg.includes('non disponibile') ? 'OFF non disponibile. Riprova più tardi.' : 'Errore ricerca', 'error');
    _es.searchResults = [];
  } finally {
    if (_es.searchAbort === ctrl) _es.searchAbort = null;
    _es.searchLoading = false;
    updateSubSearchList();
  }
}, SEARCH_DEBOUNCE_MS);

function bindEvents(): void {
  if (_bound) return;
  _bound = true;

  document.addEventListener('input', (e) => {
    const t = e.target as HTMLElement;
    if (!document.querySelector('[data-modal-id="recipe-editor"]')) return;
    if (t.id === 're-name') { _es.name = (t as HTMLInputElement).value; return; }
    if (t.id === 're-desc') { _es.description = (t as HTMLInputElement).value; return; }
    if (t.id === 're-servings') { _es.servings = (t as HTMLInputElement).value; rerenderEditorBody(); return; }
    if (t.dataset.action === 're-ing-grams') {
      const id = t.dataset.ingId;
      const v = Math.max(0, Number((t as HTMLInputElement).value) || 0);
      _es.ingredients = _es.ingredients.map((i) => (i.id === id ? { ...i, grams: v } : i));
      // Update solo la riga (cheap) - per semplicità re-render totale
      rerenderEditorBody();
      return;
    }
    if (t.id === 're-search-input') {
      _es.searchQuery = (t as HTMLInputElement).value;
      if (_es.searchQuery.trim().length < SEARCH_MIN_QUERY) {
        _es.searchResults = [];
        _es.searchLoading = false;
        // Aggiorna SOLO la lista — non toccare il searchbox (preserva focus)
        updateSubSearchList();
        return;
      }
      _es.searchLoading = true;
      // Aggiorna SOLO la lista (mostra spinner) — non toccare il searchbox
      updateSubSearchList();
      runSubSearch(_es.searchQuery);
      return;
    }
  });

  document.addEventListener('click', (e) => {
    if (!document.querySelector('[data-modal-id="recipe-editor"]')) return;
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (!action) return;

    if (action === 're-open-search') {
      if (!_es.searchOpen) openSubSearch();
      return;
    }
    if (action === 're-search-tab') {
      const newTab = target.dataset.tab as 'favorites' | 'saved' | 'search';
      if (newTab === _es.searchTab) return;
      // Se lasciamo il tab search, abortisce la ricerca in corso
      if (_es.searchTab === 'search' && newTab !== 'search') {
        if (_es.searchAbort) {
          try { _es.searchAbort.abort(); } catch { /* noop */ }
          _es.searchAbort = null;
        }
        _es.searchLoading = false;
        _es.searchResults = [];
      }
      _es.searchTab = newTab;
      updateSubSearchContent();
      return;
    }
    if (action === 're-search-pick') {
      const id = target.dataset.foodId || '';
      const state = getState();
      // lookup in saved/favorites OR in search results
      const all = [...state.foods, ..._es.searchResults];
      const f = all.find((x) => x.id === id);
      if (f) {
        // Se proviene da OFF e non è salvato, salva
        let foodRef = f;
        if (f.source === 'openfoodfacts' && !state.foods.find((x) => x.id === f.id)) {
          foodRef = { ...f, id: safeId('food_') };
          // Aggiungiamo allo store
          import('../lib/store').then(({ addFood }) => {
            addFood(foodRef);
            _es.ingredients = [..._es.ingredients, {
              id: safeId('ing_'),
              foodId: foodRef.id,
              foodSnapshot: foodRef,
              grams: foodRef.servingSize,
            }];
            closeModalById('recipe-search-sub');
            rerenderEditorBody();
            showToast(`${foodRef.name} aggiunto`, 'success');
          });
          return;
        }
        _es.ingredients = [..._es.ingredients, {
          id: safeId('ing_'),
          foodId: foodRef.id,
          foodSnapshot: foodRef,
          grams: foodRef.servingSize,
        }];
        closeModalById('recipe-search-sub');
        rerenderEditorBody();
        showToast(`${foodRef.name} aggiunto`, 'success');
      }
      return;
    }
    if (action === 're-search-custom') {
      closeModalById('recipe-search-sub');
      openFoodEditor('new');
      return;
    }
    if (action === 're-ing-remove') {
      const id = target.dataset.ingId || '';
      _es.ingredients = _es.ingredients.filter((i) => i.id !== id);
      rerenderEditorBody();
      return;
    }
  });
}

/** Fix B5: ritorna false per bloccare chiusura modal se validazione fallisce. */
function handleSave(recipeId: string | null): boolean {
  if (!_es.name.trim()) {
    showToast('Inserisci il nome della ricetta', 'error');
    return false;
  }
  if (_es.ingredients.length === 0) {
    showToast('Aggiungi almeno un ingrediente', 'error');
    return false;
  }
  const servings = Number(_es.servings) || 1;
  if (servings < 1) {
    showToast('Il numero di porzioni deve essere almeno 1', 'error');
    return false;
  }
  const payload = {
    name: _es.name.trim(),
    description: _es.description.trim() || undefined,
    servings,
    ingredients: _es.ingredients,
  };
  if (recipeId && recipeId !== 'new') {
    updateRecipe(recipeId, payload);
    showToast('Ricetta aggiornata', 'success');
  } else {
    addRecipe(payload);
    showToast('Ricetta creata', 'success');
  }
  // NOTA: non chiamiamo closeRecipeEditor() qui — ci pensa onClose callback del modal.
  emitChange();
  return true;
}

// Esposto per refresh da food-editor (caso: custom food creato da dentro recipe editor)
export function refreshRecipeEditor(): void {
  if (getState()._editingRecipeId !== null) {
    // Riapri il sub-search sul tab salvati per mostrare il nuovo food custom
    if (!_es.searchOpen) {
      openSubSearch();
    }
    _es.searchTab = 'saved';
    updateSubSearchContent();
  }
}
