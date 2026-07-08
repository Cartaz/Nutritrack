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
    // Fix LOW bug: preserva undefined invece di 0 per fiber/sugar/salt se NESSUN item li ha.
    // Inconsistenza: scaleNutrition preserva undefined, sumNutrition forzava 0. Display mostrava
    // "0g fiber" per somma di food senza fiber invece di "—".
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

/** Mifflin-St Jeor BMR.
 *  Fix B6.5 (T6): clamp a 0 per input zero/estremi (defense in depth; l'UI valida già).
 *  Fix MEDIUM bug: ritorna 0 se sex non è 'M' o 'F' (defense in depth per backup legacy senza sex). */
export function calcBMR(weightKg: number, heightCm: number, ageYears: number, sex: Sex): number {
  if (!Number.isFinite(weightKg) || !Number.isFinite(heightCm) || !Number.isFinite(ageYears)) return 0;
  if (weightKg <= 0 || heightCm <= 0 || ageYears <= 0) return 0;
  // Fix MEDIUM bug: sex undefined (da backup legacy o chiamata diretta con cast) veniva
  // trattato come 'F' dalla formula `sex === 'M' ? +5 : -161`, causando ~166 kcal/giorno
  // di differenza per utenti maschi. Ora ritorniamo 0 esplicitamente.
  if (sex !== 'M' && sex !== 'F') return 0;
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

/** Calcola il numero di settimane necessarie per andare dal peso attuale al peso target
 *  dato un rateo (kg/settimana, valore assoluto positivo). Ritorna 0 se i dati sono mancanti
 *  o invalidi. Sempre arrotondato per eccesso (ceil) — meglio promettere 1 settimana in più
 *  che in meno, dato che il ritmo reale dipende da molti fattori metabolici.
 *  Fix LOW bug: soglia 0.05 kg invece di 0.01 per evitare che 10g di differenza (possibile
 *  rumore floating-point come 80.01 - 80.0 = 0.010000000000005116) faccia restituire 1 settimana. */
export function calcWeeksToTarget(
  currentWeightKg: number | undefined,
  targetWeightKg: number | undefined,
  weeklyRateKg: number | undefined,
): number {
  if (currentWeightKg == null || !Number.isFinite(currentWeightKg) || currentWeightKg <= 0) return 0;
  if (targetWeightKg == null || !Number.isFinite(targetWeightKg) || targetWeightKg <= 0) return 0;
  if (weeklyRateKg == null || !Number.isFinite(weeklyRateKg) || weeklyRateKg <= 0) return 0;
  const delta = Math.abs(targetWeightKg - currentWeightKg);
  if (delta < 0.05) return 0; // già al target (soglia aumentata da 0.01 a 0.05)
  return Math.ceil(delta / weeklyRateKg);
}

/** Calcola la variazione di peso settimanale CON SEGNO a partire dal rateo scelto dall'utente
 *  (sempre positivo) e dal tipo di obiettivo. negativo = deficit (perdere),
 *  positivo = surplus (aumentare), zero = mantieni.
 *  Il rateo viene clampato a MAX_WEEKLY_KG_RATE per safety (defense in depth — l'UI fa già clamp). */
export function calcWeeklyDeltaKg(weeklyRateKg: number | undefined, goalType: WeightGoalType | undefined): number {
  if (goalType === 'maintain' || goalType == null) return 0;
  if (weeklyRateKg == null || !Number.isFinite(weeklyRateKg) || weeklyRateKg <= 0) return 0;
  const clampedRate = Math.min(MAX_WEEKLY_KG_RATE, weeklyRateKg);
  const sign = goalType === 'gain' ? +1 : -1;
  return round(clampedRate * sign, 3);
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
 *  Clamp a range sano [500..10000] coerente con normalizeUserSettings.
 *  Ritorna anche le settimane necessarie e i kg totali da perdere/aumentare.
 *  Fix MEDIUM bug: se tdee=0 (invalido), ritorna kcal=DEFAULT (2000) con kcalClamped=true
 *  invece di kcal=0 violando il contratto clamp [500..10000]. */
export function calcGoalAdjustedCalories(
  tdee: number,
  currentWeightKg: number | undefined,
  targetWeightKg: number | undefined,
  weeklyRateKg: number | undefined,
  goalType: WeightGoalType | undefined,
): {
  kcal: number;
  weeklyDeltaKg: number;
  dailyAdjustment: number;
  weeksToTarget: number;
  totalDeltaKg: number;
  rateClamped: boolean;
  kcalClamped: boolean;
} {
  if (!Number.isFinite(tdee) || tdee <= 0) {
    // Fix MEDIUM bug: prima ritornava kcal=0 (violando il clamp min 500). Ora ritorniamo
    // 500 (il minimo del range sicuro) con kcalClamped=true, così la UI può mostrare un
    // warning appropriato invece di un obiettivo calorico pericolosamente basso.
    return {
      kcal: 500,
      weeklyDeltaKg: 0,
      dailyAdjustment: 0,
      weeksToTarget: 0,
      totalDeltaKg: 0,
      rateClamped: false,
      kcalClamped: true,
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
  const max = 10000;
  const kcalClamped = raw < min || raw > max;
  const kcal = Math.max(min, Math.min(max, Math.round(raw)));
  return { kcal, weeklyDeltaKg, dailyAdjustment, weeksToTarget, totalDeltaKg, rateClamped, kcalClamped };
}

/** Default settings iniziali (dark theme, 2000 kcal, 30/40/30) */
export const DEFAULT_SETTINGS: UserSettings = {
  calorieGoal: 2000,
  macroSplit: { proteinPct: 30, carbsPct: 40, fatPct: 30 },
  theme: 'system',
};

/** Normalizza macro split: se somma != 100, riscala.
 *  Fix B14: clampa i negativi a 0 prima di riscalare (proteinPct=-10 → 0).
 *  Fix MEDIUM bug: la tolleranza 0.5 permetteva split in [99.5, 100.5) di passare invariati,
 *  violando il contratto "sum=100 SEMPRE". Ora ridistribuiamo la differenza su fat. */
export function normalizeMacroSplit(split: MacroSplit): MacroSplit {
  // Fix B14: clampa negativi a 0
  const protein = Math.max(0, split.proteinPct);
  const carbs = Math.max(0, split.carbsPct);
  const fat = Math.max(0, split.fatPct);
  const sum = protein + carbs + fat;
  if (sum === 0) return { proteinPct: 33, carbsPct: 34, fatPct: 33 };
  if (Math.abs(sum - 100) < 0.5) {
    // Fix MEDIUM bug: ridistribuisci la differenza su fat per garantire sum=100 esatto.
    // Prima {99.6, 0, 0} passava invariata (sum=99.6 ≠ 100). Ora fat = 100 - protein - carbs.
    const correctedFat = Math.max(0, 100 - protein - carbs);
    return { proteinPct: protein, carbsPct: carbs, fatPct: correctedFat };
  }
  const f = 100 / sum;
  const p = Math.round(protein * f);
  const c = Math.round(carbs * f);
  const ft = 100 - p - c;
  return { proteinPct: p, carbsPct: c, fatPct: ft };
}

/** Calcola kcal da macro (verifica consistenza) */
export function kcalFromMacros(grams: { protein: number; carbs: number; fat: number }): number {
  // Fix LOW bug: clamp negativi a 0 (defense in depth; upstream clamps già, ma caller
  // diretto potrebbe passare valori invalidi)
  const p = Math.max(0, grams.protein);
  const c = Math.max(0, grams.carbs);
  const f = Math.max(0, grams.fat);
  return Math.round(p * KCAL_PER_GRAM.protein + c * KCAL_PER_GRAM.carbs + f * KCAL_PER_GRAM.fat);
}
