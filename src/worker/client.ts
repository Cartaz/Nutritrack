// Wrapper client per il worker statistiche con timeout e fallback main-thread.

import type { DiaryEntry, StatsResult, WorkerRequest, WorkerResponse } from '../types';
import { WORKER_TIMEOUT_MS } from '../lib/constants';
import { computeStats } from '../lib/statsCore';

let _worker: Worker | null = null;
let _workerSupported = true;
let _idleTimeoutId: ReturnType<typeof setTimeout> | null = null;
const IDLE_TIMEOUT_MS = 60_000;

function getWorker(): Worker | null {
  if (!_workerSupported) return null;
  if (_worker) return _worker;
  try {
    _worker = new Worker(new URL('./stats.worker.ts', import.meta.url), { type: 'module' });
    _worker.onerror = (event) => {
      console.warn('[worker] load error, disabilitato, fallback main-thread', event.message ?? event);
      _workerSupported = false;
      const worker = _worker;
      if (worker) {
        try {
          worker.terminate();
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
    }
    _idleTimeoutId = null;
  }, IDLE_TIMEOUT_MS);
}

let _reqIdCounter = 0;

export function computeStatsAsync(entries: DiaryEntry[], dates: string[]): Promise<StatsResult> {
  return new Promise((resolve) => {
    const fallback = () => computeStats(entries, dates);
    const worker = getWorker();
    if (!worker) {
      resolve(fallback());
      return;
    }

    resetIdleTimeout();
    const reqId = ++_reqIdCounter;
    const timeout = setTimeout(() => {
      worker.removeEventListener('message', handler);
      resolve(fallback());
    }, WORKER_TIMEOUT_MS);

    const handler = (event: MessageEvent<WorkerResponse>) => {
      const data = event.data;
      if (data.reqId !== reqId) return;
      if (data.type === 'error') {
        clearTimeout(timeout);
        worker.removeEventListener('message', handler);
        console.warn('[worker] computation error, fallback:', data.message);
        resolve(fallback());
        return;
      }
      if (data.type === 'stats') {
        clearTimeout(timeout);
        worker.removeEventListener('message', handler);
        resolve(data.result);
      }
    };

    worker.addEventListener('message', handler);
    const request: WorkerRequest = { type: 'stats', reqId, entries, dates };
    try {
      worker.postMessage(request);
    } catch (e) {
      clearTimeout(timeout);
      worker.removeEventListener('message', handler);
      console.warn('[worker] postMessage failed, fallback:', e);
      resolve(fallback());
    }
  });
}

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
