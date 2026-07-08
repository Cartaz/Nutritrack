// Test unitari per src/lib/normalize.ts
//
// Copre le funzioni di normalizzazione di input esterni (localStorage, import JSON,
// risposte Open Food Facts). Queste funzioni sono la "linea di difesa" anti-XSS,
// anti-NaN, anti-corruzione. Un bug qui significa dati corrotti persistiti.

import { describe, it, expect } from 'vitest';
import {
  normalizeString,
  normalizeOptionalString,
  normalizeNonNegNum,
  normalizeMeal,
  normalizeFoodSource,
  normalizeTheme,
  normalizeSex,
  normalizeActivity,
  normalizeWeightGoal,
  normalizeMacroSplit,
  normalizeNutrition,
  normalizeFoodItem,
  normalizeDiaryEntry,
  normalizeRecipeIngredient,
  normalizeRecipe,
  normalizeUserSettings,
  normalizeDayDiary,
  reconcileAll,
  buildFoodFromOff,
  estimateStorageBytes,
  isStorageWarn,
} from '../src/lib/normalize';

describe('normalizeString', () => {
  it('trimma whitespace', () => {
    expect(normalizeString('  ciao  ')).toBe('ciao');
  });

  it('ritorna stringa vuota per non-string', () => {
    expect(normalizeString(null)).toBe('');
    expect(normalizeString(undefined)).toBe('');
    expect(normalizeString(123)).toBe('');
    expect(normalizeString({})).toBe('');
  });

  it('tronca a maxLen', () => {
    expect(normalizeString('abcdefghij', 5)).toBe('abcde');
  });

  it('default maxLen = 500', () => {
    const s = 'a'.repeat(600);
    expect(normalizeString(s).length).toBe(500);
  });

  it('non spezza surrogate pair UTF-16 (emoji)', () => {
    // 😀 è un surrogate pair: 0xD83D + 0xDE00
    // Troncare a posizione 1 (dove c'è 0xD83D high surrogate) deve rimuovere il high surrogate
    const emoji = 'a😀';
    const r = normalizeString(emoji, 2);
    // Dovrebbe tornare 'a' (1 char) perché l'high surrogate è stato rimosso
    expect(r).toBe('a');
  });
});

describe('normalizeOptionalString', () => {
  it('ritorna undefined per stringa vuota', () => {
    expect(normalizeOptionalString('')).toBeUndefined();
    expect(normalizeOptionalString('   ')).toBeUndefined();
  });

  it('ritorna stringa trimmata per input valido', () => {
    expect(normalizeOptionalString('  ciao  ')).toBe('ciao');
  });

  it('ritorna undefined per non-string', () => {
    expect(normalizeOptionalString(null)).toBeUndefined();
    expect(normalizeOptionalString(123)).toBeUndefined();
  });
});

describe('normalizeNonNegNum', () => {
  it('parsa numero valido', () => {
    expect(normalizeNonNegNum(42)).toBe(42);
    expect(normalizeNonNegNum('42')).toBe(42);
  });

  it('clampa a 0 per negativi', () => {
    expect(normalizeNonNegNum(-5)).toBe(0);
    expect(normalizeNonNegNum('-5')).toBe(0);
  });

  it('clampa a max', () => {
    expect(normalizeNonNegNum(2000000, 1000)).toBe(1000);
  });

  it('ritorna 0 per non-numero', () => {
    expect(normalizeNonNegNum('abc')).toBe(0);
    expect(normalizeNonNegNum(null)).toBe(0);
    expect(normalizeNonNegNum(NaN)).toBe(0);
  });
});

describe('normalizeMeal', () => {
  it('accetta i 4 pasti validi', () => {
    expect(normalizeMeal('breakfast')).toBe('breakfast');
    expect(normalizeMeal('lunch')).toBe('lunch');
    expect(normalizeMeal('dinner')).toBe('dinner');
    expect(normalizeMeal('snack')).toBe('snack');
  });

  it('ritorna null per pasto non valido', () => {
    expect(normalizeMeal('brunch')).toBeNull();
    expect(normalizeMeal('')).toBeNull();
    expect(normalizeMeal(123)).toBeNull();
    expect(normalizeMeal(null)).toBeNull();
  });
});

