// Tipi condivisi del dominio NutriTrack.
// Tipi grezzi da API (prefisso Off*) separati dai tipi interni normalizzati.
// Tipi messaggi worker come union discriminata.

// ============ Domain types ============

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export const MEAL_LABELS: Record<MealType, string> = {
  breakfast: 'Colazione',
  lunch: 'Pranzo',
  dinner: 'Cena',
  snack: 'Spuntino',
};

export const MEAL_ICONS: Record<MealType, string> = {
  breakfast: '☕',
  lunch: '🍽️',
  dinner: '🌙',
  snack: '🍎',
};

export const MEAL_ORDER: readonly MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'] as const;

/** Valori nutrizionali riferiti a 100g/ml */
export interface NutritionPer100 {
  calories: number; // kcal
  protein: number;  // g
  carbs: number;    // g
  fat: number;      // g
  fiber?: number;   // g
  sugar?: number;   // g
  salt?: number;    // g
}

/** Sorgente ammissibile per un FoodItem */
export const ALLOWED_FOOD_SOURCES = ['custom', 'openfoodfacts'] as const;
export type FoodSource = (typeof ALLOWED_FOOD_SOURCES)[number];

/** Ingrediente / cibo salvabile (custom o da Open Food Facts) */
export interface FoodItem {
  id: string;
  name: string;
  brand?: string;
  barcode?: string;
  source: FoodSource;
  servingSize: number;     // grammi/ml per porzione di default
  servingLabel?: string;   // es. "1 fetta", "1 tazza"
  nutrition: NutritionPer100;
  image?: string;          // URL thumbnail
  createdAt: number;
}

/** Riga del diario: riferimento a FoodItem + quantità */
export interface DiaryEntry {
  id: string;
  date: string;       // YYYY-MM-DD
  meal: MealType;
  foodId?: string;    // riferimento a FoodItem salvato
  foodSnapshot: FoodItem; // snapshot al momento dell'aggiunta
  quantity: number;   // numero di porzioni
  gramsOverride?: number; // peso in grammi (bilancia)
  createdAt: number;
}

export interface RecipeIngredient {
  id: string;
  foodId?: string;
  foodSnapshot: FoodItem;
  grams: number;
}

export interface Recipe {
  id: string;
  name: string;
  description?: string;
  servings: number;
  ingredients: RecipeIngredient[];
  image?: string;
  createdAt: number;
  updatedAt: number;
}

export interface MacroSplit {
  proteinPct: number;
  carbsPct: number;
  fatPct: number;
}

export const ALLOWED_THEMES = ['light', 'dark', 'system'] as const;
export type Theme = (typeof ALLOWED_THEMES)[number];

export const ALLOWED_SEX = ['M', 'F'] as const;
export type Sex = (typeof ALLOWED_SEX)[number];

export const ALLOWED_ACTIVITY = ['sedentary', 'light', 'moderate', 'active', 'very_active'] as const;
export type ActivityLevel = (typeof ALLOWED_ACTIVITY)[number];

export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

export const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: 'Sedentario (poco o niente esercizio)',
  light: 'Leggero (1-3 allenamenti/settimana)',
  moderate: 'Moderato (3-5 allenamenti/settimana)',
  active: 'Attivo (6-7 allenamenti/settimana)',
  very_active: 'Molto attivo (lavoro fisico + allenamento)',
};

export interface UserSettings {
  calorieGoal: number;     // kcal/giorno
  macroSplit: MacroSplit;
  name?: string;
  theme: Theme;
  weightKg?: number;
  heightCm?: number;
  ageYears?: number;
  sex?: Sex;
  activityLevel?: ActivityLevel;
}

/** Mappa date -> entries */
export interface DayDiary {
  [date: string]: DiaryEntry[];
}

export interface MacroPreset {
  id: string;
  name: string;
  description: string;
  split: MacroSplit;
}

export const MACRO_PRESETS: readonly MacroPreset[] = [
  { id: 'balanced',     name: 'Bilanciato',    description: '30/40/30 - equilibrio classico',  split: { proteinPct: 30, carbsPct: 40, fatPct: 30 } },
  { id: 'high_protein', name: 'Alto proteico', description: '40/30/30 - taglio / massa magra', split: { proteinPct: 40, carbsPct: 30, fatPct: 30 } },
  { id: 'low_carb',     name: 'Low carb',      description: '35/20/45 - basso carboidrato',    split: { proteinPct: 35, carbsPct: 20, fatPct: 45 } },
  { id: 'keto',         name: 'Keto',          description: '25/5/70 - chetogenica',           split: { proteinPct: 25, carbsPct: 5,  fatPct: 70 } },
  { id: 'mediterranean',name: 'Mediterranea',  description: '20/50/30 - stile mediterraneo',   split: { proteinPct: 20, carbsPct: 50, fatPct: 30 } },
] as const;

/** Costanti kcal/g per i macro */
export const KCAL_PER_GRAM = {
  protein: 4,
  carbs: 4,
  fat: 9,
} as const;

// ============ Open Food Facts raw types (grezzi da API) ============

export interface OffNutriments {
  'energy-kcal_100g'?: number;
  energy_100g?: number;        // kJ
  proteins_100g?: number;
  carbohydrates_100g?: number;
  fat_100g?: number;
  fiber_100g?: number;
  sugars_100g?: number;
  salt_100g?: number;
}

export interface OffProduct {
  code?: string;
  product_name?: string;
  product_name_it?: string;
  generic_name?: string;
  brands?: string;
  image_url?: string;
  image_front_small_url?: string;
  nutriments?: OffNutriments;
  serving_size?: string;
  serving_quantity?: number;
  quantity?: string;
}

export interface OffSearchResponse {
  products?: OffProduct[];
  count?: number;
  page?: number;
  page_size?: number;
}

// ============ Worker message types (union discriminata) ============

export interface DayTotals {
  date: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  count: number;
}

export interface StatsResult {
  days: DayTotals[];
  avgCalories: number;
  avgProtein: number;
  avgCarbs: number;
  avgFat: number;
  totalEntries: number;
  daysTracked: number;
}

export type WorkerRequest =
  | { type: 'stats'; reqId: number; entries: DiaryEntry[]; dates: string[] }
  | { type: 'dayTotals'; reqId: number; entries: DiaryEntry[] };

export type WorkerResponse =
  | { type: 'stats'; reqId: number; result: StatsResult }
  | { type: 'dayTotals'; reqId: number; result: DayTotals };

// ============ App state ============

export type ViewName = 'dashboard' | 'foods' | 'recipes' | 'settings';

export interface AppState {
  settings: UserSettings;
  foods: FoodItem[];
  diary: DayDiary;
  recipes: Recipe[];
  favoriteFoodIds: string[];
  currentView: ViewName;
  currentDate: string;        // YYYY-MM-DD (dashboard)
  _storageDisabled: boolean;
  _searchOpen: boolean;
  _searchMeal: MealType;
  _searchDate: string;
  /** null = chiuso, 'new' = crea nuovo, string = modifica esistente */
  _editingFoodId: string | null;
  /** null = chiuso, 'new' = crea nuovo, string = modifica esistente */
  _editingRecipeId: string | null;
  _viewingRecipeId: string | null;
  _confirmDeleteFoodId: string | null;
  _confirmDeleteRecipeId: string | null;
  _confirmReset: boolean;
  _addRecipeToMealPickerId: string | null;
}
