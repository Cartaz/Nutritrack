import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiaryEntry, FoodItem } from '../src/types';
import { normalizeDayDiary, normalizeNutrition } from '../src/lib/normalize';
import { addDiaryEntries, getState, resetAll, setState } from '../src/lib/store';
import { addRecipeToDiary, changeEntryQuantity } from '../src/lib/diary';

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
  resetAll();
  setState({ currentDate: DATE, _storageDisabled: false });
});

afterEach(async () => {
  await vi.runAllTimersAsync();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('audit: persisted data integrity', () => {
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
