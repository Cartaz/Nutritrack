// Modal: editor ricetta. Form nome/desc/servings + lista ingredienti con ricerca OFF.

import {
  getState,
  closeRecipeEditor,
  addRecipe,
  updateRecipeDetails,
  openFoodEditor,
  emitChange,
  isRecipeEditorOpen,
} from '../lib/store';
import { showToast } from '../components/toast';
import { showModal, closeModalById, isModalOpen } from '../components/modal';
import { escapeHtml, escapeAttr, safeId, round } from '../lib/utils';
import { scaleNutrition, sumNutrition } from '../lib/nutrition';
import { FoodSearchSession } from '../components/foodSearchSession';
import { saveOffFood } from '../lib/foods';
import { imgTag } from '../components/img';
import { SEARCH_MIN_QUERY } from '../lib/constants';
import type { FoodItem, Recipe, RecipeIngredient } from '../types';

interface EditorState {
  name: string;
  description: string;
  servings: string;
  ingredients: RecipeIngredient[];
  searchOpen: boolean;
  searchTab: 'favorites' | 'saved' | 'search';
}

const _recipeEditorState: EditorState = {
  name: '',
  description: '',
  servings: '1',
  ingredients: [],
  searchOpen: false,
  searchTab: 'favorites',
};

let _recipeEditorBound = false;

/** Ricerca ingredienti: stessa sessione/politica del dialog "Aggiungi al diario". */
const _subSession = new FoodSearchSession(
  () => updateSubSearchList(),
  () => _recipeEditorState.searchOpen,
);
let _recipeEditBaseline: string | null = null;

function resetRecipeEditorState(): void {
  cancelSubSearchWork();
  Object.assign(_recipeEditorState, {
    name: '',
    description: '',
    servings: '1',
    ingredients: [],
    searchOpen: false,
    searchTab: 'favorites',
  });
}

function recipeEditSignature(recipe: Recipe): string {
  return JSON.stringify({
    name: recipe.name,
    description: recipe.description ?? null,
    servings: recipe.servings,
    ingredients: recipe.ingredients.map((ing) => ({
      id: ing.id,
      foodId: ing.foodId ?? null,
      grams: ing.grams,
      foodSnapshot: {
        id: ing.foodSnapshot.id,
        name: ing.foodSnapshot.name,
        brand: ing.foodSnapshot.brand ?? null,
        barcode: ing.foodSnapshot.barcode ?? null,
        source: ing.foodSnapshot.source,
        servingSize: ing.foodSnapshot.servingSize,
        servingLabel: ing.foodSnapshot.servingLabel ?? null,
        customPortions:
          ing.foodSnapshot.customPortions?.map((portion) => ({
            id: portion.id,
            label: portion.label,
            grams: portion.grams,
          })) ?? null,
        nutrition: {
          calories: ing.foodSnapshot.nutrition.calories,
          protein: ing.foodSnapshot.nutrition.protein,
          carbs: ing.foodSnapshot.nutrition.carbs,
          fat: ing.foodSnapshot.nutrition.fat,
          fiber: ing.foodSnapshot.nutrition.fiber ?? null,
          sugar: ing.foodSnapshot.nutrition.sugar ?? null,
          salt: ing.foodSnapshot.nutrition.salt ?? null,
        },
        image: ing.foodSnapshot.image ?? null,
        createdAt: ing.foodSnapshot.createdAt,
      },
    })),
  });
}

function loadFromRecipe(recipeId: string): Recipe | null {
  const r = getState().recipes.find((x) => x.id === recipeId);
  if (!r) {
    resetRecipeEditorState();
    closeRecipeEditor();
    showToast('La ricetta non esiste più (potrebbe essere stata eliminata in un altro tab)', 'warning', 5000);
    return null;
  }
  _recipeEditorState.name = r.name;
  _recipeEditorState.description = r.description || '';
  _recipeEditorState.servings = String(r.servings);
  _recipeEditorState.ingredients = r.ingredients.map((ing) => ({ ...ing }));
  return r;
}

