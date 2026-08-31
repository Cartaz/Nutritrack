// Normalizzazione rigorosa di ogni input esterno (localStorage, API, import JSON).
// Le invarianti del modello persistente vengono ricostruite qui, in un solo punto.

import type {
  ActivityLevel,
  BiometricEntry,
  Biometrics,
  DayDiary,
  DiaryEntry,
  FoodItem,
  FoodSource,
  MacroSplit,
  MealType,
  NutritionPer100,
  OffNutriments,
  OffProduct,
  PersistedState,
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
import { isValidDateKey, safeId, safeImageUrl, safeNum } from './utils';
import { SCHEMA_VERSION, STORAGE_WARN_BYTES } from './constants';
import { DEFAULT_SETTINGS, normalizeMacroSplit as normalizeMacroSplitRescale } from './nutrition';

const ALLOWED_MEALS: readonly MealType[] = MEAL_ORDER;

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nextUniqueId(candidate: string | undefined, prefix: string, seen: Set<string>): string {
  let id = candidate || safeId(prefix);
  while (seen.has(id)) id = safeId(prefix);
  seen.add(id);
  return id;
}

// ============ Primitives ============

export function normalizeString(value: unknown, maxLen = 500): string {
  if (!isString(value)) return '';
  const trimmed = value.trim();
  let sliced = trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
  if (sliced.length > 0) {
    const lastCode = sliced.charCodeAt(sliced.length - 1);
    if (lastCode >= 0xd800 && lastCode <= 0xdbff) sliced = sliced.slice(0, -1);
  }
  // eslint-disable-next-line no-control-regex
  return sliced.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

export function normalizeOptionalString(value: unknown, maxLen = 500): string | undefined {
  const normalized = normalizeString(value, maxLen);
  return normalized || undefined;
}

export function normalizeNonNegNum(value: unknown, max = 1_000_000): number {
  return safeNum(value, 0, 0, max);
}

export function normalizeMeal(value: unknown): MealType | null {
  if (isString(value) && (ALLOWED_MEALS as readonly string[]).includes(value)) return value as MealType;
  return null;
}

export function normalizeFoodSource(value: unknown): FoodSource {
  if (isString(value) && (ALLOWED_FOOD_SOURCES as readonly string[]).includes(value)) return value as FoodSource;
  return 'custom';
}

export function normalizeTheme(value: unknown): Theme {
  if (isString(value) && (ALLOWED_THEMES as readonly string[]).includes(value)) return value as Theme;
  return 'system';
}

export function normalizeSex(value: unknown): Sex | undefined {
  if (isString(value) && (ALLOWED_SEX as readonly string[]).includes(value)) return value as Sex;
  return undefined;
}

export function normalizeActivity(value: unknown): ActivityLevel | undefined {
  if (isString(value) && (ALLOWED_ACTIVITY as readonly string[]).includes(value)) return value as ActivityLevel;
  return undefined;
}

export function normalizeWeightGoal(value: unknown): WeightGoalType {
  if (isString(value) && (ALLOWED_WEIGHT_GOALS as readonly string[]).includes(value)) return value as WeightGoalType;
  return 'maintain';
}

export function normalizeMacroSplit(value: unknown): MacroSplit {
  if (!isObject(value)) return normalizeMacroSplitRescale({ proteinPct: 30, carbsPct: 40, fatPct: 30 });
  return normalizeMacroSplitRescale({
    proteinPct: safeNum(value.proteinPct, 30, 0, 100),
    carbsPct: safeNum(value.carbsPct, 40, 0, 100),
    fatPct: safeNum(value.fatPct, 30, 0, 100),
  });
}

export function normalizeNutrition(value: unknown): NutritionPer100 | null {
  if (!isObject(value)) return null;
  const calories = safeNum(value.calories, 0, 0, 100_000);
  const protein = safeNum(value.protein, 0, 0, 1_000);
  const carbs = safeNum(value.carbs, 0, 0, 1_000);
  const fat = safeNum(value.fat, 0, 0, 1_000);
  const fiber = value.fiber == null ? undefined : safeNum(value.fiber, 0, 0, 1_000);
  const sugar = value.sugar == null ? undefined : safeNum(value.sugar, 0, 0, 1_000);
  const salt = value.salt == null ? undefined : safeNum(value.salt, 0, 0, 1_000);
  const hasMain = calories > 0 || protein > 0 || carbs > 0 || fat > 0;
  const hasOptional = (fiber ?? 0) > 0 || (sugar ?? 0) > 0 || (salt ?? 0) > 0;
  if (!hasMain && !hasOptional) return null;
  return { calories, protein, carbs, fat, fiber, sugar, salt };
}

export function normalizeFoodItem(value: unknown): FoodItem | null {
  if (!isObject(value)) return null;
  const name = normalizeString(value.name, 300);
  if (!name) return null;
  const nutrition = normalizeNutrition(value.nutrition);
  if (!nutrition) return null;
  const servingSize = safeNum(value.servingSize, 100, 0, 100_000);

  let customPortions: FoodItem['customPortions'];
  if (Array.isArray(value.customPortions)) {
    const seen = new Set<string>();
    const list: NonNullable<FoodItem['customPortions']> = [];
    for (const raw of value.customPortions) {
      if (!isObject(raw)) continue;
      const label = normalizeString(raw.label, 100);
      if (!label) continue;
      const grams = safeNum(raw.grams, 0, 0.1, 100_000);
      if (grams <= 0) continue;
      const id = nextUniqueId(isString(raw.id) && raw.id ? raw.id : undefined, 'port_', seen);
      list.push({ id, label, grams });
    }
    if (list.length > 0) customPortions = list;
  }

  return {
    id: isString(value.id) && value.id ? value.id : safeId('food_'),
    name,
    brand: normalizeOptionalString(value.brand, 200),
    barcode: normalizeOptionalString(value.barcode, 50),
    source: normalizeFoodSource(value.source),
    servingSize: servingSize > 0 ? servingSize : 100,
    servingLabel: normalizeOptionalString(value.servingLabel, 100),
    customPortions,
    nutrition,
    image: safeImageUrl(value.image),
    createdAt: safeNum(value.createdAt, Date.now(), 0),
  };
}

function resolveFoodId(rawId: unknown, snapshot: FoodItem, knownFoods: FoodItem[]): string | undefined {
  // Snapshot identity è più affidabile di un id importato duplicato/corrotto.
  if (snapshot.barcode) {
    const byBarcode = knownFoods.find((food) => food.barcode === snapshot.barcode);
    if (byBarcode) return byBarcode.id;
  }
  const byIdentity = knownFoods.find(
    (food) =>
      food.name.toLowerCase() === snapshot.name.toLowerCase() &&
      (food.brand ?? '').toLowerCase() === (snapshot.brand ?? '').toLowerCase(),
  );
  if (byIdentity) return byIdentity.id;
  if (isString(rawId) && rawId && knownFoods.some((food) => food.id === rawId)) return rawId;
  return undefined;
}

export function normalizeDiaryEntry(value: unknown, knownFoods: FoodItem[]): DiaryEntry | null {
  if (!isObject(value)) return null;
  const date = normalizeString(value.date, 10);
  if (!isValidDateKey(date)) return null;
  const meal = normalizeMeal(value.meal);
  if (!meal) return null;
  const foodSnapshot = normalizeFoodItem(value.foodSnapshot);
  if (!foodSnapshot) return null;
  const quantity = safeNum(value.quantity, 1, 0, 1000);
  if (quantity <= 0) return null;
  let gramsOverride: number | undefined;
  if (value.gramsOverride != null) {
    const grams = safeNum(value.gramsOverride, 0, 0, 100_000);
    if (grams > 0) gramsOverride = grams;
  }
  return {
    id: isString(value.id) && value.id ? value.id : safeId('entry_'),
    date,
    meal,
    foodId: resolveFoodId(value.foodId, foodSnapshot, knownFoods),
    foodSnapshot,
    quantity,
    gramsOverride,
    createdAt: safeNum(value.createdAt, Date.now(), 0),
  };
}

export function normalizeDayDiary(value: unknown, knownFoods: FoodItem[]): DayDiary {
  if (!isObject(value)) return {};
  const out: DayDiary = {};
  const seenEntryIds = new Set<string>();
  for (const [date, rawEntries] of Object.entries(value)) {
    if (!isValidDateKey(date) || !Array.isArray(rawEntries)) continue;
    const entries: DiaryEntry[] = [];
    for (const raw of rawEntries) {
      // La chiave della mappa è la fonte canonica della data del bucket.
      const normalizedRaw = isObject(raw) ? { ...raw, date } : raw;
      const entry = normalizeDiaryEntry(normalizedRaw, knownFoods);
      if (!entry) continue;
      entry.id = nextUniqueId(entry.id, 'entry_', seenEntryIds);
      entry.date = date;
      entries.push(entry);
    }
    if (entries.length > 0) out[date] = entries;
  }
  return out;
}

export function normalizeRecipeIngredient(value: unknown, knownFoods: FoodItem[] = []): RecipeIngredient | null {
  if (!isObject(value)) return null;
  const foodSnapshot = normalizeFoodItem(value.foodSnapshot);
  if (!foodSnapshot) return null;
  const grams = safeNum(value.grams, 0, 0, 100_000);
  if (grams <= 0) return null;
  return {
    id: isString(value.id) && value.id ? value.id : safeId('ing_'),
    foodId: resolveFoodId(value.foodId, foodSnapshot, knownFoods),
    foodSnapshot,
    grams,
  };
}

export function normalizeRecipe(value: unknown, knownFoods: FoodItem[] = []): Recipe | null {
  if (!isObject(value)) return null;
  const name = normalizeString(value.name, 300);
  if (!name) return null;
  const rawIngredients = Array.isArray(value.ingredients) ? value.ingredients : [];
  const ingredients: RecipeIngredient[] = [];
  const seenIngredientIds = new Set<string>();
  for (const raw of rawIngredients) {
    const ingredient = normalizeRecipeIngredient(raw, knownFoods);
    if (!ingredient) continue;
    ingredient.id = nextUniqueId(ingredient.id, 'ing_', seenIngredientIds);
    ingredients.push(ingredient);
  }
  if (ingredients.length === 0) return null;
  const servings = safeNum(value.servings, 1, 1, 200);
  return {
    id: isString(value.id) && value.id ? value.id : safeId('recipe_'),
    name,
    description: normalizeOptionalString(value.description, 2000),
    servings,
    ingredients,
    image: safeImageUrl(value.image),
    createdAt: safeNum(value.createdAt, Date.now(), 0),
    updatedAt: safeNum(value.updatedAt, Date.now(), 0),
  };
}

// ============ Biometrics ============

export function normalizeBiometricEntry(value: unknown): BiometricEntry {
  if (!isObject(value)) return {};
  const out: BiometricEntry = {};
  if (value.waterMl != null) {
    const water = safeNum(value.waterMl, NaN, 0, 20_000);
    if (Number.isFinite(water) && water > 0) out.waterMl = water;
  }
  if (value.sleepHours != null) {
    const sleep = safeNum(value.sleepHours, NaN, 0, 24);
    if (Number.isFinite(sleep) && sleep > 0) out.sleepHours = sleep;
  }
  if (value.weightKg != null) {
    const weight = safeNum(value.weightKg, NaN);
    if (Number.isFinite(weight) && weight >= 20) out.weightKg = Math.min(weight, 500);
  }
  return out;
}

export function normalizeBiometrics(value: unknown): Biometrics {
  if (!isObject(value)) return {};
  const out: Biometrics = {};
  for (const [date, rawEntry] of Object.entries(value)) {
    if (!isValidDateKey(date)) continue;
    const entry = normalizeBiometricEntry(rawEntry);
    if (entry.waterMl === undefined && entry.sleepHours === undefined && entry.weightKg === undefined) continue;
    out[date] = entry;
  }
  return out;
}

export function normalizeUserSettings(value: unknown): UserSettings {
  if (!isObject(value)) return { ...DEFAULT_SETTINGS, macroSplit: { ...DEFAULT_SETTINGS.macroSplit } };
  const weightGoalType = normalizeWeightGoal(value.weightGoalType);
  return {
    calorieGoal: safeNum(value.calorieGoal, DEFAULT_SETTINGS.calorieGoal, 500, 10_000),
    macroSplit: normalizeMacroSplit(value.macroSplit),
    theme: normalizeTheme(value.theme),
    name: normalizeOptionalString(value.name, 100),
    weightKg: value.weightKg == null ? undefined : safeNum(value.weightKg, 0, 0, 500),
    heightCm: value.heightCm == null ? undefined : safeNum(value.heightCm, 0, 0, 300),
    ageYears: value.ageYears == null ? undefined : safeNum(value.ageYears, 0, 0, 150),
    sex: normalizeSex(value.sex),
    activityLevel: normalizeActivity(value.activityLevel),
    weightGoalType,
    targetWeightKg:
      weightGoalType === 'maintain' || value.targetWeightKg == null
        ? undefined
        : safeNum(value.targetWeightKg, 0, 30, 500),
    weeklyRateKg:
      weightGoalType === 'maintain' || value.weeklyRateKg == null
        ? undefined
        : safeNum(value.weeklyRateKg, 0.25, 0.1, 0.5),
  };
}

// ============ Bulk normalization ============

export type NormalizedPayload = PersistedState;

function normalizeUniqueFoods(raw: unknown): FoodItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const foods: FoodItem[] = [];
  for (const item of raw) {
    const food = normalizeFoodItem(item);
    if (!food) continue;
    food.id = nextUniqueId(food.id, 'food_', seen);
    foods.push(food);
  }
  return foods;
}

function normalizeUniqueRecipes(raw: unknown, foods: FoodItem[]): Recipe[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const recipes: Recipe[] = [];
  for (const item of raw) {
    const recipe = normalizeRecipe(item, foods);
    if (!recipe) continue;
    recipe.id = nextUniqueId(recipe.id, 'recipe_', seen);
    recipes.push(recipe);
  }
  return recipes;
}

export function reconcileAll(raw: unknown): NormalizedPayload {
  if (isObject(raw) && typeof raw.version === 'number' && raw.version !== SCHEMA_VERSION) {
    console.warn(`[normalize] schema version mismatch: payload=${raw.version}, expected=${SCHEMA_VERSION}`);
  }
  if (!isObject(raw)) {
    return {
      settings: { ...DEFAULT_SETTINGS, macroSplit: { ...DEFAULT_SETTINGS.macroSplit } },
      foods: [],
      diary: {},
      recipes: [],
      favoriteFoodIds: [],
      biometrics: {},
    };
  }

  const foods = normalizeUniqueFoods(raw.foods);
  const foodIds = new Set(foods.map((food) => food.id));
  const diary = normalizeDayDiary(raw.diary, foods);
  const recipes = normalizeUniqueRecipes(raw.recipes, foods);
  const favoriteFoodIds = Array.isArray(raw.favoriteFoodIds)
    ? Array.from(
        new Set(raw.favoriteFoodIds.filter((id): id is string => isString(id) && foodIds.has(id))),
      )
    : [];
  return {
    settings: normalizeUserSettings(raw.settings),
    foods,
    diary,
    recipes,
    favoriteFoodIds,
    biometrics: normalizeBiometrics(raw.biometrics),
  };
}

// ============ Open Food Facts -> FoodItem ============

function kJtoKcal(kj?: number): number | undefined {
  if (kj == null || !Number.isFinite(kj)) return undefined;
  return Math.round(kj / 4.184);
}

function pickName(product: OffProduct): string {
  return product.product_name_it || product.product_name || product.generic_name || 'Prodotto senza nome';
}

export function buildFoodFromOff(product: OffProduct): FoodItem | null {
  if (!product || typeof product !== 'object') return null;
  const nutriments: OffNutriments = product.nutriments || {};
  const kcalRaw = nutriments['energy-kcal_100g'];
  const kJRaw = nutriments.energy_100g;
  let calories =
    typeof kcalRaw === 'number' && Number.isFinite(kcalRaw)
      ? kcalRaw
      : typeof kJRaw === 'number' && Number.isFinite(kJRaw)
        ? (kJtoKcal(kJRaw) ?? 0)
        : 0;

  let rawNutrition = {
    calories,
    protein: nutriments.proteins_100g,
    carbs: nutriments.carbohydrates_100g,
    fat: nutriments.fat_100g,
    fiber: nutriments.fiber_100g,
    sugar: nutriments.sugars_100g,
    salt: nutriments.salt_100g,
  };
  if (rawNutrition.calories === 0) {
    const macroKcal =
      (Number(rawNutrition.protein) || 0) * 4 +
      (Number(rawNutrition.carbs) || 0) * 4 +
      (Number(rawNutrition.fat) || 0) * 9;
    if (macroKcal > 0) {
      calories = Math.round(macroKcal);
      rawNutrition = { ...rawNutrition, calories };
    }
  }
  const nutrition = normalizeNutrition(rawNutrition);
  if (!nutrition) return null;
  const name = normalizeString(pickName(product), 300);
  if (!name || name === 'Prodotto senza nome') return null;
  const servingQuantity = safeNum(product.serving_quantity, 0, 0, 100_000);
  const brands = typeof product.brands === 'string' ? product.brands : '';
  return {
    id: safeId('off_'),
    name,
    brand: normalizeOptionalString(brands.split(',')[0]?.trim(), 200),
    barcode: normalizeOptionalString(product.code, 50),
    source: 'openfoodfacts',
    servingSize: servingQuantity > 0 ? Math.round(servingQuantity) : 100,
    servingLabel: normalizeOptionalString(product.serving_size, 100),
    nutrition,
    image: safeImageUrl(product.image_front_small_url || product.image_url),
    createdAt: Date.now(),
  };
}

// ============ Quota & size helpers ============

export function estimateStorageBytes(payload: unknown): number {
  try {
    return JSON.stringify(payload).length * 2;
  } catch {
    return 0;
  }
}

export function isStorageWarn(bytes: number): boolean {
  return bytes > STORAGE_WARN_BYTES;
}
