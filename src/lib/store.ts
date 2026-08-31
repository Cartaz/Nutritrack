// Store observer minimale con RAF batching.
// Lo store possiede le invarianti in-memory; storage può sostituire solo PersistedState.

import type {
  AppState,
  BiometricEntry,
  Biometrics,
  DayDiary,
  DiaryEntry,
  FoodItem,
  MacroSplit,
  MealType,
  PersistedState,
  Recipe,
  UserSettings,
  ViewName,
} from '../types';
import { DEFAULT_SETTINGS } from './nutrition';
import { isValidDateKey, safeId, toDateKey } from './utils';
import { MAX_DIARY_ENTRIES_PER_DAY } from './constants';
import { clearAllLocalUserData } from './localData';

function createDefaultPersistedState(): PersistedState {
  return {
    settings: { ...DEFAULT_SETTINGS, macroSplit: { ...DEFAULT_SETTINGS.macroSplit } },
    foods: [],
    diary: {},
    recipes: [],
    favoriteFoodIds: [],
    biometrics: {},
  };
}

const initialPersisted = createDefaultPersistedState();
const state: AppState = {
  ...initialPersisted,
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

/** Alias per chiarezza semantica nei moduli UI (renderer, views). */
export const getStoreState = getState;

/**
 * Vista esplicita dei soli dati persistenti. Storage/import/export non devono
 * dipendere dai dettagli di UiState.
 */
export function getPersistedState(): PersistedState {
  return {
    settings: state.settings,
    foods: state.foods,
    diary: state.diary,
    recipes: state.recipes,
    favoriteFoodIds: state.favoriteFoodIds,
    biometrics: state.biometrics,
  };
}

/**
 * Sostituisce in un'unica operazione l'intero dominio persistente.
 * Non emette: il chiamante decide quando notificare (load, import, multi-tab).
 */
export function replacePersistedState(next: PersistedState): void {
  state.settings = next.settings;
  state.foods = next.foods;
  state.diary = next.diary;
  state.recipes = next.recipes;
  state.favoriteFoodIds = next.favoriteFoodIds;
  state.biometrics = next.biometrics;
}

/**
 * Patch generica mantenuta per test e compatibilità legacy. Il codice di
 * produzione deve preferire operazioni semantiche o replacePersistedState().
 */
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

/** Emissione batched su RAF (dedupe tramite flag). */
export function emitChange(): void {
  if (_rafScheduled) return;
  _rafScheduled = true;
  requestAnimationFrame(() => {
    _rafScheduled = false;
    listeners.forEach((listener) => {
      try {
        listener();
      } catch (e) {
        console.error('[store] listener error', e);
      }
    });
  });
}

// ============ View navigation ============

export function switchView(view: ViewName): void {
  state._searchOpen = false;
  state._editingFoodId = null;
  state._editingRecipeId = null;
  state._viewingRecipeId = null;
  state._confirmDeleteFoodId = null;
  state._confirmDeleteRecipeId = null;
  state._confirmReset = false;
  state._addRecipeToMealPickerId = null;
  state._editingEntryId = null;
  state.currentView = view;
  emitChange();
}

// ============ Date navigation (dashboard) ============

export function setCurrentDate(date: string): void {
  if (!isValidDateKey(date)) {
    console.warn('[store] data dashboard non valida ignorata', date);
    return;
  }
  state.currentDate = date;
  emitChange();
}

// ============ Settings ============

export function updateSettings(patch: Partial<UserSettings>): void {
  state.settings = { ...state.settings, ...patch };
  emitChange();
}

export function setCalorieGoal(kcal: number): void {
  if (!Number.isFinite(kcal) || kcal < 500 || kcal > 10_000) return;
  state.settings = { ...state.settings, calorieGoal: kcal };
  emitChange();
}

export function setMacroSplit(split: MacroSplit): void {
  state.settings = { ...state.settings, macroSplit: split };
  emitChange();
}

// ============ Foods ============

export function addFood(input: Omit<FoodItem, 'id' | 'createdAt'> & { id?: string }): FoodItem {
  let id = input.id || safeId('food_');
  while (state.foods.some((food) => food.id === id)) id = safeId('food_');
  const food: FoodItem = {
    ...input,
    id,
    createdAt: Date.now(),
  };
  state.foods = [food, ...state.foods];
  emitChange();
  return food;
}

export function updateFood(id: string, patch: Partial<FoodItem>): void {
  const { id: _ignoredId, createdAt: _ignoredCreatedAt, ...safePatch } = patch;
  void _ignoredId;
  void _ignoredCreatedAt;
  state.foods = state.foods.map((food) => (food.id === id ? { ...food, ...safePatch } : food));
  emitChange();
}

export function deleteFood(id: string): void {
  state.foods = state.foods.filter((food) => food.id !== id);
  state.favoriteFoodIds = state.favoriteFoodIds.filter((foodId) => foodId !== id);
  emitChange();
}

export function getFood(id: string): FoodItem | undefined {
  return state.foods.find((food) => food.id === id);
}

export function toggleFavorite(id: string): void {
  if (!state.foods.some((food) => food.id === id)) {
    state.favoriteFoodIds = state.favoriteFoodIds.filter((foodId) => foodId !== id);
    emitChange();
    return;
  }
  state.favoriteFoodIds = state.favoriteFoodIds.includes(id)
    ? state.favoriteFoodIds.filter((foodId) => foodId !== id)
    : [...state.favoriteFoodIds, id];
  emitChange();
}

// ============ Diary ============

export type DiaryEntryInput = Omit<DiaryEntry, 'id' | 'createdAt'>;

function isValidDiaryInput(input: DiaryEntryInput): boolean {
  if (!isValidDateKey(input.date)) return false;
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) return false;
  if (input.gramsOverride != null && (!Number.isFinite(input.gramsOverride) || input.gramsOverride <= 0)) return false;
  return true;
}

