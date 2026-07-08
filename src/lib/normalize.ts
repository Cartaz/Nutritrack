// Normalizzazione rigorosa di ogni input esterno (localStorage, API, import JSON).
// Pattern 6 dello standard: validate tipo, range, lunghezza, ricostruisci oggetto tipato.

import type {
  ActivityLevel,
  DiaryEntry,
  DayDiary,
  FoodItem,
  FoodSource,
  MacroSplit,
  MealType,
  NutritionPer100,
  OffNutriments,
  OffProduct,
  Recipe,
  RecipeIngredient,
  Sex,
  Theme,
  UserSettings,
  WeightGoalType,
} from '../types';
import {
  ALLOWED_ACTIVITY,
  ALLOWED_FOOD_SOURCES,
  ALLOWED_SEX,
  ALLOWED_THEMES,
  ALLOWED_WEIGHT_GOALS,
  MEAL_ORDER,
} from '../types';
import { safeId, safeImageUrl, safeNum, isValidDateKey } from './utils';
import { STORAGE_WARN_BYTES, SCHEMA_VERSION } from './constants';
import { DEFAULT_SETTINGS, normalizeMacroSplit as normalizeMacroSplitRescale } from './nutrition';

const ALLOWED_MEALS: readonly MealType[] = MEAL_ORDER;

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ============ Primitives ============

export function normalizeString(v: unknown, maxLen = 500): string {
  if (!isString(v)) return '';
  const trimmed = v.trim();
  if (trimmed.length > maxLen) {
    // Fix: evita di spezzare surrogate pair UTF-16 (emoji) troncando a maxLen-1 se l'ultimo char è high surrogate
    const sliced = trimmed.slice(0, maxLen);
    const lastCode = sliced.charCodeAt(sliced.length - 1);
    if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
      return sliced.slice(0, sliced.length - 1);
    }
    return sliced;
  }
  return trimmed;
}

export function normalizeOptionalString(v: unknown, maxLen = 500): string | undefined {
  const s = normalizeString(v, maxLen);
  return s || undefined;
}

export function normalizeNonNegNum(v: unknown, max = 1_000_000): number {
  const n = safeNum(v, 0, 0, max);
  return n;
}

export function normalizeMeal(v: unknown): MealType | null {
  if (isString(v) && (ALLOWED_MEALS as readonly string[]).includes(v)) {
    return v as MealType;
  }
  return null;
}

export function normalizeFoodSource(v: unknown): FoodSource {
  if (isString(v) && (ALLOWED_FOOD_SOURCES as readonly string[]).includes(v)) {
    return v as FoodSource;
  }
  return 'custom';
}

export function normalizeTheme(v: unknown): Theme {
  if (isString(v) && (ALLOWED_THEMES as readonly string[]).includes(v)) {
    return v as Theme;
  }
  return 'system';
}

export function normalizeSex(v: unknown): Sex | undefined {
  if (isString(v) && (ALLOWED_SEX as readonly string[]).includes(v)) {
    return v as Sex;
  }
  return undefined;
}

export function normalizeActivity(v: unknown): ActivityLevel | undefined {
  if (isString(v) && (ALLOWED_ACTIVITY as readonly string[]).includes(v)) {
    return v as ActivityLevel;
  }
  return undefined;
}

/** Normalizza il tipo di obiettivo peso. Default 'maintain' per backward compat. */
export function normalizeWeightGoal(v: unknown): WeightGoalType {
  if (isString(v) && (ALLOWED_WEIGHT_GOALS as readonly string[]).includes(v)) {
    return v as WeightGoalType;
  }
  return 'maintain';
}

/** Normalizza macro split DA INPUT ESTERNO (localStorage, import JSON).
 *  Fix Bug #1 (T1): delega a nutrition.normalizeMacroSplit per garantire sum=100 SEMPRE.
 *  Prima questa versione faceva solo clamp [0,100] senza rescale → target macro sbagliati dopo import. */
export function normalizeMacroSplit(v: unknown): MacroSplit {
  if (!isObject(v)) return normalizeMacroSplitRescale({ proteinPct: 30, carbsPct: 40, fatPct: 30 });
  const proteinPct = safeNum(v.proteinPct, 30, 0, 100);
  const carbsPct = safeNum(v.carbsPct, 40, 0, 100);
  const fatPct = safeNum(v.fatPct, 30, 0, 100);
  return normalizeMacroSplitRescale({ proteinPct, carbsPct, fatPct });
}

