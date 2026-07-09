// Test unitari per src/lib/recentFoods.ts
//
// Verifica:
// - getRecentFoods: ordinamento per ultimo utilizzo, dedupe per foodId, limite 10
// - useCount aggregato correttamente
// - quickAddRecentFood: usa pasto intelligente in base all'ora + addFoodToDiary

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getRecentFoods, quickAddRecentFood } from '../src/lib/recentFoods';
import { setState } from '../src/lib/store';
import type { FoodItem, DiaryEntry } from '../src/types';

// Mock addFoodToDiary per verificare la chiamata
const addFoodToDiaryMock = vi.fn();
vi.mock('../src/lib/diary', () => ({
  addFoodToDiary: (input: unknown) => addFoodToDiaryMock(input),
}));

beforeEach(() => {
  setState({
    foods: [],
    diary: {},
    recipes: [],
    favoriteFoodIds: [],
    biometrics: {},
  });
  addFoodToDiaryMock.mockReset();
});

function makeFood(id: string, name: string): FoodItem {
  return {
    id,
    name,
    source: 'custom',
    servingSize: 100,
    nutrition: { calories: 100, protein: 5, carbs: 20, fat: 2 },
    createdAt: 0,
  };
}

function makeEntry(id: string, date: string, foodId: string, food: FoodItem, createdAt: number): DiaryEntry {
  return {
    id,
    date,
    meal: 'lunch',
    foodId,
    foodSnapshot: food,
    quantity: 1,
    createdAt,
  };
}

describe('getRecentFoods', () => {
  it('ritorna array vuoto se diario vuoto', () => {
    expect(getRecentFoods()).toEqual([]);
  });

  it('ritorna alimenti ordinati per ultimo utilizzo (desc)', () => {
    const f1 = makeFood('food_a', 'Pasta');
    const f2 = makeFood('food_b', 'Riso');
    const f3 = makeFood('food_c', 'Pane');
    setState({
      foods: [f1, f2, f3],
      diary: {
        '2026-07-08': [makeEntry('e1', '2026-07-08', 'food_a', f1, 1000)],
        '2026-07-09': [makeEntry('e2', '2026-07-09', 'food_b', f2, 2000)],
        '2026-07-10': [makeEntry('e3', '2026-07-10', 'food_c', f3, 3000)],
      },
    });
    const recents = getRecentFoods();
    expect(recents.map((r) => r.food.id)).toEqual(['food_c', 'food_b', 'food_a']);
  });

  it('deduplica per foodId: useCount aggregato, lastUsedAt = più recente', () => {
    const f1 = makeFood('food_a', 'Pasta');
    setState({
      foods: [f1],
      diary: {
        '2026-07-08': [makeEntry('e1', '2026-07-08', 'food_a', f1, 1000)],
        '2026-07-09': [makeEntry('e2', '2026-07-09', 'food_a', f1, 2000)],
        '2026-07-10': [makeEntry('e3', '2026-07-10', 'food_a', f1, 3000)],
      },
    });
    const recents = getRecentFoods();
    expect(recents).toHaveLength(1);
    expect(recents[0].useCount).toBe(3);
    expect(recents[0].lastUsedDate).toBe('2026-07-10');
    expect(recents[0].lastUsedAt).toBe(3000);
  });

  it('limita a 10 elementi', () => {
    const foods: FoodItem[] = [];
    const diary: Record<string, DiaryEntry[]> = {};
    for (let i = 0; i < 15; i++) {
      const f = makeFood(`food_${i}`, `Food ${i}`);
      foods.push(f);
      const date = `2026-07-${String(i + 1).padStart(2, '0')}`;
      diary[date] = [makeEntry(`e${i}`, date, f.id, f, 1000 + i)];
    }
    setState({ foods, diary });
    const recents = getRecentFoods(10);
    expect(recents).toHaveLength(10);
  });

  it('usa snapshot della entry se foodId non in state.foods (food eliminato)', () => {
    const f1 = makeFood('food_deleted', 'Eliminato');
    setState({
      foods: [], // food eliminato
      diary: {
        '2026-07-10': [makeEntry('e1', '2026-07-10', 'food_deleted', f1, 1000)],
      },
    });
    const recents = getRecentFoods();
    expect(recents).toHaveLength(1);
    expect(recents[0].food.name).toBe('Eliminato');
  });

  it('usa snapshot fresco da state.foods se disponibile', () => {
    const f1 = makeFood('food_a', 'Pasta originale');
    const f1Updated = makeFood('food_a', 'Pasta rinominata');
    setState({
      foods: [f1Updated],
      diary: {
        '2026-07-10': [makeEntry('e1', '2026-07-10', 'food_a', f1, 1000)],
      },
    });
    const recents = getRecentFoods();
    expect(recents[0].food.name).toBe('Pasta rinominata');
  });
});

describe('quickAddRecentFood', () => {
  it('chiama addFoodToDiary con gramsOverride = servingSize', () => {
    const food = makeFood('food_a', 'Pasta');
    quickAddRecentFood(food, '2026-07-10');
    expect(addFoodToDiaryMock).toHaveBeenCalledTimes(1);
    const call = addFoodToDiaryMock.mock.calls[0][0];
    expect(call.date).toBe('2026-07-10');
    expect(call.food).toBe(food);
    expect(call.quantity).toBe(1);
    expect(call.gramsOverride).toBe(100);
  });

  it("sceglie meal in base all'ora corrente", () => {
    const food = makeFood('food_a', 'Pasta');
    // Verifica che meal sia uno dei 4 validi (non testiamo l'ora esatta per flakiness)
    quickAddRecentFood(food, '2026-07-10');
    const call = addFoodToDiaryMock.mock.calls[0][0];
    expect(['breakfast', 'lunch', 'dinner', 'snack']).toContain(call.meal);
  });
});
