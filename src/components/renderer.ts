// Renderer principale: render() con RAF + code-splitting viste via dynamic import + event delegation globale.
// Pattern 2 + 3 dello standard.

import { getState, emitChange, switchView, closeRecipeMealPicker } from '../lib/store';
import { renderHeader, renderBottomNav } from './header';
import { initImageFallback } from './imageFallback';
import { bindSearchEvents, renderSearchShell, updateSearchContent } from './search';
import { showToast } from './toast';
import { showModal } from './modal';
import { escapeHtml, escapeAttr } from '../lib/utils';
import type { ViewName, FoodItem, Recipe } from '../types';
import { MEAL_LABELS } from '../types';
import { getStoreState, closeConfirmReset, resetAll } from '../lib/store';
import { confirmDeleteFood, cancelDeleteFood } from '../lib/foods';
import { confirmDeleteRecipe, cancelDeleteRecipe } from '../lib/recipes';
import { addRecipeToDiary } from '../lib/diary';

let _mainEl: HTMLElement | null = null;
let _appEl: HTMLElement | null = null;
let _rafScheduled = false;
let _renderToken = 0;
let _eventsBound = false;

export function getMain(): HTMLElement {
  if (_mainEl && document.body.contains(_mainEl)) return _mainEl;
  _mainEl = document.getElementById('main') as HTMLElement;
  return _mainEl;
}

export function getApp(): HTMLElement {
  if (_appEl && document.body.contains(_appEl)) return _appEl;
  _appEl = document.getElementById('app') as HTMLElement;
  return _appEl;
}

/** Render principale: shell (header+nav) + vista corrente (lazy) + overlay modali */
export function render(): void {
  if (_rafScheduled) return;
  _rafScheduled = true;
  requestAnimationFrame(() => {
    _rafScheduled = false;
    void doRender();
  });
}

async function doRender(): Promise<void> {
  const state = getState();
  const app = getApp();

  const currentHeader = app.querySelector('.app-header');
  if (!currentHeader) {
    app.innerHTML = `
      ${renderHeader(state.currentView)}
      <main id="main" class="app-main"></main>
      ${renderBottomNav(state.currentView)}
    `;
  } else {
    // Update nav attiva (cheap)
    const navItems = app.querySelectorAll('.nav-item');
    navItems.forEach((btn) => {
      const el = btn as HTMLElement;
      const v = el.dataset.view as ViewName;
      if (v === state.currentView) {
        el.classList.add('active');
        el.setAttribute('aria-current', 'page');
      } else {
        el.classList.remove('active');
        el.removeAttribute('aria-current');
      }
    });
  }

  // Render vista (lazy)
  const myToken = ++_renderToken;
  const main = getMain();
  const viewChanged = main.dataset.view !== state.currentView;
  if (viewChanged) {
    main.dataset.view = state.currentView;
    // Reset signature cache delle viste per forzare re-render completo al cambio vista
    resetViewSignatures();
    main.innerHTML = `<div class="view-skeleton"><div class="spinner" aria-hidden="true"></div></div>`;
  }

  try {
    switch (state.currentView) {
      case 'dashboard': {
        const { renderDashboard } = await import('../views/dashboard');
        if (myToken !== _renderToken) return;
        renderDashboard(main);
        break;
      }
      case 'foods': {
        const { renderFoods } = await import('../views/foods');
        if (myToken !== _renderToken) return;
        renderFoods(main);
        break;
      }
      case 'recipes': {
        const { renderRecipes } = await import('../views/recipes');
        if (myToken !== _renderToken) return;
        renderRecipes(main);
        break;
      }
      case 'settings': {
        const { renderSettings } = await import('../views/settings');
        if (myToken !== _renderToken) return;
        renderSettings(main);
        break;
      }
    }
  } catch (e) {
    console.error('[renderer] errore render vista', state.currentView, e);
    // Fix B15: check token prima di scrivere nel catch — se la vista è cambiata, non sovrascrivere
    if (myToken !== _renderToken) return;
    main.innerHTML = `<div class="view-error"><p>Errore caricamento vista.</p><button class="btn btn-outline" data-action="retryView">Riprova</button></div>`;
  }

  renderOverlays();
}

function renderOverlays(): void {
  renderSearchOverlay();
  renderConfirmDeleteFood();
  renderConfirmDeleteRecipe();
  renderConfirmReset();
  void renderFoodEditor();
  void renderRecipeEditor();
  void renderRecipeViewer();
  renderRecipeMealPicker();
}

