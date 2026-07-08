// Test unitari per src/lib/nutrition.ts
//
// Copre i calcoli nutrizionali puri: macro grams, scaling, somma, BMR (Mifflin-St Jeor),
// TDEE, weeks-to-target, weekly delta, goal-adjusted calories, macro normalization.
//
// Queste funzioni sono il cuore "matematico" dell'app — un bug qui si propaga
// a tutte le viste (dashboard, settings, recipe editor).

import { describe, it, expect } from 'vitest';
import {
  calcMacroGrams,
  scaleNutrition,
  sumNutrition,
  calcBMR,
  calcTDEE,
  calcWeeksToTarget,
  calcWeeklyDeltaKg,
  weeklyDeltaToDailyKcal,
  calcGoalAdjustedCalories,
  normalizeMacroSplit,
  kcalFromMacros,
  DEFAULT_SETTINGS,
} from '../src/lib/nutrition';
import type { MacroSplit, NutritionPer100, Sex, ActivityLevel, WeightGoalType } from '../src/types';

describe('calcMacroGrams', () => {
  it('calcola grammi corretti per 2000 kcal 30/40/30', () => {
    // P = 2000 * 0.30 / 4 = 150
    // C = 2000 * 0.40 / 4 = 200
    // F = 2000 * 0.30 / 9 = 66.67 → 67
    const result = calcMacroGrams(2000, { proteinPct: 30, carbsPct: 40, fatPct: 30 });
    expect(result.protein).toBe(150);
    expect(result.carbs).toBe(200);
    expect(result.fat).toBe(67);
  });

  it('calcola grammi per split keto 25/5/70', () => {
    // P = 2000 * 0.25 / 4 = 125
    // C = 2000 * 0.05 / 4 = 25
    // F = 2000 * 0.70 / 9 = 155.56 → 156
    const result = calcMacroGrams(2000, { proteinPct: 25, carbsPct: 5, fatPct: 70 });
    expect(result.protein).toBe(125);
    expect(result.carbs).toBe(25);
    expect(result.fat).toBe(156);
  });

  it('gestisce 0 kcal', () => {
    const result = calcMacroGrams(0, { proteinPct: 30, carbsPct: 40, fatPct: 30 });
    expect(result.protein).toBe(0);
    expect(result.carbs).toBe(0);
    expect(result.fat).toBe(0);
  });

  it('verifica consistenza kcal da macro calcolati (entro tolleranza)', () => {
    const split: MacroSplit = { proteinPct: 40, carbsPct: 30, fatPct: 30 };
    const kcalTarget = 2500;
    const grams = calcMacroGrams(kcalTarget, split);
    const kcalFromMacro = kcalFromMacros(grams);
    // Tolleranza ±10 kcal dovuta agli arrotondamenti
    expect(Math.abs(kcalFromMacro - kcalTarget)).toBeLessThanOrEqual(10);
  });
});

describe('scaleNutrition', () => {
  const base: NutritionPer100 = {
    calories: 100,
    protein: 10,
    carbs: 20,
    fat: 1,
    fiber: 3,
    sugar: 5,
    salt: 0.5,
  };

  it('scala per 100g (factor = 1)', () => {
    const r = scaleNutrition(base, 100);
    expect(r.calories).toBe(100);
    expect(r.protein).toBe(10);
    expect(r.carbs).toBe(20);
    expect(r.fat).toBe(1);
    expect(r.fiber).toBe(3);
  });

  it('scala per 50g (factor = 0.5)', () => {
    const r = scaleNutrition(base, 50);
    expect(r.calories).toBe(50);
    expect(r.protein).toBe(5);
    expect(r.carbs).toBe(10);
    expect(r.fat).toBe(0.5);
    expect(r.fiber).toBe(1.5);
  });

  it('scala per 200g (factor = 2)', () => {
    const r = scaleNutrition(base, 200);
    expect(r.calories).toBe(200);
    expect(r.protein).toBe(20);
    expect(r.fat).toBe(2);
  });

  it('scala per 0g (factor = 0)', () => {
    const r = scaleNutrition(base, 0);
    expect(r.calories).toBe(0);
    expect(r.protein).toBe(0);
    expect(r.fat).toBe(0);
  });

  it('mantieni campi undefined quando source non li ha', () => {
    const minimal: NutritionPer100 = { calories: 100, protein: 5, carbs: 10, fat: 2 };
    const r = scaleNutrition(minimal, 50);
    expect(r.fiber).toBeUndefined();
    expect(r.sugar).toBeUndefined();
    expect(r.salt).toBeUndefined();
  });
});

