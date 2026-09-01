// Web Worker per aggregazioni statistiche (ultimi 7/30 giorni).
// Il worker possiede solo il trasporto: la matematica vive nel core puro condiviso.

import type { WorkerRequest, WorkerResponse } from '../types';
import { computeDayTotals, computeStats } from '../lib/statistics';

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
    (self as unknown as Worker).postMessage({
      type: 'error',
      reqId: (msg as { reqId?: number })?.reqId ?? 0,
      message: `Unknown message type: ${(msg as { type?: string }).type ?? 'undefined'}`,
    });
  } catch (e) {
    (self as unknown as Worker).postMessage({
      type: 'error',
      reqId: msg?.reqId ?? 0,
      message: e instanceof Error ? e.message : String(e),
    });
  }
};
