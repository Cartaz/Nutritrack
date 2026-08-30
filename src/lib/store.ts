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
  Biometrics,
  BiometricEntry,
} from '../types';
import { DEFAULT_SETTINGS } from './nutrition';
import { safeId, toDateKey } from './utils';
import { MAX_DIARY_ENTRIES_PER_DAY, STORAGE_KEY, BACKUP_KEY } from './constants';

/**
 * Fix HIGH bug (privacy): cancella sia STORAGE_KEY che BACKUP_KEY da localStorage.
 * Implementato qui in store.ts (invece di importare da storage.ts) per evitare
 * circular import: storage.ts importa già da store.ts (getState, setState, ecc.).
 *
 * Prima resetAll() sovrascriveva solo STORAGE_KEY con payload vuoto, ma BACKUP_KEY
 * conservava il payload precedente e loadData() poteva resuscitarlo come fallback.
 */
function clearAllStoredDataLocal(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(BACKUP_KEY);
  } catch {
    /* ignore */
  }
}

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
  // Fix MEDIUM bug: chiudi tutti i modal UI aperti quando si cambia vista.
  // Prima switchView lasciava aperti modal come search-dialog/food-editor/recipe-editor,
  // che rimanevano floating sopra la nuova vista creando confusione UX.
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
  | { ok: true; entries: DiaryEntry[] }
  | { ok: false; reason: 'day_full'; date: string };

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
  state.recipes = state.recipes.map((r) => (r.id === id ? { ...r, ...patch, updatedAt: Date.now() } : r));
  emitChange();
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
  // Fix Bug #7 (T1): resetta anche i flag UI/modal per evitare modal aperti su UI vuota
  // Fix Bug #15 (T1): deep-copy macroSplit per evitare condivisione reference
  // Fix HIGH bug (privacy): cancella anche BACKUP_KEY da localStorage, non solo lo state in-memory.
  //   Prima saveData() sovrascriveva STORAGE_KEY con payload vuoto, ma BACKUP_KEY conservava
  //   il payload precedente e loadData() poteva resuscitarlo come fallback.
  state.settings = { ...DEFAULT_SETTINGS, macroSplit: { ...DEFAULT_SETTINGS.macroSplit } };
  state.foods = [];
  state.diary = {};
  state.recipes = [];
  state.favoriteFoodIds = [];
  state.biometrics = {};
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
  // Fix HIGH bug: pulisci entrambe le chiavi localStorage per evitare resurrezione dati
  try {
    clearAllStoredDataLocal();
  } catch (e) {
    console.warn('[store] clearAllStoredDataLocal fallito durante resetAll', e);
  }
  emitChange();
}

export function setStorageDisabled(disabled: boolean): void {
  state._storageDisabled = disabled;
  emitChange();
}
