// Azioni dominio: biometria giornaliera (acqua / sonno / peso).
// P1 #3 Step 02 "Qualità della vita quotidiana".
//
// Tutto su localStorage nello stesso payload AppState.biometrics (vedi storage.ts).
// Nessun backend, nessuna dipendenza esterna. Calcoli puri testabili.

import type { BiometricEntry, Biometrics } from '../types';
import { getState, setBiometric } from './store';
import { showToast } from '../components/toast';
import { round, isValidDateKey } from './utils';

/** Volume di un bicchiere standard per il quick-add (200 ml = bicchiere medio italiano). */
export const WATER_GLASS_ML = 200;

/** Riferimento visivo per la progress bar dell'acqua; non è un target clinico individuale. */
export const WATER_GOAL_ML = 2500;

/** Range di input validi (defense in depth — l'UI valida già). */
const WATER_ML_MIN = 0;
const WATER_ML_MAX = 20_000;
const SLEEP_HOURS_MIN = 0;
const SLEEP_HOURS_MAX = 24;
const WEIGHT_KG_MIN = 20;
const WEIGHT_KG_MAX = 500;
const MS_PER_DAY = 86_400_000;

// ============ Setters con validazione + toast ============

/** Imposta i millilitri di acqua per una data.
 *  - Valore <= 0 → cancella il campo (azzeramento intenzionale).
 *  - Valore > MAX → clampato al massimo.
 *  - NaN/non finito → toast errore, nessuna modifica. */
export function setWater(date: string, waterMl: number): void {
  if (!isValidDateKey(date)) {
    showToast('Data non valida', 'error');
    return;
  }
  if (!Number.isFinite(waterMl)) {
    showToast('Valore acqua non valido', 'error');
    return;
  }
  if (waterMl <= WATER_ML_MIN) {
    setBiometric(date, { waterMl: undefined });
    return;
  }
  const clamped = Math.min(waterMl, WATER_ML_MAX);
  setBiometric(date, { waterMl: round(clamped, 0) });
}

/** Aggiunge un bicchiere (WATER_GLASS_ML) all'idratazione odierna. */
export function addWaterGlass(date: string): void {
  const current = getState().biometrics[date]?.waterMl ?? 0;
  setWater(date, current + WATER_GLASS_ML);
}

/** Rimuove un bicchiere (non va sotto zero). */
export function removeWaterGlass(date: string): void {
  const current = getState().biometrics[date]?.waterMl ?? 0;
  setWater(date, Math.max(0, current - WATER_GLASS_ML));
}

/** Imposta le ore di sonno per una data.
 *  - Valore <= 0 → cancella il campo.
 *  - Valore > 24 → clampato a 24.
 *  - NaN/non finito → toast errore, nessuna modifica. */
export function setSleep(date: string, sleepHours: number): void {
  if (!isValidDateKey(date)) {
    showToast('Data non valida', 'error');
    return;
  }
  if (!Number.isFinite(sleepHours)) {
    showToast('Valore sonno non valido', 'error');
    return;
  }
  if (sleepHours <= SLEEP_HOURS_MIN) {
    setBiometric(date, { sleepHours: undefined });
    return;
  }
  const clamped = Math.min(sleepHours, SLEEP_HOURS_MAX);
  setBiometric(date, { sleepHours: round(clamped, 1) });
}

/** Imposta il peso corporeo per una data.
 *  - Valore <= 0 → cancella il campo.
 *  - Valore < 20 → toast warning, nessuna modifica.
 *  - Valore > 500 → clampato a 500.
 *  - NaN/non finito → toast errore, nessuna modifica. */
export function setWeight(date: string, weightKg: number): void {
  if (!isValidDateKey(date)) {
    showToast('Data non valida', 'error');
    return;
  }
  if (!Number.isFinite(weightKg)) {
    showToast('Valore peso non valido', 'error');
    return;
  }
  if (weightKg <= 0) {
    setBiometric(date, { weightKg: undefined });
    return;
  }
  if (weightKg < WEIGHT_KG_MIN) {
    showToast(`Peso troppo basso (minimo ${WEIGHT_KG_MIN} kg)`, 'warning');
    return;
  }
  const clamped = Math.min(weightKg, WEIGHT_KG_MAX);
  setBiometric(date, { weightKg: round(clamped, 1) });
}