describe('normalizeFoodSource', () => {
  it('accetta custom e openfoodfacts', () => {
    expect(normalizeFoodSource('custom')).toBe('custom');
    expect(normalizeFoodSource('openfoodfacts')).toBe('openfoodfacts');
  });

  it('default a custom per valori non validi', () => {
    expect(normalizeFoodSource('other')).toBe('custom');
    expect(normalizeFoodSource(null)).toBe('custom');
    expect(normalizeFoodSource(123)).toBe('custom');
  });
});

describe('normalizeTheme', () => {
  it('accetta light/dark/system', () => {
    expect(normalizeTheme('light')).toBe('light');
    expect(normalizeTheme('dark')).toBe('dark');
    expect(normalizeTheme('system')).toBe('system');
  });

  it('default a system per valori non validi', () => {
    expect(normalizeTheme('purple')).toBe('system');
    expect(normalizeTheme(null)).toBe('system');
  });
});

describe('normalizeSex', () => {
  it('accetta M e F', () => {
    expect(normalizeSex('M')).toBe('M');
    expect(normalizeSex('F')).toBe('F');
  });

  it('ritorna undefined per valori non validi', () => {
    expect(normalizeSex('X')).toBeUndefined();
    expect(normalizeSex(null)).toBeUndefined();
  });
});

describe('normalizeActivity', () => {
  it('accetta i 5 livelli', () => {
    expect(normalizeActivity('sedentary')).toBe('sedentary');
    expect(normalizeActivity('light')).toBe('light');
    expect(normalizeActivity('moderate')).toBe('moderate');
    expect(normalizeActivity('active')).toBe('active');
    expect(normalizeActivity('very_active')).toBe('very_active');
  });

  it('ritorna undefined per valori non validi', () => {
    expect(normalizeActivity('extreme')).toBeUndefined();
    expect(normalizeActivity(null)).toBeUndefined();
  });
});

describe('normalizeWeightGoal', () => {
  it('accetta lose/maintain/gain', () => {
    expect(normalizeWeightGoal('lose')).toBe('lose');
    expect(normalizeWeightGoal('maintain')).toBe('maintain');
    expect(normalizeWeightGoal('gain')).toBe('gain');
  });

  it('default a maintain per valori non validi', () => {
    expect(normalizeWeightGoal('recomp')).toBe('maintain');
    expect(normalizeWeightGoal(null)).toBe('maintain');
  });
});

describe('normalizeMacroSplit', () => {
  it('riscala split che non somma a 100', () => {
    const r = normalizeMacroSplit({ proteinPct: 40, carbsPct: 40, fatPct: 40 });
    expect(r.proteinPct + r.carbsPct + r.fatPct).toBe(100);
  });

  it('default a 30/40/30 per input non-oggetto', () => {
    const r = normalizeMacroSplit(null);
    expect(r.proteinPct).toBe(30);
    expect(r.carbsPct).toBe(40);
    expect(r.fatPct).toBe(30);
  });

  it('clampa macro negativi prima di riscalare', () => {
    const r = normalizeMacroSplit({ proteinPct: -10, carbsPct: 50, fatPct: 50 });
    expect(r.proteinPct).toBe(0);
    expect(r.proteinPct + r.carbsPct + r.fatPct).toBe(100);
  });
});

