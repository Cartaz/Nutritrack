import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderFoodEditorModal } from '../src/views/food-editor';
import { renderRecipeEditorModal } from '../src/views/recipe-editor';
import { renderEntryEditorModal } from '../src/views/entry-editor';
import { getState, setState } from '../src/lib/store';
import type { DiaryEntry, FoodItem, Recipe } from '../src/types';

const FOOD: FoodItem = {
  id: 'food-1',
  name: 'Original food',
  brand: 'Brand',
  source: 'custom',
  servingSize: 100,
  nutrition: {
    calories: 200,
    protein: 10,
    carbs: 20,
    fat: 8,
  },
  createdAt: 1,
};

const ENTRY: DiaryEntry = {
  id: 'entry-1',
  date: '2026-08-31',
  meal: 'breakfast',
  foodId: FOOD.id,
  foodSnapshot: FOOD,
  quantity: 1,
  gramsOverride: 100,
  createdAt: 2,
};

const RECIPE: Recipe = {
  id: 'recipe-1',
  name: 'Original recipe',
  servings: 1,
  ingredients: [
    {
      id: 'ingredient-1',
      foodId: FOOD.id,
      foodSnapshot: FOOD,
      grams: 100,
    },
  ],
  createdAt: 3,
  updatedAt: 3,
};

function input(id: string, value: string): void {
  const el = document.querySelector<HTMLInputElement>(id);
  expect(el).not.toBeNull();
  el!.value = value;
  el!.dispatchEvent(new Event('input', { bubbles: true }));
}

function confirmModal(modalId: string): void {
  const button = document.querySelector<HTMLButtonElement>(
    `[data-modal-id="${modalId}"] [data-modal-action="confirm"]`,
  );
  expect(button).not.toBeNull();
  button!.click();
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.body.classList.remove('modal-open');
  setState({
    foods: [{ ...FOOD, nutrition: { ...FOOD.nutrition } }],
    diary: { '2026-08-31': [{ ...ENTRY, foodSnapshot: { ...FOOD, nutrition: { ...FOOD.nutrition } } }] },
    recipes: [
      {
        ...RECIPE,
        ingredients: RECIPE.ingredients.map((ing) => ({
          ...ing,
          foodSnapshot: { ...FOOD, nutrition: { ...FOOD.nutrition } },
        })),
      },
    ],
    favoriteFoodIds: [],
    biometrics: {},
    dialog: null,
  });
});

afterEach(() => {
  document.body.innerHTML = '';
  document.body.classList.remove('modal-open');
  setState({ dialog: null });
});

describe('food editor optimistic concurrency', () => {
  it('does not overwrite editable food fields changed remotely after the draft opened', () => {
    setState({ dialog: { type: 'food-editor', foodId: FOOD.id } });
    renderFoodEditorModal(FOOD.id);
    input('#fe-name', 'Local draft');

    setState({
      foods: [{ ...getState().foods[0], name: 'Remote edit' }],
    });

    confirmModal('food-editor');

    expect(getState().foods[0].name).toBe('Remote edit');
    expect(document.querySelector('[data-modal-id="food-editor"]')).not.toBeNull();
  });

  it('allows unrelated remote food fields and preserves them when saving the draft', () => {
    setState({ dialog: { type: 'food-editor', foodId: FOOD.id } });
    renderFoodEditorModal(FOOD.id);
    input('#fe-name', 'Local draft');

    setState({
      foods: [
        {
          ...getState().foods[0],
          image: 'https://example.test/remote.jpg',
          customPortions: [{ id: 'portion-1', label: 'Remote portion', grams: 42 }],
        },
      ],
    });

    confirmModal('food-editor');

    expect(getState().foods[0].name).toBe('Local draft');
    expect(getState().foods[0].image).toBe('https://example.test/remote.jpg');
    expect(getState().foods[0].customPortions).toEqual([{ id: 'portion-1', label: 'Remote portion', grams: 42 }]);
  });
});

describe('recipe editor optimistic concurrency', () => {
  it('does not overwrite recipe content changed remotely after the draft opened', () => {
    setState({ dialog: { type: 'recipe-editor', recipeId: RECIPE.id } });
    renderRecipeEditorModal(RECIPE.id);
    input('#re-name', 'Local recipe');

    setState({
      recipes: [{ ...getState().recipes[0], name: 'Remote recipe', updatedAt: 10 }],
    });

    confirmModal('recipe-editor');

    expect(getState().recipes[0].name).toBe('Remote recipe');
    expect(document.querySelector('[data-modal-id="recipe-editor"]')).not.toBeNull();
  });

  it('ignores remote metadata the editor does not overwrite', () => {
    setState({ dialog: { type: 'recipe-editor', recipeId: RECIPE.id } });
    renderRecipeEditorModal(RECIPE.id);
    input('#re-name', 'Local recipe');

    setState({
      recipes: [
        {
          ...getState().recipes[0],
          image: 'https://example.test/remote-recipe.jpg',
          updatedAt: 11,
        },
      ],
    });

    confirmModal('recipe-editor');

    expect(getState().recipes[0].name).toBe('Local recipe');
    expect(getState().recipes[0].image).toBe('https://example.test/remote-recipe.jpg');
  });
});

describe('entry editor optimistic concurrency', () => {
  it('does not overwrite an amount changed remotely after the draft opened', () => {
    setState({ dialog: { type: 'entry-editor', entryId: ENTRY.id } });
    renderEntryEditorModal(ENTRY.id);
    input('#ee-grams-input', '150');

    const current = getState().diary['2026-08-31'][0];
    setState({
      diary: {
        '2026-08-31': [{ ...current, quantity: 1, gramsOverride: 120 }],
      },
    });

    confirmModal('entry-editor');

    expect(getState().diary['2026-08-31'][0].gramsOverride).toBe(120);
    expect(document.querySelector('[data-modal-id="entry-editor"]')).not.toBeNull();
  });

  it('allows remote snapshot changes that do not alter the edited amount', () => {
    setState({ dialog: { type: 'entry-editor', entryId: ENTRY.id } });
    renderEntryEditorModal(ENTRY.id);
    input('#ee-grams-input', '150');

    const current = getState().diary['2026-08-31'][0];
    setState({
      diary: {
        '2026-08-31': [
          {
            ...current,
            foodSnapshot: {
              ...current.foodSnapshot,
              image: 'https://example.test/remote-entry-food.jpg',
            },
          },
        ],
      },
    });

    confirmModal('entry-editor');

    const saved = getState().diary['2026-08-31'][0];
    expect(saved.gramsOverride).toBe(150);
    expect(saved.foodSnapshot.image).toBe('https://example.test/remote-entry-food.jpg');
  });
});
