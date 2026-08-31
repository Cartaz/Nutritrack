import type { DayTotals } from '../types';

export type StatsTab = 'week' | 'month' | 'year';
export type StatsResult = { days: DayTotals[]; avgCalories: number };

let statsTab: StatsTab = 'week';
let weekStats: StatsResult | null = null;
let weekStatsInputSig = '';
let monthStats: StatsResult | null = null;
let monthStatsInputSig = '';
let yearStats: StatsResult | null = null;
let yearStatsInputSig = '';

export function getStatsTab(): StatsTab {
  return statsTab;
}

export function setStatsTab(value: StatsTab): void {
  statsTab = value;
}

export function getWeekStats(): StatsResult | null {
  return weekStats;
}

export function setWeekStats(value: StatsResult | null): void {
  weekStats = value;
}

export function getWeekStatsInputSig(): string {
  return weekStatsInputSig;
}

export function setWeekStatsInputSig(value: string): void {
  weekStatsInputSig = value;
}

export function getMonthStats(): StatsResult | null {
  return monthStats;
}

export function setMonthStats(value: StatsResult | null): void {
  monthStats = value;
}

export function getMonthStatsInputSig(): string {
  return monthStatsInputSig;
}

export function setMonthStatsInputSig(value: string): void {
  monthStatsInputSig = value;
}

export function getYearStats(): StatsResult | null {
  return yearStats;
}

export function setYearStats(value: StatsResult | null): void {
  yearStats = value;
}

export function getYearStatsInputSig(): string {
  return yearStatsInputSig;
}

export function setYearStatsInputSig(value: string): void {
  yearStatsInputSig = value;
}