/**
 * Inserimento batch atomico. Se una qualsiasi data supererebbe il limite o un
 * input è invalido, non viene scritto nulla.
 */
export function addDiaryEntries(inputs: DiaryEntryInput[]): DiaryEntry[] | null {
  if (inputs.length === 0) return [];
  if (!inputs.every(isValidDiaryInput)) {
    console.warn('[store] batch diario invalido');
    return null;
  }

  const additionsByDate = new Map<string, number>();
  for (const input of inputs) {
    additionsByDate.set(input.date, (additionsByDate.get(input.date) ?? 0) + 1);
  }
  for (const [date, additions] of additionsByDate) {
    if ((state.diary[date]?.length ?? 0) + additions > MAX_DIARY_ENTRIES_PER_DAY) {
      console.warn('[store] diario pieno per la data', date);
      return null;
    }
  }

  const now = Date.now();
  const usedIds = new Set(Object.values(state.diary).flatMap((entries) => entries.map((entry) => entry.id)));
  const created = inputs.map((input, index) => {
    let id = safeId('entry_');
    while (usedIds.has(id)) id = safeId('entry_');
    usedIds.add(id);
    return { ...input, id, createdAt: now + index } satisfies DiaryEntry;
  });

  const nextDiary: DayDiary = { ...state.diary };
  for (const entry of created) {
    nextDiary[entry.date] = [...(nextDiary[entry.date] ?? []), entry];
  }
  state.diary = nextDiary;
  emitChange();
  return created;
}

export function addDiaryEntry(input: DiaryEntryInput): DiaryEntry | null {
  const created = addDiaryEntries([input]);
  return created?.[0] ?? null;
}

export function updateDiaryEntry(id: string, patch: Partial<DiaryEntry>): void {
  const { id: _ignoredId, createdAt: _ignoredCreatedAt, ...safePatch } = patch;
  void _ignoredId;
  void _ignoredCreatedAt;

  const currentDate = getCurrentEntryDate(id);
  if (!currentDate) return;

  let effectivePatch = safePatch;
  if (safePatch.date && safePatch.date !== currentDate) {
    if (!isValidDateKey(safePatch.date)) return;
    const destCount = state.diary[safePatch.date]?.length ?? 0;
    if (destCount >= MAX_DIARY_ENTRIES_PER_DAY) {
      console.warn('[store] diario destinazione pieno per la data', safePatch.date, '— move skipped');
      const { date: _omitted, ...restPatch } = safePatch;
      void _omitted;
      effectivePatch = restPatch;
    }
  }

  const newDiary: DayDiary = {};
  let movedEntry: DiaryEntry | null = null;
  let movedToDate: string | null = null;
  for (const [date, entries] of Object.entries(state.diary)) {
    const filtered: DiaryEntry[] = [];
    for (const entry of entries) {
      if (entry.id !== id) {
        filtered.push(entry);
        continue;
      }
      const updated = { ...entry, ...effectivePatch };
      if (effectivePatch.date && effectivePatch.date !== date) {
        movedEntry = updated;
        movedToDate = effectivePatch.date;
      } else {
        filtered.push(updated);
      }
    }
    if (filtered.length > 0) newDiary[date] = filtered;
  }
  if (movedEntry && movedToDate) {
    newDiary[movedToDate] = [...(newDiary[movedToDate] ?? []), movedEntry];
  }
  state.diary = newDiary;
  emitChange();
}

