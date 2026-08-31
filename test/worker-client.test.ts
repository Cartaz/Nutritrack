import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiaryEntry, FoodItem, StatsResult, WorkerResponse } from '../src/types';
import { WORKER_TIMEOUT_MS } from '../src/lib/constants';

function makeFood(): FoodItem {
  return {
    id: 'food-1',
    name: 'Worker food',
    source: 'custom',
    servingSize: 100,
    nutrition: { calories: 200, protein: 10, carbs: 20, fat: 8 },
    createdAt: 1,
  };
}

function makeEntry(id: string, date: string, quantity: number): DiaryEntry {
  const food = makeFood();
  return {
    id,
    date,
    meal: 'lunch',
    foodId: food.id,
    foodSnapshot: food,
    quantity,
    createdAt: 1,
  };
}

class FakeWorker {
  static instances: FakeWorker[] = [];

  readonly postMessage = vi.fn();
  readonly terminate = vi.fn();
  onerror: ((this: AbstractWorker, ev: ErrorEvent) => unknown) | null = null;
  private readonly listeners = new Set<(event: MessageEvent) => void>();

  constructor() {
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type !== 'message' || typeof listener !== 'function') return;
    this.listeners.add(listener as (event: MessageEvent) => void);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type !== 'message' || typeof listener !== 'function') return;
    this.listeners.delete(listener as (event: MessageEvent) => void);
  }

  emit(data: WorkerResponse): void {
    const event = { data } as MessageEvent;
    for (const listener of this.listeners) listener(event);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  FakeWorker.instances = [];
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('stats worker client', () => {
  it('usa il fallback main-thread quando il Worker non può essere creato', async () => {
    class ThrowingWorker {
      constructor() {
        throw new Error('Worker unavailable');
      }
    }
    vi.stubGlobal('Worker', ThrowingWorker);

    const { computeStatsAsync } = await import('../src/worker/client');
    const entries = [makeEntry('e1', '2026-08-30', 1), makeEntry('e2', '2026-08-31', 2)];

    const result = await computeStatsAsync(entries, ['2026-08-30', '2026-08-31', '2026-09-01']);

    expect(result.days).toHaveLength(3);
    expect(result.days[0]).toMatchObject({ date: '2026-08-30', calories: 200, count: 1 });
    expect(result.days[1]).toMatchObject({ date: '2026-08-31', calories: 400, count: 1 });
    expect(result.days[2]).toMatchObject({ date: '2026-09-01', calories: 0, count: 0 });
    expect(result.avgCalories).toBe(300);
    expect(result.daysTracked).toBe(2);
    expect(result.totalEntries).toBe(2);
  });

  it('risolve solo la risposta del worker con il reqId della richiesta corrente', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const { computeStatsAsync, terminateWorker } = await import('../src/worker/client');
    const expected: StatsResult = {
      days: [],
      avgCalories: 123,
      avgProtein: 10,
      avgCarbs: 20,
      avgFat: 5,
      totalEntries: 7,
      daysTracked: 3,
    };

    const promise = computeStatsAsync([], []);
    const worker = FakeWorker.instances[0];
    const request = worker.postMessage.mock.calls[0][0] as { reqId: number };

    worker.emit({ type: 'stats', reqId: request.reqId + 1, result: { ...expected, avgCalories: 999 } });
    worker.emit({ type: 'stats', reqId: request.reqId, result: expected });

    await expect(promise).resolves.toEqual(expected);
    terminateWorker();
  });

  it('torna al main thread se il worker supera il timeout', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const { computeStatsAsync, terminateWorker } = await import('../src/worker/client');
    const entries = [makeEntry('e1', '2026-08-31', 1)];

    const promise = computeStatsAsync(entries, ['2026-08-31']);
    await vi.advanceTimersByTimeAsync(WORKER_TIMEOUT_MS);

    await expect(promise).resolves.toMatchObject({ avgCalories: 200, totalEntries: 1, daysTracked: 1 });
    terminateWorker();
  });

  it('torna al main thread se postMessage fallisce', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const { computeStatsAsync, terminateWorker } = await import('../src/worker/client');
    const entries = [makeEntry('e1', '2026-08-31', 1)];
    const warmupResult: StatsResult = {
      days: [],
      avgCalories: 0,
      avgProtein: 0,
      avgCarbs: 0,
      avgFat: 0,
      totalEntries: 0,
      daysTracked: 0,
    };

    const warmup = computeStatsAsync([], []);
    const worker = FakeWorker.instances[0];
    const warmupRequest = worker.postMessage.mock.calls[0][0] as { reqId: number };
    worker.emit({ type: 'stats', reqId: warmupRequest.reqId, result: warmupResult });
    await warmup;

    worker.postMessage.mockImplementationOnce(() => {
      throw new Error('clone failed');
    });
    const fallbackPromise = computeStatsAsync(entries, ['2026-08-31']);

    await expect(fallbackPromise).resolves.toMatchObject({ avgCalories: 200, totalEntries: 1, daysTracked: 1 });
    terminateWorker();
  });
});
