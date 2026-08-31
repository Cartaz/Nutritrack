import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiaryEntry, FoodItem, Recipe } from '../src/types';
import { BACKUP_KEY, MAX_DIARY_ENTRIES_PER_DAY, STORAGE_KEY } from '../src/lib/constants';
import {
  deleteDiaryEntry,
  getState,
  resetAll,
  setBiometric,
  setState,
  switchView,
  toggleFavorite,
  updateDiaryEntry,
} from '../src/lib/store';
import { addFoodToDiary, addRecipeToDiary, changeEntryQuantity } from '../src/lib/diary';
import { addCustomPortionToFood, saveOffFood } from '../src/lib/foods';

vi.mock('../src/components/toast', () => ({ showToast: vi.fn() }));

function makeFood(id = 'food-1', source: FoodItem['source'] = 'custom'): FoodItem {
  return {
    id,
    name: 'Test food',
    brand: 'Brand',
    barcode: source === 'openfoodfacts' ? '8001234567890' : undefined,
    source,
    servingSize: 100,
    nutrition: { calories: 200, protein: 10, carbs: 20, fat: 8 },
    createdAt: 1,
  };
}

function makeEntry(id: string, date: string, food = makeFood()): DiaryEntry {
  return {
    id,
    date,
    meal: 'lunch',
    foodId: food.id,
    foodSnapshot: food,
    quantity: 1,
    createdAt: 1,
  };
}

function resetState(): void {
  localStorage.clear();
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
    currentDate: '2026-08-31',
    _storageDisabled: false,
    _searchOpen: false,
    _searchMeal: 'breakfast',
    _searchDate: '2026-08-31',
    _editingFoodId: null,
    _editingRecipeId: null,
    _viewingRecipeId: null,
    _confirmDeleteFoodId: null,
    _confirmDeleteRecipeId: null,
    _confirmReset: false,
    _addRecipeToMealPickerId: null,
    _editingEntryId: null,
  });
}

beforeEach(resetState);

describe('store invariants', () => {
  it('switchView chiude tutti gli stati modal prima di cambiare vista', () => {
    setState({
      _searchOpen: true,
      _editingFoodId: 'new',
      _editingRecipeId: 'new',
      _viewingRecipeId: 'r1',
      _confirmDeleteFoodId: 'f1',
      _confirmDeleteRecipeId: 'r1',
      _confirmReset: true,
      _addRecipeToMealPickerId: 'r1',
      _editingEntryId: 'e1',
    });

    switchView('settings');
    const state = getState();

    expect(state.currentView).toBe('settings');
    expect(state._searchOpen).toBe(false);
    expect(state._editingFoodId).toBeNull();
    expect(state._editingRecipeId).toBeNull();
    expect(state._viewingRecipeId).toBeNull();
    expect(state._confirmDeleteFoodId).toBeNull();
    expect(state._confirmDeleteRecipeId).toBeNull();
    expect(state._confirmReset).toBe(false);
    expect(state._addRecipeToMealPickerId).toBeNull();
    expect(state._editingEntryId).toBeNull();
  });

  it('toggleFavorite non crea riferimenti orfani', () => {
    setState({ favoriteFoodIds: ['missing'] });
    toggleFavorite('missing');
    expect(getState().favoriteFoodIds).toEqual([]);
  });

  it('sposta una entry alla nuova data mantenendo il contratto della entry', () => {
    const entry = makeEntry('e1', '2026-08-30');
    setState({ diary: { '2026-08-30': [entry] } });

    updateDiaryEntry('e1', { date: '2026-08-31', quantity: 2 });

    expect(getState().diary['2026-08-31']).toHaveLength(1);
    expect(getState().diary['2026-08-31'][0]).toMatchObject({ id: 'e1', date: '2026-08-31', quantity: 2 });
  });

  it('non sposta una entry in un giorno pieno ma applica gli altri campi', () => {
    const source = makeEntry('moving', '2026-08-30');
    const fullDestination = Array.from({ length: MAX_DIARY_ENTRIES_PER_DAY }, (_, index) =>
      makeEntry(`dest-${index}`, '2026-08-31'),
    );
    setState({
      diary: {
        '2026-08-30': [source],
        '2026-08-31': fullDestination,
      },
    });

    updateDiaryEntry('moving', { date: '2026-08-31', quantity: 3 });

    expect(getState().diary['2026-08-31']).toHaveLength(MAX_DIARY_ENTRIES_PER_DAY);
    expect(getState().diary['2026-08-30'][0]).toMatchObject({ date: '2026-08-30', quantity: 3 });
  });

  it('deleteDiaryEntry elimina anche la chiave giorno quando resta vuota', () => {
    setState({ diary: { '2026-08-31': [makeEntry('e1', '2026-08-31')] } });
    deleteDiaryEntry('e1');
    expect(getState().diary).toEqual({});
  });

  it('setBiometric rimuove una entry biometrica diventata completamente vuota', () => {
    setState({ biometrics: { '2026-08-31': { waterMl: 1000 } } });
    setBiometric('2026-08-31', { waterMl: undefined });
    expect(getState().biometrics).toEqual({});
  });

  it('resetAll elimina sia payload primario sia backup', () => {
    localStorage.setItem(STORAGE_KEY, '{"secret":1}');
    localStorage.setItem(BACKUP_KEY, '{"secret":2}');
    resetAll();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(BACKUP_KEY)).toBeNull();
  });
});