export function renderRecipeEditorModal(recipeId: string | null): void {
  // Ogni apertura parte da uno stato pulito, compresa la sotto-ricerca ingredienti.
  resetRecipeEditorState();
  if (recipeId && recipeId !== 'new') {
    const recipe = loadFromRecipe(recipeId);
    if (!recipe) {
      _recipeEditBaseline = null;
      return;
    }
    _recipeEditBaseline = recipeEditSignature(recipe);
  } else {
    _recipeEditBaseline = null;
  }

  const editing = !!recipeId && recipeId !== 'new';
  showModal({
    modalId: 'recipe-editor',
    title: editing ? 'Modifica ricetta' : 'Crea ricetta custom',
    trustedBodyHtml: renderEditorBody(),
    actions: [
      { label: 'Annulla', action: 'close', variant: 'outline' },
      { label: editing ? 'Salva ricetta' : 'Crea ricetta', action: 'confirm', variant: 'primary' },
    ],
    onConfirm: () => handleSave(recipeId),
    onClose: () => {
      cancelSubSearchWork();
      closeModalById('recipe-search-sub');
      _recipeEditorState.searchOpen = false;
      _recipeEditBaseline = null;
      closeRecipeEditor();
    },
  });

  bindRecipeEditorModalEvents();
}

function renderEditorBody(): string {
  const { totals, per, servings } = recipeTotals();
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
          <div class="stat-row">${renderMacroRow(totals)}</div>
        </div>
        <div class="totals-block highlight">
          <p class="totals-label">Per porzione (${servings} porz.)</p>
          <div class="stat-row">${renderMacroRow(per, true)}</div>
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

type MacroTotals = { calories: number; protein: number; carbs: number; fat: number };

/** Totali della ricetta in bozza e valori per porzione: unico calcolo per render e aggiornamenti live. */
function recipeTotals(): { totals: MacroTotals; per: MacroTotals; servings: number } {
  const totals = sumNutrition(
    _recipeEditorState.ingredients.map((ing) => scaleNutrition(ing.foodSnapshot.nutrition, ing.grams)),
  );
  const servings = Number(_recipeEditorState.servings) || 1;
  const perServing = (value: number): number => round(value / servings, 1);
  return {
    totals,
    per: {
      calories: perServing(totals.calories),
      protein: perServing(totals.protein),
      carbs: perServing(totals.carbs),
      fat: perServing(totals.fat),
    },
    servings,
  };
}

function renderMacroRow(n: MacroTotals, highlight = false): string {
  return `
    ${renderMacroBox('kcal', String(Math.round(n.calories)), highlight)}
    ${renderMacroBox('P', `${round(n.protein, 1)}g`, highlight)}
    ${renderMacroBox('C', `${round(n.carbs, 1)}g`, highlight)}
    ${renderMacroBox('G', `${round(n.fat, 1)}g`, highlight)}
  `;
}

/** Aggiorna i blocchi dei totali senza ricostruire il form (preserva focus e cursore). */
function updateTotalsLive(): void {
  const overlay = document.querySelector('[data-modal-id="recipe-editor"]');
  if (!overlay) return;
  const { totals, per, servings } = recipeTotals();
  const [totalBlock, perBlock] = Array.from(overlay.querySelectorAll('.totals-block'));
  const totalRow = totalBlock?.querySelector('.stat-row');
  if (totalRow) totalRow.innerHTML = renderMacroRow(totals);
  const perRow = perBlock?.querySelector('.stat-row');
  if (perRow) perRow.innerHTML = renderMacroRow(per, true);
  const perLabel = perBlock?.querySelector('.totals-label');
  if (perLabel) perLabel.textContent = `Per porzione (${servings} porz.)`;
}

// ============ Sub-dialog: ingredient search ============

let _subOverlay: HTMLElement | null = null;

function openSubSearch(): void {
  cancelSubSearchWork();
  const state = getState();
  _recipeEditorState.searchOpen = true;
  _recipeEditorState.searchTab =
    state.favoriteFoodIds.length > 0 ? 'favorites' : state.foods.length > 0 ? 'saved' : 'search';
  _subSession.reset();

  const overlay: HTMLElement = showModal({
    modalId: 'recipe-search-sub',
    title: 'Aggiungi ingrediente',
    trustedBodyHtml: renderSubSearchShell(),
    actions: [],
    onClose: () => {
      // La chiusura è animata: se nel frattempo è stata aperta una nuova sotto-ricerca,
      // questa callback appartiene a quella vecchia e non deve toccare lo stato.
      if (_subOverlay !== overlay) return;
      cancelSubSearchWork();
      _recipeEditorState.searchOpen = false;
      _subOverlay = null;
    },
  });
  _subOverlay = overlay;

  updateSubSearchContent();

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

  const boxEl = _subOverlay.querySelector<HTMLElement>('[data-sub-zone="searchbox"]');
  if (boxEl) {
    const shouldShow = _recipeEditorState.searchTab === 'search';
    const hasContent = boxEl.children.length > 0;
    if (shouldShow && !hasContent) {
      boxEl.innerHTML = `
        <div class="search-row">
          <div class="search-box">
            <span class="search-icon" aria-hidden="true">🔍</span>
            <input id="re-search-input" type="search" placeholder="Cerca su Open Food Facts…" autocomplete="off" />
          </div>
          <button type="button" class="btn btn-primary" data-re-action="run-search">Cerca</button>
        </div>
      `;
      const inp = boxEl.querySelector<HTMLInputElement>('#re-search-input');
      if (inp) inp.value = _subSession.query;
      setTimeout(() => inp?.focus(), 0);
    } else if (!shouldShow && hasContent) {
      boxEl.innerHTML = '';
    }
  }

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
        : _subSession.results;
  const inSearch = _recipeEditorState.searchTab === 'search';
  const emptyHint = !inSearch
    ? 'Nessun alimento qui.'
    : _subSession.query.trim().length < SEARCH_MIN_QUERY
      ? 'Scrivi il nome di un prodotto e premi Cerca.'
      : _subSession.searched
        ? 'Nessun risultato. Prova con un altro termine.'
        : 'Premi Cerca o Invio per interrogare Open Food Facts.';
  const loadMore =
    inSearch && _subSession.canLoadMore
      ? `<div class="search-load-more"><button type="button" class="btn btn-outline btn-sm btn-block" data-re-action="load-more">Carica altri risultati${_subSession.remainingCount > 0 ? ` (${_subSession.remainingCount} restanti)` : ''}</button></div>`
      : '';
  const listHtml =
    inSearch && _subSession.loading
      ? `<div class="search-loading"><span class="spinner" aria-hidden="true"></span> Ricerca…</div>`
      : list.length === 0
        ? `<div class="search-empty">${escapeHtml(emptyHint)}</div>`
        : `<div class="search-list">${list.map((f) => renderIngredientRow(f)).join('')}</div>${loadMore}`;
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

function updateIngRowLive(ingId: string): void {
  const overlay = document.querySelector('[data-modal-id="recipe-editor"]');
  if (!overlay) return;
  const ing = _recipeEditorState.ingredients.find((i) => i.id === ingId);
  if (!ing) return;

  const row = overlay.querySelector<HTMLElement>(`[data-ing-id="${CSS.escape(ingId)}"]`)?.closest('.ing-row');
  if (row) {
    const scaled = scaleNutrition(ing.foodSnapshot.nutrition, ing.grams);
    const meta = row.querySelector<HTMLElement>('.ing-meta');
    if (meta) {
      meta.textContent = `${Math.round(scaled.calories)} kcal · P${Math.round(scaled.protein)}g · C${Math.round(scaled.carbs)}g · G${Math.round(scaled.fat)}g`;
    }
  }

  updateTotalsLive();
}

function cancelSubSearchWork(): void {
  _subSession.cancel();
}

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
      updateTotalsLive();
      return;
    }
    if (t.dataset.reAction === 'ing-grams') {
      const id = t.dataset.ingId;
      const raw = (t as HTMLInputElement).value;
      const parsed = Number(raw);
      if (raw.trim() !== '' && !Number.isFinite(parsed)) return;
      const v = Math.max(0, parsed);
      _recipeEditorState.ingredients = _recipeEditorState.ingredients.map((i) =>
        i.id === id ? { ...i, grams: v } : i,
      );
      updateIngRowLive(id || '');
      return;
    }
    if (t.id === 're-search-input') {
      _subSession.setQuery((t as HTMLInputElement).value);
      updateSubSearchList();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || (e.target as HTMLElement).id !== 're-search-input') return;
    e.preventDefault();
    _subSession.run();
  });

  document.addEventListener('click', (e) => {
    if (!document.querySelector('[data-modal-id="recipe-editor"]')) return;
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-re-action]');
    if (!target) return;
    const action = target.dataset.reAction;
    if (!action) return;

    if (action === 'open-search') {
      // Una sotto-ricerca in chiusura (fade-out) non conta come aperta.
      if (!isModalOpen(_subOverlay)) openSubSearch();
      return;
    }
    if (action === 'run-search') {
      _subSession.run();
      return;
    }
    if (action === 'load-more') {
      _subSession.loadMore();
      return;
    }
    if (action === 'search-tab') {
      const newTab = target.dataset.tab as 'favorites' | 'saved' | 'search';
      if (newTab === _recipeEditorState.searchTab) return;
      if (_recipeEditorState.searchTab === 'search' && newTab !== 'search') {
        _subSession.setQuery(_subSession.query);
      }
      _recipeEditorState.searchTab = newTab;
      updateSubSearchContent();
      return;
    }
    if (action === 'search-pick') {
      const id = target.dataset.foodId || '';
      const state = getState();
      const all = [...state.foods, ..._subSession.results];
      const f = all.find((x) => x.id === id);
      if (f) {
        // Un risultato OFF entra nella libreria solo quando la ricetta viene salvata (handleSave):
        // annullare l'editor non deve lasciare alimenti salvati come effetto collaterale.
        const isSaved = state.foods.some((food) => food.id === f.id);
        _recipeEditorState.ingredients = [
          ..._recipeEditorState.ingredients,
          {
            id: safeId('ing_'),
            foodId: isSaved ? f.id : undefined,
            foodSnapshot: f,
            grams: f.servingSize,
          },
        ];
        closeModalById('recipe-search-sub');
        rerenderModalBody();
        showToast(`${f.name} aggiunto`, 'success');
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
    }
  });
}

