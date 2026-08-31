// Azioni dominio: biometria giornaliera (acqua / sonno / peso).

import type { BiometricEntry, Biometrics } from '../types';
import { getState, setBiometric } from './store';
import { showToast } from '../components/toast';
import { isValidDateKey, round } from './utils';

export const WATER_GLASS_ML = 200;
/** Riferimento puramente visuale dell'interfaccia, non prescrizione individuale. */
export const WATER_GOAL_ML = 2500;

const WATER_ML_MIN = 0;
const WATER_ML_MAX = 20_000;
const SLEEP_HOURS_MIN = 0;
const SLEEP_HOURS_MAX = 24;
const WEIGHT_KG_MIN = 20;
const WEIGHT_KG_MAX = 500;

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
  setBiometric(date, { waterMl: round(Math.min(waterMl, WATER_ML_MAX), 0) });
}

export function addWaterGlass(date: string): void {
  setWater(date, (getState().biometrics[date]?.waterMl ?? 0) + WATER_GLASS_ML);
}

export function removeWaterGlass(date: string): void {
  setWater(date, Math.max(0, (getState().biometrics[date]?.waterMl ?? 0) - WATER_GLASS_ML));
}

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
  setBiometric(date, { sleepHours: round(Math.min(sleepHours, SLEEP_HOURS_MAX), 1) });
}

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
  setBiometric(date, { weightKg: round(Math.min(weightKg, WEIGHT_KG_MAX), 1) });
}

// ============ Calcoli puri ============

export interface WeightPoint {
  date: string;
  weightKg: number;
}

export interface WeightTrendPoint extends WeightPoint {
  ma7: number | null;
}

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

function dateOrdinal(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

/**
 * Media mobile trailing su giorni di calendario. `window=7` significa il giorno
 * corrente + i sei giorni precedenti; giorni senza misura vengono semplicemente
 * esclusi dalla media, non trasformati in zero.
 */
export function computeWeightMovingAverage(points: WeightPoint[], window = 7): WeightTrendPoint[] {
  if (points.length === 0) return [];
  const windowDays = Math.max(1, Math.floor(window));
  const sorted = [...points].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return sorted.map((point, index) => {
    const currentDay = dateOrdinal(point.date);
    const minDay = currentDay - windowDays + 1;
    const values: number[] = [];
    for (let i = index; i >= 0; i--) {
      const candidate = sorted[i];
      if (dateOrdinal(candidate.date) < minDay) break;
      values.push(candidate.weightKg);
    }
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    return { ...point, ma7: round(average, 1) };
  });
}

export function getLatestWeight(biometrics: Biometrics): WeightPoint | null {
  const points = computeWeightTrend(biometrics);
  return points.length > 0 ? points[points.length - 1] : null;
}

/** Ultimo peso noto che non proviene dal futuro rispetto alla data richiesta. */
export function getLatestWeightOnOrBefore(biometrics: Biometrics, date: string): WeightPoint | null {
  if (!isValidDateKey(date)) return null;
  const points = computeWeightTrend(biometrics);
  for (let index = points.length - 1; index >= 0; index--) {
    if (points[index].date <= date) return points[index];
  }
  return null;
}

export type BiometricDisplayEntry = BiometricEntry & {
  weightKgInferred: boolean;
  weightKgSourceDate?: string;
};

/**
 * Precompila il peso solo con informazioni disponibili alla data visualizzata.
 * Una misurazione futura non può influenzare una schermata storica.
 */
export function getBiometricForDisplay(biometrics: Biometrics, date: string): BiometricDisplayEntry {
  const entry = biometrics[date] ?? {};
  if (entry.weightKg == null) {
    const latest = getLatestWeightOnOrBefore(biometrics, date);
    if (latest && latest.date !== date) {
      return {
        ...entry,
        weightKg: latest.weightKg,
        weightKgInferred: true,
        weightKgSourceDate: latest.date,
      };
    }
  }
  return { ...entry, weightKgInferred: false };
}
