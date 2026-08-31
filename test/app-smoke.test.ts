import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoodItem } from '../src/types';

const searchMocks = vi.hoisted(() => ({
  searchFoods: vi.fn(),
  continueFoodSearch: vi.fn(),
  lookupFoodByBarcode: vi.fn(),
}));

vi.mock('../src/lib/food-search', () => {
  class FoodSearchError extends Error {
    constructor(
      public readonly kind: 'offline' | 'network' | 'timeout' | 'unavailable' | 'unknown',
      message = kind,
    ) {
      super(message);
      this.name = 'FoodSearchError';
    }
  }

  return {
    FoodSearchError,
    searchFoods: searchMocks.searchFoods,
    continueFoodSearch: searchMocks.continueFoodSearch,
    lookupFoodByBarcode: searchMocks.lookupFoodByBarcode,
  };
});

import { renderDashboard } from '../src/views/dashboard';
import { renderEntryEditorModal } from '../src/views/entry-editor';
import { bindSearchEvents, renderSearchShell, updateSearchContent } from '../src/components/search';
import { getActiveDialog, getState, setState, subscribe } from '../src/lib/store';
import { __resetStorageInternalForTesting, loadData, saveData } from '../src/lib/storage';

const DATE = '2026-08-31';
const FOOD: FoodItem = {
  id: 'off-smoke-1',
  name: 'Pasta smoke',
  brand: 'Test',
  source: 'openfoodfacts',
  servingSize: 100,
  nutrition: { calories: 350, protein: 12, carbs: 70, fat: 2 },
  createdAt: 1,
};

let unsubscribe: (() => void) | null = null;

function resetStore(): void {
  setState({
    settings: {
      calorieGoal: 2000,
      macroSplit: { proteinPct: 30, carbsPct: 40, fatPct: 30 },
      theme: 'system',
    },
    foods: [],
    diary: {},
    recipes: [],
    favoriteFoodIds: [],
    biometrics: {},
    currentView: 'dashboard',
    currentDate: DATE,
    _storageDisabled: false,
    dialog: null,
  });
}

function syncSearchOverlay(): void {
  const open = getActiveDialog()?.type === 'food-search';
  let overlay = document.querySelector<HTMLElement>('[data-modal-id="search-dialog"]');

  if (!open) {
    overlay?.remove();
    return;
  }

  if (!overlay) {
    const wrap = document.createElement('div');
    wrap.innerHTML = renderSearchShell();
    overlay = wrap.firstElementChild as HTMLElement;
    document.body.appendChild(overlay);
    bindSearchEvents();
  }

  updateSearchContent(overlay);
}

async function flushUi(): Promise<void> {
  await vi.runAllTimersAsync();
  await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  localStorage.clear();
  __resetStorageInternalForTesting();
  document.body.innerHTML = '<main id="main"></main>';
  resetStore();

  searchMocks.searchFoods.mockResolvedValue({
    foods: [FOOD],
    totalCount: 1,
    continuation: null,
  });
  searchMocks.continueFoodSearch.mockResolvedValue({
    foods: [],
    totalCount: 1,
    continuation: null,
  });
  searchMocks.lookupFoodByBarcode.mockResolvedValue({ kind: 'not-found' });

  unsubscribe = subscribe(syncSearchOverlay);
});

afterEach(() => {
  unsubscribe?.();
  unsubscribe = null;
  vi.useRealTimers();
  __resetStorageInternalForTesting();
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('application diary smoke flow', () => {
  it('goes dashboard → search → add → edit → persisted reload', async () => {
    const main = document.querySelector<HTMLElement>('#main')!;
    renderDashboard(main);
    await flushUi();

    const addLunch = main.querySelector<HTMLButtonElement>('[data-action="addMeal"][data-meal="lunch"]');
    expect(addLunch).not.toBeNull();
    addLunch!.click();
    await flushUi();

    const searchInput = document.querySelector<HTMLInputElement>('#search-input');
    expect(searchInput).not.toBeNull();
    searchInput!.value = 'pasta';
    searchInput!.dispatchEvent(new Event('input', { bubbles: true }));
    await flushUi();

    expect(searchMocks.searchFoods).toHaveBeenCalledWith('pasta', {
      signal: expect.any(AbortSignal),
      italianOnly: true,
    });

    const result = document.querySelector<HTMLElement>('[data-search-action="selectFood"]');
    expect(result?.textContent).toContain('Pasta smoke');
    result!.click();
    await flushUi();

    const confirmAdd = document.querySelector<HTMLButtonElement>('[data-search-action="confirm"]');
    expect(confirmAdd).not.toBeNull();
    confirmAdd!.click();
    await flushUi();

    const added = getState().diary[DATE]?.[0];
    const savedFood = getState().foods.find((food) => food.name === FOOD.name && food.brand === FOOD.brand);
    expect(added?.foodSnapshot.name).toBe('Pasta smoke');
    expect(savedFood?.source).toBe('openfoodfacts');
    expect(savedFood?.id).toMatch(/^food_/);
    expect(added?.foodId).toBe(savedFood?.id);
    expect(added?.foodSnapshot.id).toBe(savedFood?.id);

    renderDashboard(main);
    await flushUi();

    const entryRow = main.querySelector<HTMLElement>(`[data-action="editEntry"][data-entry-id="${added!.id}"]`);
    expect(entryRow).not.toBeNull();
    entryRow!.click();
    await flushUi();

    expect(getActiveDialog()).toEqual({ type: 'entry-editor', entryId: added!.id });
    renderEntryEditorModal(added!.id);
    await flushUi();

    const gramsInput = document.querySelector<HTMLInputElement>('#ee-grams-input');
    expect(gramsInput).not.toBeNull();
    gramsInput!.value = '150';
    gramsInput!.dispatchEvent(new Event('input', { bubbles: true }));

    const saveButton = document.querySelector<HTMLButtonElement>(
      '[data-modal-id="entry-editor"] [data-modal-action="confirm"]',
    );
    expect(saveButton).not.toBeNull();
    saveButton!.click();
    await flushUi();

    expect(getState().diary[DATE][0].gramsOverride).toBe(150);
    expect(saveData()).toEqual({ ok: true });

    resetStore();
    __resetStorageInternalForTesting();
    expect(loadData()).toBe(true);

    const reloaded = getState().diary[DATE]?.[0];
    const reloadedFood = getState().foods.find((food) => food.name === FOOD.name && food.brand === FOOD.brand);
    expect(reloaded?.foodSnapshot.name).toBe('Pasta smoke');
    expect(reloaded?.gramsOverride).toBe(150);
    expect(reloaded?.foodId).toBe(reloadedFood?.id);
    expect(reloaded?.foodSnapshot.id).toBe(reloadedFood?.id);
  });
});
