// Signature cache condivise per le viste.
// Modulo leggero (no import dalle viste) per permettere al renderer di resettarle
// sincronamente senza rompere il code-splitting (Fix 9.2 T9 + Fix CI code-splitting).
//
// Le viste leggono/scrivono queste variabili; il renderer le resetta al cambio vista.

import type { DayTotals } from '../types';

// ============ Dashboard ============
let _dashRenderSig = '';
let _weekStats: { days: DayTotals[]; avgCalories: number } | null = null;
let _weekStatsInputSig = '';

export function getDashRenderSig(): string {
  return _dashRenderSig;
}
export function setDashRenderSig(v: string): void {
  _dashRenderSig = v;
}
export function getWeekStats(): { days: DayTotals[]; avgCalories: number } | null {
  return _weekStats;
}
export function setWeekStats(v: { days: DayTotals[]; avgCalories: number } | null): void {
  _weekStats = v;
}
export function getWeekStatsInputSig(): string {
  return _weekStatsInputSig;
}
export function setWeekStatsInputSig(v: string): void {
  _weekStatsInputSig = v;
}

// ============ Dashboard stats estese (P1 #1 — Mese / Anno) ============
export type StatsTab = 'week' | 'month' | 'year';

let _statsTab: StatsTab = 'week';
let _monthStats: { days: DayTotals[]; avgCalories: number } | null = null;
let _monthStatsInputSig = '';
let _yearStats: { days: DayTotals[]; avgCalories: number } | null = null;
let _yearStatsInputSig = '';

export function getStatsTab(): StatsTab {
  return _statsTab;
}
export function setStatsTab(v: StatsTab): void {
  _statsTab = v;
}
export function getMonthStats(): { days: DayTotals[]; avgCalories: number } | null {
  return _monthStats;
}
export function setMonthStats(v: { days: DayTotals[]; avgCalories: number } | null): void {
  _monthStats = v;
}
export function getMonthStatsInputSig(): string {
  return _monthStatsInputSig;
}
export function setMonthStatsInputSig(v: string): void {
  _monthStatsInputSig = v;
}
export function getYearStats(): { days: DayTotals[]; avgCalories: number } | null {
  return _yearStats;
}
export function setYearStats(v: { days: DayTotals[]; avgCalories: number } | null): void {
  _yearStats = v;
}
export function getYearStatsInputSig(): string {
  return _yearStatsInputSig;
}
export function setYearStatsInputSig(v: string): void {
  _yearStatsInputSig = v;
}

export function resetDashboardSignature(): void {
  _dashRenderSig = '';
  _weekStats = null;
  _weekStatsInputSig = '';
  // P1 #1: reset stats estese (manteniamo il tab attivo per non perdere la selezione utente)
  _monthStats = null;
  _monthStatsInputSig = '';
  _yearStats = null;
  _yearStatsInputSig = '';
}

// ============ Foods ============
let _foodsRenderSig = '';
export function getFoodsRenderSig(): string {
  return _foodsRenderSig;
}
export function setFoodsRenderSig(v: string): void {
  _foodsRenderSig = v;
}
export function resetFoodsSignature(): void {
  _foodsRenderSig = '';
}

// ============ Recipes ============
let _recipesRenderSig = '';
export function getRecipesRenderSig(): string {
  return _recipesRenderSig;
}
export function setRecipesRenderSig(v: string): void {
  _recipesRenderSig = v;
}
export function resetRecipesSignature(): void {
  _recipesRenderSig = '';
}

// ============ Settings ============
let _settingsRenderSig = '';
export function getSettingsRenderSig(): string {
  return _settingsRenderSig;
}
export function setSettingsRenderSig(v: string): void {
  _settingsRenderSig = v;
}
export function resetSettingsSignature(): void {
  _settingsRenderSig = '';
}

// ============ Registry per reset aggiuntivi (es. _pendingMacroSplit in settings.ts) ============
// Le viste possono registrare callback di reset locali che verranno chiamati da resetAllViewSignatures.
// Questo evita dipendenze circolari (signatures.ts non importa le viste).
const _extraResets: Set<() => void> = new Set();
export function registerViewReset(fn: () => void): () => void {
  _extraResets.add(fn);
  return () => {
    _extraResets.delete(fn);
  };
}

// Reset tutte in un colpo (chiamato dal renderer al cambio vista)
export function resetAllViewSignatures(): void {
  resetDashboardSignature();
  resetFoodsSignature();
  resetRecipesSignature();
  resetSettingsSignature();
  // Chiama i reset aggiuntivi registrati dalle viste (es. _pendingMacroSplit)
  _extraResets.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.error('[signatures] extra reset error', e);
    }
  });
}
