// Modal: editor ricetta. Form nome/desc/servings + lista ingredienti con ricerca OFF.

import { getState, closeRecipeEditor, addRecipe, updateRecipe, openFoodEditor, emitChange } from '../lib/store';
import { showToast } from '../components/toast';
import { showModal, closeModalById } from '../components/modal';
import { escapeHtml, escapeAttr, safeId, debounce, round } from '../lib/utils';
import { scaleNutrition, sumNutrition } from '../lib/nutrition';
import { searchOffWithPartialMatch } from '../lib/api';
import { buildFoodFromOff } from '../lib/normalize';
import { saveOffFood } from '../lib/foods';
import { imgTag } from '../components/img';
import { SEARCH_DEBOUNCE_MS, SEARCH_MIN_QUERY, SEARCH_AUTO_RETRY_DELAY_MS } from '../lib/constants';
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
  // Fix OFF-RETRY (issue #1): flag auto-retry per la sub-search ingredienti
  searchAutoRetryDone: boolean;
  // Fix PARTIAL-MATCH: query efficace (con suffix expansion applicato) per paginazione
  searchEffectiveQuery: string;
}

const _recipeEditorState: EditorState = {
  name: '',
  description: '',
  servings: '1',
  ingredients: [],
  searchOpen: false,
  searchTab: 'favorites',
  searchQuery: '',
  searchLoading: false,
  searchResults: [],
  searchAbort: null,
  searchAutoRetryDone: false,
  searchEffectiveQuery: '',
};

let _recipeEditorBound = false;

function resetRecipeEditorState(): void {
  Object.assign(_recipeEditorState, {
    name: '',
    description: '',
    servings: '1',
    ingredients: [],
    searchOpen: false,
    searchTab: 'favorites',
    searchQuery: '',
    searchLoading: false,
    searchResults: [],
    searchAbort: null,
    searchAutoRetryDone: false,
    searchEffectiveQuery: '',
  });
}

function loadFromRecipe(recipeId: string): void {
  const r = getState().recipes.find((x) => x.id === recipeId);
  if (!r) {
    // Fix MEDIUM bug: se la ricetta è stata cancellata in altro tab mentre il viewer era aperto,
    // chiudi l'editor invece di lasciarlo in uno stato inconsistente (titolo "Modifica" su form vuoto).
    resetRecipeEditorState();
    closeRecipeEditor();
    showToast('La ricetta non esiste più (potrebbe essere stata eliminata in un altro tab)', 'warning', 5000);
    return;
  }
  _recipeEditorState.name = r.name;
  _recipeEditorState.description = r.description || '';
  _recipeEditorState.servings = String(r.servings);
  _recipeEditorState.ingredients = r.ingredients.map((ing) => ({ ...ing }));
}

