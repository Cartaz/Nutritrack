import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiaryEntry, FoodItem } from '../src/types';

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

describe('stats worker client fallback', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('calcola gli stessi risultati sul main thread quando Worker non può essere creato', async () => {
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
});
