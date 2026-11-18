// Renderer principale: render() con RAF + code-splitting viste via dynamic import + event delegation globale.

import {
  getState,
  getActiveDialog,
  emitChange,
  switchView,
  closeAddRecipeToMeal,
  closeDeleteFoodConfirm,
  closeDeleteRecipeConfirm,
  closeResetConfirm,
  getViewRevision,
} from '../lib/store';
import { renderHeader, renderBottomNav } from './header';
import { initImageFallback } from './imageFallback';
import { bindSearchEvents, renderSearchShell, updateSearchContent } from './search';
import { showToast } from './toast';
import { showModal, closeModalById } from './modal';
import { escapeHtml, escapeAttr, formatDateIT } from '../lib/utils';
import type { AppDialog, ViewName, FoodItem, Recipe } from '../types';
import { MEAL_LABELS } from '../types';
import { confirmDeleteFood } from '../lib/foods';
import { confirmDeleteRecipe } from '../lib/recipes';
import { addRecipeToDiary } from '../lib/diary';
import { resetApplicationData } from '../lib/storage';

let _mainEl: HTMLElement | null = null;
let _appEl: HTMLElement | null = null;
let _rafScheduled = false;
let _renderToken = 0;
let _eventsBound = false;
let _lastViewKey: readonly unknown[] | null = null;

/** Tutto ciò da cui dipende il contenuto delle viste (le slice dello store sono immutabili). */
function viewRenderKey(): readonly unknown[] {
  const s = getState();
  return [
    s.currentView,
    s.currentDate,
    s.settings,
    s.foods,
    s.diary,
    s.recipes,
    s.favoriteFoodIds,
    s.biometrics,
    getViewRevision(),
  ];
}

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

  const storageWarning = app.querySelector('#storage-warning');
  if (state._storageDisabled && !storageWarning) {
    const warning = document.createElement('p');
    warning.id = 'storage-warning';
    warning.className = 'storage-warning';
    warning.setAttribute('role', 'alert');
    warning.textContent =
      'Salvataggio non disponibile: le modifiche potrebbero andare perse. Esporta un backup dalle Impostazioni.';
    app.querySelector('.app-header')?.after(warning);
  } else if (!state._storageDisabled) {
    storageWarning?.remove();
  }

  applyTheme(state.settings.theme);

  // Render vista (lazy). Le viste vengono ricostruite solo se è cambiato qualcosa che
  // mostrano: un emit che riguarda solo un dialog (es. digitare nella ricerca) non rifà la vista.
  const myToken = ++_renderToken;
  const main = getMain();
  const viewChanged = main.dataset.view !== state.currentView;
  if (viewChanged) {
    main.dataset.view = state.currentView;
    main.innerHTML = `<div class="view-skeleton"><div class="spinner" aria-hidden="true"></div></div>`;
    _lastViewKey = null;
  }
  const viewKey = viewRenderKey();
  if (_lastViewKey && viewKey.every((part, i) => part === _lastViewKey![i])) {
    renderOverlays();
    return;
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
    if (myToken === _renderToken) _lastViewKey = viewKey;
  } catch (e) {
    _lastViewKey = null;
    console.error('[renderer] errore render vista', state.currentView, e);
    // check token prima di scrivere nel catch — se la vista è cambiata, non sovrascrivere
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
  void renderRecipeEditor();
  void renderRecipeViewer();
  renderRecipeMealPicker();
  void renderEntryEditor();
  // Il food editor viene renderizzato per ultimo perché può essere figlio di search/recipe editor.
  void renderFoodEditor();
}

function renderSearchOverlay(): void {
  const open = getActiveDialog()?.type === 'food-search';
  const existing = document.querySelector<HTMLElement>('[data-modal-id="search-dialog"]');

  if (open && !existing) {
    // Crea shell una volta sola
    const wrap = document.createElement('div');
    wrap.innerHTML = renderSearchShell();
    const overlay = wrap.firstElementChild as HTMLElement;
    document.body.appendChild(overlay);
    document.body.classList.add('modal-open');
    bindSearchEvents();
    // Popola il contenuto iniziale
    updateSearchContent(overlay);
  } else if (!open && existing) {
    // Elimina overlay
    existing.remove();
    closeModalCleanup();
  } else if (open && existing) {
    // Aggiorna SOLO il contenuto dinamico (NON tocca l'input — preserva focus)
    updateSearchContent(existing);
  }
}

// ============ Confirm dialog renders ============

interface DeleteConfirmSpec {
  modalId: 'confirm-delete-food' | 'confirm-delete-recipe';
  /** Id dell'entità che il dialog attivo chiede di eliminare, o null se non è aperto. */
  activeId: () => string | null;
  /** Nome dell'entità, o null se non esiste più (es. eliminata in un altro tab). */
  entityName: (id: string) => string | null;
  title: string;
  body: (name: string) => string;
  confirm: () => void;
  cancel: () => void;
}

