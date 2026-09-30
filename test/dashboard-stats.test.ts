import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderDashboard } from '../src/views/dashboard';
import { getState, setState } from '../src/lib/store';
import { setStatsTab } from '../src/views/dashboard-state';
import { computeStats } from '../src/lib/statistics';
import type { DiaryEntry, StatsResult } from '../src/types';

const mocks = vi.hoisted(() => ({ compute: vi.fn() }));
vi.mock('../src/worker/client', () => ({ computeStatsAsync: mocks.compute }));
const DATE = '2026-09-30';
const ENTRY: DiaryEntry = {
  id: 'entry',
  date: DATE,
  meal: 'lunch',
  quantity: 1,
  createdAt: 1,
  foodSnapshot: {
    id: 'food',
    name: 'Pasta',
    source: 'custom',
    servingSize: 100,
    nutrition: { calories: 100, protein: 10, carbs: 10, fat: 2 },
    createdAt: 1,
  },
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16));
  mocks.compute.mockReset();
  document.body.innerHTML = '<main id="main"></main>';
  setState({ ...getState(), diary: { [DATE]: [ENTRY] }, biometrics: {}, currentDate: DATE });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('dashboard asynchronous statistics', () => {
  it('keeps each tab result when another tab starts a calculation before completion', async () => {
    const pending: { finish: () => void }[] = [];
    mocks.compute.mockImplementation(
      (entries, dates) =>
        new Promise<StatsResult>((resolve) => {
          pending.push({ finish: () => resolve(computeStats(entries, dates)) });
        }),
    );
    const main = document.querySelector<HTMLElement>('main')!;
    setStatsTab('week');
    renderDashboard(main);
    setStatsTab('month');
    renderDashboard(main);
    pending.forEach((request) => request.finish());
    await Promise.resolve();
    setStatsTab('week');
    renderDashboard(main);
    expect(main.querySelector('.week-loading')).toBeNull();
    expect(main.querySelectorAll('.week-bar')).toHaveLength(7);
  });

  it('recomputes when only snapshot nutrition changes, preserving ids and amounts', async () => {
    mocks.compute.mockImplementation((entries, dates) => Promise.resolve(computeStats(entries, dates)));
    const main = document.querySelector<HTMLElement>('main')!;
    setStatsTab('week');
    renderDashboard(main);
    await Promise.resolve();
    const changed = {
      ...ENTRY,
      foodSnapshot: { ...ENTRY.foodSnapshot, nutrition: { ...ENTRY.foodSnapshot.nutrition, calories: 300 } },
    };
    setState({ diary: { [DATE]: [changed] } });
    renderDashboard(main);
    await Promise.resolve();
    renderDashboard(main);
    expect(mocks.compute).toHaveBeenCalledTimes(2);
    expect(main.querySelector(`.week-bar[data-date="${DATE}"]`)?.getAttribute('title')).toContain('300 kcal');
  });
});
