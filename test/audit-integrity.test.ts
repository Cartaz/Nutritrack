import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiaryEntry, FoodItem } from '../src/types';
import { normalizeDayDiary, normalizeNutrition } from '../src/lib/normalize';
import { addDiaryEntries, getState, resetAll, setState, updateSettings } from '../src/lib/store';
import { addRecipeToDiary, changeEntryQuantity } from '../src/lib/diary';
import {
  __resetStorageInternalForTesting,
  enableAutoSave,
  importDataJson,
  loadData,
  saveData,
} from '../src/lib/storage';
import { STORAGE_KEY } from '../src/lib/constants';

const DATE = '2026-09-30';
const FOOD: FoodItem = {
  id: 'water',
  name: 'Acqua',
  source: 'custom',
  servingSize: 200,
  nutrition: { calories: 0, protein: 0, carbs: 0, fat: 0 },
  createdAt: 1,
};
const ENTRY: DiaryEntry = {
  id: 'entry',
  date: DATE,
  meal: 'lunch',
  foodId: FOOD.id,
  foodSnapshot: FOOD,
  quantity: 1,
  createdAt: 1,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 16));
  localStorage.clear();
  __resetStorageInternalForTesting();
  resetAll();
  setState({ currentDate: DATE, _storageDisabled: false });
});

afterEach(async () => {
  __resetStorageInternalForTesting();
  await vi.runAllTimersAsync();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('audit: persisted data integrity', () => {
  it('preserves explicitly zero nutrition through save and reload, including recipes and diary', () => {
    setState({
      foods: [FOOD],
      diary: { [DATE]: [ENTRY] },
      recipes: [
        {
          id: 'recipe',
          name: 'Acqua aromatizzata',
          servings: 1,
          ingredients: [{ id: 'ing', foodId: FOOD.id, foodSnapshot: FOOD, grams: 200 }],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    expect(saveData().ok).toBe(true);
    resetAll();
    expect(loadData()).toBe(true);
    expect(getState().foods).toHaveLength(1);
    expect(getState().diary[DATE]).toHaveLength(1);
    expect(getState().recipes).toHaveLength(1);
  });

  it('still rejects nutrition with missing or invalid values', () => {
    for (const nutrition of [
      {},
      { calories: 0 },
      { calories: -1, protein: 0, carbs: 0, fat: 0 },
      { calories: '', protein: 0, carbs: 0, fat: 0 },
    ]) {
      expect(normalizeNutrition(nutrition)).toBeNull();
    }
  });

  it('uses the diary bucket date consistently for imported history and statistics', () => {
    const snapshot = { ...FOOD, nutrition: { ...FOOD.nutrition, calories: 50 } };
    const diary = normalizeDayDiary({ [DATE]: [{ ...ENTRY, date: '2026-09-29', foodSnapshot: snapshot }] }, []);
    expect(diary[DATE][0].date).toBe(DATE);
  });

  it.each([{ version: 1 }, { foods: 'invalid' }, { settings: null }, { diary: [] }])(
    'rejects an invalid backup envelope without replacing existing data: %j',
    (document) => {
      setState({ foods: [FOOD] });
      expect(importDataJson(JSON.stringify(document)).ok).toBe(false);
      expect(getState().foods).toEqual([FOOD]);
    },
  );

  it('flushes an unrendered local change when the page is hidden or leaves', () => {
    expect(saveData().ok).toBe(true);
    enableAutoSave();
    updateSettings({ calorieGoal: 2300 });
    window.dispatchEvent(new Event('pagehide'));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).settings.calorieGoal).toBe(2300);
    updateSettings({ calorieGoal: 2400 });
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).settings.calorieGoal).toBe(2400);
  });

  it('makes a fatal autosave failure visible in application state', () => {
    expect(saveData().ok).toBe(true);
    setState({ foods: [FOOD] });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });
    expect(saveData().ok).toBe(false);
    expect(getState()._storageDisabled).toBe(true);
  });
});

describe('audit: diary transaction and precision', () => {
  it('rejects a batch containing an invalid date or amount atomically', () => {
    for (const invalid of [
      { ...ENTRY, date: '2026-02-30' },
      { ...ENTRY, quantity: NaN },
      { ...ENTRY, gramsOverride: 0 },
    ]) {
      expect(addDiaryEntries([ENTRY, invalid]).ok).toBe(false);
      expect(getState().diary).toEqual({});
    }
  });

  it('preserves small ingredient quantities when adding a recipe portion', () => {
    setState({
      recipes: [
        {
          id: 'recipe',
          name: 'Condimento',
          servings: 200,
          ingredients: [{ id: 'ing', foodSnapshot: FOOD, grams: 1 }],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    addRecipeToDiary('lunch', 'recipe', 1);
    expect(getState().diary[DATE][0].gramsOverride).toBe(0.005);
  });

  it('preserves fractional grams when changing and restoring portions', () => {
    setState({ diary: { [DATE]: [{ ...ENTRY, gramsOverride: 0.4 }] } });
    changeEntryQuantity(ENTRY.id, -0.5, 1, 0.4);
    expect(getState().diary[DATE][0].gramsOverride).toBeCloseTo(0.2);
    changeEntryQuantity(ENTRY.id, 0.5, 0.5, 0.2);
    expect(getState().diary[DATE][0].gramsOverride).toBeCloseTo(0.4);
  });
});
