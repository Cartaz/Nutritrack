// Web Worker statistiche: trasporto dei messaggi; l'algoritmo vive in statsCore.ts.

import type { WorkerRequest, WorkerResponse } from '../types';
import { computeDayTotals, computeStats } from '../lib/statsCore';

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  try {
    let response: WorkerResponse;
    if (message.type === 'stats') {
      response = { type: 'stats', reqId: message.reqId, result: computeStats(message.entries, message.dates) };
    } else if (message.type === 'dayTotals') {
      response = { type: 'dayTotals', reqId: message.reqId, result: computeDayTotals(message.entries) };
    } else {
      const unknown = message as { reqId?: number; type?: string };
      response = {
        type: 'error',
        reqId: unknown.reqId ?? 0,
        message: `Unknown message type: ${unknown.type ?? 'undefined'}`,
      };
    }
    (self as unknown as Worker).postMessage(response);
  } catch (e) {
    const error: WorkerResponse = {
      type: 'error',
      reqId: message?.reqId ?? 0,
      message: e instanceof Error ? e.message : String(e),
    };
    (self as unknown as Worker).postMessage(error);
  }
};