describe('sumNutrition', () => {
  it('somma una lista di NutritionPer100', () => {
    const items: NutritionPer100[] = [
      { calories: 100, protein: 5, carbs: 20, fat: 1, fiber: 2, sugar: 10, salt: 0.1 },
      { calories: 200, protein: 10, carbs: 30, fat: 5, fiber: 3, sugar: 5, salt: 0.2 },
    ];
    const r = sumNutrition(items);
    expect(r.calories).toBe(300);
    expect(r.protein).toBe(15);
    expect(r.carbs).toBe(50);
    expect(r.fat).toBe(6);
    expect(r.fiber).toBe(5);
    expect(r.sugar).toBe(15);
    expect(r.salt).toBeCloseTo(0.3, 5);
  });

  it('ritorna zeri per lista vuota', () => {
    const r = sumNutrition([]);
    expect(r.calories).toBe(0);
    expect(r.protein).toBe(0);
    expect(r.carbs).toBe(0);
    expect(r.fat).toBe(0);
    // fiber/sugar/salt inizializzati a 0 (non undefined) per sum
    expect(r.fiber).toBe(0);
  });

  it('gestisce campi mancanti trattandoli come 0', () => {
    const items: NutritionPer100[] = [
      { calories: 100, protein: 5, carbs: 10, fat: 2 }, // senza fiber/sugar/salt
      { calories: 50, protein: 2, carbs: 5, fat: 1, fiber: 4 },
    ];
    const r = sumNutrition(items);
    expect(r.calories).toBe(150);
    expect(r.protein).toBe(7);
    expect(r.fiber).toBe(4); // 0 + 4
  });
});

describe('calcBMR (Mifflin-St Jeor)', () => {
  it('calcola BMR per uomo adulto', () => {
    // 10 * 80 + 6.25 * 180 - 5 * 30 + 5 = 800 + 1125 - 150 + 5 = 1780
    const bmr = calcBMR(80, 180, 30, 'M' as Sex);
    expect(bmr).toBe(1780);
  });

  it('calcola BMR per donna adulta', () => {
    // 10 * 60 + 6.25 * 165 - 5 * 25 - 161 = 600 + 1031.25 - 125 - 161 = 1345.25 → 1345
    const bmr = calcBMR(60, 165, 25, 'F' as Sex);
    expect(bmr).toBe(1345);
  });

  it('ritorna 0 per input non finiti', () => {
    expect(calcBMR(NaN, 180, 30, 'M' as Sex)).toBe(0);
    expect(calcBMR(80, Infinity, 30, 'F' as Sex)).toBe(0);
  });

  it('ritorna 0 per input <= 0', () => {
    expect(calcBMR(0, 180, 30, 'M' as Sex)).toBe(0);
    expect(calcBMR(80, 0, 30, 'F' as Sex)).toBe(0);
    expect(calcBMR(80, 180, -5, 'M' as Sex)).toBe(0);
  });

  it('non ritorna mai valori negativi', () => {
    // Anche per età estrema, base - 161 potrebbe essere negativo
    // 10*40 + 6.25*150 - 5*100 - 161 = 400 + 937.5 - 500 - 161 = 676.5 → 677 (positivo)
    // Proviamo un caso più estremo: peso 30, altezza 100, età 100
    // 10*30 + 6.25*100 - 5*100 - 161 = 300 + 625 - 500 - 161 = 264
    const bmr = calcBMR(30, 100, 100, 'F' as Sex);
    expect(bmr).toBeGreaterThanOrEqual(0);
  });
});

describe('calcTDEE', () => {
  it('calcola TDEE per BMR 1780 e attività moderata', () => {
    // 1780 * 1.55 = 2759
    const tdee = calcTDEE(1780, 'moderate' as ActivityLevel);
    expect(tdee).toBe(2759);
  });

  it('calcola TDEE per sedentario', () => {
    // 1780 * 1.2 = 2136
    const tdee = calcTDEE(1780, 'sedentary' as ActivityLevel);
    expect(tdee).toBe(2136);
  });

  it('ritorna 0 per BMR non valido', () => {
    expect(calcTDEE(0, 'moderate' as ActivityLevel)).toBe(0);
    expect(calcTDEE(-100, 'sedentary' as ActivityLevel)).toBe(0);
    expect(calcTDEE(NaN, 'active' as ActivityLevel)).toBe(0);
  });

  it('fallback a sedentario per attività sconosciuta', () => {
    // Cast esplicito per simulare un valore invalido da localStorage corrotto.
    // @ts-expect-error — 'super_active' non è un ActivityLevel valido
    const tdee = calcTDEE(1780, 'super_active');
    // Usa fattore sedentario (1.2)
    expect(tdee).toBe(2136);
  });
});

