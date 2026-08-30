import { beforeEach, describe, expect, it } from 'vitest';
import { addRecipeToDiary } from '../src/lib/diary';
import { addDiaryEntries, getState, setDiaryEntryAmount, setDiaryEntryFoodSnapshot, setState } from '../src/lib/store';
import { MAX_DIARY_ENTRIES_PER_DAY } from '../src/lib/constants';
import type { DiaryEntry, FoodItem, Recipe } from '../src/types';

const DATE = '2026-08-30';

function food(id: string, name = id): FoodItem {
  return {
    id,
    name,
    source: 'custom',
    servingSize: 100,
    nutrition: { calories: 100, protein: 10, carbs: 10, fat: 2 },
    createdAt: 1,
  };
}

function entry(id: string, index = 0): DiaryEntry {
  const snapshot = food(`food-${index}`);
  return {
    id,
    date: DATE,
    meal: 'lunch',
    foodId: snapshot.id,
    foodSnapshot: snapshot,
    quantity: 1,
    createdAt: index + 1,
  };
}

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
    currentDate: DATE,
  });
}

beforeEach(() => {
  document.body.innerHTML = '';
  resetStore();
});

describe('semantic diary entry mutations', () => {
  it('updates amount without exposing a generic DiaryEntry patch', () => {
    setState({ diary: { [DATE]: [entry('entry-1')] } });

    expect(setDiaryEntryAmount('entry-1', 1.5, 150)).toBe(true);

    const updated = getState().diary[DATE][0];
    expect(updated.quantity).toBe(1.5);
    expect(updated.gramsOverride).toBe(150);
    expect(updated.date).toBe(DATE);
    expect(updated.meal).toBe('lunch');
  });

  it('updates only the historical food snapshot', () => {
    setState({ diary: { [DATE]: [entry('entry-1')] } });
    const replacement = food('replacement', 'Nuovo snapshot');

    expect(setDiaryEntryFoodSnapshot('entry-1', replacement)).toBe(true);

    const updated = getState().diary[DATE][0];
    expect(updated.foodSnapshot).toEqual(replacement);
    expect(updated.foodId).toBe('food-0');
    expect(updated.quantity).toBe(1);
  });
});

describe('atomic diary insertion', () => {
  it('does not insert any entry when the whole batch cannot fit', () => {
    const existing = Array.from({ length: MAX_DIARY_ENTRIES_PER_DAY - 1 }, (_, i) =>
      entry(`existing-${i}`, i),
    );
    setState({ diary: { [DATE]: existing } });

    const result = addDiaryEntries([
      {
        date: DATE,
        meal: 'dinner',
        foodId: 'a',
        foodSnapshot: food('a'),
        quantity: 1,
      },
      {
        date: DATE,
        meal: 'dinner',
        foodId: 'b',
        foodSnapshot: food('b'),
        quantity: 1,
      },
    ]);

    expect(result).toEqual({ ok: false, reason: 'day_full', date: DATE });
    expect(getState().diary[DATE]).toHaveLength(MAX_DIARY_ENTRIES_PER_DAY - 1);
  });

  it('adds a recipe entirely or not at all when the day is near capacity', () => {
    const existing = Array.from({ length: MAX_DIARY_ENTRIES_PER_DAY - 1 }, (_, i) =>
      entry(`existing-${i}`, i),
    );
    const ingredientA = food('a', 'Ingrediente A');
    const ingredientB = food('b', 'Ingrediente B');
    const recipe: Recipe = {
      id: 'recipe-1',
      name: 'Ricetta atomica',
      servings: 1,
      ingredients: [
        { id: 'ing-a', foodId: ingredientA.id, foodSnapshot: ingredientA, grams: 100 },
        { id: 'ing-b', foodId: ingredientB.id, foodSnapshot: ingredientB, grams: 50 },
      ],
      createdAt: 1,
      updatedAt: 1,
    };
    setState({ diary: { [DATE]: existing }, recipes: [recipe] });

    addRecipeToDiary('dinner', recipe.id, 1);

    expect(getState().diary[DATE]).toHaveLength(MAX_DIARY_ENTRIES_PER_DAY - 1);
    expect(getState().diary[DATE].some((item) => item.foodId === 'a' || item.foodId === 'b')).toBe(false);
  });
});
