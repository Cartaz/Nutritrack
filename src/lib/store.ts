// Store observer minimale con RAF batching.
// Pattern 1 dello standard: singolo oggetto state, Set<Listener>, emitChange su RAF.
// Anti-pattern rispettati: niente Proxy, niente librerie esterne, niente emit sincrono.

import type {
  AppState,
  DayDiary,
  DiaryEntry,
  FoodItem,
  MealType,
  Recipe,
  UserSettings,
  ViewName,
  MacroSplit,
} from '../types';
import { DEFAULT_SETTINGS } from './nutrition';
import { safeId, toDateKey } from './utils';
import { MAX_DIARY_ENTRIES_PER_DAY } from './constants';

const state: AppState = {
  settings: { ...DEFAULT_SETTINGS },
  foods: [],
  diary: {},
  recipes: [],
  favoriteFoodIds: [],
  currentView: 'dashboard',
  currentDate: toDateKey(new Date()),
  _storageDisabled: false,
  _searchOpen: false,
  _searchMeal: 'breakfast',
  _searchDate: toDateKey(new Date()),
  _editingFoodId: null,
  _editingRecipeId: null,
  _viewingRecipeId: null,
  _confirmDeleteFoodId: null,
  _confirmDeleteRecipeId: null,
  _confirmReset: false,
  _addRecipeToMealPickerId: null,
  _editingEntryId: null,
};

const listeners = new Set<() => void>();

export function getState(): AppState {
  return state;
}

/** Alias per chiarezza semantica nei moduli UI (renderer, views) */
export const getStoreState = getState;