function getCurrentEntryDate(id: string): string | undefined {
  for (const [date, entries] of Object.entries(state.diary)) {
    if (entries.some((entry) => entry.id === id)) return date;
  }
  return undefined;
}

export function deleteDiaryEntry(id: string): void {
  const newDiary: DayDiary = {};
  for (const [date, entries] of Object.entries(state.diary)) {
    const filtered = entries.filter((entry) => entry.id !== id);
    if (filtered.length > 0) newDiary[date] = filtered;
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
  let id = input.id || safeId('recipe_');
  while (state.recipes.some((recipe) => recipe.id === id)) id = safeId('recipe_');
  const recipe: Recipe = {
    ...input,
    id,
    createdAt: now,
    updatedAt: now,
  };
  state.recipes = [recipe, ...state.recipes];
  emitChange();
  return recipe;
}

export function updateRecipe(id: string, patch: Partial<Recipe>): void {
  const { id: _ignoredId, createdAt: _ignoredCreatedAt, updatedAt: _ignoredUpdatedAt, ...safePatch } = patch;
  void _ignoredId;
  void _ignoredCreatedAt;
  void _ignoredUpdatedAt;
  state.recipes = state.recipes.map((recipe) =>
    recipe.id === id ? { ...recipe, ...safePatch, updatedAt: Date.now() } : recipe,
  );
  emitChange();
}

export function deleteRecipe(id: string): void {
  state.recipes = state.recipes.filter((recipe) => recipe.id !== id);
  emitChange();
}

export function getRecipe(id: string): Recipe | undefined {
  return state.recipes.find((recipe) => recipe.id === id);
}

// ============ Biometrics ============

export function getBiometric(date: string): BiometricEntry {
  return state.biometrics[date] ?? {};
}

export function setBiometric(date: string, patch: Partial<BiometricEntry>): void {
  if (!isValidDateKey(date)) return;
  const current = state.biometrics[date] ?? {};
  const merged: BiometricEntry = { ...current };
  if ('waterMl' in patch) {
    if (patch.waterMl === undefined) delete merged.waterMl;
    else merged.waterMl = patch.waterMl;
  }
  if ('sleepHours' in patch) {
    if (patch.sleepHours === undefined) delete merged.sleepHours;
    else merged.sleepHours = patch.sleepHours;
  }
  if ('weightKg' in patch) {
    if (patch.weightKg === undefined) delete merged.weightKg;
    else merged.weightKg = patch.weightKg;
  }
  const next: Biometrics = { ...state.biometrics };
  if (merged.waterMl === undefined && merged.sleepHours === undefined && merged.weightKg === undefined) {
    delete next[date];
  } else {
    next[date] = merged;
  }
  state.biometrics = next;
  emitChange();
}

export function setAllBiometrics(biometrics: Biometrics): void {
  state.biometrics = biometrics;
  emitChange();
}

// ============ Search dialog ============

export function openFoodSearch(meal: MealType, date: string): void {
  if (!isValidDateKey(date)) return;
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

export function openAddRecipeToMeal(recipeId: string): void {
  state._addRecipeToMealPickerId = recipeId;
  emitChange();
}

export function closeAddRecipeToMeal(): void {
  state._addRecipeToMealPickerId = null;
  emitChange();
}

export function openDeleteFoodConfirm(foodId: string): void {
  state._confirmDeleteFoodId = foodId;
  emitChange();
}

export function closeDeleteFoodConfirm(): void {
  state._confirmDeleteFoodId = null;
  emitChange();
}

export function openDeleteRecipeConfirm(recipeId: string): void {
  state._confirmDeleteRecipeId = recipeId;
  emitChange();
}

export function closeDeleteRecipeConfirm(): void {
  state._confirmDeleteRecipeId = null;
  emitChange();
}

export function openResetConfirm(): void {
  state._confirmReset = true;
  emitChange();
}

export function closeResetConfirm(): void {
  state._confirmReset = false;
  emitChange();
}

// ============ Entry editor dialog ============

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
  replacePersistedState(createDefaultPersistedState());
  state._storageDisabled = false;
  state._searchOpen = false;
  state._editingFoodId = null;
  state._editingRecipeId = null;
  state._viewingRecipeId = null;
  state._confirmDeleteFoodId = null;
  state._confirmDeleteRecipeId = null;
  state._confirmReset = false;
  state._addRecipeToMealPickerId = null;
  state._editingEntryId = null;
  clearAllLocalUserData();
  emitChange();
}

export function setStorageDisabled(disabled: boolean): void {
  state._storageDisabled = disabled;
  emitChange();
}
