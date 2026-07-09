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

/** Obiettivo idratazione giornaliero di riferimento (EFSA: 2.5 L per uomini, 2 L donne).
 *  Usato solo come riferimento visivo (progress bar), non come hard target. */
export const WATER_GOAL_ML = 2500;

/** Range di input validi (defense in depth — l'UI valida già). */
const WATER_ML_MIN = 0;
const WATER_ML_MAX = 20_000;
const SLEEP_HOURS_MIN = 0;
const SLEEP_HOURS_MAX = 24;
const WEIGHT_KG_MIN = 20;
const WEIGHT_KG_MAX = 500;

// ============ Setters con validazione + toast ============

/** Imposta i millilitri di acqua per una data.
 *  - Valore <= 0 → cancella il campo (azzeramento intenzionale).
 *  - Valore > MAX → clampato al massimo (hai bevuto tanto, cap a 20 L).
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
 *  - Valore < 20 (sotto il minimo realistico) → toast warning, nessuna modifica
 *    (NON clampiamo silenziosamente a 20: sarebbe fuorviante).
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

/** Media mobile centrata su 7 giorni: per ogni punto con dati, media il valore
 *  del punto stesso con i precedenti (fino a 6) per un massimo di 7 giorni.
 *  Usiamo una media mobile "trailing" (guarda indietro) invece che centrata,
 *  perché per un trend personale ha senso confrontare il valore odierno con la
 *  media degli ultimi 7 giorni, non con giorni futuri che non sono ancora accaduti.
 *
 *  Giorni senza peso registrato vengono saltati (non conteggiati come 0):
 *  la media mobile viene calcolata solo sui giorni che hanno effettivamente un valore,
 *  raggruppando su una finestra di 7 punti temporali consecutivi con dato. */
export function computeWeightTrend(biometrics: Biometrics): WeightPoint[] {
  const points: WeightPoint[] = [];
  for (const [date, entry] of Object.entries(biometrics)) {
    if (!isValidDateKey(date)) continue;
    if (entry.weightKg == null || !Number.isFinite(entry.weightKg) || entry.weightKg <= 0) continue;
    points.push({ date, weightKg: entry.weightKg });
  }
  // Ordina cronologicamente per data
  points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return points;
}

/** Calcola la media mobile a 7 giorni (trailing) sul trend peso.
 *  Ritorna un array allineato a computeWeightTrend: ogni elemento ha
 *  { date, weightKg (grezzo), ma7 (media mobile) }.
 *  Se ci sono meno di 7 punti, la media è sulla disponibilità (min 1 punto). */
export interface WeightTrendPoint extends WeightPoint {
  ma7: number | null; // null se nessun punto disponibile (non dovrebbe accadere qui)
}

export function computeWeightMovingAverage(points: WeightPoint[], window = 7): WeightTrendPoint[] {
  if (points.length === 0) return [];
  const w = Math.max(1, window);
  const out: WeightTrendPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    const start = Math.max(0, i - w + 1);
    const slice = points.slice(start, i + 1);
    const sum = slice.reduce((acc, p) => acc + p.weightKg, 0);
    const ma = sum / slice.length;
    out.push({ ...points[i], ma7: round(ma, 1) });
  }
  return out;
}

/** Estrae il peso più recente registrato (utile per pre-compilare l'input odierno
 *  con l'ultimo valore noto, dato che il peso varia lentamente). */
export function getLatestWeight(biometrics: Biometrics): WeightPoint | null {
  const points = computeWeightTrend(biometrics);
  if (points.length === 0) return null;
  return points[points.length - 1];
}

/** Helper per la UI: ritorna l'entry biometrica di una data con fallback intelligente
 *  per il peso (precompila con l'ultimo valore noto se la data odierna non ne ha). */
export function getBiometricForDisplay(
  biometrics: Biometrics,
  date: string,
): BiometricEntry & { weightKgInferred?: boolean } {
  const entry = biometrics[date] ?? {};
  // Se manca il peso odierno, suggerisci l'ultimo noto (l'utente può confermare)
  if (entry.weightKg == null) {
    const latest = getLatestWeight(biometrics);
    if (latest && latest.date !== date) {
      return { ...entry, weightKg: latest.weightKg, weightKgInferred: true };
    }
  }
  return { ...entry, weightKgInferred: false };
}
