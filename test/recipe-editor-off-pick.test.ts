import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoodItem } from '../src/types';

const OFF_FOOD: FoodItem = {
  id: 'off_transient',
  name: 'Ceci lessati',
  brand: 'Marca',
  barcode: '8001234567895',
  source: 'openfoodfacts',
  servingSize: 100,
  nutrition: { calories: 120, protein: 7, carbs: 16, fat: 2 },
  createdAt: 1,
};

vi.mock('../src/lib/food-search', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/food-search')>();
  return {
    ...actual,
    searchFoods: vi.fn(async () => ({ foods: [{ ...OFF_FOOD }], totalCount: 1, continuation: null })),
  };
});

import { renderRecipeEditorModal } from '../src/views/recipe-editor';
import { getState, setState } from '../src/lib/store';

function click(selector: string): void {
  const el = document.querySelector<HTMLElement>(selector);
  expect(el, selector).not.toBeNull();
  el!.click();
}

function input(selector: string, value: string): void {
  const el = document.querySelector<HTMLInputElement>(selector);
  expect(el, selector).not.toBeNull();
  el!.value = value;
  el!.dispatchEvent(new Event('input', { bubbles: true }));
}

async function pickOffResult(): Promise<void> {
  click('[data-re-action="open-search"]');
  click('[data-re-action="search-tab"][data-tab="search"]');
  input('#re-search-input', 'ceci');
  const search = document.querySelector<HTMLElement>('[data-re-action="run-search"]');
  if (search) search.click();
  await vi.waitFor(() => expect(document.querySelector('[data-re-action="search-pick"]')).not.toBeNull(), {
    timeout: 3000,
  });
  click('[data-re-action="search-pick"]');
}

beforeEach(() => {
  document.body.innerHTML = '';
  setState({ foods: [], diary: {}, recipes: [], favoriteFoodIds: [], biometrics: {}, dialog: null });
  setState({ dialog: { type: 'recipe-editor', recipeId: 'new' } });
  renderRecipeEditorModal('new');
});

afterEach(() => {
  document.body.innerHTML = '';
  setState({ dialog: null });
});

describe('recipe editor: OFF ingredients', () => {
  it('a sub-search closed and reopened during the close animation keeps working', async () => {
    click('[data-re-action="open-search"]');
    document.querySelector<HTMLElement>('[data-modal-id="recipe-search-sub"] [data-modal-action="close"]')!.click();
    await pickOffResult();
    expect(document.querySelector('[data-modal-id="recipe-editor"] [data-re-action="ing-remove"]')).not.toBeNull();
  });

  it('does not add a picked OFF product to the library until the recipe is saved', async () => {
    await pickOffResult();
    expect(getState().foods).toEqual([]);
  });

  it('saves the picked OFF product, deduplicated, when the recipe is saved', async () => {
    await pickOffResult();
    input('#re-name', 'Hummus');
    click('[data-modal-id="recipe-editor"] [data-modal-action="confirm"]');

    const foods = getState().foods;
    expect(foods).toHaveLength(1);
    expect(foods[0].barcode).toBe(OFF_FOOD.barcode);
    const recipe = getState().recipes[0];
    expect(recipe.ingredients[0].foodId).toBe(foods[0].id);
  });
});
