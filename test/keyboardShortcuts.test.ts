// Test unitari per src/lib/keyboardShortcuts.ts
//
// Verifica (leggera, focus su comportamento chiave):
// - initKeyboardShortcuts è idempotente
// - help overlay: open/close
// - shortcut "/" apre search dialog
// - shortcut "d/f/r/s" cambiano vista
// - shortcut "?" apre help overlay
// - shortcut ignorati quando si sta digitando in un input

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  initKeyboardShortcuts,
  __isHelpOpenForTesting,
  __openHelpForTesting,
  __closeHelpForTesting,
} from '../src/lib/keyboardShortcuts';
import { setState } from '../src/lib/store';
import { switchView, openFoodSearch } from '../src/lib/store';

// Mock store actions per verificare le chiamate
vi.mock('../src/lib/store', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/store')>('../src/lib/store');
  return {
    ...actual,
    switchView: vi.fn(),
    openFoodSearch: vi.fn(),
  };
});

beforeEach(() => {
  setState({
    foods: [],
    diary: {},
    recipes: [],
    favoriteFoodIds: [],
    biometrics: {},
    _searchOpen: false,
    _editingFoodId: null,
    _editingRecipeId: null,
    _viewingRecipeId: null,
    _confirmReset: false,
    _confirmDeleteFoodId: null,
    _confirmDeleteRecipeId: null,
    _addRecipeToMealPickerId: null,
    _editingEntryId: null,
  });
  // Pulisci eventuali overlay residui
  document.body.innerHTML = '';
  document.body.classList.remove('modal-open');
});

afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
  document.body.classList.remove('modal-open');
});

function dispatchKey(key: string, target: HTMLElement | null = null): void {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
  });
  (target ?? document.body).dispatchEvent(event);
}

describe('initKeyboardShortcuts', () => {
  it('è idempotente: chiamate multiple non aggiungono listener duplicati', () => {
    initKeyboardShortcuts();
    initKeyboardShortcuts();
    initKeyboardShortcuts();
    // Se fossero duplicati, dispatchando "?" aprirebbe 3 overlay (ma verifichiamo solo 1)
    dispatchKey('?');
    expect(__isHelpOpenForTesting()).toBe(true);
    const overlays = document.querySelectorAll('#kbd-help-overlay');
    expect(overlays).toHaveLength(1);
  });
});

describe('help overlay', () => {
  it("openHelp crea l'overlay nel DOM", () => {
    __openHelpForTesting();
    expect(__isHelpOpenForTesting()).toBe(true);
    expect(document.getElementById('kbd-help-overlay')).not.toBeNull();
    expect(document.body.classList.contains('modal-open')).toBe(true);
  });

  it("closeHelp rimuove l'overlay", () => {
    __openHelpForTesting();
    __closeHelpForTesting();
    expect(__isHelpOpenForTesting()).toBe(false);
    expect(document.getElementById('kbd-help-overlay')).toBeNull();
  });

  it("click sul bottone close chiude l'overlay", () => {
    __openHelpForTesting();
    const closeBtn = document.querySelector<HTMLButtonElement>('[data-kbd-help-close]');
    expect(closeBtn).not.toBeNull();
    closeBtn!.click();
    expect(__isHelpOpenForTesting()).toBe(false);
  });

  it("Esc chiude l'overlay se aperto", () => {
    __openHelpForTesting();
    dispatchKey('Escape');
    expect(__isHelpOpenForTesting()).toBe(false);
  });
});

describe('navigation shortcuts', () => {
  it('"/" apre il search dialog con meal intelligente', () => {
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    setState({ currentDate: todayKey });
    dispatchKey('/');
    expect(openFoodSearch).toHaveBeenCalledTimes(1);
  });

  it('"d" passa al dashboard', () => {
    setState({ currentView: 'foods' }); // già su foods per evitare short-circuit
    dispatchKey('d');
    expect(switchView).toHaveBeenCalledWith('dashboard');
  });

  it('"f" passa agli alimenti', () => {
    setState({ currentView: 'dashboard' });
    dispatchKey('f');
    expect(switchView).toHaveBeenCalledWith('foods');
  });

  it('"r" passa alle ricette', () => {
    setState({ currentView: 'dashboard' });
    dispatchKey('r');
    expect(switchView).toHaveBeenCalledWith('recipes');
  });

  it('"s" passa alle impostazioni', () => {
    setState({ currentView: 'dashboard' });
    dispatchKey('s');
    expect(switchView).toHaveBeenCalledWith('settings');
  });

  it('shortcut ignorato se già su quella vista (no switchView call)', () => {
    setState({ currentView: 'dashboard' });
    dispatchKey('d');
    expect(switchView).not.toHaveBeenCalled();
  });
});

describe('guard conditions', () => {
  it('shortcut ignorato quando si sta digitando in un input', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    setState({ currentView: 'foods' });
    dispatchKey('d', input);
    expect(switchView).not.toHaveBeenCalled();
  });

  it('shortcut ignorato quando un modal è aperto', () => {
    setState({ currentView: 'foods', _searchOpen: true });
    dispatchKey('d');
    expect(switchView).not.toHaveBeenCalled();
  });

  it('shortcut con modificatori (Ctrl/Cmd) ignorati', () => {
    setState({ currentView: 'foods' });
    const event = new KeyboardEvent('keydown', {
      key: 'd',
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
    });
    document.body.dispatchEvent(event);
    expect(switchView).not.toHaveBeenCalled();
  });
});
