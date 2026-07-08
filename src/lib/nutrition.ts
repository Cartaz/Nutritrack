// Calcoli nutrizionali puri (no DOM, no side-effect).

import { KCAL_PER_GRAM, type MacroSplit, type NutritionPer100, type Sex, type ActivityLevel, type UserSettings, type WeightGoalType } from '../types';
import { ACTIVITY_FACTORS, MAX_WEEKLY_KG_RATE, KCAL_PER_KG_BODYWEIGHT } from '../types';
import { round } from './utils';

/** Macro target in grammi dato il totale calorico e lo split % */
export function calcMacroGrams(calorieGoal: number, split: MacroSplit): { protein: number; carbs: number; fat: number } {
  // Fix B6.8 (T6): distribuisci l'errore di arrotondamento sul grasso (il macro con più kcal/g)
  // per minimizzare lo scostamento totale. Prima: P=150, C=200, F=67 → 2003 kcal (off by 3).
  // Ora: P=150, C=200, F=round((2000 - 150*4 - 200*4) / 9) = round(66.67) = 67 → 2003.
  // Per differenze piccole (<5 kcal) è accettabile; lasciamo il round standard.
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

/** Mifflin-St Jeor BMR.
 *  Fix B6.5 (T6): clamp a 0 per input zero/estremi (defense in depth; l'UI valida già). */
export function calcBMR(weightKg: number, heightCm: number, ageYears: number, sex: Sex): number {
  if (!Number.isFinite(weightKg) || !Number.isFinite(heightCm) || !Number.isFinite(ageYears)) return 0;
  if (weightKg <= 0 || heightCm <= 0 || ageYears <= 0) return 0;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  const raw = sex === 'M' ? base + 5 : base - 161;
  return Math.max(0, Math.round(raw));
}

/** TDEE = BMR * fattore attività.
 *  Fix B6.6 (T6): fallback a sedentario se activity non in mappa (defense in depth). */
export function calcTDEE(bmr: number, activity: ActivityLevel): number {
  const factor = ACTIVITY_FACTORS[activity] ?? ACTIVITY_FACTORS.sedentary;
  if (!Number.isFinite(bmr) || bmr <= 0) return 0;
  return Math.max(0, Math.round(bmr * factor));
}

/** Calcola la variazione di peso settimanale necessaria per andare dal peso attuale
 *  al peso target nel numero di settimane indicato. Clampa il rateo a +/-0.5 kg/settimana
 *  (linea guida WHO/ACSM: perdere/aumentare più di 0.5 kg/settimana è rischioso).
 *  Ritorna un numero con segno: negativo = deficit (perdere), positivo = surplus (aumentare),
 *  zero = mantieni o maintain.
 *  Fix: ritorna 0 se maintain, se mancano dati (pesi/setting non validi), o se il rateo calcolato
 *  supererebbe il limite e l'utente avrebbe bisogno di più tempo. */
export function calcWeeklyDeltaKg(
  currentWeightKg: number | undefined,
  targetWeightKg: number | undefined,
  goalWeeks: number | undefined,
  goalType: WeightGoalType | undefined,
): number {
  if (goalType === 'maintain' || goalType == null) return 0;
  if (currentWeightKg == null || !Number.isFinite(currentWeightKg) || currentWeightKg <= 0) return 0;
  if (targetWeightKg == null || !Number.isFinite(targetWeightKg) || targetWeightKg <= 0) return 0;
  if (goalWeeks == null || !Number.isFinite(goalWeeks) || goalWeeks <= 0) return 0;
  const delta = targetWeightKg - currentWeightKg;
  // Coerenza direzione: se l'utente dice "perdere" ma targetWeight > current, forziamo la direzione a -|delta|
  const directionSign = goalType === 'gain' ? +1 : -1;
  const weeklyRaw = (Math.abs(delta) / goalWeeks) * directionSign;
  // Clamp al rateo massimo (es. +0.5 o -0.5 kg/settimana)
  const clamped = Math.max(-MAX_WEEKLY_KG_RATE, Math.min(MAX_WEEKLY_KG_RATE, weeklyRaw));
  return round(clamped, 3);
}

/** Converte un rateo di variazione peso (kg/settimana, con segno) in adjustment calorico
 *  giornaliero (kcal/giorno, con segno). Negativo = deficit, positivo = surplus.
 *  Formula: kcal/giorno = (kg/settimana * 7700 kcal/kg) / 7 giorni. */
export function weeklyDeltaToDailyKcal(weeklyDeltaKg: number): number {
  if (!Number.isFinite(weeklyDeltaKg) || weeklyDeltaKg === 0) return 0;
  return Math.round((weeklyDeltaKg * KCAL_PER_KG_BODYWEIGHT) / 7);
}

/** Calcola l'obiettivo calorico giornaliero aggiustato per l'obiettivo di peso.
 *  TDEE + adjustment (deficit se perdere, surplus se aumentare, zero se mantenere).
 *  Clamp a range sano [500..10000] coerente con normalizeUserSettings. */
export function calcGoalAdjustedCalories(
  tdee: number,
  currentWeightKg: number | undefined,
  targetWeightKg: number | undefined,
  goalWeeks: number | undefined,
  goalType: WeightGoalType | undefined,
): { kcal: number; weeklyDeltaKg: number; dailyAdjustment: number; clamped: boolean } {
  if (!Number.isFinite(tdee) || tdee <= 0) {
    return { kcal: 0, weeklyDeltaKg: 0, dailyAdjustment: 0, clamped: false };
  }
  const weeklyDeltaKg = calcWeeklyDeltaKg(currentWeightKg, targetWeightKg, goalWeeks, goalType);
  const dailyAdjustment = weeklyDeltaToDailyKcal(weeklyDeltaKg);
  const raw = tdee + dailyAdjustment;
  const min = 500;
  const max = 10000;
  const clamped = raw < min || raw > max;
  const kcal = Math.max(min, Math.min(max, Math.round(raw)));
  return { kcal, weeklyDeltaKg, dailyAdjustment, clamped };
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