export function normalizeNutrition(v: unknown): NutritionPer100 | null {
  if (!isObject(v)) return null;
  const calories = safeNum(v.calories, 0, 0, 100_000);
  const protein = safeNum(v.protein, 0, 0, 1_000);
  const carbs = safeNum(v.carbs, 0, 0, 1_000);
  const fat = safeNum(v.fat, 0, 0, 1_000);
  if (calories === 0 && protein === 0 && carbs === 0 && fat === 0) return null;
  const fiber = v.fiber == null ? undefined : safeNum(v.fiber, 0, 0, 1_000);
  const sugar = v.sugar == null ? undefined : safeNum(v.sugar, 0, 0, 1_000);
  const salt = v.salt == null ? undefined : safeNum(v.salt, 0, 0, 1_000);
  return { calories, protein, carbs, fat, fiber, sugar, salt };
}

export function normalizeFoodItem(v: unknown): FoodItem | null {
  if (!isObject(v)) return null;
  const name = normalizeString(v.name, 300);
  if (!name) return null;
  const nutrition = normalizeNutrition(v.nutrition);
  if (!nutrition) return null;
  const servingSize = safeNum(v.servingSize, 100, 0, 100_000);
  // Normalizza customPortions (array di { id, label, grams })
  let customPortions: FoodItem['customPortions'];
  if (Array.isArray(v.customPortions)) {
    const seen = new Set<string>();
    const list: NonNullable<FoodItem['customPortions']>[number][] = [];
    for (const raw of v.customPortions) {
      if (!isObject(raw)) continue;
      const label = normalizeString(raw.label, 100);
      if (!label) continue;
      const grams = safeNum(raw.grams, 0, 0.1, 100_000);
      if (grams <= 0) continue;
      const id = isString(raw.id) && raw.id ? raw.id : safeId('port_');
      if (seen.has(id)) continue;
      seen.add(id);
      list.push({ id, label, grams });
    }
    if (list.length > 0) customPortions = list;
  }
  const item: FoodItem = {
    id: isString(v.id) && v.id ? v.id : safeId('food_'),
    name,
    brand: normalizeOptionalString(v.brand, 200),
    barcode: normalizeOptionalString(v.barcode, 50),
    source: normalizeFoodSource(v.source),
    servingSize: servingSize > 0 ? servingSize : 100,
    servingLabel: normalizeOptionalString(v.servingLabel, 100),
    customPortions,
    nutrition,
    image: safeImageUrl(v.image),
    createdAt: safeNum(v.createdAt, Date.now(), 0),
  };
  return item;
}

export function normalizeDiaryEntry(v: unknown, knownFoods: FoodItem[]): DiaryEntry | null {
  if (!isObject(v)) return null;
  const date = normalizeString(v.date, 10);
  // Fix B9: usa isValidDateKey (round-trip check) invece di sola regex
  if (!isValidDateKey(date)) return null;
  const meal = normalizeMeal(v.meal);
  if (!meal) return null;
  const foodSnapshot = normalizeFoodItem(v.foodSnapshot);
  if (!foodSnapshot) return null;
  const quantity = safeNum(v.quantity, 1, 0, 1000);
  const gramsOverride = v.gramsOverride == null ? undefined : safeNum(v.gramsOverride, 0, 0, 100_000);
  // Fix Bug #8 (T1): preferisci match per barcode (più univoco) prima di name+brand
  let foodId: string | undefined;
  if (isString(v.foodId) && v.foodId) {
    foodId = v.foodId;
  } else if (foodSnapshot.barcode) {
    foodId = knownFoods.find((f) => f.barcode === foodSnapshot.barcode)?.id;
  }
  if (!foodId) {
    foodId = knownFoods.find((f) => f.name === foodSnapshot.name && f.brand === foodSnapshot.brand)?.id;
  }
  const entry: DiaryEntry = {
    id: isString(v.id) && v.id ? v.id : safeId('entry_'),
    date,
    meal,
    foodId,
    foodSnapshot,
    quantity,
    gramsOverride,
    createdAt: safeNum(v.createdAt, Date.now(), 0),
  };
  return entry;
}

export function normalizeDayDiary(v: unknown, knownFoods: FoodItem[]): DayDiary {
  if (!isObject(v)) return {};
  const out: DayDiary = {};
  for (const [k, val] of Object.entries(v)) {
    // Fix B9: usa isValidDateKey (round-trip check) invece di sola regex
    if (!isValidDateKey(k)) continue;
    if (!Array.isArray(val)) continue;
    const entries: DiaryEntry[] = [];
    for (const raw of val) {
      const e = normalizeDiaryEntry(raw, knownFoods);
      if (e) entries.push(e);
    }
    if (entries.length > 0) out[k] = entries;
  }
  return out;
}

