// Calcoli nutrizionali puri (no DOM, no side-effect).

import { KCAL_PER_GRAM, type MacroSplit, type NutritionPer100, type Sex, type ActivityLevel, type UserSettings } from '../types';
import { ACTIVITY_FACTORS } from '../types';
import { round } from './utils';

/** Macro target in grammi dato il totale calorico e lo split % */
export function calcMacroGrams(calorieGoal: number, split: MacroSplit): { protein: number; carbs: number; fat: number } {
  return {
    protein: Math.round((calorieGoal * split.proteinPct / 100) / KCAL_PER_GRAM.protein),
    carbs:   Math.round((calorieGoal * split.carbsPct   / 100) / KCAL_PER_GRAM.carbs),
    fat:     Math.round((calorieGoal * split.fatPct     / 100) / KCAL_PER_GRAM.fat),
  };
}

/** Scala valori per 100g -> quantita in grammi */
export function scaleNutrition(n: NutritionPer100, grams: number): NutritionPer100 {
  const factor = grams / 100;
  return {
    calories: round(n.calories * factor, 1),
    protein:  round(n.protein  * factor, 1),
    carbs:    round(n.carbs    * factor, 1),
    fat:      round(n.fat      * factor, 1),
    fiber:    n.fiber != null ? round(n.fiber * factor, 1) : undefined,
    sugar:    n.sugar != null ? round(n.sugar * factor, 1) : undefined,
    salt:     n.salt  != null ? round(n.salt  * factor, 1) : undefined,
  };
}

/** Somma una lista di NutritionPer100 */
export function sumNutrition(items: NutritionPer100[]): NutritionPer100 {
  const acc: NutritionPer100 = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, salt: 0 };
  for (const it of items) {
    acc.calories += it.calories || 0;
    acc.protein  += it.protein  || 0;
    acc.carbs    += it.carbs    || 0;
    acc.fat      += it.fat      || 0;
    acc.fiber = (acc.fiber || 0) + (it.fiber || 0);
    acc.sugar = (acc.sugar || 0) + (it.sugar || 0);
    acc.salt  = (acc.salt  || 0) + (it.salt  || 0);
  }
  return acc;
}

/** Mifflin-St Jeor BMR */
export function calcBMR(weightKg: number, heightCm: number, ageYears: number, sex: Sex): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  return sex === 'M' ? Math.round(base + 5) : Math.round(base - 161);
}

/** TDEE = BMR * fattore attività */
export function calcTDEE(bmr: number, activity: ActivityLevel): number {
  return Math.round(bmr * ACTIVITY_FACTORS[activity]);
}

/** Default settings iniziali (dark theme, 2000 kcal, 30/40/30) */
export const DEFAULT_SETTINGS: UserSettings = {
  calorieGoal: 2000,
  macroSplit: { proteinPct: 30, carbsPct: 40, fatPct: 30 },
  theme: 'system',
};

/** Normalizza macro split: se somma != 100, riscala.
 *  Fix B14: clampa i negativi a 0 prima di riscalare (proteinPct=-10 → 0).
 */
export function normalizeMacroSplit(split: MacroSplit): MacroSplit {
  // Fix B14: clampa negativi a 0
  const protein = Math.max(0, split.proteinPct);
  const carbs = Math.max(0, split.carbsPct);
  const fat = Math.max(0, split.fatPct);
  const sum = protein + carbs + fat;
  if (sum === 0) return { proteinPct: 33, carbsPct: 34, fatPct: 33 };
  if (Math.abs(sum - 100) < 0.5) return { proteinPct: protein, carbsPct: carbs, fatPct: fat };
  const f = 100 / sum;
  const p = Math.round(protein * f);
  const c = Math.round(carbs * f);
  const ft = 100 - p - c;
  return { proteinPct: p, carbsPct: c, fatPct: ft };
}

/** Calcola kcal da macro (verifica consistenza) */
export function kcalFromMacros(grams: { protein: number; carbs: number; fat: number }): number {
  return Math.round(
    grams.protein * KCAL_PER_GRAM.protein +
    grams.carbs   * KCAL_PER_GRAM.carbs +
    grams.fat     * KCAL_PER_GRAM.fat
  );
}
