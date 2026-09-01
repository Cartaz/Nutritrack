import { beforeEach, describe, expect, it } from 'vitest';
import { getState, setFoodCustomPortions, setState, updateFoodDetails, updateRecipeDetails } from '../src/lib/store';
import type { FoodItem, Recipe, RecipeIngredient } from '../src/types';

const FOOD: FoodItem = {
  id: 'food-1',
  name: 'Originale',
  brand: 'Marca',
  barcode: '12345678',
  source: 'openfoodfacts',
  servingSize: 100,
  servingLabel: '100 g',
  customPortions: [{ id: 'portion-1', label: '1 fetta', grams: 30 }],
  nutrition: { calories: 200, protein: 10, carbs: 20, fat: 5 },
  image: 'https://images.openfoodfacts.org/original.jpg',
  createdAt: 123,
};

const RECIPE: Recipe = {
  id: 'recipe-1',
  name: 'Ricetta originale',
  description: 'Descrizione',
  servings: 2,
  ingredients: [
    {
      id: 'ingredient-1',
      foodId: FOOD.id,
      foodSnapshot: FOOD,
      grams: 100,
    },
  ],
  image: 'recipe.jpg',
  createdAt: 456,
  updatedAt: 789,
};

beforeEach(() => {
  setState({
    foods: [{ ...FOOD, nutrition: { ...FOOD.nutrition }, customPortions: FOOD.customPortions?.map((p) => ({ ...p })) }],
    recipes: [
      {
        ...RECIPE,
        ingredients: RECIPE.ingredients.map((ingredient) => ({ ...ingredient })),
      },
    ],
  });
});

describe('semantic food mutations', () => {
  it('updates only editable details and preserves store-owned fields', () => {
    const nutrition = { calories: 150, protein: 12, carbs: 15, fat: 4 };

    expect(
      updateFoodDetails(FOOD.id, {
        name: 'Modificato',
        brand: undefined,
        barcode: undefined,
        source: 'custom',
        servingSize: 80,
        servingLabel: '1 porzione',
        nutrition,
      }),
    ).toBe(true);

    const updated = getState().foods[0];
    expect(updated).toMatchObject({
      id: FOOD.id,
      name: 'Modificato',
      source: 'custom',
      servingSize: 80,
      servingLabel: '1 porzione',
      image: FOOD.image,
      createdAt: FOOD.createdAt,
      customPortions: FOOD.customPortions,
    });
    expect(updated.brand).toBeUndefined();
    expect(updated.barcode).toBeUndefined();
    expect(updated.nutrition).toEqual(nutrition);

    nutrition.calories = 999;
    expect(updated.nutrition.calories).toBe(150);
  });

  it('owns and canonicalizes custom portions without retaining caller references', () => {
    const portions = [{ id: 'portion-2', label: '1 tazza', grams: 250 }];

    expect(setFoodCustomPortions(FOOD.id, portions)).toBe(true);
    portions[0].grams = 999;
    portions.push({ id: 'portion-3', label: 'extra', grams: 1 });

    expect(getState().foods[0].customPortions).toEqual([{ id: 'portion-2', label: '1 tazza', grams: 250 }]);
    expect(setFoodCustomPortions(FOOD.id, [])).toBe(true);
    expect(getState().foods[0].customPortions).toBeUndefined();
  });

  it('reports a missing food instead of silently succeeding', () => {
    const before = getState().foods;

    expect(
      updateFoodDetails('missing', {
        name: 'Missing',
        source: 'custom',
        servingSize: 100,
        nutrition: { calories: 0, protein: 0, carbs: 0, fat: 0 },
      }),
    ).toBe(false);
    expect(setFoodCustomPortions('missing', [])).toBe(false);
    expect(getState().foods).toBe(before);
  });
});

describe('semantic recipe mutations', () => {
  it('updates editable details while preserving identity, image and creation time', () => {
    const ingredients: RecipeIngredient[] = [
      {
        id: 'ingredient-2',
        foodId: FOOD.id,
        foodSnapshot: FOOD,
        grams: 75,
      },
    ];

    expect(
      updateRecipeDetails(RECIPE.id, {
        name: 'Ricetta modificata',
        description: undefined,
        servings: 3,
        ingredients,
      }),
    ).toBe(true);

    const updated = getState().recipes[0];
    expect(updated).toMatchObject({
      id: RECIPE.id,
      name: 'Ricetta modificata',
      servings: 3,
      image: RECIPE.image,
      createdAt: RECIPE.createdAt,
    });
    expect(updated.description).toBeUndefined();
    expect(updated.updatedAt).toBeGreaterThan(RECIPE.updatedAt);
    expect(updated.ingredients).toEqual(ingredients);

    ingredients[0].grams = 999;
    ingredients.push({ ...ingredients[0], id: 'ingredient-3' });
    expect(updated.ingredients).toHaveLength(1);
    expect(updated.ingredients[0].grams).toBe(75);
  });

  it('reports a missing recipe without mutating state', () => {
    const before = getState().recipes;

    expect(
      updateRecipeDetails('missing', {
        name: 'Missing',
        servings: 1,
        ingredients: [],
      }),
    ).toBe(false);
    expect(getState().recipes).toBe(before);
  });
});
