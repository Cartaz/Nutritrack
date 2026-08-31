import { beforeEach, describe, expect, it } from 'vitest';
import {
  closeFoodEditor,
  closeFoodSearch,
  closeResetConfirm,
  getActiveDialog,
  isAnyDialogOpen,
  openFoodEditor,
  openFoodSearch,
  openRecipeEditor,
  openResetConfirm,
  resetAll,
  setState,
  switchView,
} from '../src/lib/store';

beforeEach(() => {
  setState({ dialog: null, currentView: 'dashboard' });
});

describe('application dialog state', () => {
  it('has one root dialog at a time', () => {
    openFoodSearch('lunch', '2026-08-31');
    openResetConfirm();

    expect(getActiveDialog()).toEqual({ type: 'confirm-reset' });
    expect(isAnyDialogOpen()).toBe(true);
  });

  it('nests food editor only under food search', () => {
    openFoodSearch('dinner', '2026-08-31');
    openFoodEditor('new');

    expect(getActiveDialog()).toEqual({
      type: 'food-search',
      meal: 'dinner',
      date: '2026-08-31',
      child: { type: 'food-editor', foodId: 'new' },
    });

    closeFoodEditor();
    expect(getActiveDialog()).toEqual({ type: 'food-search', meal: 'dinner', date: '2026-08-31' });
  });

  it('nests food editor under recipe editor and preserves the parent on close', () => {
    openRecipeEditor('recipe-1');
    openFoodEditor('new');

    expect(getActiveDialog()).toEqual({
      type: 'recipe-editor',
      recipeId: 'recipe-1',
      child: { type: 'food-editor', foodId: 'new' },
    });

    closeFoodEditor();
    expect(getActiveDialog()).toEqual({ type: 'recipe-editor', recipeId: 'recipe-1' });
  });

  it('opens food editor standalone outside the two supported parents', () => {
    openFoodEditor('food-1');
    expect(getActiveDialog()).toEqual({ type: 'food-editor', foodId: 'food-1' });

    closeFoodEditor();
    expect(getActiveDialog()).toBeNull();
  });

  it('ignores a stale close from a dialog that is no longer active', () => {
    openFoodSearch('breakfast', '2026-08-31');
    openResetConfirm();

    closeFoodSearch();
    expect(getActiveDialog()).toEqual({ type: 'confirm-reset' });

    closeResetConfirm();
    expect(getActiveDialog()).toBeNull();
  });

  it('clears the dialog on view switch and reset', () => {
    openResetConfirm();
    switchView('foods');
    expect(getActiveDialog()).toBeNull();

    openResetConfirm();
    resetAll();
    expect(getActiveDialog()).toBeNull();
  });
});
