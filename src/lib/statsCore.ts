// Aggregazioni statistiche pure condivise da Web Worker e fallback main-thread.

import type { DayTotals, DiaryEntry, StatsResult } from '../types';
import { scaleNutrition, sumNutrition } from './nutrition';

export function computeDayTotals(entries: DiaryEntry[], dateKey?: string): DayTotals {
  const nutritions = entries.map((entry) => {
    const grams = entry.gramsOverride ?? entry.foodSnapshot.servingSize * entry.quantity;
    return scaleNutrition(entry.foodSnapshot.nutrition, grams);
  });
  const total = sumNutrition(nutritions);
  return {
    date: dateKey ?? entries[0]?.date ?? '',
    calories: total.calories,
    protein: total.protein,
    carbs: total.carbs,
    fat: total.fat,
    count: entries.length,
  };
}

export function computeStats(entries: DiaryEntry[], dates: string[]): StatsResult {
  const byDate = new Map<string, DiaryEntry[]>();
  for (const entry of entries) {
    const list = byDate.get(entry.date) ?? [];
    list.push(entry);
    byDate.set(entry.date, list);
  }

  const days = dates.map((date) => {
    const list = byDate.get(date) ?? [];
    return list.length > 0
      ? computeDayTotals(list, date)
      : { date, calories: 0, protein: 0, carbs: 0, fat: 0, count: 0 };
  });
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
