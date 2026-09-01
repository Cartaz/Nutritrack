// Wrapper client per il worker statistiche con fallback main-thread + timeout 500ms.
// Il client possiede lifecycle, timeout e fallback; la matematica vive nel core condiviso.

import type { DiaryEntry, StatsResult, WorkerRequest, WorkerResponse } from '../types';
import { WORKER_TIMEOUT_MS } from '../lib/constants';
import { computeStats } from '../lib/statistics';

let _worker: Worker | null = null;
let _workerSupported = true;
let _idleTimeoutId: ReturnType<typeof setTimeout> | null = null;
const IDLE_TIMEOUT_MS = 60_000;

function getWorker(): Worker | null {
  if (!_workerSupported) return null;
  if (_worker) return _worker;
  try {
    _worker = new Worker(new URL('./stats.worker.ts', import.meta.url), { type: 'module' });
    _worker.onerror = (e) => {
      console.warn('[worker] load error, disabilitato, fallback main-thread', e.message ?? e);
      _workerSupported = false;
      const w = _worker;
      if (w) {
        try {
          w.terminate();
        } catch {
          /* ignore */
        }
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

function resetIdleTimeout(): void {
  if (_idleTimeoutId) clearTimeout(_idleTimeoutId);
  _idleTimeoutId = setTimeout(() => {
    if (_worker) {
      try {
        _worker.terminate();
      } catch {
        /* ignore */
      }
      _worker = null;
      console.info('[worker] idle timeout, terminato per risparmiare memoria');
    }
    _idleTimeoutId = null;
  }, IDLE_TIMEOUT_MS);
}

// ============ Public API ============

let _reqIdCounter = 0;

/** Calcola statistiche su un insieme di date usando il worker quando disponibile. */
export function computeStatsAsync(entries: DiaryEntry[], dates: string[]): Promise<StatsResult> {
  return new Promise((resolve) => {
    const worker = getWorker();
    if (!worker) {
      resolve(computeStats(entries, dates));
      return;
    }

    resetIdleTimeout();
    const reqId = ++_reqIdCounter;
    const timeout = setTimeout(() => {
      worker.removeEventListener('message', handler);
      resolve(computeStats(entries, dates));
    }, WORKER_TIMEOUT_MS);

    const handler = (ev: MessageEvent<WorkerResponse | { type: 'error'; reqId: number; message: string }>) => {
      const data = ev.data;
      if (data.type === 'error' && data.reqId === reqId) {
        clearTimeout(timeout);
        worker.removeEventListener('message', handler);
        console.warn('[worker] computation error, fallback:', data.message);
        resolve(computeStats(entries, dates));
        return;
      }
      if (data.type === 'stats' && data.reqId === reqId) {
        clearTimeout(timeout);
        worker.removeEventListener('message', handler);
        resolve(data.result);
      }
    };
    worker.addEventListener('message', handler);

    const req: WorkerRequest = { type: 'stats', reqId, entries, dates };
    try {
      worker.postMessage(req);
    } catch (e) {
      clearTimeout(timeout);
      worker.removeEventListener('message', handler);
      console.warn('[worker] postMessage failed, fallback:', e);
      resolve(computeStats(entries, dates));
    }
  });
}

/** Termina il worker (su unload) e cancella l'idle timeout. */
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
