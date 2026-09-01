// Calcoli nutrizionali puri (no DOM, no side-effect).

import {
  KCAL_PER_GRAM,
  type MacroSplit,
  type NutritionPer100,
  type Sex,
  type ActivityLevel,
  type UserSettings,
  type WeightGoalType,
} from '../types';
import { ACTIVITY_FACTORS, MAX_WEEKLY_KG_RATE, KCAL_PER_KG_BODYWEIGHT } from '../types';
import { round } from './utils';

/** Macro target in grammi dato il totale calorico e lo split % */
export function calcMacroGrams(
  calorieGoal: number,
  split: MacroSplit,
): { protein: number; carbs: number; fat: number } {
  // Fix B6.8 (T6): distribuisci l'errore di arrotondamento sul grasso (il macro con più kcal/g)
  // per minimizzare lo scostamento totale. Prima: P=150, C=200, F=67 → 2003 kcal (off by 3).
  // Ora: P=150, C=200, F=round((2000 - 150*4 - 200*4) / 9) = round(66.67) = 67 → 2003.
  // Per differenze piccole (<5 kcal) è accettabile; lasciamo il round standard.
  // Fix LOW bug: guard per calorieGoal negativo/NaN/Infinity (defense in depth)
  if (!Number.isFinite(calorieGoal) || calorieGoal < 0) {
    return { protein: 0, carbs: 0, fat: 0 };
  }
  return {
    protein: Math.round((calorieGoal * split.proteinPct) / 100 / KCAL_PER_GRAM.protein),
    carbs: Math.round((calorieGoal * split.carbsPct) / 100 / KCAL_PER_GRAM.carbs),
    fat: Math.round((calorieGoal * split.fatPct) / 100 / KCAL_PER_GRAM.fat),
  };
}

