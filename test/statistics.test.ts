import { describe, expect, it } from 'vitest';
import { computeDayTotals, computeStats } from '../src/lib/statistics';
import type { DiaryEntry, FoodItem } from '../src/types';

const FOOD: FoodItem = {
  id: 'food-1',
  name: 'Test food',
  source: 'custom',
  servingSize: 100,
  nutrition: {
    calories: 200,
    protein: 10,
    carbs: 20,
    fat: 8,
  },
  createdAt: 1,
};

function entry(id: string, date: string, quantity: number, gramsOverride?: number): DiaryEntry {
  return {
    id,
    date,
    meal: 'breakfast',
    foodId: FOOD.id,
    foodSnapshot: FOOD,
    quantity,
    gramsOverride,
    createdAt: 2,
  };
}

describe('computeDayTotals', () => {
  it('uses gramsOverride when present and servingSize × quantity otherwise', () => {
    const result = computeDayTotals([entry('a', '2026-08-30', 99, 150), entry('b', '2026-08-30', 0.5)]);

    expect(result).toEqual({
      date: '2026-08-30',
      calories: 400,
      protein: 20,
      carbs: 40,
      fat: 16,
      count: 2,
    });
  });

  it('uses an explicit requested date instead of inferring it from mismatched entries', () => {
    const result = computeDayTotals([entry('a', '2026-08-29', 1)], '2026-08-30');

    expect(result.date).toBe('2026-08-30');
    expect(result.count).toBe(1);
  });

  it('returns a zero-valued day for an empty entry list', () => {
    expect(computeDayTotals([], '2026-08-31')).toEqual({
      date: '2026-08-31',
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      count: 0,
    });
  });
});

describe('computeStats', () => {
  it('preserves requested date order and includes explicit empty days', () => {
    const result = computeStats(
      [entry('a', '2026-08-30', 99, 150), entry('b', '2026-08-30', 0.5), entry('c', '2026-08-28', 1)],
      ['2026-08-30', '2026-08-29', '2026-08-28'],
    );

    expect(result.days.map((day) => day.date)).toEqual(['2026-08-30', '2026-08-29', '2026-08-28']);
    expect(result.days[1]).toEqual({
      date: '2026-08-29',
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      count: 0,
    });
    expect(result.totalEntries).toBe(3);
    expect(result.daysTracked).toBe(2);
  });

  it('averages only tracked days, not requested empty days', () => {
    const result = computeStats(
      [entry('a', '2026-08-30', 99, 150), entry('b', '2026-08-30', 0.5), entry('c', '2026-08-28', 1)],
      ['2026-08-30', '2026-08-29', '2026-08-28'],
    );

    expect(result.avgCalories).toBe(300);
    expect(result.avgProtein).toBe(15);
    expect(result.avgCarbs).toBe(30);
    expect(result.avgFat).toBe(12);
  });

  it('returns zero averages when none of the requested days is tracked', () => {
    const result = computeStats([], ['2026-08-30', '2026-08-31']);

    expect(result).toMatchObject({
      avgCalories: 0,
      avgProtein: 0,
      avgCarbs: 0,
      avgFat: 0,
      totalEntries: 0,
      daysTracked: 0,
    });
  });
});