describe('normalizeNutrition', () => {
  it('normalizza nutrizione valida', () => {
    const r = normalizeNutrition({ calories: 100, protein: 5, carbs: 20, fat: 1 });
    expect(r).not.toBeNull();
    expect(r!.calories).toBe(100);
    expect(r!.protein).toBe(5);
    expect(r!.carbs).toBe(20);
    expect(r!.fat).toBe(1);
  });

  it('ritorna null se tutti i valori sono 0', () => {
    expect(normalizeNutrition({ calories: 0, protein: 0, carbs: 0, fat: 0 })).toBeNull();
  });

  it('ritorna null per non-oggetto', () => {
    expect(normalizeNutrition(null)).toBeNull();
    expect(normalizeNutrition('ciao')).toBeNull();
    expect(normalizeNutrition(123)).toBeNull();
  });

  it('clampa negativi a 0', () => {
    const r = normalizeNutrition({ calories: -50, protein: -5, carbs: 10, fat: 2 });
    expect(r!.calories).toBe(0);
    expect(r!.protein).toBe(0);
    expect(r!.carbs).toBe(10);
  });

  it('preserva campi opzionali fiber/sugar/salt quando presenti', () => {
    const r = normalizeNutrition({ calories: 100, protein: 5, carbs: 10, fat: 1, fiber: 3, sugar: 5, salt: 0.5 });
    expect(r!.fiber).toBe(3);
    expect(r!.sugar).toBe(5);
    expect(r!.salt).toBe(0.5);
  });

  it('undefined per campi opzionali mancanti', () => {
    const r = normalizeNutrition({ calories: 100, protein: 5, carbs: 10, fat: 1 });
    expect(r!.fiber).toBeUndefined();
  });

  // Fix MEDIUM bug: alimenti fiber/sugar/salt-only non devono più essere scartati
  it('accetta alimenti con solo fiber (es. psyllium husk 0kcal/5g fiber)', () => {
    const r = normalizeNutrition({ calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 5 });
    expect(r).not.toBeNull();
    expect(r!.fiber).toBe(5);
    expect(r!.calories).toBe(0);
  });

  it('accetta alimenti con solo salt (es. sale da cucina)', () => {
    const r = normalizeNutrition({ calories: 0, protein: 0, carbs: 0, fat: 0, salt: 97 });
    expect(r).not.toBeNull();
    expect(r!.salt).toBe(97);
  });
});

describe('normalizeString control chars (Fix LOW bug)', () => {
  it('filtra null byte e caratteri di controllo', () => {
    expect(normalizeString('ciao\x00mondo')).toBe('ciaomondo');
    expect(normalizeString('test\x01\x02foo')).toBe('testfoo');
    expect(normalizeString('a\x7Fb')).toBe('ab');
  });

  it('preserva newline e tab', () => {
    expect(normalizeString('riga1\nriga2')).toBe('riga1\nriga2');
    expect(normalizeString('col1\tcol2')).toBe('col1\tcol2');
  });
});

describe('normalizeFoodItem', () => {
  const validFood = {
    id: 'food_123',
    name: 'Mela',
    brand: 'Coop',
    barcode: '8012345678901',
    source: 'custom',
    servingSize: 100,
    nutrition: { calories: 52, protein: 0.3, carbs: 14, fat: 0.2 },
    createdAt: 1700000000000,
  };

  it('normalizza cibo valido', () => {
    const r = normalizeFoodItem(validFood);
    expect(r).not.toBeNull();
    expect(r!.id).toBe('food_123');
    expect(r!.name).toBe('Mela');
    expect(r!.nutrition.calories).toBe(52);
  });

  it('ritorna null se manca il nome', () => {
    expect(normalizeFoodItem({ ...validFood, name: '' })).toBeNull();
    expect(normalizeFoodItem({ ...validFood, name: null })).toBeNull();
  });

  it('ritorna null se nutrizione è zero (tutti macro = 0)', () => {
    expect(normalizeFoodItem({ ...validFood, nutrition: { calories: 0, protein: 0, carbs: 0, fat: 0 } })).toBeNull();
  });

  it('ritorna null per non-oggetto', () => {
    expect(normalizeFoodItem(null)).toBeNull();
    expect(normalizeFoodItem('ciao')).toBeNull();
  });

  it('genera ID se mancante', () => {
    const r = normalizeFoodItem({ ...validFood, id: undefined });
    expect(r!.id).toBeTruthy();
    expect(r!.id.length).toBeGreaterThan(5);
  });

  it('sanitizza URL immagine non-http', () => {
    // javascript: deve essere neutralizzato
    const r = normalizeFoodItem({ ...validFood, image: 'javascript:alert(1)' });
    expect(r!.image).toBeUndefined();
  });

  it('accetta URL https per immagine', () => {
    const r = normalizeFoodItem({ ...validFood, image: 'https://example.com/img.jpg' });
    expect(r!.image).toBe('https://example.com/img.jpg');
  });

  it('normalizza customPortions valide', () => {
    const r = normalizeFoodItem({
      ...validFood,
      customPortions: [
        { id: 'port_1', label: '1 fetta', grams: 30 },
        { id: 'port_2', label: '1 tazza', grams: 150 },
      ],
    });
    expect(r!.customPortions).toHaveLength(2);
    expect(r!.customPortions![0].label).toBe('1 fetta');
  });

  it('scarta customPortions con grams non numerico (NaN)', () => {
    // Nota: safeNum clampa 0 → 0.1 (min), quindi grams=0 viene tenuto.
    // L'unico modo per scartare è passare un valore che safeNum considera non-finito (ritorna fallback 0).
    const r = normalizeFoodItem({
      ...validFood,
      customPortions: [
        { id: 'port_1', label: 'valid', grams: 30 },
        { id: 'port_2', label: 'invalid', grams: 'not-a-number' },
      ],
    });
    expect(r!.customPortions).toHaveLength(1);
  });
});