describe('calcWeeksToTarget', () => {
  it('calcola settimane per perdere 5 kg a 0.5 kg/sett', () => {
    // 5 / 0.5 = 10
    expect(calcWeeksToTarget(80, 75, 0.5)).toBe(10);
  });

  it('arrotonda per eccesso (ceil)', () => {
    // 5 / 0.3 = 16.67 → 17
    expect(calcWeeksToTarget(80, 75, 0.3)).toBe(17);
  });

  it('ritorna 0 se già al target', () => {
    expect(calcWeeksToTarget(75, 75, 0.5)).toBe(0);
  });

  it('ritorna 0 per dati mancanti', () => {
    expect(calcWeeksToTarget(undefined, 75, 0.5)).toBe(0);
    expect(calcWeeksToTarget(80, undefined, 0.5)).toBe(0);
    expect(calcWeeksToTarget(80, 75, undefined)).toBe(0);
  });

  it('ritorna 0 per dati non finiti o <= 0', () => {
    expect(calcWeeksToTarget(NaN, 75, 0.5)).toBe(0);
    expect(calcWeeksToTarget(80, 0, 0.5)).toBe(0);
    expect(calcWeeksToTarget(80, 75, 0)).toBe(0);
  });

  it('gestisce obiettivo di aumento (target > current)', () => {
    // Stessa logica: delta assoluto, weeksToTarget è simmetrico
    expect(calcWeeksToTarget(70, 75, 0.5)).toBe(10);
  });
});

describe('calcWeeklyDeltaKg', () => {
  it('ritorna valore negativo per "lose"', () => {
    expect(calcWeeklyDeltaKg(0.5, 'lose' as WeightGoalType)).toBe(-0.5);
  });

  it('ritorna valore positivo per "gain"', () => {
    expect(calcWeeklyDeltaKg(0.5, 'gain' as WeightGoalType)).toBe(0.5);
  });

  it('ritorna 0 per "maintain"', () => {
    expect(calcWeeklyDeltaKg(0.5, 'maintain' as WeightGoalType)).toBe(0);
  });

  it('ritorna 0 per goalType undefined', () => {
    expect(calcWeeklyDeltaKg(0.5, undefined)).toBe(0);
  });

  it('ritorna 0 per rateo non valido', () => {
    expect(calcWeeklyDeltaKg(0, 'lose' as WeightGoalType)).toBe(0);
    expect(calcWeeksToTarget(80, 75, -0.5)).toBe(0);
  });

  it('clampa rateo a MAX_WEEKLY_KG_RATE (0.5)', () => {
    // 1.0 → clampato a 0.5 → -0.5
    expect(calcWeeklyDeltaKg(1.0, 'lose' as WeightGoalType)).toBe(-0.5);
    expect(calcWeeklyDeltaKg(1.0, 'gain' as WeightGoalType)).toBe(0.5);
  });
});

describe('weeklyDeltaToDailyKcal', () => {
  it('converte -0.5 kg/sett in deficit calorico giornaliero', () => {
    // -0.5 * 7700 / 7 = -550
    expect(weeklyDeltaToDailyKcal(-0.5)).toBe(-550);
  });

  it('converte +0.5 kg/sett in surplus calorico giornaliero', () => {
    // 0.5 * 7700 / 7 = 550
    expect(weeklyDeltaToDailyKcal(0.5)).toBe(550);
  });

  it('ritorna 0 per delta 0', () => {
    expect(weeklyDeltaToDailyKcal(0)).toBe(0);
  });

  it('ritorna 0 per delta non finito', () => {
    expect(weeklyDeltaToDailyKcal(NaN)).toBe(0);
    expect(weeklyDeltaToDailyKcal(Infinity)).toBe(0);
  });
});

