// Calcoli nutrizionali puri (no DOM, no side-effect).

import {
  ACTIVITY_FACTORS,
  KCAL_PER_GRAM,
  KCAL_PER_KG_BODYWEIGHT,
  MAX_WEEKLY_KG_RATE,
  type ActivityLevel,
  type MacroSplit,
  type NutritionPer100,
  type Sex,
  type UserSettings,
  type WeightGoalType,
} from '../types';
import { round } from './utils';

/** Macro target in grammi dato il totale calorico e lo split %. */
export function calcMacroGrams(
  calorieGoal: number,
  split: MacroSplit,
): { protein: number; carbs: number; fat: number } {
  if (!Number.isFinite(calorieGoal) || calorieGoal < 0) return { protein: 0, carbs: 0, fat: 0 };
  return {
    protein: Math.round((calorieGoal * split.proteinPct) / 100 / KCAL_PER_GRAM.protein),
    carbs: Math.round((calorieGoal * split.carbsPct) / 100 / KCAL_PER_GRAM.carbs),
    fat: Math.round((calorieGoal * split.fatPct) / 100 / KCAL_PER_GRAM.fat),
  };
}

/** Scala valori per 100g -> quantità in grammi. */
export function scaleNutrition(n: NutritionPer100, grams: number): NutritionPer100 {
  const safeGrams = !Number.isFinite(grams) || grams < 0 ? 0 : grams;
  const factor = safeGrams / 100;
  return {
    calories: round(n.calories * factor, 1),
    protein: round(n.protein * factor, 1),
    carbs: round(n.carbs * factor, 1),
    fat: round(n.fat * factor, 1),
    fiber: n.fiber != null ? round(n.fiber * factor, 1) : undefined,
    sugar: n.sugar != null ? round(n.sugar * factor, 1) : undefined,
    salt: n.salt != null ? round(n.salt * factor, 1) : undefined,
  };
}

/** Somma una lista di NutritionPer100. */
export function sumNutrition(items: NutritionPer100[]): NutritionPer100 {
  const acc: NutritionPer100 = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, salt: 0 };
  let hasFiber = false;
  let hasSugar = false;
  let hasSalt = false;
  for (const item of items) {
    acc.calories += item.calories || 0;
    acc.protein += item.protein || 0;
    acc.carbs += item.carbs || 0;
    acc.fat += item.fat || 0;
    if (item.fiber != null) {
      acc.fiber = (acc.fiber || 0) + item.fiber;
      hasFiber = true;
    }
    if (item.sugar != null) {
      acc.sugar = (acc.sugar || 0) + item.sugar;
      hasSugar = true;
    }
    if (item.salt != null) {
      acc.salt = (acc.salt || 0) + item.salt;
      hasSalt = true;
    }
  }
  return {
    calories: acc.calories,
    protein: acc.protein,
    carbs: acc.carbs,
    fat: acc.fat,
    fiber: hasFiber ? acc.fiber : undefined,
    sugar: hasSugar ? acc.sugar : undefined,
    salt: hasSalt ? acc.salt : undefined,
  };
}

/** Mifflin-St Jeor BMR. Input invalido => 0 (nessuna stima). */
export function calcBMR(weightKg: number, heightCm: number, ageYears: number, sex: Sex): number {
  if (!Number.isFinite(weightKg) || !Number.isFinite(heightCm) || !Number.isFinite(ageYears)) return 0;
  if (weightKg <= 0 || heightCm <= 0 || ageYears <= 0) return 0;
  if (sex !== 'M' && sex !== 'F') return 0;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  return Math.max(0, Math.round(sex === 'M' ? base + 5 : base - 161));
}

/** TDEE = BMR * fattore attività. Input invalido => 0 (nessuna stima). */
export function calcTDEE(bmr: number, activity: ActivityLevel): number {
  const factor = ACTIVITY_FACTORS[activity] ?? ACTIVITY_FACTORS.sedentary;
  if (!Number.isFinite(bmr) || bmr <= 0) return 0;
  return Math.max(0, Math.round(bmr * factor));
}

export function calcWeeksToTarget(
  currentWeightKg: number | undefined,
  targetWeightKg: number | undefined,
  weeklyRateKg: number | undefined,
): number {
  if (currentWeightKg == null || !Number.isFinite(currentWeightKg) || currentWeightKg <= 0) return 0;
  if (targetWeightKg == null || !Number.isFinite(targetWeightKg) || targetWeightKg <= 0) return 0;
  if (weeklyRateKg == null || !Number.isFinite(weeklyRateKg) || weeklyRateKg <= 0) return 0;
  const delta = Math.abs(targetWeightKg - currentWeightKg);
  if (delta < 0.05) return 0;
  return Math.ceil(delta / weeklyRateKg);
}