describe('domain flows', () => {
  it('rifiuta una data invalida prima di aggiungere al diario', () => {
    addFoodToDiary({ date: '2026-02-30', meal: 'lunch', food: makeFood(), quantity: 1 });
    expect(getState().diary).toEqual({});
  });

  it('deduplica gli alimenti Open Food Facts per barcode', () => {
    const first = makeFood('off-1', 'openfoodfacts');
    const second = { ...makeFood('off-2', 'openfoodfacts'), name: 'Nome aggiornato' };

    const savedFirst = saveOffFood(first);
    const savedSecond = saveOffFood(second);

    expect(savedSecond.id).toBe(savedFirst.id);
    expect(getState().foods).toHaveLength(1);
  });

  it('aggiungendo due volte lo stesso prodotto OFF usa un solo food salvato', () => {
    const first = makeFood('off-1', 'openfoodfacts');
    const second = makeFood('off-2', 'openfoodfacts');

    addFoodToDiary({ date: '2026-08-31', meal: 'lunch', food: first, quantity: 1 });
    addFoodToDiary({ date: '2026-08-31', meal: 'dinner', food: second, quantity: 1 });

    expect(getState().foods).toHaveLength(1);
    expect(getState().diary['2026-08-31']).toHaveLength(2);
    expect(getState().diary['2026-08-31'][0].foodId).toBe(getState().diary['2026-08-31'][1].foodId);
  });

  it('aggiunge una ricetta alla data selezionata e scala i grammi per porzione', () => {
    const food = makeFood();
    const recipe: Recipe = {
      id: 'recipe-1',
      name: 'Ricetta',
      servings: 2,
      ingredients: [{ id: 'ing-1', foodId: food.id, foodSnapshot: food, grams: 120 }],
      createdAt: 1,
      updatedAt: 1,
    };
    setState({ currentDate: '2026-08-20', recipes: [recipe] });

    addRecipeToDiary('dinner', recipe.id, 1);

    const entries = getState().diary['2026-08-20'];
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ date: '2026-08-20', meal: 'dinner', gramsOverride: 60 });
  });

  it('rifiuta un numero di porzioni ricetta non valido senza modificare il diario', () => {
    const food = makeFood();
    const recipe: Recipe = {
      id: 'recipe-1',
      name: 'Ricetta',
      servings: 2,
      ingredients: [{ id: 'ing-1', foodId: food.id, foodSnapshot: food, grams: 120 }],
      createdAt: 1,
      updatedAt: 1,
    };
    setState({ recipes: [recipe] });

    addRecipeToDiary('dinner', recipe.id, Number.NaN);
    expect(getState().diary).toEqual({});
  });

  it('preserva la modalità grammi quando cambia la quantità di una entry', () => {
    const entry = { ...makeEntry('e1', '2026-08-31'), quantity: 2, gramsOverride: 100 };
    setState({ diary: { '2026-08-31': [entry] } });

    changeEntryQuantity('e1', 1, 2, 100);

    expect(getState().diary['2026-08-31'][0]).toMatchObject({ quantity: 3, gramsOverride: 150 });
  });

  it('rifiuta porzioni custom con grammi non positivi o label duplicata', () => {
    const food = { ...makeFood(), customPortions: [{ id: 'p1', label: '1 fetta', grams: 30 }] };
    setState({ foods: [food] });

    expect(addCustomPortionToFood(food.id, 'Nuova', 0)).toBeNull();
    expect(addCustomPortionToFood(food.id, '1 FETTA', 40)).toBeNull();
    expect(getState().foods[0].customPortions).toHaveLength(1);
  });
});