describe('normalizeDiaryEntry', () => {
  const validEntry = {
    id: 'entry_1',
    date: '2024-01-15',
    meal: 'breakfast',
    foodSnapshot: {
      id: 'food_1',
      name: 'Mela',
      source: 'custom',
      servingSize: 100,
      nutrition: { calories: 52, protein: 0.3, carbs: 14, fat: 0.2 },
    },
    quantity: 1,
    createdAt: 1700000000000,
  };

  it('normalizza entry valida', () => {
    const r = normalizeDiaryEntry(validEntry, []);
    expect(r).not.toBeNull();
    expect(r!.date).toBe('2024-01-15');
    expect(r!.meal).toBe('breakfast');
    expect(r!.quantity).toBe(1);
  });

  it('ritorna null per data non valida', () => {
    expect(normalizeDiaryEntry({ ...validEntry, date: '2024-13-45' }, [])).toBeNull();
    expect(normalizeDiaryEntry({ ...validEntry, date: 'ciao' }, [])).toBeNull();
    expect(normalizeDiaryEntry({ ...validEntry, date: '2024-1-5' }, [])).toBeNull(); // formato non stretto
  });

  it('ritorna null per meal non valido', () => {
    expect(normalizeDiaryEntry({ ...validEntry, meal: 'brunch' }, [])).toBeNull();
  });

  it('match foodId per barcode quando presente', () => {
    const knownFoods = [
      {
        id: 'food_known',
        name: 'Altro',
        source: 'custom' as const,
        servingSize: 100,
        nutrition: { calories: 100, protein: 1, carbs: 1, fat: 1 },
        createdAt: 0,
        barcode: '8012345678901',
      },
    ];
    const entry = {
      ...validEntry,
      foodSnapshot: { ...validEntry.foodSnapshot, barcode: '8012345678901' },
      foodId: undefined,
    };
    const r = normalizeDiaryEntry(entry, knownFoods);
    expect(r!.foodId).toBe('food_known');
  });

  it('match foodId per name+brand se barcode non presente', () => {
    const knownFoods = [
      {
        id: 'food_known',
        name: 'Mela',
        brand: 'Coop',
        source: 'custom' as const,
        servingSize: 100,
        nutrition: { calories: 100, protein: 1, carbs: 1, fat: 1 },
        createdAt: 0,
      },
    ];
    // Il foodSnapshot deve avere stesso name E brand per matchare
    const entry = {
      ...validEntry,
      foodSnapshot: { ...validEntry.foodSnapshot, brand: 'Coop' },
      foodId: undefined,
    };
    const r = normalizeDiaryEntry(entry, knownFoods);
    expect(r!.foodId).toBe('food_known');
  });
});