export function normalizeRecipeIngredient(v: unknown): RecipeIngredient | null {
  if (!isObject(v)) return null;
  const foodSnapshot = normalizeFoodItem(v.foodSnapshot);
  if (!foodSnapshot) return null;
  const grams = safeNum(v.grams, 0, 0, 100_000);
  if (grams <= 0) return null;
  return {
    id: isString(v.id) && v.id ? v.id : safeId('ing_'),
    foodId: isString(v.foodId) && v.foodId ? v.foodId : undefined,
    foodSnapshot,
    grams,
  };
}

export function normalizeRecipe(v: unknown): Recipe | null {
  if (!isObject(v)) return null;
  const name = normalizeString(v.name, 300);
  if (!name) return null;
  const rawIngs = Array.isArray(v.ingredients) ? v.ingredients : [];
  const ingredients: RecipeIngredient[] = [];
  for (const raw of rawIngs) {
    const ing = normalizeRecipeIngredient(raw);
    if (ing) ingredients.push(ing);
  }
  if (ingredients.length === 0) return null;
  // Fix R8 (T4): allineato max a 200 (coerente con HTML max e normalizeRecipe)
  const servings = safeNum(v.servings, 1, 1, 200);
  return {
    id: isString(v.id) && v.id ? v.id : safeId('recipe_'),
    name,
    description: normalizeOptionalString(v.description, 2000),
    servings,
    ingredients,
    image: safeImageUrl(v.image),
    createdAt: safeNum(v.createdAt, Date.now(), 0),
    updatedAt: safeNum(v.updatedAt, Date.now(), 0),
  };
}

export function normalizeUserSettings(v: unknown): UserSettings {
  if (!isObject(v)) return { ...DEFAULT_SETTINGS };
  const calorieGoal = safeNum(v.calorieGoal, DEFAULT_SETTINGS.calorieGoal, 500, 10_000);
  const macroSplit = normalizeMacroSplit(v.macroSplit);
  const theme = normalizeTheme(v.theme);
  const weightGoalType = normalizeWeightGoal(v.weightGoalType);
  return {
    calorieGoal,
    macroSplit,
    theme,
    name: normalizeOptionalString(v.name, 100),
    weightKg: v.weightKg == null ? undefined : safeNum(v.weightKg, 0, 0, 500),
    heightCm: v.heightCm == null ? undefined : safeNum(v.heightCm, 0, 0, 300),
    ageYears: v.ageYears == null ? undefined : safeNum(v.ageYears, 0, 0, 150),
    sex: normalizeSex(v.sex),
    activityLevel: normalizeActivity(v.activityLevel),
    weightGoalType,
    // targetWeightKg: clamp [30..500] — valori realistici per adulto.
    // undefined se maintain o se mancante.
    targetWeightKg: weightGoalType === 'maintain' || v.targetWeightKg == null
      ? undefined
      : safeNum(v.targetWeightKg, 0, 30, 500),
    // goalWeeks: clamp [1..156] (3 anni max) — oltre non ha senso pratico.
    goalWeeks: weightGoalType === 'maintain' || v.goalWeeks == null
      ? undefined
      : safeNum(v.goalWeeks, 0, 1, 156),
  };
}

// ============ Bulk normalization for state hydration ============

export interface NormalizedPayload {
  settings: UserSettings;
  foods: FoodItem[];
  diary: DayDiary;
  recipes: Recipe[];
  favoriteFoodIds: string[];
}

export function reconcileAll(raw: unknown): NormalizedPayload {
  // Fix Bug 7.13 (T7): warning se versione schema non supportata (migration placeholder)
  if (isObject(raw) && typeof raw.version === 'number' && raw.version !== SCHEMA_VERSION) {
    console.warn(`[normalize] schema version mismatch: payload=${raw.version}, expected=${SCHEMA_VERSION}. Migrating...`);
    // Qui in futuro si aggiungerà migrate(raw) per versioni > 1
  }
  if (!isObject(raw)) {
    return {
      settings: { ...DEFAULT_SETTINGS },
      foods: [],
      diary: {},
      recipes: [],
      favoriteFoodIds: [],
    };
  }
  const foods: FoodItem[] = Array.isArray(raw.foods)
    ? raw.foods.map(normalizeFoodItem).filter((f): f is FoodItem => f !== null)
    : [];
  const foodIds = new Set(foods.map((f) => f.id));
  const diary = normalizeDayDiary(raw.diary, foods);
  const recipes: Recipe[] = Array.isArray(raw.recipes)
    ? raw.recipes.map(normalizeRecipe).filter((r): r is Recipe => r !== null)
    : [];
  const favoriteFoodIds: string[] = Array.isArray(raw.favoriteFoodIds)
    ? raw.favoriteFoodIds.filter((id): id is string => isString(id) && foodIds.has(id))
    : [];
  const settings = normalizeUserSettings(raw.settings);
  return { settings, foods, diary, recipes, favoriteFoodIds };
}

