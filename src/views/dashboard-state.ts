import type { DayDiary, StatsResult } from '../types';
import { emitChange } from '../lib/store';
import { isValidDateKey, parseISODateLocal, toDateKey } from '../lib/utils';
import { computeStatsAsync } from '../worker/client';

export type StatsTab = 'week' | 'month' | 'year';

let statsTab: StatsTab = 'week';

export function getStatsTab(): StatsTab {
  return statsTab;
}

export function setStatsTab(value: StatsTab): void {
  statsTab = value;
}

interface StatsCalculation {
  diary: DayDiary;
  date: string;
  result: StatsResult | null;
}

const calculations = new Map<StatsTab, StatsCalculation>();
const WINDOW_DAYS: Record<StatsTab, number> = { week: 7, month: 30, year: 365 };

/**
 * Returns cached statistics or starts the calculation and returns null while pending.
 * The store replaces diary snapshots on mutation/hydration, so reference identity
 * covers all input changes, including nutrition-only edits and imported snapshots.
 * Each tab owns its pending calculation: switching tabs cannot discard another result.
 */
export function getDashboardStats(tab: StatsTab, diary: DayDiary, currentDate: string): StatsResult | null {
  const date = isValidDateKey(currentDate) ? currentDate : toDateKey(new Date());
  const cached = calculations.get(tab);
  if (cached?.diary === diary && cached.date === date) return cached.result;

  const calculation: StatsCalculation = { diary, date, result: null };
  calculations.set(tab, calculation);
  const anchor = parseISODateLocal(date);
  const dates: string[] = [];
  for (let i = WINDOW_DAYS[tab] - 1; i >= 0; i--) {
    const day = new Date(anchor);
    day.setDate(day.getDate() - i);
    dates.push(toDateKey(day));
  }
  const entries = dates.flatMap((key) => diary[key] ?? []);

  void computeStatsAsync(entries, dates)
    .then((result) => {
      if (calculations.get(tab) !== calculation) return;
      calculation.result = result;
      emitChange();
    })
    .catch((error) => {
      if (calculations.get(tab) !== calculation) return;
      calculations.delete(tab);
      console.error('[dashboard] worker stats error', error);
    });
  return null;
}
