import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, STORAGE_KEY } from '../src/lib/constants';
import { __resetStorageInternalForTesting, importDataJson, loadData, saveData } from '../src/lib/storage';
import { getState, setState } from '../src/lib/store';

function resetStore(): void {
  setState({
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
    _storageDisabled: false,
  });
}

function futurePayload(calorieGoal = 2600): string {
  return JSON.stringify({
    version: SCHEMA_VERSION + 1,
    settings: {
      calorieGoal,
      macroSplit: { proteinPct: 30, carbsPct: 40, fatPct: 30 },
      theme: 'system',
    },
    foods: [],
    diary: {},
    recipes: [],
    favoriteFoodIds: [],
    biometrics: {},
  });
}

beforeEach(() => {
  localStorage.clear();
  __resetStorageInternalForTesting();
  resetStore();
});

afterEach(() => {
  __resetStorageInternalForTesting();
  localStorage.clear();
});

describe('storage schema boundary', () => {
  it('loads an unversioned legacy document through migration before normalization', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        settings: {
          calorieGoal: 1800,
          macroSplit: { proteinPct: 30, carbsPct: 40, fatPct: 30 },
          theme: 'dark',
        },
        foods: [],
        diary: {},
        recipes: [],
        favoriteFoodIds: [],
        biometrics: {},
      }),
    );

    expect(loadData()).toBe(true);
    expect(getState().settings.calorieGoal).toBe(1800);
    expect(getState().settings.theme).toBe('dark');
  });

  it('rejects a future persisted schema without hydrating it', () => {
    localStorage.setItem(STORAGE_KEY, futurePayload());

    expect(loadData()).toBe(false);
    expect(getState().settings.calorieGoal).toBe(2000);
  });

  it('does not overwrite a future physical schema on the next local save', () => {
    const future = futurePayload();
    localStorage.setItem(STORAGE_KEY, future);
    setState({ settings: { ...getState().settings, calorieGoal: 2100 } });

    const result = saveData();

    expect(result.ok).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(future);
  });

  it('rejects future-schema imports with an explicit compatibility error', () => {
    const result = importDataJson(futurePayload());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('schema più recente');
    expect(getState().settings.calorieGoal).toBe(2000);
  });

  it('accepts a legacy unversioned import and persists it as the current schema', () => {
    const result = importDataJson(
      JSON.stringify({
        settings: {
          calorieGoal: 1900,
          macroSplit: { proteinPct: 30, carbsPct: 40, fatPct: 30 },
          theme: 'light',
        },
        foods: [],
        diary: {},
        recipes: [],
        favoriteFoodIds: [],
        biometrics: {},
      }),
    );

    expect(result.ok).toBe(true);
    expect(getState().settings.calorieGoal).toBe(1900);
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>;
    expect(persisted.version).toBe(SCHEMA_VERSION);
  });
});
