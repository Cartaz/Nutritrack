// Keyboard shortcuts globali per uso desktop.
// P2 #3 Step 02 "Qualità della vita quotidiana".
//
// Shortcut:
//   /  → focus search (apre il search dialog sul dashboard, meal intelligente)
//   d  → dashboard
//   f  → foods
//   r  → recipes
//   s  → settings
//   ?  → help overlay
//
// Gli shortcut sono disattivati quando:
//   - il focus è in un input/textarea/contenteditable (l'utente sta digitando)
//   - un modal è aperto (esc gestisce già la chiusura)
//   - il search dialog è aperto (esc gestisce già la chiusura)

import { getState, switchView, openFoodSearch } from './store';
import type { ViewName } from '../types';
import { showToast } from '../components/toast';
import { isValidDateKey } from './utils';

let _bound = false;

/** Inizializza il keydown listener globale. Idempotente. */
export function initKeyboardShortcuts(): void {
  if (_bound) return;
  _bound = true;
  document.addEventListener('keydown', handleKeydown);
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (target.isContentEditable) return true;
  return false;
}

function isAnyModalOpen(): boolean {
  const s = getState();
  return (
    s._searchOpen ||
    s._editingFoodId !== null ||
    s._editingRecipeId !== null ||
    s._viewingRecipeId !== null ||
    s._confirmReset ||
    s._confirmDeleteFoodId !== null ||
    s._confirmDeleteRecipeId !== null ||
    s._addRecipeToMealPickerId !== null ||
    s._editingEntryId !== null
  );
}

function handleKeydown(e: KeyboardEvent): void {
  // Skip se stiamo digitando in un campo
  if (isTyping(e.target)) return;
  // Skip se un modal è aperto (lascia che ESC/close gestiscano)
  if (isAnyModalOpen()) return;
  // Skip se l'help overlay è aperto e il tasto è ESC (gestito dal overlay)
  if (isHelpOpen() && e.key === 'Escape') {
    closeHelp();
    e.preventDefault();
    return;
  }
  // Solo tasti singoli senza modificatori (no Ctrl/Cmd/Alt/Meta)
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  const key = e.key.toLowerCase();
  switch (key) {
    case '/': {
      // Apri search dialog sul dashboard corrente. Meal intelligente in base all'ora.
      const s = getState();
      if (!isValidDateKey(s.currentDate)) return;
      const hour = new Date().getHours();
      const meal = hour < 11 ? 'breakfast' : hour < 15 ? 'lunch' : hour < 21 ? 'dinner' : 'snack';
      openFoodSearch(meal, s.currentDate);
      e.preventDefault();
      return;
    }
    case 'd':
      switchTo('dashboard', e);
      return;
    case 'f':
      switchTo('foods', e);
      return;
    case 'r':
      switchTo('recipes', e);
      return;
    case 's':
      switchTo('settings', e);
      return;
    case '?':
      openHelp();
      e.preventDefault();
      return;
  }
}

function switchTo(view: ViewName, e: KeyboardEvent): void {
  const s = getState();
  if (s.currentView === view) return; // già su quella vista
  switchView(view);
  e.preventDefault();
}

// ============ Help overlay ============

const HELP_OVERLAY_ID = 'kbd-help-overlay';

function isHelpOpen(): boolean {
  return !!document.getElementById(HELP_OVERLAY_ID);
}

function openHelp(): void {
  if (isHelpOpen()) return;
  const overlay = document.createElement('div');
  overlay.id = HELP_OVERLAY_ID;
  overlay.className = 'modal-overlay modal-show';
  overlay.dataset.modalId = HELP_OVERLAY_ID;
  overlay.innerHTML = `
    <div class="modal modal-help" role="dialog" aria-modal="true" aria-label="Scorciatoie da tastiera">
      <div class="modal-header">
        <h3 class="modal-title">⌨️ Scorciatoie da tastiera</h3>
        <button type="button" class="modal-close" data-kbd-help-close aria-label="Chiudi">✕</button>
      </div>
      <div class="modal-body">
        <p class="muted">Disponibili ovunque tranne quando stai digitando in un campo o un modal è aperto.</p>
        <ul class="kbd-list">
          <li><kbd>/</kbd> <span>Cerca alimento (apre la ricerca sul pasto corrente)</span></li>
          <li><kbd>d</kbd> <span>Vai al dashboard (Oggi)</span></li>
          <li><kbd>f</kbd> <span>Vai agli alimenti</span></li>
          <li><kbd>r</kbd> <span>Vai alle ricette</span></li>
          <li><kbd>s</kbd> <span>Vai alle impostazioni</span></li>
          <li><kbd>?</kbd> <span>Mostra questo aiuto</span></li>
          <li><kbd>Esc</kbd> <span>Chiudi modal / aiuto</span></li>
        </ul>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-primary" data-kbd-help-close>OK</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.classList.add('modal-open');
  // Bind close su entrambi i bottoni + overlay click
  overlay.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.matches('[data-kbd-help-close]') || t === overlay) {
      closeHelp();
    }
  });
  // Focus sul bottone OK per accessibilità
  const okBtn = overlay.querySelector<HTMLButtonElement>('[data-kbd-help-close].btn-primary');
  okBtn?.focus();
}

function closeHelp(): void {
  const overlay = document.getElementById(HELP_OVERLAY_ID);
  if (!overlay) return;
  overlay.remove();
  // Rimuovi la classe modal-open solo se non ci sono altri modal aperti
  if (!document.querySelector('.modal-overlay')) {
    document.body.classList.remove('modal-open');
  }
}

// Esportato per test
export function __isHelpOpenForTesting(): boolean {
  return isHelpOpen();
}
export function __openHelpForTesting(): void {
  openHelp();
}
export function __closeHelpForTesting(): void {
  closeHelp();
}

// Evita "unused" warning per showToast (usato solo in path futuro)
void showToast;
