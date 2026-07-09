// Test unitari per le statistiche estese (P1 #1 — Mese / Anno).
//
// Verifica che computeStatsAsync gestisca correttamente finestre di 7, 30 e 365
// giorni. In jsdom il Worker non è istanziabile → il client usa il fallback
// main-thread (stessa logica del worker), quindi testiamo la computazione reale.
//
// Copre:
// - finestra 7 giorni (regressione: comportamento originale)
// - finestra 30 giorni (Mese)
// - finestra 365 giorni (Anno)
// - avgCalories / daysTracked / totalEntries corretti
// - giorni senza entry → count 0, non conteggiati in daysTracked
// - entries con gramsOverride calcolate correttamente

import { describe, it, expect } from 'vitest';
import { computeStatsAsync } from '../src/worker/client';
import type { DiaryEntry } from '../src/types';
import { toDateKey } from '../src/lib/utils';

/** Helper: crea una data YYYY-MM-DD shiftata di `days` da oggi. */
function dateOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toDateKey(d);
}

/** Helper: crea una DiaryEntry fittizia con valori nutrizionali noti. */
function makeEntry(date: string, meal: DiaryEntry['meal'], calories: number): DiaryEntry {
  return {
    id: `entry_${date}_${meal}_${calories}`,
    date,
    meal,
    foodSnapshot: {
      id: 'food_test',
      name: 'Test Food',
      source: 'custom',
      servingSize: 100,
      nutrition: { calories, protein: 10, carbs: 20, fat: 5 },
      createdAt: 0,
    },
    quantity: 1,
    createdAt: 0,
  };
}

describe('computeStatsAsync - finestra 7 giorni (Settimana, regressione)', () => {
  it('ritorna 7 days con avgCalories corrette', async () => {
    const dates: string[] = [];
    for (let i = 6; i >= 0; i--) dates.push(dateOffset(-i));
    const entries = [
      makeEntry(dates[0], 'breakfast', 400), // 400 kcal
      makeEntry(dates[0], 'lunch', 600), // +600 = 1000 totale giorno 0
      makeEntry(dates[3], 'dinner', 800), // 800 kcal giorno 3
    ];
    const res = await computeStatsAsync(entries, dates);
    expect(res.days).toHaveLength(7);
    expect(res.days[0].calories).toBe(1000);
    expect(res.days[3].calories).toBe(800);
    // daysTracked: 2 (giorno 0 e giorno 3)
    expect(res.daysTracked).toBe(2);
    // avg = (1000 + 800) / 2 = 900
    expect(res.avgCalories).toBe(900);
    expect(res.totalEntries).toBe(3);
  });

  it('giorni senza entry hanno count 0 e non conteggiati in daysTracked', async () => {
    const dates: string[] = [];
    for (let i = 6; i >= 0; i--) dates.push(dateOffset(-i));
    const entries = [makeEntry(dates[6], 'breakfast', 500)];
    const res = await computeStatsAsync(entries, dates);
    expect(res.days[5].count).toBe(0);
    expect(res.days[5].calories).toBe(0);
    expect(res.daysTracked).toBe(1);
    expect(res.avgCalories).toBe(500);
  });
});

describe('computeStatsAsync - finestra 30 giorni (Mese, P1 #1)', () => {
  it('ritorna 30 days con medie corrette', async () => {
    const dates: string[] = [];
    for (let i = 29; i >= 0; i--) dates.push(dateOffset(-i));
    // 5 giorni con entry, tutti 2000 kcal
    const entries = [
      makeEntry(dates[0], 'breakfast', 2000),
      makeEntry(dates[7], 'lunch', 2000),
      makeEntry(dates[14], 'dinner', 2000),
      makeEntry(dates[21], 'snack', 2000),
      makeEntry(dates[29], 'breakfast', 2000),
    ];
    const res = await computeStatsAsync(entries, dates);
    expect(res.days).toHaveLength(30);
    expect(res.daysTracked).toBe(5);
    expect(res.avgCalories).toBe(2000);
    expect(res.totalEntries).toBe(5);
    // I giorni senza entry hanno calories 0
    expect(res.days[1].calories).toBe(0);
  });

  it('finestra vuota (nessuna entry) ritorna tutti days con count 0', async () => {
    const dates: string[] = [];
    for (let i = 29; i >= 0; i--) dates.push(dateOffset(-i));
    const res = await computeStatsAsync([], dates);
    expect(res.days).toHaveLength(30);
    expect(res.daysTracked).toBe(0);
    expect(res.avgCalories).toBe(0);
    expect(res.totalEntries).toBe(0);
  });
});

describe('computeStatsAsync - finestra 365 giorni (Anno, P1 #1)', () => {
  it('ritorna 365 days', async () => {
    const dates: string[] = [];
    for (let i = 364; i >= 0; i--) dates.push(dateOffset(-i));
    // Solo 3 giorni registrati sparsi nell'anno
    const entries = [
      makeEntry(dates[0], 'breakfast', 1800),
      makeEntry(dates[180], 'lunch', 2200),
      makeEntry(dates[364], 'dinner', 2000),
    ];
    const res = await computeStatsAsync(entries, dates);
    expect(res.days).toHaveLength(365);
    expect(res.daysTracked).toBe(3);
    // avg = (1800 + 2200 + 2000) / 3 = 2000
    expect(res.avgCalories).toBe(2000);
    expect(res.totalEntries).toBe(3);
  });

  it('heatmap: giorni senza entry hanno count 0 (verifica struttura per heatmap)', async () => {
    const dates: string[] = [];
    for (let i = 364; i >= 0; i--) dates.push(dateOffset(-i));
    const res = await computeStatsAsync([], dates);
    expect(res.days).toHaveLength(365);
    // Tutti i days devono avere count 0 (per il rendering heatmap come celle grige)
    expect(res.days.every((d) => d.count === 0)).toBe(true);
    expect(res.days.every((d) => d.calories === 0)).toBe(true);
  });
});

describe('computeStatsAsync - gramsOverride calcolato correttamente', () => {
  it('usa gramsOverride invece di servingSize * quantity', async () => {
    const today = dateOffset(0);
    const entry: DiaryEntry = {
      id: 'entry_grams',
      date: today,
      meal: 'breakfast',
      foodSnapshot: {
        id: 'food_test',
        name: 'Test',
        source: 'custom',
        servingSize: 100,
        nutrition: { calories: 200, protein: 10, carbs: 20, fat: 5 },
        createdAt: 0,
      },
      quantity: 1,
      gramsOverride: 150, // 150g invece di 100g
      createdAt: 0,
    };
    const res = await computeStatsAsync([entry], [today]);
    // 200 kcal/100g * 150g = 300 kcal
    expect(res.days[0].calories).toBe(300);
  });
});