/** Id attualmente renderizzato per modal: una nuova richiesta può arrivare mentre il vecchio overlay si chiude. */
const _openConfirmIds = new Map<string, string | null>();

function renderDeleteConfirm(spec: DeleteConfirmSpec): void {
  const id = spec.activeId();
  const existing = document.querySelector(`[data-modal-id="${spec.modalId}"]`);
  const openId = _openConfirmIds.get(spec.modalId) ?? null;
  if (!id) {
    if (existing) {
      existing.remove();
      closeModalCleanup();
    }
    _openConfirmIds.set(spec.modalId, null);
    return;
  }
  if (existing && openId === id) return;
  if (existing) closeModalById(spec.modalId);

  const name = spec.entityName(id);
  if (name === null) {
    _openConfirmIds.set(spec.modalId, null);
    spec.cancel();
    return;
  }
  _openConfirmIds.set(spec.modalId, id);
  showModal({
    modalId: spec.modalId,
    title: spec.title,
    bodyText: spec.body(name),
    actions: [
      { label: 'Annulla', action: 'close', variant: 'outline' },
      { label: 'Elimina', action: 'confirm', variant: 'danger' },
    ],
    onConfirm: () => {
      spec.confirm();
      closeModalCleanup();
    },
    onClose: () => {
      spec.cancel();
      _openConfirmIds.set(spec.modalId, null);
    },
  });
}

function renderConfirmDeleteFood(): void {
  renderDeleteConfirm({
    modalId: 'confirm-delete-food',
    activeId: () => {
      const dialog = getActiveDialog();
      return dialog?.type === 'confirm-delete-food' ? dialog.foodId : null;
    },
    entityName: (id) => getState().foods.find((f: FoodItem) => f.id === id)?.name ?? null,
    title: "Eliminare l'alimento?",
    body: (name) =>
      `Stai per eliminare ${name}. Le voci del diario che lo utilizzano manterranno uno snapshot dei dati nutrizionali, quindi non verranno perse.`,
    confirm: confirmDeleteFood,
    cancel: closeDeleteFoodConfirm,
  });
}

function renderConfirmDeleteRecipe(): void {
  renderDeleteConfirm({
    modalId: 'confirm-delete-recipe',
    activeId: () => {
      const dialog = getActiveDialog();
      return dialog?.type === 'confirm-delete-recipe' ? dialog.recipeId : null;
    },
    entityName: (id) => getState().recipes.find((r: Recipe) => r.id === id)?.name ?? null,
    title: 'Eliminare la ricetta?',
    body: (name) => `Stai per eliminare ${name}. Questa azione non può essere annullata.`,
    confirm: confirmDeleteRecipe,
    cancel: closeDeleteRecipeConfirm,
  });
}

function renderConfirmReset(): void {
  const open = getActiveDialog()?.type === 'confirm-reset';
  const existing = document.querySelector('[data-modal-id="confirm-reset"]');
  if (!open && existing) {
    existing.remove();
    closeModalCleanup();
    return;
  }
  if (!open || existing) return;
  showModal({
    modalId: 'confirm-reset',
    title: 'Resettare tutti i dati?',
    bodyText:
      'Verranno cancellati definitivamente alimenti, ricette, diario e impostazioni. Fai prima un backup se vuoi conservarli.',
    actions: [
      { label: 'Annulla', action: 'close', variant: 'outline' },
      { label: 'Reset', action: 'confirm', variant: 'danger' },
    ],
    onConfirm: () => {
      void resetApplicationData().then((result) => {
        if (result.ok) showToast('Dati resettati', 'success');
        else showToast(result.error, 'error', 6000);
      });
    },
    onClose: () => closeResetConfirm(),
  });
}

// ============ Lazy-rendered complex modals ============

function activeFoodEditorId(dialog: AppDialog | null = getActiveDialog()): string | null {
  if (!dialog) return null;
  if (dialog.type === 'food-editor') return dialog.foodId;
  if ((dialog.type === 'food-search' || dialog.type === 'recipe-editor') && dialog.child) {
    return dialog.child.foodId;
  }
  return null;
}

async function renderFoodEditor(): Promise<void> {
  const id = activeFoodEditorId();
  const existing = document.querySelector('[data-modal-id="food-editor"]');
  if (id === null) {
    if (existing) {
      existing.remove();
      closeModalCleanup();
    }
    return;
  }
  if (existing) return;
  const { renderFoodEditorModal } = await import('../views/food-editor');
  const idAfter = activeFoodEditorId();
  if (idAfter !== id) return;
  if (document.querySelector('[data-modal-id="food-editor"]')) return;
  renderFoodEditorModal(id);
}