// ============ Calcoli puri (testabili, no DOM) ============

/** Punto del trend peso: data + valore. */
export interface WeightPoint {
  date: string;
  weightKg: number;
}

/** Estrae i rilevamenti di peso validi ordinati cronologicamente. */
export function computeWeightTrend(biometrics: Biometrics): WeightPoint[] {
  const points: WeightPoint[] = [];
  for (const [date, entry] of Object.entries(biometrics)) {
    if (!isValidDateKey(date)) continue;
    if (entry.weightKg == null || !Number.isFinite(entry.weightKg) || entry.weightKg <= 0) continue;
    points.push({ date, weightKg: entry.weightKg });
  }
  points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return points;
}

/** Converte YYYY-MM-DD in un indice di giorno UTC, indipendente da timezone e DST. */
function dateKeyToEpochDay(date: string): number | null {
  if (!isValidDateKey(date)) return null;
  const [year, month, day] = date.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

/**
 * Media mobile trailing su giorni di calendario.
 *
 * Con `windowDays=7`, ogni punto usa le misurazioni comprese tra il giorno del punto
 * e i 6 giorni precedenti. I giorni senza rilevamento vengono ignorati, non trattati
 * come zero; una misurazione di 7 giorni prima è invece fuori dalla finestra.
 *
 * `points` è atteso in ordine cronologico, come l'output di computeWeightTrend().
 */
export interface WeightTrendPoint extends WeightPoint {
  ma7: number | null;
}

export function computeWeightMovingAverage(points: WeightPoint[], windowDays = 7): WeightTrendPoint[] {
  if (points.length === 0) return [];
  const days = Number.isFinite(windowDays) ? Math.max(1, Math.floor(windowDays)) : 7;
  const out: WeightTrendPoint[] = [];

  for (let i = 0; i < points.length; i++) {
    const currentDay = dateKeyToEpochDay(points[i].date);
    if (currentDay == null) {
      out.push({ ...points[i], ma7: null });
      continue;
    }

    const firstIncludedDay = currentDay - days + 1;
    let sum = 0;
    let count = 0;

    for (let j = i; j >= 0; j--) {
      const pointDay = dateKeyToEpochDay(points[j].date);
      if (pointDay == null) continue;
      if (pointDay < firstIncludedDay) break;
      if (pointDay > currentDay) continue;
      sum += points[j].weightKg;
      count++;
    }

    out.push({ ...points[i], ma7: count > 0 ? round(sum / count, 1) : null });
  }

  return out;
}

/** Estrae il peso più recente registrato nell'intero dataset. */
export function getLatestWeight(biometrics: Biometrics): WeightPoint | null {
  const points = computeWeightTrend(biometrics);
  if (points.length === 0) return null;
  return points[points.length - 1];
}

/**
 * Estrae il peso più recente disponibile alla data richiesta.
 *
 * Questa è l'operazione corretta per una vista storica: un valore registrato
 * dopo `date` non deve influenzare ciò che l'utente vede nel passato.
 */
export function getLatestWeightOnOrBefore(biometrics: Biometrics, date: string): WeightPoint | null {
  if (!isValidDateKey(date)) return null;
  const points = computeWeightTrend(biometrics);
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].date <= date) return points[i];
  }
  return null;
}

/** Helper per la UI: ritorna l'entry biometrica di una data con fallback temporale
 *  per il peso. Se il giorno non contiene un peso, suggerisce soltanto l'ultimo
 *  valore noto registrato in quella data o in una data precedente. */
export function getBiometricForDisplay(
  biometrics: Biometrics,
  date: string,
): BiometricEntry & { weightKgInferred?: boolean } {
  const entry = biometrics[date] ?? {};
  if (entry.weightKg == null) {
    const latest = getLatestWeightOnOrBefore(biometrics, date);
    if (latest) {
      return { ...entry, weightKg: latest.weightKg, weightKgInferred: true };
    }
  }
  return { ...entry, weightKgInferred: false };
}