describe('calcGoalAdjustedCalories', () => {
  it('calcola kcal per obiettivo "lose" con deficit', () => {
    // TDEE 2500, lose 0.5 kg/sett → -550 kcal/giorno → 1950
    const r = calcGoalAdjustedCalories(2500, 80, 75, 0.5, 'lose' as WeightGoalType);
    expect(r.kcal).toBe(1950);
    expect(r.weeklyDeltaKg).toBe(-0.5);
    expect(r.dailyAdjustment).toBe(-550);
    expect(r.weeksToTarget).toBe(10);
    expect(r.totalDeltaKg).toBe(-5);
    expect(r.rateClamped).toBe(false);
    expect(r.kcalClamped).toBe(false);
  });

  it('calcola kcal per obiettivo "gain" con surplus', () => {
    // TDEE 2500, gain 0.5 kg/sett → +550 kcal/giorno → 3050
    const r = calcGoalAdjustedCalories(2500, 70, 75, 0.5, 'gain' as WeightGoalType);
    expect(r.kcal).toBe(3050);
    expect(r.weeklyDeltaKg).toBe(0.5);
    expect(r.dailyAdjustment).toBe(550);
    expect(r.weeksToTarget).toBe(10);
    expect(r.totalDeltaKg).toBe(5);
  });

  it('TDEE + adjustment per "maintain" = TDEE', () => {
    const r = calcGoalAdjustedCalories(2500, 80, 80, 0.5, 'maintain' as WeightGoalType);
    expect(r.kcal).toBe(2500);
    expect(r.weeklyDeltaKg).toBe(0);
    expect(r.dailyAdjustment).toBe(0);
  });

  it('clampa rateo > MAX_WEEKLY_KG_RATE', () => {
    // 1.0 kg/sett → clampato a 0.5
    const r = calcGoalAdjustedCalories(2500, 80, 75, 1.0, 'lose' as WeightGoalType);
    expect(r.rateClamped).toBe(true);
    expect(r.weeklyDeltaKg).toBe(-0.5); // clampato
  });

  it('clampa kcal a range [500, 10000]', () => {
    // TDEE 100, lose 0.5 → 100 - 550 = -450 → clampato a 500
    const r = calcGoalAdjustedCalories(100, 80, 75, 0.5, 'lose' as WeightGoalType);
    expect(r.kcal).toBe(500);
    expect(r.kcalClamped).toBe(true);
  });

  it('ritorna 0 per TDEE non valido', () => {
    const r = calcGoalAdjustedCalories(0, 80, 75, 0.5, 'lose' as WeightGoalType);
    expect(r.kcal).toBe(0);
    expect(r.weeklyDeltaKg).toBe(0);
  });
});

describe('normalizeMacroSplit', () => {
  it('passa attraverso split che somma a 100', () => {
    const split: MacroSplit = { proteinPct: 30, carbsPct: 40, fatPct: 30 };
    const r = normalizeMacroSplit(split);
    expect(r.proteinPct).toBe(30);
    expect(r.carbsPct).toBe(40);
    expect(r.fatPct).toBe(30);
  });

  it('riscala split che non somma a 100', () => {
    // 40 + 40 + 40 = 120 → f = 100/120 = 0.833
    // P = round(40 * 0.833) = 33, C = round(40 * 0.833) = 33, F = 100 - 33 - 33 = 34
    const r = normalizeMacroSplit({ proteinPct: 40, carbsPct: 40, fatPct: 40 });
    expect(r.proteinPct + r.carbsPct + r.fatPct).toBe(100);
  });

  it('clampa negativi a 0 prima di riscalare', () => {
    // -10 + 50 + 50 = 90 → f = 100/90 = 1.111
    // P = round(0 * 1.111) = 0 (clamp -10 → 0), C = round(50 * 1.111) = 56, F = 100 - 0 - 56 = 44
    const r = normalizeMacroSplit({ proteinPct: -10, carbsPct: 50, fatPct: 50 });
    expect(r.proteinPct).toBe(0);
    expect(r.proteinPct + r.carbsPct + r.fatPct).toBe(100);
  });

  it('ritorna default 33/34/33 se somma è 0', () => {
    const r = normalizeMacroSplit({ proteinPct: 0, carbsPct: 0, fatPct: 0 });
    expect(r.proteinPct).toBe(33);
    expect(r.carbsPct).toBe(34);
    expect(r.fatPct).toBe(33);
  });

  it('somma sempre esattamente 100 dopo riscalamento', () => {
    // Test con vari split randomici
    const testCases: MacroSplit[] = [
      { proteinPct: 35, carbsPct: 35, fatPct: 35 },
      { proteinPct: 25, carbsPct: 25, fatPct: 25 },
      { proteinPct: 10, carbsPct: 20, fatPct: 30 },
    ];
    for (const split of testCases) {
      const r = normalizeMacroSplit(split);
      expect(r.proteinPct + r.carbsPct + r.fatPct).toBe(100);
    }
  });
});

describe('kcalFromMacros', () => {
  it('calcola kcal correttamente per macro standard', () => {
    // 150*4 + 200*4 + 67*9 = 600 + 800 + 603 = 2003
    const kcal = kcalFromMacros({ protein: 150, carbs: 200, fat: 67 });
    expect(kcal).toBe(2003);
  });

  it('ritorna 0 per macro tutti a 0', () => {
    expect(kcalFromMacros({ protein: 0, carbs: 0, fat: 0 })).toBe(0);
  });
});

describe('DEFAULT_SETTINGS', () => {
  it('ha valori sensati di default', () => {
    expect(DEFAULT_SETTINGS.calorieGoal).toBe(2000);
    expect(
      DEFAULT_SETTINGS.macroSplit.proteinPct +
        DEFAULT_SETTINGS.macroSplit.carbsPct +
        DEFAULT_SETTINGS.macroSplit.fatPct,
    ).toBe(100);
    expect(DEFAULT_SETTINGS.theme).toBe('system');
  });
});