function renderSearchOverlay(): void {
  const state = getState();
  const existing = document.querySelector<HTMLElement>('[data-modal-id="search-dialog"]');

  if (state._searchOpen && !existing) {
    // Crea shell una volta sola
    const wrap = document.createElement('div');
    wrap.innerHTML = renderSearchShell();
    const overlay = wrap.firstElementChild as HTMLElement;
    document.body.appendChild(overlay);
    document.body.classList.add('modal-open');
    bindSearchEvents();
    // Popola il contenuto iniziale
    updateSearchContent(overlay);
  } else if (!state._searchOpen && existing) {
    // Elimina overlay
    existing.remove();
    closeModalCleanup();
  } else if (state._searchOpen && existing) {
    // Aggiorna SOLO il contenuto dinamico (NON tocca l'input — preserva focus)
    updateSearchContent(existing);
  }
}

// ============ Confirm dialog renders ============

function renderConfirmDeleteFood(): void {
  const id = getStoreState()._confirmDeleteFoodId;
  const existing = document.querySelector('[data-modal-id="confirm-delete-food"]');
  if (!id && existing) { existing.remove(); closeModalCleanup(); return; }
  if (!id || existing) return;
  const food = getStoreState().foods.find((f: FoodItem) => f.id === id);
  if (!food) { cancelDeleteFood(); return; }
  showModal({
    modalId: 'confirm-delete-food',
    title: 'Eliminare l\'alimento?',
    bodyHtml: `<p>Stai per eliminare <strong>${escapeHtml(food.name)}</strong>. Le voci del diario che lo utilizzano manterranno uno snapshot dei dati nutrizionali, quindi non verranno perse.</p>`,
    actions: [
      { label: 'Annulla', action: 'close', variant: 'outline' },
      { label: 'Elimina', action: 'confirm', variant: 'danger' },
    ],
    onConfirm: () => {
      confirmDeleteFood();
      closeModalCleanup();
    },
  });
}

function renderConfirmDeleteRecipe(): void {
  const id = getStoreState()._confirmDeleteRecipeId;
  const existing = document.querySelector('[data-modal-id="confirm-delete-recipe"]');
  if (!id && existing) { existing.remove(); closeModalCleanup(); return; }
  if (!id || existing) return;
  const recipe = getStoreState().recipes.find((r: Recipe) => r.id === id);
  if (!recipe) { cancelDeleteRecipe(); return; }
  showModal({
    modalId: 'confirm-delete-recipe',
    title: 'Eliminare la ricetta?',
    bodyHtml: `<p>Stai per eliminare <strong>${escapeHtml(recipe.name)}</strong>. Questa azione non può essere annullata.</p>`,
    actions: [
      { label: 'Annulla', action: 'close', variant: 'outline' },
      { label: 'Elimina', action: 'confirm', variant: 'danger' },
    ],
    onConfirm: () => {
      confirmDeleteRecipe();
      closeModalCleanup();
    },
  });
}

function renderConfirmReset(): void {
  const open = getStoreState()._confirmReset;
  const existing = document.querySelector('[data-modal-id="confirm-reset"]');
  if (!open && existing) { existing.remove(); closeModalCleanup(); return; }
  if (!open || existing) return;
  showModal({
    modalId: 'confirm-reset',
    title: 'Resettare tutti i dati?',
    bodyHtml: `<p>Verranno cancellati definitivamente alimenti, ricette, diario e impostazioni. Fai prima un backup se vuoi conservarli.</p>`,
    actions: [
      { label: 'Annulla', action: 'close', variant: 'outline' },
      { label: 'Reset', action: 'confirm', variant: 'danger' },
    ],
    onConfirm: () => {
      resetAll();
      closeConfirmReset();
      showToast('Dati resettati', 'success');
      closeModalCleanup();
    },
  });
}

// ============ Lazy-rendered complex modals ============
// Fix B4: 'new' è sentinel per "crea nuovo"; null = chiuso; string = modifica esistente.
// Fix B16: dopo l'await import, re-check di existing + id corrente per evitare doppio modal / phantom modal.

async function renderFoodEditor(): Promise<void> {
  const id = getStoreState()._editingFoodId;
  const existing = document.querySelector('[data-modal-id="food-editor"]');
  if (id === null) {
    // Modal chiuso: rimuovi se esiste (la cleanup del state avviene via onClose callback)
    if (existing) { existing.remove(); closeModalCleanup(); }
    return;
  }
  // id è 'new' o un food id esistente: se il modal esiste già, skip
  if (existing) return;
  const { renderFoodEditorModal } = await import('../views/food-editor');
  // Fix B16: re-check dopo await — lo stato potrebbe essere cambiato (es. resetAll, close da altro path)
  const idAfter = getStoreState()._editingFoodId;
  if (idAfter !== id) return;
  if (document.querySelector('[data-modal-id="food-editor"]')) return;
  renderFoodEditorModal(id);
}

