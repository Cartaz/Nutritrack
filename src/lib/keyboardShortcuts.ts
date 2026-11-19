// Keyboard shortcuts globali per uso desktop.
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
//   - un dialog applicativo è aperto (esc gestisce già la chiusura)

import { getState, switchView, openFoodSearch, isAnyDialogOpen } from './store';
import type { ViewName } from '../types';
import { isValidDateKey } from './utils';
import { closeModalById, isModalOpen, showModal } from '../components/modal';

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

function handleKeydown(e: KeyboardEvent): void {
  // Skip se stiamo digitando in un campo
  if (isTyping(e.target)) return;
  // Skip se un dialog applicativo è aperto (lascia che ESC/close gestiscano)
  if (isAnyDialogOpen()) return;
  // Con l'aiuto aperto le scorciatoie tacciono: ESC/chiusura sono gestiti dal modale.
  if (isHelpOpen()) return;
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

const HELP_MODAL_ID = 'kbd-help';
let _helpOverlay: HTMLElement | null = null;

function isHelpOpen(): boolean {
  return isModalOpen(_helpOverlay);
}

function openHelp(): void {
  if (isHelpOpen()) return;
  _helpOverlay = showModal({
    modalId: HELP_MODAL_ID,
    title: '⌨️ Scorciatoie da tastiera',
    trustedBodyHtml: `
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
    `,
    actions: [{ label: 'OK', action: 'close', variant: 'primary' }],
  });
}

function closeHelp(): void {
  if (isHelpOpen()) closeModalById(HELP_MODAL_ID);
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