describe('normalizeDayDiary', () => {
  it('ritorna oggetto vuoto per input non valido', () => {
    expect(normalizeDayDiary(null, [])).toEqual({});
    expect(normalizeDayDiary('ciao', [])).toEqual({});
    expect(normalizeDayDiary(123, [])).toEqual({});
  });

  it('filtra date non valide (e salta array vuoti)', () => {
    // Nota: normalizeDayDiary non salva date con array vuoto (entries.length > 0 richiesto)
    const r = normalizeDayDiary(
      {
        '2024-01-15': [
          {
            id: 'e1',
            date: '2024-01-15',
            meal: 'breakfast',
            foodSnapshot: {
              id: 'f1',
              name: 'X',
              source: 'custom',
              servingSize: 100,
              nutrition: { calories: 10, protein: 1, carbs: 1, fat: 1 },
            },
            quantity: 1,
          },
        ],
        'invalid-date': [],
      },
      [],
    );
    expect(Object.keys(r)).toEqual(['2024-01-15']);
  });

  it('normalizza entries valide e scarta invalide', () => {
    const r = normalizeDayDiary(
      {
        '2024-01-15': [
          // valida
          {
            id: 'e1',
            date: '2024-01-15',
            meal: 'breakfast',
            foodSnapshot: {
              id: 'f1',
              name: 'X',
              source: 'custom',
              servingSize: 100,
              nutrition: { calories: 10, protein: 1, carbs: 1, fat: 1 },
            },
            quantity: 1,
          },
          // invalida (manca nutrition)
          {
            id: 'e2',
            date: '2024-01-15',
            meal: 'lunch',
            foodSnapshot: {
              id: 'f2',
              name: 'Y',
              source: 'custom',
              servingSize: 100,
              nutrition: { calories: 0, protein: 0, carbs: 0, fat: 0 },
            },
            quantity: 1,
          },
        ],
      },
      [],
    );
    expect(r['2024-01-15']).toHaveLength(1);
  });
});

describe('normalizeRecipeIngredient', () => {
  it('normalizza ingrediente valido', () => {
    const r = normalizeRecipeIngredient({
      id: 'ing_1',
      foodSnapshot: {
        id: 'f1',
        name: 'Farina',
        source: 'custom',
        servingSize: 100,
        nutrition: { calories: 350, protein: 10, carbs: 70, fat: 1 },
      },
      grams: 200,
    });
    expect(r).not.toBeNull();
    expect(r!.grams).toBe(200);
  });

  it('ritorna null per grams <= 0', () => {
    expect(
      normalizeRecipeIngredient({
        id: 'ing_1',
        foodSnapshot: {
          id: 'f1',
          name: 'X',
          source: 'custom',
          servingSize: 100,
          nutrition: { calories: 100, protein: 1, carbs: 1, fat: 1 },
        },
        grams: 0,
      }),
    ).toBeNull();
  });

  it('ritorna null se foodSnapshot non valido', () => {
    expect(
      normalizeRecipeIngredient({
        id: 'ing_1',
        foodSnapshot: {
          id: 'f1',
          name: '',
          source: 'custom',
          servingSize: 100,
          nutrition: { calories: 100, protein: 1, carbs: 1, fat: 1 },
        },
        grams: 100,
      }),
    ).toBeNull();
  });
});

describe('normalizeRecipe', () => {
  const validIngredient = {
    id: 'ing_1',
    foodSnapshot: {
      id: 'f1',
      name: 'Farina',
      source: 'custom' as const,
      servingSize: 100,
      nutrition: { calories: 350, protein: 10, carbs: 70, fat: 1 },
    },
    grams: 200,
  };

  it('normalizza ricetta valida', () => {
    const r = normalizeRecipe({
      id: 'recipe_1',
      name: 'Pasta',
      servings: 2,
      ingredients: [validIngredient],
    });
    expect(r).not.toBeNull();
    expect(r!.name).toBe('Pasta');
    expect(r!.servings).toBe(2);
    expect(r!.ingredients).toHaveLength(1);
  });

  it('ritorna null se manca il nome', () => {
    expect(normalizeRecipe({ id: 'r1', name: '', servings: 2, ingredients: [validIngredient] })).toBeNull();
  });

  it('ritorna null se nessun ingrediente valido', () => {
    expect(normalizeRecipe({ id: 'r1', name: 'Vuota', servings: 2, ingredients: [] })).toBeNull();
  });

  it('clampa servings a [1, 200]', () => {
    const r1 = normalizeRecipe({ id: 'r1', name: 'X', servings: 0, ingredients: [validIngredient] });
    expect(r1!.servings).toBe(1);
    const r2 = normalizeRecipe({ id: 'r2', name: 'X', servings: 500, ingredients: [validIngredient] });
    expect(r2!.servings).toBe(200);
  });
});