async function renderRecipeEditor(): Promise<void> {
  const id = getStoreState()._editingRecipeId;
  const existing = document.querySelector('[data-modal-id="recipe-editor"]');
  if (id === null) {
    if (existing) { existing.remove(); closeModalCleanup(); }
    return;
  }
  if (existing) return;
  const { renderRecipeEditorModal } = await import('../views/recipe-editor');
  // Fix B16: re-check dopo await
  const idAfter = getStoreState()._editingRecipeId;
  if (idAfter !== id) return;
  if (document.querySelector('[data-modal-id="recipe-editor"]')) return;
  renderRecipeEditorModal(id);
}

async function renderRecipeViewer(): Promise<void> {
  const id = getStoreState()._viewingRecipeId;
  const existing = document.querySelector('[data-modal-id="recipe-viewer"]');
  if (!id && existing) { existing.remove(); closeModalCleanup(); return; }
  if (!id || existing) return;
  const { renderRecipeViewerModal } = await import('../views/recipe-viewer');
  // Fix B16: re-check dopo await
  const idAfter = getStoreState()._viewingRecipeId;
  if (idAfter !== id) return;
  if (document.querySelector('[data-modal-id="recipe-viewer"]')) return;
  renderRecipeViewerModal(id);
}

function renderRecipeMealPicker(): void {
  const id = getStoreState()._addRecipeToMealPickerId;
  const existing = document.querySelector('[data-modal-id="recipe-meal-picker"]');
  if (!id && existing) { existing.remove(); closeModalCleanup(); return; }
  if (!id || existing) return;
  const recipe = getStoreState().recipes.find((r: Recipe) => r.id === id);
  if (!recipe) { closeRecipeMealPicker(); return; }
  const buttons = (['breakfast', 'lunch', 'dinner', 'snack'] as const)
    .map((m) => `<button type="button" class="btn btn-outline btn-block" data-action="addRecipeMeal" data-recipe-id="${escapeAttr(recipe.id)}" data-meal="${m}">${escapeHtml(MEAL_LABELS[m])}</button>`)
    .join('');
  showModal({
    modalId: 'recipe-meal-picker',
    title: 'Aggiungi a quale pasto?',
    bodyHtml: `<p class="muted">${escapeHtml(recipe.name)} · per oggi</p><div class="grid-2">${buttons}</div>`,
    actions: [{ label: 'Annulla', action: 'close', variant: 'outline' }],
    sticky: false,
  });
}

function closeModalCleanup(): void {
  if (!document.querySelector('.modal-overlay')) {
    document.body.classList.remove('modal-open');
  }
}

/** Reset signature cache di tutte le viste (chiamato al cambio vista). */
function resetViewSignatures(): void {
  // Import statico per evitare ciclo: le funzioni di reset sono pure e non hanno side-effect sul renderer.
  // Le viste sono caricate lazy sotto, ma i moduli di reset sono leggeri e staticamente importabili.
  // Per evitare dipendenze circolari con il lazy import, usiamo dynamic import con fire-and-forget.
  void resetAllSignatures();
}

async function resetAllSignatures(): Promise<void> {
  // Import lazy per evitare di caricare tutte le viste nel bundle principale del renderer
  const [dash, foods, recipes, settings] = await Promise.all([
    import('../views/dashboard'),
    import('../views/foods'),
    import('../views/recipes'),
    import('../views/settings'),
  ]);
  dash.resetDashboardSignature();
  foods.resetFoodsSignature();
  recipes.resetRecipesSignature();
  settings.resetSettingsSignature();
}

// ============ Global event delegation (Pattern 3) ============

export function bindGlobalEvents(): void {
  if (_eventsBound) return;
  _eventsBound = true;
  initImageFallback();

  document.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (!action) return;
    handleAction(action, target);
  });
}

function handleAction(action: string, el: HTMLElement): void {
  switch (action) {
    case 'switchView': {
      const v = el.dataset.view as ViewName | undefined;
      if (v) switchView(v);
      return;
    }
    case 'retryView': {
      const main = getMain();
      main.dataset.view = '';
      emitChange();
      return;
    }
    case 'addRecipeMeal': {
      const recipeId = el.dataset.recipeId || '';
      const meal = el.dataset.meal as 'breakfast' | 'lunch' | 'dinner' | 'snack' | undefined;
      if (recipeId && meal) {
        addRecipeToDiary(meal, recipeId, 1);
        closeRecipeMealPicker();
      }
      return;
    }
  }
}

// ============ Tema ============

export function applyTheme(theme: 'light' | 'dark' | 'system'): void {
  const root = document.documentElement;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const effective = theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;
  root.dataset.theme = effective;
}

export function applyInitialTheme(): void {
  applyTheme(getStoreState().settings.theme);
}

if (typeof window !== 'undefined' && window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getStoreState().settings.theme === 'system') {
      applyTheme('system');
    }
  });
}
