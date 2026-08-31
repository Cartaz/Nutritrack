// Store observer minimale con RAF batching.
// Pattern 1 dello standard: singolo oggetto state, Set<Listener>, emitChange su RAF.
// Anti-pattern rispettati: niente Proxy, niente librerie esterne, niente emit sincrono.

import type {
  AppDialog,
  AppState,
  DayDiary,
  DiaryEntry,
  FoodItem,
  MealType,
  Recipe,
  UserSettings,
  ViewName,
  MacroSplit,
  Biometrics,
  BiometricEntry,
} from '../types';
import { DEFAULT_SETTINGS } from './nutrition';
import { safeId, toDateKey } from './utils';
import { MAX_DIARY_ENTRIES_PER_DAY } from './constants';

const state: AppState = {
  // Fix Bug #15 (T1): deep-copy macroSplit per evitare condivisione reference con DEFAULT_SETTINGS
  settings: { ...DEFAULT_SETTINGS, macroSplit: { ...DEFAULT_SETTINGS.macroSplit } },
  foods: [],
  diary: {},
  recipes: [],
  favoriteFoodIds: [],
  biometrics: {},
  currentView: 'dashboard',
  currentDate: toDateKey(new Date()),
  _storageDisabled: false,
  dialog: null,
};

const listeners = new Set<() => void>();

export function getState(): AppState {
  return state;
}

/** Alias per chiarezza semantica nei moduli UI (renderer, views) */
export const getStoreState = getState;

/**
 * Patch shallow riservata a hydration/persistence e test.
 * Il normale codice applicativo deve usare operazioni semantiche che possiedono gli invarianti del relativo dominio.
 */
export function setState(patch: Partial<AppState>): void {
  Object.assign(state, patch);
}

export function getActiveDialog(): AppDialog | null {
  return state.dialog;
}

/** Unico check globale per i consumer che devono sapere se esiste un workflow modale attivo. */
export function isAnyDialogOpen(): boolean {
  return state.dialog !== null;
}

export function isFoodSearchOpen(): boolean {
  return state.dialog?.type === 'food-search';
}