/** Scala valori per 100g -> quantita in grammi */
export function scaleNutrition(n: NutritionPer100, grams: number): NutritionPer100 {
  // Fix LOW bug: guard per grams negativo (defense in depth; l'UI valida già, ma un caller
  // diretto potrebbe passare valori invalidi). NaN/Infinity sono già sanitizzati da round().
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

/** Somma una lista di NutritionPer100 */
export function sumNutrition(items: NutritionPer100[]): NutritionPer100 {
  const acc: NutritionPer100 = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, salt: 0 };
  let hasFiber = false;
  let hasSugar = false;
  let hasSalt = false;
  for (const it of items) {
    acc.calories += it.calories || 0;
    acc.protein += it.protein || 0;
    acc.carbs += it.carbs || 0;
    acc.fat += it.fat || 0;
    // Preserva undefined invece di 0 per fiber/sugar/salt se nessun item li ha.
    if (it.fiber != null) {
      acc.fiber = (acc.fiber || 0) + it.fiber;
      hasFiber = true;
    }
    if (it.sugar != null) {
      acc.sugar = (acc.sugar || 0) + it.sugar;
      hasSugar = true;
    }
    if (it.salt != null) {
      acc.salt = (acc.salt || 0) + it.salt;
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

/** Mifflin-St Jeor BMR. */
export function calcBMR(weightKg: number, heightCm: number, ageYears: number, sex: Sex): number {
  if (!Number.isFinite(weightKg) || !Number.isFinite(heightCm) || !Number.isFinite(ageYears)) return 0;
  if (weightKg <= 0 || heightCm <= 0 || ageYears <= 0) return 0;
  if (sex !== 'M' && sex !== 'F') return 0;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  const raw = sex === 'M' ? base + 5 : base - 161;
  return Math.max(0, Math.round(raw));
}

/** TDEE = BMR * fattore attività. */
export function calcTDEE(bmr: number, activity: ActivityLevel): number {
  const factor = ACTIVITY_FACTORS[activity] ?? ACTIVITY_FACTORS.sedentary;
  if (!Number.isFinite(bmr) || bmr <= 0) return 0;
  return Math.max(0, Math.round(bmr * factor));
}

/** Calcola il numero di settimane necessarie per andare dal peso attuale al peso target
 *  dato un rateo (kg/settimana, valore assoluto positivo). Ritorna 0 se i dati sono mancanti
 *  o invalidi. La stima è lineare e non modella adattamenti fisiologici nel tempo. */
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

/** Calcola la variazione di peso settimanale CON SEGNO a partire dal rateo scelto dall'utente
 *  (sempre positivo) e dal tipo di obiettivo. negativo = deficit (perdere),
 *  positivo = surplus (aumentare), zero = mantieni.
 *  Il rateo viene clampato a MAX_WEEKLY_KG_RATE come limite applicativo. */
export function calcWeeklyDeltaKg(weeklyRateKg: number | undefined, goalType: WeightGoalType | undefined): number {
  if (goalType === 'maintain' || goalType == null) return 0;
  if (weeklyRateKg == null || !Number.isFinite(weeklyRateKg) || weeklyRateKg <= 0) return 0;
  const clampedRate = Math.min(MAX_WEEKLY_KG_RATE, weeklyRateKg);
  const sign = goalType === 'gain' ? +1 : -1;
  return round(clampedRate * sign, 3);
}

/** Converte un rateo di variazione peso (kg/settimana, con segno) in adjustment calorico
 *  giornaliero (kcal/giorno, con segno). È una stima lineare semplificata. */
export function weeklyDeltaToDailyKcal(weeklyDeltaKg: number): number {
  if (!Number.isFinite(weeklyDeltaKg) || weeklyDeltaKg === 0) return 0;
  return Math.round((weeklyDeltaKg * KCAL_PER_KG_BODYWEIGHT) / 7);
}

export interface EstimatedGoalCalories {
  status: 'estimated';
  kcal: number;
  weeklyDeltaKg: number;
  dailyAdjustment: number;
  weeksToTarget: number;
  totalDeltaKg: number;
  rateClamped: boolean;
}

export interface InvalidGoalCalories {
  status: 'invalid';
  reason: 'invalid_tdee';
}

/** Risultato della sola stima matematica. Non incorpora decisioni su cosa l'app possa applicare. */
export type GoalCalorieEstimate = EstimatedGoalCalories | InvalidGoalCalories;

/**
 * Limiti di applicazione automatica, separati dalla formula.
 *
 * Il limite inferiore segue il comportamento del NIH/NIDDK Body Weight Planner, che rifiuta
 * target sotto 1000 kcal/giorno invece di clampare il risultato. È una policy prudenziale
 * del prodotto, non una soglia clinica personalizzata. Fonte mantenuta in
 * docs/sources/goal-calorie-policy.md.
 *
 * Il limite superiore è soltanto il range tecnico attualmente supportato dall'app.
 */
export const AUTOMATIC_CALORIE_MIN_KCAL = 1000;
export const AUTOMATIC_CALORIE_MAX_KCAL = 10_000;

export type AutomaticCalorieGoalAssessment =
  | { status: 'accepted'; estimate: EstimatedGoalCalories }
  | {
      status: 'blocked';
      reason: 'below_automatic_minimum' | 'above_app_limit';
      estimate: EstimatedGoalCalories;
      limitKcal: number;
    }
  | { status: 'invalid'; reason: InvalidGoalCalories['reason'] };

/**
 * Calcola la stima calorica senza clampare il risultato a un valore plausibile.
 *
 * Un TDEE invalido produce un risultato discriminato `invalid`, non 0/500/2000 kcal.
 * Per input validi `kcal` è il risultato matematico arrotondato: può essere fuori dal range
 * applicabile e deve essere valutato separatamente con assessAutomaticCalorieGoal().
 */
export function calcGoalAdjustedCalories(
  tdee: number,
  currentWeightKg: number | undefined,
  targetWeightKg: number | undefined,
  weeklyRateKg: number | undefined,
  goalType: WeightGoalType | undefined,
): GoalCalorieEstimate {
  if (!Number.isFinite(tdee) || tdee <= 0) {
    return { status: 'invalid', reason: 'invalid_tdee' };
  }

  const rateClamped = weeklyRateKg != null && Number.isFinite(weeklyRateKg) && weeklyRateKg > MAX_WEEKLY_KG_RATE;
  const weeklyDeltaKg = calcWeeklyDeltaKg(weeklyRateKg, goalType);
  const dailyAdjustment = weeklyDeltaToDailyKcal(weeklyDeltaKg);
  const weeksToTarget = calcWeeksToTarget(currentWeightKg, targetWeightKg, Math.abs(weeklyDeltaKg));
  const totalDeltaKg =
    currentWeightKg != null && targetWeightKg != null ? round(targetWeightKg - currentWeightKg, 1) : 0;

  return {
    status: 'estimated',
    kcal: Math.round(tdee + dailyAdjustment),
    weeklyDeltaKg,
    dailyAdjustment,
    weeksToTarget,
    totalDeltaKg,
    rateClamped,
  };
}

/** Decide se NutriTrack può applicare automaticamente una stima già calcolata. */
export function assessAutomaticCalorieGoal(estimate: GoalCalorieEstimate): AutomaticCalorieGoalAssessment {
  if (estimate.status === 'invalid') {
    return { status: 'invalid', reason: estimate.reason };
  }
  if (estimate.kcal < AUTOMATIC_CALORIE_MIN_KCAL) {
    return {
      status: 'blocked',
      reason: 'below_automatic_minimum',
      estimate,
      limitKcal: AUTOMATIC_CALORIE_MIN_KCAL,
    };
  }
  if (estimate.kcal > AUTOMATIC_CALORIE_MAX_KCAL) {
    return {
      status: 'blocked',
      reason: 'above_app_limit',
      estimate,
      limitKcal: AUTOMATIC_CALORIE_MAX_KCAL,
    };
  }
  return { status: 'accepted', estimate };
}

/** Default settings iniziali (system theme, 2000 kcal, 30/40/30) */
export const DEFAULT_SETTINGS: UserSettings = {
  calorieGoal: 2000,
  macroSplit: { proteinPct: 30, carbsPct: 40, fatPct: 30 },
  theme: 'system',
};

/**
 * Normalizza lo split macro garantendo una somma di 100.
 *
 * Per piccoli errori di input (<0.5 punti percentuali) preserva il più possibile
 * i valori scelti: un deficit viene assorbito dal grasso, mentre un eccesso viene
 * sottratto dal componente più grande. Per scostamenti maggiori riscala l'intero
 * vettore e arrotonda a percentuali intere, come faceva il comportamento storico.
 */
export function normalizeMacroSplit(split: MacroSplit): MacroSplit {
  const protein = Math.max(0, split.proteinPct);
  const carbs = Math.max(0, split.carbsPct);
  const fat = Math.max(0, split.fatPct);
  const sum = protein + carbs + fat;
  if (sum === 0) return { proteinPct: 33, carbsPct: 34, fatPct: 33 };

  const delta = 100 - sum;
  if (Math.abs(delta) < 0.5) {
    if (delta >= 0) {
      return { proteinPct: protein, carbsPct: carbs, fatPct: fat + delta };
    }

    const excess = -delta;
    if (protein >= carbs && protein >= fat) {
      return { proteinPct: protein - excess, carbsPct: carbs, fatPct: fat };
    }
    if (carbs >= fat) {
      return { proteinPct: protein, carbsPct: carbs - excess, fatPct: fat };
    }
    return { proteinPct: protein, carbsPct: carbs, fatPct: fat - excess };
  }

  const factor = 100 / sum;
  const p = Math.round(protein * factor);
  const c = Math.round(carbs * factor);
  const f = 100 - p - c;
  return { proteinPct: p, carbsPct: c, fatPct: f };
}

/** Calcola kcal da macro (verifica consistenza) */
export function kcalFromMacros(grams: { protein: number; carbs: number; fat: number }): number {
  const p = Math.max(0, grams.protein);
  const c = Math.max(0, grams.carbs);
  const f = Math.max(0, grams.fat);
  return Math.round(p * KCAL_PER_GRAM.protein + c * KCAL_PER_GRAM.carbs + f * KCAL_PER_GRAM.fat);
}
