import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiaryEntry, FoodItem, PersistedState } from '../src/types';
import { MAX_DIARY_ENTRIES_PER_DAY, SCHEMA_VERSION, STORAGE_KEY } from '../src/lib/constants';
import { reconcileAll } from '../src/lib/normalize';
import {
  addDiaryEntries,
  getState,
  replacePersistedState,
  setCurrentDate,
  setState,
  updateFood,
} from '../src/lib/store';
import { __resetStorageInternalForTesting, initMultiTabSync } from '../src/lib/storage';
import {
  computeWeightMovingAverage,
  getBiometricForDisplay,
  type WeightPoint,
} from '../src/lib/biometrics';
import { clearRuntimeDataCaches } from '../src/lib/localData';

const food = (id: string, name = id, barcode?: string): FoodItem => ({
  id,
  name,
  barcode,
  source: 'custom',
  servingSize: 100,
  nutrition: { calories: 100, protein: 5, carbs: 10, fat: 2 },
  createdAt: 1,
});

const emptyPersisted = (): PersistedState => ({
  settings: {
    calorieGoal: 2000,
    macroSplit: { proteinPct: 30, carbsPct: 40, fatPct: 30 },
    theme: 'system',
  },
  foods: [],
  diary: {},
  recipes: [],
  favoriteFoodIds: [],
  biometrics: {},
});

beforeEach(() => {
  localStorage.clear();
  __resetStorageInternalForTesting();
  replacePersistedState(emptyPersisted());
  setState({ currentDate: '2026-01-01' });
});

describe('reconcileAll invariants', () => {
  it('rende univoci gli id duplicati senza perdere entità valide', () => {
    const reconciled = reconcileAll({
      version: SCHEMA_VERSION,
      ...emptyPersisted(),
      foods: [food('dup', 'Mela'), food('dup', 'Pane')],
    });

    expect(reconciled.foods).toHaveLength(2);
    expect(new Set(reconciled.foods.map((item) => item.id)).size).toBe(2);
  });

  it('usa la chiave del bucket diario come data canonica', () => {
    const snapshot = food('f1', 'Mela');
    const reconciled = reconcileAll({
      version: SCHEMA_VERSION,
      ...emptyPersisted(),
      foods: [snapshot],
      diary: {
        '2026-01-10': [
          {
            id: 'e1',
            date: '2026-02-20',
            meal: 'breakfast',
            foodId: 'f1',
            foodSnapshot: snapshot,
            quantity: 1,
            createdAt: 1,
          },
        ],
      },
    });

    expect(reconciled.diary['2026-01-10'][0].date).toBe('2026-01-10');
    expect(reconciled.diary['2026-02-20']).toBeUndefined();
  });

  it('ripara un foodId corrotto usando identità dello snapshot', () => {
    const saved = food('canonical', 'Mela', '8000000000001');
    const reconciled = reconcileAll({
      version: SCHEMA_VERSION,
      ...emptyPersisted(),
      foods: [saved],
      diary: {
        '2026-01-10': [
          {
            id: 'e1',
            date: '2026-01-10',
            meal: 'breakfast',
            foodId: 'stale-id',
            foodSnapshot: food('snapshot', 'Mela', '8000000000001'),
            quantity: 1,
            createdAt: 1,
          },
        ],
      },
    });

    expect(reconciled.diary['2026-01-10'][0].foodId).toBe('canonical');
  });
});

describe('store invariants', () => {
  it('rifiuta atomicamente un batch che supererebbe il limite giornaliero', () => {
    const snapshot = food('f1', 'Mela');
    const existing: DiaryEntry[] = Array.from({ length: MAX_DIARY_ENTRIES_PER_DAY - 1 }, (_, index) => ({
      id: `existing-${index}`,
      date: '2026-01-01',
      meal: 'breakfast',
      foodId: snapshot.id,
      foodSnapshot: snapshot,
      quantity: 1,
      createdAt: index,
    }));
    setState({ foods: [snapshot], diary: { '2026-01-01': existing } });

    const result = addDiaryEntries([
      {
        date: '2026-01-01',
        meal: 'lunch',
        foodId: snapshot.id,
        foodSnapshot: snapshot,
        quantity: 1,
      },
      {
        date: '2026-01-01',
        meal: 'dinner',
        foodId: snapshot.id,
        foodSnapshot: snapshot,
        quantity: 1,
      },
    ]);

    expect(result).toBeNull();
    expect(getState().diary['2026-01-01']).toHaveLength(MAX_DIARY_ENTRIES_PER_DAY - 1);
  });

  it('non permette a updateFood di cambiare id e createdAt', () => {
    const original = food('f1', 'Mela');
    setState({ foods: [original] });

    updateFood('f1', { id: 'hijacked', createdAt: 999, name: 'Mela rossa' });

    expect(getState().foods[0]).toMatchObject({ id: 'f1', createdAt: 1, name: 'Mela rossa' });
  });

  it('ignora una data dashboard invalida', () => {
    setCurrentDate('2026-02-30');
    expect(getState().currentDate).toBe('2026-01-01');
  });
});

describe('biometric temporal invariants', () => {
  it('non usa una misurazione futura per precompilare una data storica', () => {
    const display = getBiometricForDisplay(
      {
        '2026-01-01': { weightKg: 80 },
        '2026-02-01': { weightKg: 70 },
      },
      '2026-01-15',
    );

    expect(display.weightKg).toBe(80);
    expect(display.weightKgSourceDate).toBe('2026-01-01');
    expect(display.weightKgInferred).toBe(true);
  });

  it('la media mobile a 7 giorni esclude registrazioni troppo lontane', () => {
    const points: WeightPoint[] = [
      { date: '2026-01-01', weightKg: 70 },
      { date: '2026-01-02', weightKg: 72 },
      { date: '2026-01-20', weightKg: 100 },
    ];

    const trend = computeWeightMovingAverage(points, 7);
    expect(trend[1].ma7).toBe(71);
    expect(trend[2].ma7).toBe(100);
  });
});

describe('multi-tab revision ordering', () => {
  it('applica la revisione più nuova e ignora snapshot successivamente più vecchi', () => {
    initMultiTabSync();
    const payload = (revision: number, calorieGoal: number) =>
      JSON.stringify({
        version: SCHEMA_VERSION,
        revision,
        ...emptyPersisted(),
        settings: {
          calorieGoal,
          macroSplit: { proteinPct: 30, carbsPct: 40, fatPct: 30 },
          theme: 'system',
        },
      });

    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY, newValue: payload(5, 2500) }));
    expect(getState().settings.calorieGoal).toBe(2500);

    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY, newValue: payload(4, 1400) }));
    expect(getState().settings.calorieGoal).toBe(2500);
  });
});

describe('complete local reset primitives', () => {
  it('rimuove tutte le cache runtime che possono contenere attività utente', async () => {
    const deleteCache = vi.fn().mockResolvedValue(true);
    const previousCaches = globalThis.caches;
    Object.defineProperty(globalThis, 'caches', {
      configurable: true,
      value: { delete: deleteCache },
    });

    try {
      await clearRuntimeDataCaches();
      expect(deleteCache).toHaveBeenCalledTimes(3);
      expect(deleteCache).toHaveBeenCalledWith('nutritrack-off-api');
      expect(deleteCache).toHaveBeenCalledWith('nutritrack-off-img');
      expect(deleteCache).toHaveBeenCalledWith('nutritrack-img');
    } finally {
      Object.defineProperty(globalThis, 'caches', { configurable: true, value: previousCaches });
    }
  });
});