/** Patch shallow dello state. NON emette direttamente (chiama emitChange). */
export function setState(patch: Partial<AppState>): void {
  Object.assign(state, patch);
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

let _rafScheduled = false;

/** Emissione batched su RAF (dedupe tramite flag) */
export function emitChange(): void {
  if (_rafScheduled) return;
  _rafScheduled = true;
  requestAnimationFrame(() => {
    _rafScheduled = false;
    listeners.forEach((l) => {
      try {
        l();
      } catch (e) {
        console.error('[store] listener error', e);
      }
    });
  });
}

// ============ View navigation ============

export function switchView(view: ViewName): void {
  state.currentView = view;
  emitChange();
}

// ============ Date navigation (dashboard) ============

export function setCurrentDate(date: string): void {
  state.currentDate = date;
  emitChange();
}

// ============ Settings ============

export function updateSettings(patch: Partial<UserSettings>): void {
  state.settings = { ...state.settings, ...patch };
  emitChange();
}

export function setCalorieGoal(kcal: number): void {
  state.settings = { ...state.settings, calorieGoal: kcal };
  emitChange();
}

export function setMacroSplit(split: MacroSplit): void {
  state.settings = { ...state.settings, macroSplit: split };
  emitChange();
}

// ============ Foods ============

export function addFood(input: Omit<FoodItem, 'id' | 'createdAt'> & { id?: string }): FoodItem {
  const food: FoodItem = {
    ...input,
    id: input.id || safeId('food_'),
    createdAt: Date.now(),
  };
  state.foods = [food, ...state.foods];
  emitChange();
  return food;
}

export function updateFood(id: string, patch: Partial<FoodItem>): void {
  state.foods = state.foods.map((f) => (f.id === id ? { ...f, ...patch } : f));
  emitChange();
}

export function deleteFood(id: string): void {
  state.foods = state.foods.filter((f) => f.id !== id);
  state.favoriteFoodIds = state.favoriteFoodIds.filter((fid) => fid !== id);
  emitChange();
}

export function getFood(id: string): FoodItem | undefined {
  return state.foods.find((f) => f.id === id);
}

export function toggleFavorite(id: string): void {
  state.favoriteFoodIds = state.favoriteFoodIds.includes(id)
    ? state.favoriteFoodIds.filter((fid) => fid !== id)
    : [...state.favoriteFoodIds, id];
  emitChange();
}

/** Alias per chiarezza semantica nelle azioni dominio */
export const toggleFoodFavorite = toggleFavorite;

// ============ Diary ============

export function addDiaryEntry(input: Omit<DiaryEntry, 'id' | 'createdAt'>): DiaryEntry | null {
  const todayList = state.diary[input.date] || [];
  if (todayList.length >= MAX_DIARY_ENTRIES_PER_DAY) {
    console.warn('[store] diario pieno per la data', input.date);
    return null;
  }
  const entry: DiaryEntry = {
    ...input,
    id: safeId('entry_'),
    createdAt: Date.now(),
  };
  state.diary = {
    ...state.diary,
    [entry.date]: [...todayList, entry],
  };
  emitChange();
  return entry;
}

export function updateDiaryEntry(id: string, patch: Partial<DiaryEntry>): void {
  const newDiary: DayDiary = {};
  for (const [date, entries] of Object.entries(state.diary)) {
    newDiary[date] = entries.map((e) => (e.id === id ? { ...e, ...patch } : e));
  }
  state.diary = newDiary;
  emitChange();
}

export function deleteDiaryEntry(id: string): void {
  const newDiary: DayDiary = {};
  for (const [date, entries] of Object.entries(state.diary)) {
    newDiary[date] = entries.filter((e) => e.id !== id);
  }
  state.diary = newDiary;
  emitChange();
}

export function getDiaryForDate(date: string): DiaryEntry[] {
  return state.diary[date] || [];
}

// ============ Recipes ============

export function addRecipe(input: Omit<Recipe, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Recipe {
  const now = Date.now();
  const recipe: Recipe = {
    ...input,
    id: input.id || safeId('recipe_'),
    createdAt: now,
    updatedAt: now,
  };
  state.recipes = [recipe, ...state.recipes];
  emitChange();
  return recipe;
}

export function updateRecipe(id: string, patch: Partial<Recipe>): void {
  state.recipes = state.recipes.map((r) =>
    r.id === id ? { ...r, ...patch, updatedAt: Date.now() } : r
  );
  emitChange();
}

export function deleteRecipe(id: string): void {
  state.recipes = state.recipes.filter((r) => r.id !== id);
  emitChange();
}

export function getRecipe(id: string): Recipe | undefined {
  return state.recipes.find((r) => r.id === id);
}

// ============ Search dialog (modal state) ============

export function openFoodSearch(meal: MealType, date: string): void {
  state._searchMeal = meal;
  state._searchDate = date;
  state._searchOpen = true;
  emitChange();
}

export function closeFoodSearch(): void {
  state._searchOpen = false;
  emitChange();
}

// ============ Food editor dialog ============

export function openFoodEditor(foodId: string | null): void {
  state._editingFoodId = foodId;
  emitChange();
}

export function closeFoodEditor(): void {
  state._editingFoodId = null;
  emitChange();
}

// ============ Recipe editor / viewer / delete ============

export function openRecipeEditor(recipeId: string | null): void {
  state._editingRecipeId = recipeId;
  emitChange();
}

export function closeRecipeEditor(): void {
  state._editingRecipeId = null;
  emitChange();
}

export function openRecipeViewer(recipeId: string): void {
  state._viewingRecipeId = recipeId;
  emitChange();
}

export function closeRecipeViewer(): void {
  state._viewingRecipeId = null;
  emitChange();
}

export function openRecipeMealPicker(recipeId: string): void {
  state._addRecipeToMealPickerId = recipeId;
  emitChange();
}

export function closeRecipeMealPicker(): void {
  state._addRecipeToMealPickerId = null;
  emitChange();
}

export function openConfirmDeleteFood(foodId: string): void {
  state._confirmDeleteFoodId = foodId;
  emitChange();
}

export function closeConfirmDeleteFood(): void {
  state._confirmDeleteFoodId = null;
  emitChange();
}

export function openConfirmDeleteRecipe(recipeId: string): void {
  state._confirmDeleteRecipeId = recipeId;
  emitChange();
}

export function closeConfirmDeleteRecipe(): void {
  state._confirmDeleteRecipeId = null;
  emitChange();
}

export function openConfirmReset(): void {
  state._confirmReset = true;
  emitChange();
}

export function closeConfirmReset(): void {
  state._confirmReset = false;
  emitChange();
}

// ============ Entry editor dialog (modifica quantità di una entry del diario) ============

export function openEntryEditor(entryId: string): void {
  state._editingEntryId = entryId;
  emitChange();
}

export function closeEntryEditor(): void {
  state._editingEntryId = null;
  emitChange();
}

// ============ Bulk operations ============

export function resetAll(): void {
  state.settings = { ...DEFAULT_SETTINGS };
  state.foods = [];
  state.diary = {};
  state.recipes = [];
  state.favoriteFoodIds = [];
  emitChange();
}

export function setStorageDisabled(disabled: boolean): void {
  state._storageDisabled = disabled;
  emitChange();
}