async function renderRecipeEditor(): Promise<void> {
  const dialog = getActiveDialog();
  const id = dialog?.type === 'recipe-editor' ? dialog.recipeId : null;
  const existing = document.querySelector('[data-modal-id="recipe-editor"]');
  if (id === null) {
    if (existing) {
      existing.remove();
      closeModalCleanup();
    }
    return;
  }
  if (existing) return;
  const { renderRecipeEditorModal } = await import('../views/recipe-editor');
  const dialogAfter = getActiveDialog();
  const idAfter = dialogAfter?.type === 'recipe-editor' ? dialogAfter.recipeId : null;
  if (idAfter !== id) return;
  if (document.querySelector('[data-modal-id="recipe-editor"]')) return;
  renderRecipeEditorModal(id);
}

async function renderRecipeViewer(): Promise<void> {
  const dialog = getActiveDialog();
  const id = dialog?.type === 'recipe-viewer' ? dialog.recipeId : null;
  const existing = document.querySelector('[data-modal-id="recipe-viewer"]');
  if (!id && existing) {
    existing.remove();
    closeModalCleanup();
    return;
  }
  if (!id || existing) return;
  const { renderRecipeViewerModal } = await import('../views/recipe-viewer');
  const dialogAfter = getActiveDialog();
  const idAfter = dialogAfter?.type === 'recipe-viewer' ? dialogAfter.recipeId : null;
  if (idAfter !== id) return;
  if (document.querySelector('[data-modal-id="recipe-viewer"]')) return;
  renderRecipeViewerModal(id);
}

async function renderEntryEditor(): Promise<void> {
  const dialog = getActiveDialog();
  const id = dialog?.type === 'entry-editor' ? dialog.entryId : null;
  const existing = document.querySelector('[data-modal-id="entry-editor"]');
  if (!id && existing) {
    existing.remove();
    closeModalCleanup();
    return;
  }
  if (!id || existing) return;
  const { renderEntryEditorModal } = await import('../views/entry-editor');
  const dialogAfter = getActiveDialog();
  const idAfter = dialogAfter?.type === 'entry-editor' ? dialogAfter.entryId : null;
  if (idAfter !== id) return;
  if (document.querySelector('[data-modal-id="entry-editor"]')) return;
  renderEntryEditorModal(id);
}

function renderRecipeMealPicker(): void {
  const s = getState();
  const dialog = getActiveDialog();
  const id = dialog?.type === 'recipe-meal-picker' ? dialog.recipeId : null;
  const existing = document.querySelector('[data-modal-id="recipe-meal-picker"]');
  if (!id && existing) {
    existing.remove();
    closeModalCleanup();
    return;
  }
  if (!id || existing) return;
  const recipe = s.recipes.find((r: Recipe) => r.id === id);
  if (!recipe) {
    closeAddRecipeToMeal();
    return;
  }
  const dateLabel = formatDateIT(s.currentDate);
  const buttons = (['breakfast', 'lunch', 'dinner', 'snack'] as const)
    .map(
      (m) =>
        `<button type="button" class="btn btn-outline btn-block" data-action="addRecipeMeal" data-recipe-id="${escapeAttr(recipe.id)}" data-meal="${m}">${escapeHtml(MEAL_LABELS[m])}</button>`,
    )
    .join('');
  const servingsInput = `
    <div class="recipe-meal-servings">
      <label for="recipe-servings" class="field-label">Porzioni</label>
      <input id="recipe-servings" type="number" min="0.5" max="20" step="0.5" value="1" />
    </div>
  `;
  showModal({
    modalId: 'recipe-meal-picker',
    title: 'Aggiungi a quale pasto?',
    trustedBodyHtml: `<p class="muted">${escapeHtml(recipe.name)} · per ${escapeHtml(dateLabel)}</p>${servingsInput}<div class="grid-2">${buttons}</div>`,
    actions: [{ label: 'Annulla', action: 'close', variant: 'outline' }],
    onClose: () => closeAddRecipeToMeal(),
  });
}

function closeModalCleanup(): void {
  if (!document.querySelector('.modal-overlay')) {
    document.body.classList.remove('modal-open');
  }
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
      const servingsInput = document.querySelector<HTMLInputElement>('#recipe-servings');
      let servings = 1;
      if (servingsInput) {
        const parsed = Number(servingsInput.value);
        servings = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
      }
      if (recipeId && meal) {
        addRecipeToDiary(meal, recipeId, servings);
        closeAddRecipeToMeal();
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
  applyTheme(getState().settings.theme);
}

if (typeof window !== 'undefined' && window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getState().settings.theme === 'system') {
      applyTheme('system');
    }
  });
}