export function renderRecipeEditorModal(recipeId: string | null): void {
  if (recipeId && recipeId !== 'new') loadFromRecipe(recipeId);
  else resetRecipeEditorState();

  const editing = !!recipeId && recipeId !== 'new';
  showModal({
    modalId: 'recipe-editor',
    title: editing ? 'Modifica ricetta' : 'Crea ricetta custom',
    bodyHtml: renderEditorBody(),
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

  bindRecipeEditorModalEvents();
}

function renderEditorBody(): string {
  const totals = computeTotals(_recipeEditorState.ingredients);
  const servings = Number(_recipeEditorState.servings) || 1;
  const per = {
    calories: servings > 0 ? round(totals.calories / servings, 1) : 0,
    protein: servings > 0 ? round(totals.protein / servings, 1) : 0,
    carbs: servings > 0 ? round(totals.carbs / servings, 1) : 0,
    fat: servings > 0 ? round(totals.fat / servings, 1) : 0,
  };
  const ingsHtml =
    _recipeEditorState.ingredients.length === 0
      ? `<div class="empty-block">Nessun ingrediente. Clicca "Aggiungi ingrediente" per cercare su Open Food Facts, usare un alimento salvato o crearne uno custom.</div>`
      : `<div class="ing-list">${_recipeEditorState.ingredients.map((ing) => renderIngredientEditorRow(ing)).join('')}</div>`;

  return `
    <div class="form">
      <label class="field">
        <span>Nome ricetta *</span>
        <input id="re-name" type="text" value="${escapeAttr(_recipeEditorState.name)}" placeholder="es. Pasta al pomodoro" />
      </label>
      <label class="field">
        <span>Descrizione / Note</span>
        <textarea id="re-desc" rows="2" maxlength="2000" placeholder="Preparazione, trucchi, ecc.">${escapeHtml(_recipeEditorState.description)}</textarea>
      </label>
      <label class="field field-sm">
        <span>Porzioni *</span>
        <input id="re-servings" type="number" min="1" max="200" value="${escapeAttr(_recipeEditorState.servings)}" />
      </label>
      <div class="separator"></div>
      <div class="ing-head">
        <h4>Ingredienti (${_recipeEditorState.ingredients.length})</h4>
        <button type="button" class="btn btn-outline btn-sm" data-re-action="open-search"><span aria-hidden="true">＋</span> Aggiungi ingrediente</button>
      </div>
      ${ingsHtml}
      <div class="separator"></div>
      <div class="totals-grid">
        <div class="totals-block muted">
          <p class="totals-label">Totale ricetta</p>
          <div class="stat-row">
            ${renderMacroBox('kcal', String(Math.round(totals.calories)))}
            ${renderMacroBox('P', `${round(totals.protein, 1)}g`)}
            ${renderMacroBox('C', `${round(totals.carbs, 1)}g`)}
            ${renderMacroBox('G', `${round(totals.fat, 1)}g`)}
          </div>
        </div>
        <div class="totals-block highlight">
          <p class="totals-label">Per porzione (${servings} porz.)</p>
          <div class="stat-row">
            ${renderMacroBox('kcal', String(Math.round(per.calories)), true)}
            ${renderMacroBox('P', `${per.protein}g`, true)}
            ${renderMacroBox('C', `${per.carbs}g`, true)}
            ${renderMacroBox('G', `${per.fat}g`, true)}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderIngredientEditorRow(ing: RecipeIngredient): string {
  const scaled = scaleNutrition(ing.foodSnapshot.nutrition, ing.grams);
  return `
    <div class="ing-row">
      ${imgTag(ing.foodSnapshot.image, ing.foodSnapshot.name, 'thumb', ing.foodSnapshot.source === 'custom' ? '✏️' : '🥫')}
      <div class="ing-info">
        <p class="ing-name">${escapeHtml(ing.foodSnapshot.name)}</p>
        ${ing.foodSnapshot.brand ? `<p class="ing-brand">${escapeHtml(ing.foodSnapshot.brand)}</p>` : ''}
        <p class="ing-meta">${Math.round(scaled.calories)} kcal · P${Math.round(scaled.protein)}g · C${Math.round(scaled.carbs)}g · G${Math.round(scaled.fat)}g</p>
      </div>
      <div class="ing-qty">
        <input type="number" min="0" value="${ing.grams}" data-re-action="ing-grams" data-ing-id="${escapeAttr(ing.id)}" />
        <span>g</span>
      </div>
      <button type="button" class="icon-btn danger" data-re-action="ing-remove" data-ing-id="${escapeAttr(ing.id)}" aria-label="Rimuovi">🗑</button>
    </div>
  `;
}

function renderMacroBox(label: string, value: string, highlight = false): string {
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
  _recipeEditorState.searchOpen = true;
  _recipeEditorState.searchTab =
    state.favoriteFoodIds.length > 0 ? 'favorites' : state.foods.length > 0 ? 'saved' : 'search';
  _recipeEditorState.searchQuery = '';
  _recipeEditorState.searchResults = [];
  _recipeEditorState.searchLoading = false;

  _subOverlay = showModal({
    modalId: 'recipe-search-sub',
    title: 'Aggiungi ingrediente',
    bodyHtml: renderSubSearchShell(),
    actions: [],
    onClose: () => {
      _recipeEditorState.searchOpen = false;
      _subOverlay = null;
      // Abort ricerca in corso
      if (_recipeEditorState.searchAbort) {
        try {
          _recipeEditorState.searchAbort.abort();
        } catch {
          /* noop */
        }
        _recipeEditorState.searchAbort = null;
      }
      _recipeEditorState.searchLoading = false;
    },
  });

  updateSubSearchContent();

  // Focus sul campo di ricerca se siamo sul tab search
  if (_recipeEditorState.searchTab === 'search') {
    setTimeout(() => {
      const inp = _subOverlay?.querySelector<HTMLInputElement>('#re-search-input');
      if (inp) inp.focus();
    }, 100);
  }
}

function renderSubSearchShell(): string {
  return `
    <div class="search-tabs" data-sub-zone="tabs"></div>
    <div data-sub-zone="searchbox"></div>
    <div class="search-list-scroll" data-sub-zone="list"></div>
    <div class="modal-footer">
      <button type="button" class="btn btn-outline btn-block" data-re-action="search-custom">✏️ Oppure crea ingrediente custom</button>
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
      <button type="button" class="tab-btn${_recipeEditorState.searchTab === id ? ' active' : ''}" data-re-action="search-tab" data-tab="${id}"${disabled ? ' disabled' : ''}>${escapeHtml(label)}</button>
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
    const shouldShow = _recipeEditorState.searchTab === 'search';
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
  const list =
    _recipeEditorState.searchTab === 'favorites'
      ? favorites
      : _recipeEditorState.searchTab === 'saved'
        ? state.foods
        : _recipeEditorState.searchResults;
  const listHtml = _recipeEditorState.searchLoading
    ? `<div class="search-loading"><span class="spinner"></span> Ricerca…</div>`
    : list.length === 0
      ? `<div class="search-empty">${_recipeEditorState.searchTab === 'search' ? 'Inizia a cercare un prodotto reale.' : 'Nessun alimento qui.'}</div>`
      : `<div class="search-list">${list.map((f) => renderIngredientRow(f)).join('')}</div>`;
  const listEl = _subOverlay.querySelector<HTMLElement>('[data-sub-zone="list"]');
  if (listEl) listEl.innerHTML = listHtml;
}

function renderIngredientRow(f: FoodItem): string {
  return `
    <button type="button" class="food-row" data-re-action="search-pick" data-food-id="${escapeAttr(f.id)}">
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

function rerenderModalBody(): void {
  const overlay = document.querySelector('[data-modal-id="recipe-editor"]');
  if (!overlay) return;
  const body = overlay.querySelector('.modal-body') as HTMLElement;
  if (body) body.innerHTML = renderEditorBody();
}

/** Update mirato del DOM per la riga ingrediente modificata + i totali.
 *  Preserva il focus sull'input dei grammi (a differenza di rerenderModalBody
 *  che rigenererebbe tutto il body distruggendo il focus ad ogni keystroke). */
function updateIngRowLive(ingId: string): void {
  const overlay = document.querySelector('[data-modal-id="recipe-editor"]');
  if (!overlay) return;
  const ing = _recipeEditorState.ingredients.find((i) => i.id === ingId);
  if (!ing) return;

  // Aggiorna solo il <p class="ing-meta"> della riga
  const row = overlay.querySelector<HTMLElement>(`[data-ing-id="${CSS.escape(ingId)}"]`)?.closest('.ing-row');
  if (row) {
    const scaled = scaleNutrition(ing.foodSnapshot.nutrition, ing.grams);
    const meta = row.querySelector<HTMLElement>('.ing-meta');
    if (meta) {
      meta.textContent = `${Math.round(scaled.calories)} kcal · P${Math.round(scaled.protein)}g · C${Math.round(scaled.carbs)}g · G${Math.round(scaled.fat)}g`;
    }
  }

  // Aggiorna i totali (Totale ricetta + Per porzione)
  const totals = computeTotals(_recipeEditorState.ingredients);
  const servings = Number(_recipeEditorState.servings) || 1;
  const per = {
    calories: servings > 0 ? round(totals.calories / servings, 1) : 0,
    protein: servings > 0 ? round(totals.protein / servings, 1) : 0,
    carbs: servings > 0 ? round(totals.carbs / servings, 1) : 0,
    fat: servings > 0 ? round(totals.fat / servings, 1) : 0,
  };
  const totalsBlocks = overlay.querySelectorAll('.totals-block');
  if (totalsBlocks.length >= 2) {
    const totalRow = totalsBlocks[0].querySelector('.stat-row');
    const perRow = totalsBlocks[1].querySelector('.stat-row');
    if (totalRow) {
      totalRow.innerHTML = `
        ${renderMacroBox('kcal', String(Math.round(totals.calories)))}
        ${renderMacroBox('P', `${round(totals.protein, 1)}g`)}
        ${renderMacroBox('C', `${round(totals.carbs, 1)}g`)}
        ${renderMacroBox('G', `${round(totals.fat, 1)}g`)}
      `;
    }
    if (perRow) {
      perRow.innerHTML = `
        ${renderMacroBox('kcal', String(Math.round(per.calories)), true)}
        ${renderMacroBox('P', `${per.protein}g`, true)}
        ${renderMacroBox('C', `${per.carbs}g`, true)}
        ${renderMacroBox('G', `${per.fat}g`, true)}
      `;
    }
    // Aggiorna label porzioni
    const perLabel = totalsBlocks[1].querySelector('.totals-label');
    if (perLabel) perLabel.textContent = `Per porzione (${servings} porz.)`;
  }
}

/** Update mirato del solo blocco "Per porzione" — usato quando cambia il numero
 *  di porzioni, per preservare il focus sull'input servings. */
function updatePerServingLive(): void {
  const overlay = document.querySelector('[data-modal-id="recipe-editor"]');
  if (!overlay) return;
  const totals = computeTotals(_recipeEditorState.ingredients);
  const servings = Number(_recipeEditorState.servings) || 1;
  const per = {
    calories: servings > 0 ? round(totals.calories / servings, 1) : 0,
    protein: servings > 0 ? round(totals.protein / servings, 1) : 0,
    carbs: servings > 0 ? round(totals.carbs / servings, 1) : 0,
    fat: servings > 0 ? round(totals.fat / servings, 1) : 0,
  };
  const totalsBlocks = overlay.querySelectorAll('.totals-block');
  const perBlock = totalsBlocks[1];
  if (!perBlock) return;
  const perLabel = perBlock.querySelector('.totals-label');
  if (perLabel) perLabel.textContent = `Per porzione (${servings} porz.)`;
  const perRow = perBlock.querySelector('.stat-row');
  if (perRow) {
    perRow.innerHTML = `
      ${renderMacroBox('kcal', String(Math.round(per.calories)), true)}
      ${renderMacroBox('P', `${per.protein}g`, true)}
      ${renderMacroBox('C', `${per.carbs}g`, true)}
      ${renderMacroBox('G', `${per.fat}g`, true)}
    `;
  }
}

const runSubSearch = debounce(async (query: string) => {
  if (query.trim().length < SEARCH_MIN_QUERY) {
    _recipeEditorState.searchResults = [];
    _recipeEditorState.searchLoading = false;
    updateSubSearchList();
    return;
  }
  if (_recipeEditorState.searchAbort) {
    try {
      _recipeEditorState.searchAbort.abort();
    } catch {
      /* noop */
    }
  }
  const ctrl = new AbortController();
  _recipeEditorState.searchAbort = ctrl;
  try {
    // Fix PARTIAL-MATCH: usa searchOffWithPartialMatch per supportare query parziali
    // (es. "melanzan" → "melanzane" via suffix expansion)
    const data = await searchOffWithPartialMatch(query.trim(), { signal: ctrl.signal });
    if (ctrl.signal.aborted) return;
    _recipeEditorState.searchResults = data.products.map(buildFoodFromOff).filter((f): f is FoodItem => f !== null);
    _recipeEditorState.searchEffectiveQuery = data.effectiveQuery;
    // Fix OFF-RETRY: successo → resetta il flag auto-retry per la prossima query
    _recipeEditorState.searchAutoRetryDone = false;
  } catch (e) {
    if (ctrl.signal.aborted) return;
    const errName = e instanceof Error ? e.name : '';
    const errStatus = (e as { status?: number })?.status;

    // Fix OFF-RETRY (issue #1): auto-retry UI-level per errori transitori.
    // Stessa logica della search principale: una sola ripetizione silenziosa.
    const isTransient =
      errName === 'NetworkError' ||
      errName === 'TimeoutError' ||
      errName === 'OfflineError' ||
      (errStatus !== undefined && (errStatus >= 500 || errStatus === 429));
    if (isTransient && !_recipeEditorState.searchAutoRetryDone) {
      _recipeEditorState.searchAutoRetryDone = true;
      _recipeEditorState.searchLoading = true;
      updateSubSearchList();
      setTimeout(() => {
        // Se il modal è stato chiuso, skip
        if (!document.querySelector('[data-modal-id="recipe-editor"]')) return;
        runSubSearch(query);
      }, SEARCH_AUTO_RETRY_DELAY_MS);
      return;
    }

    // Messaggi accurati: distinguono "offline reale" da "OFF irraggiungibile"
    const msg =
      errName === 'OfflineError' || (typeof navigator !== 'undefined' && navigator.onLine === false)
        ? 'Sei offline. Verifica la connessione.'
        : errName === 'NetworkError'
          ? 'Open Food Facts non raggiungibile. Riprova tra qualche secondo.'
          : errName === 'TimeoutError'
            ? 'Risposta di Open Food Facts troppo lenta. Riprova tra poco.'
            : e instanceof Error && e.message.includes('non disponibile')
              ? 'Open Food Facts non disponibile. Riprova tra poco.'
              : 'Errore nella ricerca ingredienti. Riprova.';
    showToast(msg, 'error', 5000);
    _recipeEditorState.searchResults = [];
  } finally {
    if (_recipeEditorState.searchAbort === ctrl) _recipeEditorState.searchAbort = null;
    _recipeEditorState.searchLoading = false;
    updateSubSearchList();
  }
}, SEARCH_DEBOUNCE_MS);

function bindRecipeEditorModalEvents(): void {
  if (_recipeEditorBound) return;
  _recipeEditorBound = true;

  document.addEventListener('input', (e) => {
    const t = e.target as HTMLElement;
    if (!document.querySelector('[data-modal-id="recipe-editor"]')) return;
    if (t.id === 're-name') {
      _recipeEditorState.name = (t as HTMLInputElement).value;
      return;
    }
    if (t.id === 're-desc') {
      _recipeEditorState.description = (t as HTMLInputElement).value;
      return;
    }
    if (t.id === 're-servings') {
      _recipeEditorState.servings = (t as HTMLInputElement).value;
      // Update mirato del blocco "Per porzione" (preserva il focus sull'input servings)
      updatePerServingLive();
      return;
    }
    if (t.dataset.reAction === 'ing-grams') {
      const id = t.dataset.ingId;
      const raw = (t as HTMLInputElement).value;
      const parsed = Number(raw);
      // Se l'utente sta digitando un valore non numerico (es. "abc"), non
      // aggiornare grams — lascia il valore precedente. La validazione
      // finale avviene in handleSave.
      if (raw.trim() !== '' && !Number.isFinite(parsed)) {
        return;
      }
      const v = Math.max(0, parsed);
      _recipeEditorState.ingredients = _recipeEditorState.ingredients.map((i) =>
        i.id === id ? { ...i, grams: v } : i,
      );
      // Update mirato: aggiorna solo il meta della riga + i totali, senza re-render
      // (preserva il focus sull'input dei grammi durante la digitazione)
      updateIngRowLive(id || '');
      return;
    }
    if (t.id === 're-search-input') {
      _recipeEditorState.searchQuery = (t as HTMLInputElement).value;
      // Fix OFF-RETRY: nuova query → resetta il flag auto-retry
      _recipeEditorState.searchAutoRetryDone = false;
      // Fix PARTIAL-MATCH: nuova query → resetta la query efficace
      _recipeEditorState.searchEffectiveQuery = '';
      if (_recipeEditorState.searchQuery.trim().length < SEARCH_MIN_QUERY) {
        _recipeEditorState.searchResults = [];
        _recipeEditorState.searchLoading = false;
        // Aggiorna SOLO la lista — non toccare il searchbox (preserva focus)
        updateSubSearchList();
        return;
      }
      _recipeEditorState.searchLoading = true;
      // Aggiorna SOLO la lista (mostra spinner) — non toccare il searchbox
      updateSubSearchList();
      runSubSearch(_recipeEditorState.searchQuery);
      return;
    }
  });

  document.addEventListener('click', (e) => {
    if (!document.querySelector('[data-modal-id="recipe-editor"]')) return;
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-re-action]');
    if (!target) return;
    const action = target.dataset.reAction;
    if (!action) return;

    if (action === 'open-search') {
      if (!_recipeEditorState.searchOpen) openSubSearch();
      return;
    }
    if (action === 'search-tab') {
      const newTab = target.dataset.tab as 'favorites' | 'saved' | 'search';
      if (newTab === _recipeEditorState.searchTab) return;
      // Se lasciamo il tab search, abortisce la ricerca in corso
      if (_recipeEditorState.searchTab === 'search' && newTab !== 'search') {
        if (_recipeEditorState.searchAbort) {
          try {
            _recipeEditorState.searchAbort.abort();
          } catch {
            /* noop */
          }
          _recipeEditorState.searchAbort = null;
        }
        _recipeEditorState.searchLoading = false;
        _recipeEditorState.searchResults = [];
      }
      _recipeEditorState.searchTab = newTab;
      updateSubSearchContent();
      return;
    }
    if (action === 'search-pick') {
      const id = target.dataset.foodId || '';
      const state = getState();
      // lookup in saved/favorites OR in search results
      const all = [...state.foods, ..._recipeEditorState.searchResults];
      const f = all.find((x) => x.id === id);
      if (f) {
        // Fix HIGH bug: usa saveOffFood() che centralizza il dedupe per barcode.
        // Prima veniva fatto `addFood({...f, id: safeId('food_')})` che generava
        // un nuovo id ad ogni pick, creando duplicati per lo stesso prodotto OFF
        // quando pickato in sessioni/recipe-editor diverse.
        const foodRef = f.source === 'openfoodfacts' ? saveOffFood(f) : f;
        _recipeEditorState.ingredients = [
          ..._recipeEditorState.ingredients,
          {
            id: safeId('ing_'),
            foodId: foodRef.id,
            foodSnapshot: foodRef,
            grams: foodRef.servingSize,
          },
        ];
        closeModalById('recipe-search-sub');
        rerenderModalBody();
        showToast(`${foodRef.name} aggiunto`, 'success');
      }
      return;
    }
    if (action === 'search-custom') {
      closeModalById('recipe-search-sub');
      openFoodEditor('new');
      return;
    }
    if (action === 'ing-remove') {
      const id = target.dataset.ingId || '';
      _recipeEditorState.ingredients = _recipeEditorState.ingredients.filter((i) => i.id !== id);
      rerenderModalBody();
      return;
    }
  });
}

/** Fix B5: ritorna false per bloccare chiusura modal se validazione fallisce. */
function handleSave(recipeId: string | null): boolean {
  if (!_recipeEditorState.name.trim()) {
    showToast('Inserisci il nome della ricetta', 'error');
    return false;
  }
  if (_recipeEditorState.ingredients.length === 0) {
    showToast('Aggiungi almeno un ingrediente', 'error');
    return false;
  }
  // Validazione servings: parse strict, rifiuta NaN/negativi/zero
  const servingsTrimmed = _recipeEditorState.servings.trim();
  if (servingsTrimmed === '') {
    showToast('Inserisci il numero di porzioni', 'error');
    return false;
  }
  const servings = Number(servingsTrimmed);
  if (!Number.isFinite(servings)) {
    showToast(`Numero di porzioni non valido ("${servingsTrimmed}")`, 'error');
    return false;
  }
  if (servings < 1) {
    showToast('Il numero di porzioni deve essere almeno 1', 'error');
    return false;
  }
  // Fix R8 (T4): validazione max servings (coerente con normalizeRecipe max=200 e HTML max=200)
  if (servings > 200) {
    showToast('Il numero di porzioni non può superare 200', 'error');
    return false;
  }
  // Validazione grammi di ogni ingrediente: parse strict, rifiuta NaN/negativi/zero
  // (lo stato interno contiene già numbers grazie all'input handler, ma verifichiamo
  // comunque per difesa — l'utente potrebbe aver digitato "abc" e l'handler lo ha
  // convertito silenziosamente a 0)
  for (const ing of _recipeEditorState.ingredients) {
    if (!Number.isFinite(ing.grams)) {
      showToast(`"${ing.foodSnapshot.name}": grammi non validi`, 'error');
      return false;
    }
    if (ing.grams <= 0) {
      showToast(`"${ing.foodSnapshot.name}": i grammi devono essere maggiori di 0`, 'error');
      return false;
    }
  }
  const payload = {
    name: _recipeEditorState.name.trim(),
    description: _recipeEditorState.description.trim() || undefined,
    servings,
    ingredients: _recipeEditorState.ingredients,
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
    if (!_recipeEditorState.searchOpen) {
      openSubSearch();
    }
    _recipeEditorState.searchTab = 'saved';
    updateSubSearchContent();
  }
}
