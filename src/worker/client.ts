// Wrapper client per il worker statistiche con fallback main-thread + timeout 500ms.
// Pattern 5 dello standard.

import type { DiaryEntry, StatsResult, WorkerRequest, WorkerResponse, DayTotals } from '../types';
import { WORKER_TIMEOUT_MS } from '../lib/constants';
import { scaleNutrition, sumNutrition } from '../lib/nutrition';

let _worker: Worker | null = null;
let _workerSupported = true;

function getWorker(): Worker | null {
  if (!_workerSupported) return null;
  if (_worker) return _worker;
  try {
    _worker = new Worker(new URL('./stats.worker.ts', import.meta.url), { type: 'module' });
    return _worker;
  } catch {
    _workerSupported = false;
    console.warn('[worker] Web Worker non supportato, fallback main-thread');
    return null;
  }
}

// ============ Fallback main-thread (stessa logica del worker) ============

function computeStatsFallback(entries: DiaryEntry[], dates: string[]): StatsResult {
  const byDate = new Map<string, DiaryEntry[]>();
  for (const e of entries) {
    const list = byDate.get(e.date) ?? [];
    list.push(e);
    byDate.set(e.date, list);
  }
  const days: DayTotals[] = dates.map((d) => {
    const list = byDate.get(d) ?? [];
    if (list.length === 0) return { date: d, calories: 0, protein: 0, carbs: 0, fat: 0, count: 0 };
    const nutritions = list.map((e) => {
      const grams = e.gramsOverride ?? e.foodSnapshot.servingSize * e.quantity;
      return scaleNutrition(e.foodSnapshot.nutrition, grams);
    });
    const sum = sumNutrition(nutritions);
    return { date: d, calories: sum.calories, protein: sum.protein, carbs: sum.carbs, fat: sum.fat, count: list.length };
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

// ============ Public API ============

// Fix B12: correlation id monotonic per evitare cross-resolution concorrente
let _reqIdCounter = 0;

/** Calcola statistiche su un insieme di date con fallback */
export function computeStatsAsync(entries: DiaryEntry[], dates: string[]): Promise<StatsResult> {
  return new Promise((resolve) => {
    const worker = getWorker();
    if (!worker) {
      resolve(computeStatsFallback(entries, dates));
      return;
    }
    const reqId = ++_reqIdCounter;
    const timeout = setTimeout(() => {
      worker.removeEventListener('message', handler);
      resolve(computeStatsFallback(entries, dates));
    }, WORKER_TIMEOUT_MS);

    const handler = (ev: MessageEvent<WorkerResponse>) => {
      // Fix B12: ignora risposte con reqId diverso (concorrenza cross-resolution)
      if (ev.data.type === 'stats' && ev.data.reqId === reqId) {
        clearTimeout(timeout);
        worker.removeEventListener('message', handler);
        resolve(ev.data.result);
      }
    };
    worker.addEventListener('message', handler);
    const req: WorkerRequest = { type: 'stats', reqId, entries, dates };
    worker.postMessage(req);
  });
}

/** Termina il worker (su unload) */
export function terminateWorker(): void {
  if (_worker) {
    _worker.terminate();
    _worker = null;
  }
}
