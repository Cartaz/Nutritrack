import type { DayTotals, DiaryEntry, StatsResult } from '../types';
import { scaleNutrition, sumNutrition } from './nutrition';

const EMPTY_DAY = {
  calories: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  count: 0,
} as const;

/** Calcola i totali nutrizionali di un insieme di entry appartenenti a un giorno. */
export function computeDayTotals(entries: DiaryEntry[], date = entries[0]?.date ?? ''): DayTotals {
  if (entries.length === 0) return { date, ...EMPTY_DAY };

  const nutritions = entries.map((entry) => {
    const grams = entry.gramsOverride ?? entry.foodSnapshot.servingSize * entry.quantity;
    return scaleNutrition(entry.foodSnapshot.nutrition, grams);
  });
  const total = sumNutrition(nutritions);
  return {
    date,
    calories: total.calories,
    protein: total.protein,
    carbs: total.carbs,
    fat: total.fat,
    count: entries.length,
  };
}

/**
 * Aggrega le statistiche sulle date richieste, preservandone ordine e giorni vuoti.
 * Le medie sono calcolate solo sui giorni con almeno una entry, come nella UI storica.
 */
export function computeStats(entries: DiaryEntry[], dates: string[]): StatsResult {
  const byDate = new Map<string, DiaryEntry[]>();
  for (const entry of entries) {
    const list = byDate.get(entry.date);
    if (list) list.push(entry);
    else byDate.set(entry.date, [entry]);
  }

  const days = dates.map((date) => computeDayTotals(byDate.get(date) ?? [], date));
  const tracked = days.filter((day) => day.count > 0);
  const divisor = tracked.length || 1;

  return {
    days,
    avgCalories: Math.round(tracked.reduce((sum, day) => sum + day.calories, 0) / divisor),
    avgProtein: Math.round(tracked.reduce((sum, day) => sum + day.protein, 0) / divisor),
    avgCarbs: Math.round(tracked.reduce((sum, day) => sum + day.carbs, 0) / divisor),
    avgFat: Math.round(tracked.reduce((sum, day) => sum + day.fat, 0) / divisor),
    totalEntries: days.reduce((sum, day) => sum + day.count, 0),
    daysTracked: tracked.length,
  };
}
