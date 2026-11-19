import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderDashboard } from '../src/views/dashboard';
import { getState, setState } from '../src/lib/store';
import { setStatsTab } from '../src/views/dashboard-state';
import type { DiaryEntry } from '../src/types';

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
  document.body.innerHTML = '<main id="main"></main>';
  setState({ ...getState(), diary: { [DATE]: [ENTRY] }, biometrics: {}, currentDate: DATE });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('dashboard statistics', () => {
  it('renders every tab synchronously and keeps each tab result independent', () => {
    const main = document.querySelector<HTMLElement>('main')!;
    setStatsTab('week');
    renderDashboard(main);
    expect(main.querySelectorAll('.week-bar')).toHaveLength(7);
    setStatsTab('month');
    renderDashboard(main);
    setStatsTab('week');
    renderDashboard(main);
    expect(main.querySelectorAll('.week-bar')).toHaveLength(7);
  });

  it('recomputes when only snapshot nutrition changes', () => {
    const main = document.querySelector<HTMLElement>('main')!;
    setStatsTab('week');
    renderDashboard(main);
    expect(main.querySelector(`.week-bar[data-date="${DATE}"]`)?.getAttribute('title')).toContain('100 kcal');
    const changed = {
      ...ENTRY,
      foodSnapshot: { ...ENTRY.foodSnapshot, nutrition: { ...ENTRY.foodSnapshot.nutrition, calories: 300 } },
    };
    setState({ diary: { [DATE]: [changed] } });
    renderDashboard(main);
    expect(main.querySelector(`.week-bar[data-date="${DATE}"]`)?.getAttribute('title')).toContain('300 kcal');
  });
});
