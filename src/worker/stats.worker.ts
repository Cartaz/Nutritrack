// Web Worker per aggregazioni statistiche (ulti 7/30 giorni).
// Pattern 5 dello standard: self.onmessage con union discriminata.
//
// Fix 9.4 (T9): try/catch nel handler, postMessage di errore al client (che fa fallback).
// Fix 9.5 (T9): feedback anche per messaggi malformati (type sconosciuto).

import type { WorkerRequest, WorkerResponse, DayTotals, StatsResult, DiaryEntry } from '../types';
import { scaleNutrition, sumNutrition } from '../lib/nutrition';

function computeDayTotals(entries: DiaryEntry[], dateKey?: string): DayTotals {
  const nutritions = entries.map((e) => {
    const grams = e.gramsOverride ?? e.foodSnapshot.servingSize * e.quantity;
    return scaleNutrition(e.foodSnapshot.nutrition, grams);
  });
  const sum = sumNutrition(nutritions);
  return {
    // Fix LOW bug: usa dateKey se fornito (più affidabile di entries[0]?.date in caso di
    // entries con date mismatchate); fallback a entries[0]?.date per il path dayTotals diretto.
    date: dateKey ?? entries[0]?.date ?? '',
    calories: sum.calories,
    protein: sum.protein,
    carbs: sum.carbs,
    fat: sum.fat,
    count: entries.length,
  };
}

function computeStats(entries: DiaryEntry[], dates: string[]): StatsResult {
  // Raggruppa per data
  const byDate = new Map<string, DiaryEntry[]>();
  for (const e of entries) {
    const list = byDate.get(e.date) ?? [];
    list.push(e);
    byDate.set(e.date, list);
  }
  const days: DayTotals[] = dates.map((d) => {
    const list = byDate.get(d) ?? [];
    if (list.length === 0) {
      return { date: d, calories: 0, protein: 0, carbs: 0, fat: 0, count: 0 };
    }
    // Fix LOW bug: passa la date key esplicita per allineare con il fallback main-thread
    return computeDayTotals(list, d);
  });
  const tracked = days.filter((d) => d.count > 0);
  const n = tracked.length || 1;
  return {
    days,
    avgCalories: Math.round(tracked.reduce((a, d) => a + d.calories, 0) / n),
    avgProtein: Math.round(tracked.reduce((a, d) => a + d.protein, 0) / n),
    avgCarbs: Math.round(tracked.reduce((a, d) => a + d.carbs, 0) / n),
    avgFat: Math.round(tracked.reduce((a, d) => a + d.fat, 0) / n),
    totalEntries: days.reduce((a, d) => a + d.count, 0),
    daysTracked: tracked.length,
  };
}

// Fix 9.4 (T9): try/catch nel handler, postMessage di errore al client
self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'stats') {
      const result = computeStats(msg.entries, msg.dates);
      const resp: WorkerResponse = { type: 'stats', reqId: msg.reqId, result };
      (self as unknown as Worker).postMessage(resp);
      return;
    }
    if (msg.type === 'dayTotals') {
      const result = computeDayTotals(msg.entries);
      const resp: WorkerResponse = { type: 'dayTotals', reqId: msg.reqId, result };
      (self as unknown as Worker).postMessage(resp);
      return;
    }
    // Fix 9.5 (T9): messaggio malformato (type sconosciuto) → postMessage di errore
    (self as unknown as Worker).postMessage({
      type: 'error',
      reqId: (msg as { reqId?: number })?.reqId ?? 0,
      message: `Unknown message type: ${(msg as { type?: string }).type ?? 'undefined'}`,
    });
  } catch (e) {
    // Fix 9.4: comunica l'errore al client che farà fallback main-thread
    (self as unknown as Worker).postMessage({
      type: 'error',
      reqId: msg?.reqId ?? 0,
      message: e instanceof Error ? e.message : String(e),
    });
  }
};
