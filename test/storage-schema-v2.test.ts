import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BACKUP_KEY, SCHEMA_VERSION, STORAGE_KEY } from '../src/lib/constants';
import {
  __resetStorageInternalForTesting,
  enableAutoSave,
  loadData,
  resetApplicationData,
  saveData,
} from '../src/lib/storage';
import { addDiaryEntry, emitChange, getState, resetAll, setCurrentDate } from '../src/lib/store';
import type { FoodItem } from '../src/types';

const LEGACY_KEY = 'nutritrack_data_v1';
const IMAGE = 'https://images.openfoodfacts.org/images/products/800/front_it.3.200.jpg';

const FOOD: FoodItem = {
  id: 'food_1',
  name: 'Pasta',
  source: 'openfoodfacts',
  barcode: '8001234567895',
  servingSize: 80,
  nutrition: { calories: 350, protein: 12, carbs: 70, fat: 2 },
  image: IMAGE,
  createdAt: 1,
};

function legacyV1Document(): string {
  return JSON.stringify({
    version: 1,
    revision: 4,
    originTabId: 'old-tab',
    syncKind: 'state',
    settings: { calorieGoal: 1900 },
    foods: [FOOD],
    diary: {
      '2026-03-01': [
        { id: 'e1', date: '2026-03-01', meal: 'lunch', foodId: FOOD.id, foodSnapshot: FOOD, quantity: 1, createdAt: 2 },
      ],
    },
    recipes: [],
    favoriteFoodIds: [],
    biometrics: {},
  });
}

const flushFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

beforeEach(() => {
  localStorage.clear();
  __resetStorageInternalForTesting();
  resetAll();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('schema v2 and fixed storage key', () => {
  it('loads data left under the legacy v1 key, rewrites it under the fixed key and keeps the original as backup', () => {
    const legacy = legacyV1Document();
    localStorage.setItem(LEGACY_KEY, legacy);

    expect(loadData()).toBe(true);

    expect(getState().settings.calorieGoal).toBe(1900);
    expect(getState().diary['2026-03-01']).toHaveLength(1);
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(persisted.version).toBe(SCHEMA_VERSION);
    expect(persisted.revision).toBe(5);
    expect(persisted.diary['2026-03-01'][0].foodSnapshot).not.toHaveProperty('image');
    expect(persisted.foods[0].image).toBe(IMAGE);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(localStorage.getItem(BACKUP_KEY)).toBe(legacy);
  });

  it('a reset also deletes data still under the legacy key', () => {
    localStorage.setItem(LEGACY_KEY, legacyV1Document());
    expect(resetApplicationData().ok).toBe(true);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('does not copy the library image into new diary snapshots', () => {
    const entry = addDiaryEntry({
      date: '2026-03-02',
      meal: 'dinner',
      foodId: FOOD.id,
      foodSnapshot: FOOD,
      quantity: 1,
      gramsOverride: 100,
    });
    expect(entry?.foodSnapshot).not.toHaveProperty('image');
    expect(entry?.foodSnapshot.nutrition).toEqual(FOOD.nutrition);
  });
});

describe('autosave cost', () => {
  it('skips persistence entirely for UI-only emits and persists data changes', async () => {
    expect(saveData().ok).toBe(true);
    enableAutoSave();
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    emitChange(); // es. un tasto nella ricerca: cambia solo lo stato UI
    await flushFrame();
    setCurrentDate('2026-03-05'); // navigazione: non è un dato persistito
    await flushFrame();
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();

    addDiaryEntry({ date: '2026-03-05', meal: 'snack', foodId: FOOD.id, foodSnapshot: FOOD, quantity: 1 });
    await flushFrame();
    expect(setItem).toHaveBeenCalledWith(STORAGE_KEY, expect.any(String));
  });
});