// ============ Open Food Facts -> FoodItem ============

function kJtoKcal(kj?: number): number | undefined {
  if (kj == null || !Number.isFinite(kj)) return undefined;
  return Math.round(kj / 4.184);
}

function pickName(p: OffProduct): string {
  return p.product_name_it || p.product_name || p.generic_name || 'Prodotto senza nome';
}

/** Converte un prodotto OFF grezzo in FoodItem normalizzato.
 *  Ritorna null se il prodotto non ha nome o nutrizione utile.
 *  Fix B-8-11 (T8): se kcal=0 ma almeno un macro > 0, stima kcal da macro (4/4/9). */
export function buildFoodFromOff(p: OffProduct): FoodItem | null {
  if (!p || typeof p !== 'object') return null;
  const n: OffNutriments = p.nutriments || {};
  let calories = n['energy-kcal_100g'] ?? kJtoKcal(n.energy_100g) ?? 0;
  // Fix B18: costruisci nutrition raw e passalo per normalizeNutrition per clampare negativi/NaN
  let rawNutrition = {
    calories,
    protein: n.proteins_100g,
    carbs: n.carbohydrates_100g,
    fat: n.fat_100g,
    fiber: n.fiber_100g,
    sugar: n.sugars_100g,
    salt: n.salt_100g,
  };
  // Fix B-8-11: se calories=0 ma almeno un macro > 0, stima kcal da macro (algoritmo Atwater)
  if (rawNutrition.calories === 0) {
    const macroKcal = (Number(rawNutrition.protein) || 0) * 4 + (Number(rawNutrition.carbs) || 0) * 4 + (Number(rawNutrition.fat) || 0) * 9;
    if (macroKcal > 0) {
      calories = Math.round(macroKcal);
      rawNutrition = { ...rawNutrition, calories };
    }
  }
  const nutrition = normalizeNutrition(rawNutrition);
  if (!nutrition) return null;
  // Fix Bug #11 (T1): rimuovere il re-check ridondante (normalizeNutrition ritorna già null se tutto 0)
  const name = normalizeString(pickName(p), 300);
  // Fix BUG #11 (T5): pickName ritorna sentinel 'Prodotto senza nome' se non c'è nome; qui scartiamo.
  if (!name || name === 'Prodotto senza nome') return null;
  const servingQuantity = safeNum(p.serving_quantity, 0, 0, 100_000);
  const brands = typeof p.brands === 'string' ? p.brands : '';
  return {
    id: safeId('off_'),
    name,
    brand: normalizeOptionalString(brands.split(',')[0]?.trim(), 200),
    barcode: normalizeOptionalString(p.code, 50),
    source: 'openfoodfacts',
    servingSize: servingQuantity > 0 ? Math.round(servingQuantity) : 100,
    servingLabel: normalizeOptionalString(p.serving_size, 100),
    nutrition,
    image: safeImageUrl(p.image_front_small_url || p.image_url),
    createdAt: Date.now(),
  };
}

// ============ Quota & size helpers ============

/** Stima byte reali del payload per confronto con quota localStorage.
 *  Fix Bug #5 (T1) / Bug 7.3 (T7): ritorna byte UTF-8 (non code unit UTF-16).
 *  localStorage conta byte UTF-16 nella maggior parte dei browser, ma UTF-8 è un'approssimazione
 *  conservativa (sotto-stima per ASCII puro, sovrastima per CJK). Usiamo UTF-16 reale (length*2)
 *  per allinearci al modello di quota Safari/Chrome. */
export function estimateStorageBytes(payload: unknown): number {
  try {
    const str = JSON.stringify(payload);
    // UTF-16: ogni code unit è 2 byte. Caratteri astrali (emoji complesse) usano 2 code unit = 4 byte, già contati.
    return str.length * 2;
  } catch {
    return 0;
  }
}

export function isStorageWarn(bytes: number): boolean {
  return bytes > STORAGE_WARN_BYTES;
}