describe('normalizeUserSettings', () => {
  it('ritorna default per input non-oggetto', () => {
    const r = normalizeUserSettings(null);
    expect(r.calorieGoal).toBe(2000);
    expect(r.macroSplit.proteinPct).toBe(30);
  });

  it('clampa calorieGoal a [500, 10000]', () => {
    expect(normalizeUserSettings({ calorieGoal: 100 }).calorieGoal).toBe(500);
    expect(normalizeUserSettings({ calorieGoal: 50000 }).calorieGoal).toBe(10000);
  });

  it('normalizza theme invalid a system', () => {
    expect(normalizeUserSettings({ theme: 'purple' }).theme).toBe('system');
  });

  it('targetWeightKg undefined se goalType = maintain', () => {
    const r = normalizeUserSettings({ weightGoalType: 'maintain', targetWeightKg: 70 });
    expect(r.targetWeightKg).toBeUndefined();
  });

  it('targetWeightKg clamped [30, 500] se lose/gain', () => {
    const r = normalizeUserSettings({ weightGoalType: 'lose', targetWeightKg: 10 });
    expect(r.targetWeightKg).toBe(30);
    const r2 = normalizeUserSettings({ weightGoalType: 'gain', targetWeightKg: 1000 });
    expect(r2.targetWeightKg).toBe(500);
  });

  it('weeklyRateKg clamped [0.1, 0.5] per lose/gain', () => {
    const r = normalizeUserSettings({ weightGoalType: 'lose', weeklyRateKg: 2 });
    expect(r.weeklyRateKg).toBe(0.5);
    const r2 = normalizeUserSettings({ weightGoalType: 'gain', weeklyRateKg: 0.01 });
    expect(r2.weeklyRateKg).toBe(0.1);
  });

  it('weeklyRateKg undefined per maintain', () => {
    const r = normalizeUserSettings({ weightGoalType: 'maintain', weeklyRateKg: 0.5 });
    expect(r.weeklyRateKg).toBeUndefined();
  });
});

describe('reconcileAll', () => {
  it('ritorna defaults per input non-oggetto', () => {
    const r = reconcileAll(null);
    expect(r.foods).toEqual([]);
    expect(r.recipes).toEqual([]);
    expect(r.diary).toEqual({});
    expect(r.favoriteFoodIds).toEqual([]);
    expect(r.settings.calorieGoal).toBe(2000);
  });

  it('normalizza payload completo', () => {
    const payload = {
      version: 1,
      settings: { calorieGoal: 1800, theme: 'dark' },
      foods: [
        {
          id: 'f1',
          name: 'Mela',
          source: 'custom',
          servingSize: 100,
          nutrition: { calories: 52, protein: 0.3, carbs: 14, fat: 0.2 },
        },
      ],
      diary: {},
      recipes: [],
      favoriteFoodIds: ['f1', 'f_non_esiste'],
    };
    const r = reconcileAll(payload);
    expect(r.foods).toHaveLength(1);
    expect(r.favoriteFoodIds).toEqual(['f1']); // f_non_esiste filtrato
  });

  it('filtra favoriteFoodIds non corrispondenti a foods esistenti', () => {
    const r = reconcileAll({
      foods: [
        {
          id: 'f1',
          name: 'X',
          source: 'custom',
          servingSize: 100,
          nutrition: { calories: 10, protein: 1, carbs: 1, fat: 1 },
        },
      ],
      favoriteFoodIds: ['f1', 'f2', 123, null],
    });
    expect(r.favoriteFoodIds).toEqual(['f1']);
  });
});

