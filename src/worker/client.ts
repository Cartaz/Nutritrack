// Wrapper client per il worker statistiche con fallback main-thread + timeout 500ms.
// Pattern 5 dello standard.
//
// Fix 9.1 (T9): getWorker() registra worker.onerror per rilevare worker rotto (404 chunk, syntax error).
// Fix 9.4 (T9): gestisce messaggi di errore dal worker (worker.ts ha try/catch con postMessage error).
// Fix 9.7 (T9): worker idle timeout (60s senza richieste → terminate per risparmiare memoria).

import type { DiaryEntry, StatsResult, WorkerRequest, WorkerResponse, DayTotals } from '../types';
import { WORKER_TIMEOUT_MS } from '../lib/constants';
import { scaleNutrition, sumNutrition } from '../lib/nutrition';

let _worker: Worker | null = null;
let _workerSupported = true;
// Fix 9.7: idle timeout per terminare il worker dopo 60s di inattività
let _idleTimeoutId: ReturnType<typeof setTimeout> | null = null;
const IDLE_TIMEOUT_MS = 60_000;

function getWorker(): Worker | null {
  if (!_workerSupported) return null;
  if (_worker) return _worker;
  try {
    _worker = new Worker(new URL('./stats.worker.ts', import.meta.url), { type: 'module' });
    // Fix 9.1 (T9): onerror handler per rilevare worker rotto (chunk 404, syntax error)
    // Senza questo, _workerSupported resta true e ogni computeStatsAsync aspetta 500ms poi fallback
    _worker.onerror = (e) => {
      console.warn('[worker] load error, disabilitato, fallback main-thread', e.message ?? e);
      _workerSupported = false;
      const w = _worker;
      if (w) {
        try { w.terminate(); } catch { /* ignore */ }
      }
      _worker = null;
    };
    return _worker;
  } catch {
    _workerSupported = false;
    console.warn('[worker] Web Worker non supportato, fallback main-thread');
    return null;
  }
}

/** Fix 9.7: resetta l'idle timeout ad ogni richiesta (termina dopo 60s di inattività). */
function resetIdleTimeout(): void {
  if (_idleTimeoutId) clearTimeout(_idleTimeoutId);
  _idleTimeoutId = setTimeout(() => {
    if (_worker) {
      try { _worker.terminate(); } catch { /* ignore */ }
      _worker = null;
      console.log('[worker] idle timeout, terminato per risparmiare memoria');
    }
    _idleTimeoutId = null;
  }, IDLE_TIMEOUT_MS);
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

/** Calcola statistiche su un insieme di date con fallback.
 *  Fix 9.4 (T9): gestisce messaggi di errore dal worker (type: 'error'). */
export function computeStatsAsync(entries: DiaryEntry[], dates: string[]): Promise<StatsResult> {
  return new Promise((resolve) => {
    const worker = getWorker();
    if (!worker) {
      resolve(computeStatsFallback(entries, dates));
      return;
    }
    // Fix 9.7: resetta idle timeout ad ogni richiesta
    resetIdleTimeout();
    const reqId = ++_reqIdCounter;
    const timeout = setTimeout(() => {
      worker.removeEventListener('message', handler);
      resolve(computeStatsFallback(entries, dates));
    }, WORKER_TIMEOUT_MS);

    const handler = (ev: MessageEvent<WorkerResponse | { type: 'error'; reqId: number; message: string }>) => {
      const data = ev.data;
      // Fix 9.4: gestisci messaggio di errore dal worker
      if (data.type === 'error' && data.reqId === reqId) {
        clearTimeout(timeout);
        worker.removeEventListener('message', handler);
        console.warn('[worker] computation error, fallback:', data.message);
        resolve(computeStatsFallback(entries, dates));
        return;
      }
      // Fix B12: ignora risposte con reqId diverso (concorrenza cross-resolution)
      if (data.type === 'stats' && data.reqId === reqId) {
        clearTimeout(timeout);
        worker.removeEventListener('message', handler);
        // Type guard: data è ora { type: 'stats'; reqId; result: StatsResult }
        resolve(data.result);
      }
    };
    worker.addEventListener('message', handler);
    const req: WorkerRequest = { type: 'stats', reqId, entries, dates };
    try {
      worker.postMessage(req);
    } catch (e) {
      // postMessage può fallire per dati non clonabili o worker terminato
      clearTimeout(timeout);
      worker.removeEventListener('message', handler);
      console.warn('[worker] postMessage failed, fallback:', e);
      resolve(computeStatsFallback(entries, dates));
    }
  });
}

/** Termina il worker (su unload). Fix 9.7: cancella anche idle timeout. */
export function terminateWorker(): void {
  if (_idleTimeoutId) {
    clearTimeout(_idleTimeoutId);
    _idleTimeoutId = null;
  }
  if (_worker) {
    _worker.terminate();
    _worker = null;
  }
}