export function calcWeeklyDeltaKg(weeklyRateKg: number | undefined, goalType: WeightGoalType | undefined): number {
  if (goalType === 'maintain' || goalType == null) return 0;
  if (weeklyRateKg == null || !Number.isFinite(weeklyRateKg) || weeklyRateKg <= 0) return 0;
  const clampedRate = Math.min(MAX_WEEKLY_KG_RATE, weeklyRateKg);
  const sign = goalType === 'gain' ? 1 : -1;
  return round(clampedRate * sign, 3);
}

export function weeklyDeltaToDailyKcal(weeklyDeltaKg: number): number {
  if (!Number.isFinite(weeklyDeltaKg) || weeklyDeltaKg === 0) return 0;
  return Math.round((weeklyDeltaKg * KCAL_PER_KG_BODYWEIGHT) / 7);
}

export interface GoalCaloriesResult {
  /** false significa che non esiste alcuna stima valida da applicare. */
  valid: boolean;
  kcal: number;
  weeklyDeltaKg: number;
  dailyAdjustment: number;
  weeksToTarget: number;
  totalDeltaKg: number;
  rateClamped: boolean;
  /** Clamp tecnico al range configurabile dell'app, non indicazione clinica di sicurezza. */
  kcalClamped: boolean;
}

/**
 * Calcola l'obiettivo calorico aggiustato. Un TDEE invalido NON viene convertito
 * in un target plausibile: ritorna valid=false e kcal=0, che i caller trattano
 * come errore senza modificare l'obiettivo esistente.
 */
export function calcGoalAdjustedCalories(
  tdee: number,
  currentWeightKg: number | undefined,
  targetWeightKg: number | undefined,
  weeklyRateKg: number | undefined,
  goalType: WeightGoalType | undefined,
): GoalCaloriesResult {
  if (!Number.isFinite(tdee) || tdee <= 0) {
    return {
      valid: false,
      kcal: 0,
      weeklyDeltaKg: 0,
      dailyAdjustment: 0,
      weeksToTarget: 0,
      totalDeltaKg: 0,
      rateClamped: false,
      kcalClamped: false,
    };
  }

  const rateClamped = weeklyRateKg != null && Number.isFinite(weeklyRateKg) && weeklyRateKg > MAX_WEEKLY_KG_RATE;
  const weeklyDeltaKg = calcWeeklyDeltaKg(weeklyRateKg, goalType);
  const dailyAdjustment = weeklyDeltaToDailyKcal(weeklyDeltaKg);
  const weeksToTarget = calcWeeksToTarget(currentWeightKg, targetWeightKg, Math.abs(weeklyDeltaKg));
  const totalDeltaKg =
    currentWeightKg != null && targetWeightKg != null ? round(targetWeightKg - currentWeightKg, 1) : 0;
  const raw = tdee + dailyAdjustment;
  const min = 500;
  const max = 10_000;
  const kcalClamped = raw < min || raw > max;
  const kcal = Math.max(min, Math.min(max, Math.round(raw)));
  return {
    valid: true,
    kcal,
    weeklyDeltaKg,
    dailyAdjustment,
    weeksToTarget,
    totalDeltaKg,
    rateClamped,
    kcalClamped,
  };
}

export const DEFAULT_SETTINGS: UserSettings = {
  calorieGoal: 2000,
  macroSplit: { proteinPct: 30, carbsPct: 40, fatPct: 30 },
  theme: 'system',
};

/**
 * Normalizza sempre lo split a somma esattamente 100. Un solo algoritmo evita
 * il precedente caso speciale della tolleranza (es. 60 + 40.2 + 0 = 100.2).
 */
export function normalizeMacroSplit(split: MacroSplit): MacroSplit {
  const finiteNonNegative = (value: number): number => (Number.isFinite(value) ? Math.max(0, value) : 0);
  const protein = finiteNonNegative(split.proteinPct);
  const carbs = finiteNonNegative(split.carbsPct);
  const fat = finiteNonNegative(split.fatPct);
  const sum = protein + carbs + fat;
  if (sum <= 0) return { proteinPct: 33, carbsPct: 34, fatPct: 33 };

  const factor = 100 / sum;
  const proteinPct = round(protein * factor, 1);
  let carbsPct = round(carbs * factor, 1);
  if (proteinPct + carbsPct > 100) carbsPct = Math.max(0, 100 - proteinPct);
  const fatPct = 100 - proteinPct - carbsPct;
  return { proteinPct, carbsPct, fatPct };
}

export function kcalFromMacros(grams: { protein: number; carbs: number; fat: number }): number {
  const protein = Number.isFinite(grams.protein) ? Math.max(0, grams.protein) : 0;
  const carbs = Number.isFinite(grams.carbs) ? Math.max(0, grams.carbs) : 0;
  const fat = Number.isFinite(grams.fat) ? Math.max(0, grams.fat) : 0;
  return Math.round(
    protein * KCAL_PER_GRAM.protein + carbs * KCAL_PER_GRAM.carbs + fat * KCAL_PER_GRAM.fat,
  );
}