describe('buildFoodFromOff', () => {
  it('converte prodotto OFF valido in FoodItem', () => {
    const product = {
      code: '8012345678901',
      product_name: 'Pasta Barilla',
      brands: 'Barilla',
      nutriments: {
        'energy-kcal_100g': 350,
        'proteins_100g': 12,
        'carbohydrates_100g': 70,
        'fat_100g': 1.5,
      },
      serving_quantity: 80,
      serving_size: '80g',
    };
    const r = buildFoodFromOff(product);
    expect(r).not.toBeNull();
    expect(r!.name).toBe('Pasta Barilla');
    expect(r!.brand).toBe('Barilla');
    expect(r!.barcode).toBe('8012345678901');
    expect(r!.source).toBe('openfoodfacts');
    expect(r!.nutrition.calories).toBe(350);
    expect(r!.nutrition.protein).toBe(12);
  });

  it('preferisce product_name_it se presente', () => {
    const r = buildFoodFromOff({
      product_name: 'English Name',
      product_name_it: 'Nome Italiano',
      nutriments: { 'energy-kcal_100g': 100, 'proteins_100g': 5, 'carbohydrates_100g': 10, 'fat_100g': 1 },
    });
    expect(r!.name).toBe('Nome Italiano');
  });

  it('ritorna null se nessun nome disponibile', () => {
    expect(
      buildFoodFromOff({
        nutriments: { 'energy-kcal_100g': 100, 'proteins_100g': 5, 'carbohydrates_100g': 10, 'fat_100g': 1 },
      }),
    ).toBeNull();
  });

  it('ritorna null se nutrizione è tutta zero', () => {
    expect(
      buildFoodFromOff({
        product_name: 'Empty',
        nutriments: {},
      }),
    ).toBeNull();
  });

  it('stima kcal da macro se energy-kcal manca (Atwater)', () => {
    // 10*4 + 20*4 + 5*9 = 40 + 80 + 45 = 165
    const r = buildFoodFromOff({
      product_name: 'No Energy',
      nutriments: {
        proteins_100g: 10,
        carbohydrates_100g: 20,
        fat_100g: 5,
      },
    });
    expect(r).not.toBeNull();
    expect(r!.nutrition.calories).toBe(165);
  });

  it('converte kJ in kcal se energy-kcal manca', () => {
    // 418 kJ / 4.184 = 100 kcal
    const r = buildFoodFromOff({
      product_name: 'kJ Product',
      nutriments: {
        energy_100g: 418,
        proteins_100g: 5,
        carbohydrates_100g: 10,
        fat_100g: 1,
      },
    });
    expect(r).not.toBeNull();
    expect(r!.nutrition.calories).toBe(100);
  });

  it('sanitizza URL immagine javascript:', () => {
    const r = buildFoodFromOff({
      product_name: 'X',
      image_url: 'javascript:alert(1)',
      nutriments: { 'energy-kcal_100g': 100, 'proteins_100g': 5, 'carbohydrates_100g': 10, 'fat_100g': 1 },
    });
    expect(r!.image).toBeUndefined();
  });
});

describe('estimateStorageBytes / isStorageWarn', () => {
  it('ritorna byte UTF-16 (length * 2)', () => {
    const bytes = estimateStorageBytes({ a: 'ciao' });
    // '{"a":"ciao"}'.length = 12 → 12 * 2 = 24
    expect(bytes).toBe(24);
  });

  it('gestisce payload non serializzabile (circolari)', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(estimateStorageBytes(circular)).toBe(0);
  });

  it('isStorageWarn ritorna true per byte > STORAGE_WARN_BYTES', () => {
    // STORAGE_WARN_BYTES = 4.5MB = 4_718_592
    expect(isStorageWarn(5_000_000)).toBe(true);
    expect(isStorageWarn(1_000_000)).toBe(false);
  });
});

describe('normalizeRecipeIngredient + normalizeRecipe integration', () => {
  it('ricetta con 2 ingredienti viene normalizzata correttamente', () => {
    const r = normalizeRecipe({
      id: 'r1',
      name: 'Riso al pomodoro',
      servings: 4,
      ingredients: [
        {
          id: 'ing_1',
          foodSnapshot: {
            id: 'f1',
            name: 'Riso',
            source: 'custom',
            servingSize: 100,
            nutrition: { calories: 350, protein: 7, carbs: 78, fat: 0.5 },
          },
          grams: 400,
        },
        {
          id: 'ing_2',
          foodSnapshot: {
            id: 'f2',
            name: 'Passata',
            source: 'custom',
            servingSize: 100,
            nutrition: { calories: 30, protein: 1.5, carbs: 6, fat: 0.2 },
          },
          grams: 500,
        },
      ],
    });
    expect(r).not.toBeNull();
    expect(r!.ingredients).toHaveLength(2);
    expect(r!.servings).toBe(4);
  });
});
