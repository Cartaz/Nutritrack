import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearRuntimeDataCaches } from '../src/lib/localData';
import { __resetStorageInternalForTesting, importDataJson } from '../src/lib/storage';
import { getState, setCurrentDate, setState } from '../src/lib/store';
import { SCHEMA_VERSION } from '../src/lib/constants';

beforeEach(() => {
  localStorage.clear();
  __resetStorageInternalForTesting();
});

describe('audit consolidation invariants', () => {
  it('rolls back an import when persistence fails', () => {
    setState({ foods: [], settings: { ...getState().settings, calorieGoal: 2100 } });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('write failed');
    });

    const result = importDataJson(
      JSON.stringify({
        version: SCHEMA_VERSION,
        settings: { ...getState().settings, calorieGoal: 1300 },
        foods: [],
        diary: {},
        recipes: [],
        favoriteFoodIds: [],
        biometrics: {},
      }),
    );

    expect(result.ok).toBe(false);
    expect(getState().settings.calorieGoal).toBe(2100);
  });

  it('rejects an impossible dashboard date at the store boundary', () => {
    setState({ currentDate: '2026-01-01' });
    setCurrentDate('2026-02-30');
    expect(getState().currentDate).toBe('2026-01-01');
  });

  it('clears only runtime caches that can contain user-triggered remote activity', async () => {
    const deleteCache = vi.fn().mockResolvedValue(true);
    const previousCaches = globalThis.caches;
    Object.defineProperty(globalThis, 'caches', { configurable: true, value: { delete: deleteCache } });
    try {
      await clearRuntimeDataCaches();
      expect(deleteCache.mock.calls.map(([name]) => name)).toEqual([
        'nutritrack-off-api',
        'nutritrack-off-img',
        'nutritrack-img',
      ]);
    } finally {
      Object.defineProperty(globalThis, 'caches', { configurable: true, value: previousCaches });
    }
  });
});