export function isRecipeEditorOpen(): boolean {
  return state.dialog?.type === 'recipe-editor';
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
  // Un cambio vista termina il workflow modale globale corrente. Eventuali sub-dialog
  // appartengono al modulo del parent e vengono ripuliti dal renderer/UI owner.
  state.dialog = null;
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

export type FoodDetailsUpdate = Pick<
  FoodItem,
  'name' | 'brand' | 'barcode' | 'source' | 'servingSize' | 'servingLabel' | 'nutrition'
>;

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

/**
 * Sostituisce i soli dettagli editabili di un alimento.
 * Identità, timestamp, immagine e porzioni custom restano proprietà dello store/degli owner dedicati.
 */
export function updateFoodDetails(id: string, details: FoodDetailsUpdate): boolean {
  const existing = state.foods.find((food) => food.id === id);
  if (!existing) return false;

  state.foods = state.foods.map((food) =>
    food.id === id
      ? {
          ...food,
          name: details.name,
          brand: details.brand,
          barcode: details.barcode,
          source: details.source,
          servingSize: details.servingSize,
          servingLabel: details.servingLabel,
          nutrition: { ...details.nutrition },
        }
      : food,
  );
  emitChange();
  return true;
}

/** Unico owner della rappresentazione delle porzioni custom di un alimento salvato. */
export function setFoodCustomPortions(id: string, portions: FoodItem['customPortions']): boolean {
  const existing = state.foods.find((food) => food.id === id);
  if (!existing) return false;

  const canonicalPortions = portions && portions.length > 0 ? portions.map((portion) => ({ ...portion })) : undefined;
  state.foods = state.foods.map((food) => (food.id === id ? { ...food, customPortions: canonicalPortions } : food));
  emitChange();
  return true;
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
  // Fix BUG #18 (T5): pulisci id stale che non corrispondono a nessun food salvato
  // (previene accumulo di id orfani da OFF food non salvati favoritati per errore)
  if (!state.foods.some((f) => f.id === id)) {
    // Food non esiste: rimuovi da preferiti se presente, non aggiungere
    state.favoriteFoodIds = state.favoriteFoodIds.filter((fid) => fid !== id);
    emitChange();
    return;
  }
  state.favoriteFoodIds = state.favoriteFoodIds.includes(id)
    ? state.favoriteFoodIds.filter((fid) => fid !== id)
    : [...state.favoriteFoodIds, id];
  emitChange();
}

// ============ Diary ============

export type DiaryEntryInput = Omit<DiaryEntry, 'id' | 'createdAt'>;
export type AddDiaryEntriesResult =
  { ok: true; entries: DiaryEntry[] } | { ok: false; reason: 'day_full'; date: string };

/**
 * Inserisce una o più entry come singola transazione di store.
 * La capacità di tutte le date coinvolte viene verificata prima di generare id o mutare lo state.
 */
export function addDiaryEntries(inputs: DiaryEntryInput[]): AddDiaryEntriesResult {
  if (inputs.length === 0) return { ok: true, entries: [] };

  const incomingPerDate = new Map<string, number>();
  for (const input of inputs) {
    incomingPerDate.set(input.date, (incomingPerDate.get(input.date) ?? 0) + 1);
  }
  for (const [date, incoming] of incomingPerDate) {
    const current = state.diary[date]?.length ?? 0;
    if (current + incoming > MAX_DIARY_ENTRIES_PER_DAY) {
      return { ok: false, reason: 'day_full', date };
    }
  }

  const now = Date.now();
  const entries = inputs.map((input) => ({
    ...input,
    id: safeId('entry_'),
    createdAt: now,
  }));
  const next: DayDiary = { ...state.diary };
  for (const entry of entries) {
    next[entry.date] = [...(next[entry.date] ?? []), entry];
  }
  state.diary = next;
  emitChange();
  return { ok: true, entries };
}

export function addDiaryEntry(input: DiaryEntryInput): DiaryEntry | null {
  const result = addDiaryEntries([input]);
  return result.ok ? result.entries[0] : null;
}

function replaceDiaryEntry(id: string, replace: (entry: DiaryEntry) => DiaryEntry): boolean {
  let found = false;
  const next: DayDiary = {};
  for (const [date, entries] of Object.entries(state.diary)) {
    next[date] = entries.map((entry) => {
      if (entry.id !== id) return entry;
      found = true;
      return replace(entry);
    });
  }
  if (!found) return false;
  state.diary = next;
  emitChange();
  return true;
}

/** Aggiorna soltanto il modo in cui una entry rappresenta la quantità consumata. */
export function setDiaryEntryAmount(id: string, quantity: number, gramsOverride?: number): boolean {
  if (!Number.isFinite(quantity) || quantity <= 0) return false;
  if (gramsOverride != null && (!Number.isFinite(gramsOverride) || gramsOverride <= 0)) return false;
  return replaceDiaryEntry(id, (entry) => ({ ...entry, quantity, gramsOverride }));
}

/** Aggiorna lo snapshot storico del food senza esporre un patch generico della DiaryEntry. */
export function setDiaryEntryFoodSnapshot(id: string, foodSnapshot: FoodItem): boolean {
  return replaceDiaryEntry(id, (entry) => ({ ...entry, foodSnapshot }));
}

export function deleteDiaryEntry(id: string): void {
  const newDiary: DayDiary = {};
  for (const [date, entries] of Object.entries(state.diary)) {
    const filtered = entries.filter((e) => e.id !== id);
    // Fix LOW bug: rimuovi le chiavi date con array vuoto, altrimenti rimangono in memoria
    // come `diary[date] = []`. normalizeDayDiary le pulirebbe su rehydrate, ma in-memory
    // potrebbero causare over-count in futuri consumer che iterano Object.keys.
    if (filtered.length > 0) {
      newDiary[date] = filtered;
    }
  }
  state.diary = newDiary;
  emitChange();
}

export function getDiaryForDate(date: string): DiaryEntry[] {
  return state.diary[date] || [];
}

// ============ Recipes ============

export type RecipeDetailsUpdate = Pick<Recipe, 'name' | 'description' | 'servings' | 'ingredients'>;

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

/**
 * Sostituisce i soli dettagli editabili di una ricetta e possiede l'aggiornamento di updatedAt.
 * Identità, createdAt e immagine non sono modificabili attraverso questo contratto.
 */
export function updateRecipeDetails(id: string, details: RecipeDetailsUpdate): boolean {
  const existing = state.recipes.find((recipe) => recipe.id === id);
  if (!existing) return false;

  state.recipes = state.recipes.map((recipe) =>
    recipe.id === id
      ? {
          ...recipe,
          name: details.name,
          description: details.description,
          servings: details.servings,
          ingredients: details.ingredients.map((ingredient) => ({ ...ingredient })),
          updatedAt: Date.now(),
        }
      : recipe,
  );
  emitChange();
  return true;
}

export function deleteRecipe(id: string): void {
  state.recipes = state.recipes.filter((r) => r.id !== id);
  emitChange();
}

export function getRecipe(id: string): Recipe | undefined {
  return state.recipes.find((r) => r.id === id);
}

// ============ Biometrics (acqua / sonno / peso) — P1 #3 Step 02 ============

/** Restituisce la biometrica di una data (oggetto vuoto se non registrata). */
export function getBiometric(date: string): BiometricEntry {
  return state.biometrics[date] ?? {};
}

/** Patch parziale della biometrica di una data.
 *  Solo i campi ESPPLICITAMENTE presenti nel patch vengono toccati (usa `in`).
 *  Passa `undefined` come valore di un campo presente nel patch per cancellarlo.
 *  I campi assenti dal patch restano invariati (merge semantica corretta).
 *  Se dopo il merge la entry risulta vuota, la chiave viene rimossa per non
 *  lasciare rumore nel payload (coerenza con deleteDiaryEntry). */
export function setBiometric(date: string, patch: Partial<BiometricEntry>): void {
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

/** Sostituisce l'intera mappa biometrics (usato da loadData/reconcile/import). */
export function setAllBiometrics(b: Biometrics): void {
  state.biometrics = b;
  emitChange();
}

// ============ Dialog state ============

function closeRootDialog(type: AppDialog['type']): void {
  if (state.dialog?.type !== type) return;
  state.dialog = null;
  emitChange();
}

export function openFoodSearch(meal: MealType, date: string): void {
  state.dialog = { type: 'food-search', meal, date };
  emitChange();
}

export function closeFoodSearch(): void {
  closeRootDialog('food-search');
}

/**
 * Apre l'editor alimento. Da ricerca alimenti o editor ricetta diventa l'unico
 * child dialog supportato; altrove è un dialog standalone.
 */
export function openFoodEditor(foodId: string): void {
  const child = { type: 'food-editor', foodId } as const;
  if (state.dialog?.type === 'food-search') {
    state.dialog = { ...state.dialog, child };
  } else if (state.dialog?.type === 'recipe-editor') {
    state.dialog = { ...state.dialog, child };
  } else {
    state.dialog = child;
  }
  emitChange();
}

export function closeFoodEditor(): void {
  const dialog = state.dialog;
  if (!dialog) return;
  if (dialog.type === 'food-editor') {
    state.dialog = null;
  } else if (dialog.type === 'food-search' && dialog.child) {
    state.dialog = { type: 'food-search', meal: dialog.meal, date: dialog.date };
  } else if (dialog.type === 'recipe-editor' && dialog.child) {
    state.dialog = { type: 'recipe-editor', recipeId: dialog.recipeId };
  } else {
    return;
  }
  emitChange();
}

export function openRecipeEditor(recipeId: string): void {
  state.dialog = { type: 'recipe-editor', recipeId };
  emitChange();
}

export function closeRecipeEditor(): void {
  closeRootDialog('recipe-editor');
}

export function openRecipeViewer(recipeId: string): void {
  state.dialog = { type: 'recipe-viewer', recipeId };
  emitChange();
}

export function closeRecipeViewer(): void {
  closeRootDialog('recipe-viewer');
}

export function openAddRecipeToMeal(recipeId: string): void {
  state.dialog = { type: 'recipe-meal-picker', recipeId };
  emitChange();
}

export function closeAddRecipeToMeal(): void {
  closeRootDialog('recipe-meal-picker');
}

export function openDeleteFoodConfirm(foodId: string): void {
  state.dialog = { type: 'confirm-delete-food', foodId };
  emitChange();
}

export function closeDeleteFoodConfirm(): void {
  closeRootDialog('confirm-delete-food');
}

export function openDeleteRecipeConfirm(recipeId: string): void {
  state.dialog = { type: 'confirm-delete-recipe', recipeId };
  emitChange();
}

export function closeDeleteRecipeConfirm(): void {
  closeRootDialog('confirm-delete-recipe');
}

export function openResetConfirm(): void {
  state.dialog = { type: 'confirm-reset' };
  emitChange();
}

export function closeResetConfirm(): void {
  closeRootDialog('confirm-reset');
}

export function openEntryEditor(entryId: string): void {
  state.dialog = { type: 'entry-editor', entryId };
  emitChange();
}

export function closeEntryEditor(): void {
  closeRootDialog('entry-editor');
}

// ============ Bulk operations ============

/** Reset esclusivamente in-memory. La persistenza del reset appartiene a storage.ts. */
export function resetAll(): void {
  state.settings = { ...DEFAULT_SETTINGS, macroSplit: { ...DEFAULT_SETTINGS.macroSplit } };
  state.foods = [];
  state.diary = {};
  state.recipes = [];
  state.favoriteFoodIds = [];
  state.biometrics = {};
  state.dialog = null;
  emitChange();
}

export function setStorageDisabled(disabled: boolean): void {
  state._storageDisabled = disabled;
  emitChange();
}
