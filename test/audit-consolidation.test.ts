import { describe, expect, it, vi } from 'vitest';
import { clearRuntimeDataCaches } from '../src/lib/localData';
import { getState, setCurrentDate, setState } from '../src/lib/store';

describe('audit consolidation invariants', () => {
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
