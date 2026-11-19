import type { DayDiary, StatsResult } from '../types';
import { isValidDateKey, parseISODateLocal, toDateKey } from '../lib/utils';
import { computeStats } from '../lib/statistics';

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
  result: StatsResult;
}

const calculations = new Map<StatsTab, StatsCalculation>();
const WINDOW_DAYS: Record<StatsTab, number> = { week: 7, month: 30, year: 365 };

/**
 * Statistiche della finestra (7/30/365 giorni) che termina alla data corrente.
 * Il calcolo è sincrono (circa 1 ms per un anno di dati) e memoizzato per tab: lo store
 * sostituisce il diario a ogni mutazione, quindi l'identità del riferimento basta come chiave.
 */
export function getDashboardStats(tab: StatsTab, diary: DayDiary, currentDate: string): StatsResult {
  const date = isValidDateKey(currentDate) ? currentDate : toDateKey(new Date());
  const cached = calculations.get(tab);
  if (cached?.diary === diary && cached.date === date) return cached.result;

  const anchor = parseISODateLocal(date);
  const dates: string[] = [];
  for (let i = WINDOW_DAYS[tab] - 1; i >= 0; i--) {
    const day = new Date(anchor);
    day.setDate(day.getDate() - i);
    dates.push(toDateKey(day));
  }
  const entries = dates.flatMap((key) => diary[key] ?? []);
  const result = computeStats(entries, dates);
  calculations.set(tab, { diary, date, result });
  return result;
}