/** Salva in libreria (con dedupe) un ingrediente scelto da OFF e non ancora salvato. */
function persistPickedOffFood(ing: RecipeIngredient): RecipeIngredient {
  if (ing.foodId || ing.foodSnapshot.source !== 'openfoodfacts') return ing;
  const saved = saveOffFood(ing.foodSnapshot);
  return { ...ing, foodId: saved.id, foodSnapshot: saved };
}

function handleSave(recipeId: string | null): boolean {
  if (!_recipeEditorState.name.trim()) {
    showToast('Inserisci il nome della ricetta', 'error');
    return false;
  }
  if (_recipeEditorState.ingredients.length === 0) {
    showToast('Aggiungi almeno un ingrediente', 'error');
    return false;
  }
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
  if (servings > 200) {
    showToast('Il numero di porzioni non può superare 200', 'error');
    return false;
  }
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
    ingredients: _recipeEditorState.ingredients.map(persistPickedOffFood),
  };
  if (recipeId && recipeId !== 'new') {
    const current = getState().recipes.find((recipe) => recipe.id === recipeId);
    if (!current) {
      showToast(
        'La ricetta è stata eliminata in un altro tab. Le modifiche locali non sono state applicate.',
        'warning',
        6000,
      );
      closeRecipeEditor();
      return true;
    }
    if (_recipeEditBaseline === null || recipeEditSignature(current) !== _recipeEditBaseline) {
      showToast(
        "La ricetta è stata modificata in un altro tab. Le modifiche locali non sono state applicate: riapri l'editor sui dati aggiornati.",
        'warning',
        6500,
      );
      return false;
    }
    updateRecipeDetails(recipeId, payload);
    showToast('Ricetta aggiornata', 'success');
  } else {
    addRecipe(payload);
    showToast('Ricetta creata', 'success');
  }
  emitChange();
  return true;
}

// Esposto per refresh da food-editor (caso: custom food creato da dentro recipe editor)
export function refreshRecipeEditor(): void {
  if (!isRecipeEditorOpen()) return;
  if (!_recipeEditorState.searchOpen) {
    openSubSearch();
  }
  cancelSubSearchWork();
  _recipeEditorState.searchTab = 'saved';
  updateSubSearchContent();
}
