import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoodItem, OffProduct } from '../src/types';

const mocks = vi.hoisted(() => ({
  searchOff: vi.fn(),
  searchOffWithPartialMatch: vi.fn(),
  getOffByBarcode: vi.fn(),
  buildFoodFromOff: vi.fn(),
}));

vi.mock('../src/lib/api', () => ({
  searchOff: mocks.searchOff,
  searchOffWithPartialMatch: mocks.searchOffWithPartialMatch,
  getOffByBarcode: mocks.getOffByBarcode,
}));

vi.mock('../src/lib/normalize', () => ({
  buildFoodFromOff: mocks.buildFoodFromOff,
}));

import { continueFoodSearch, lookupFoodByBarcode, searchFoods } from '../src/lib/food-search';

const FOOD: FoodItem = {
  id: 'off-1',
  name: 'Melanzane',
  source: 'openfoodfacts',
  servingSize: 100,
  nutrition: { calories: 25, protein: 1, carbs: 6, fat: 0.2 },
  createdAt: 1,
};

const PRODUCT = { code: '123' } as OffProduct;

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  mocks.buildFoodFromOff.mockReturnValue(FOOD);
});

describe('food search policy', () => {
  it('hides partial-match mechanics behind an opaque continuation', async () => {
    mocks.searchOffWithPartialMatch.mockResolvedValue({
      products: [PRODUCT],
      count: 5,
      page: 1,
      pageSize: 2,
      effectiveQuery: 'melanzane',
    });

    const result = await searchFoods(' melanzan ', { italianOnly: true });

    expect(mocks.searchOffWithPartialMatch).toHaveBeenCalledWith('melanzan', {
      signal: undefined,
      italianOnly: true,
      page: 1,
    });
    expect(result.foods).toEqual([FOOD]);
    expect(result.totalCount).toBe(5);
    expect(result.continuation).toEqual({ effectiveQuery: 'melanzane', nextPage: 2, italianOnly: true });
  });

  it('continues using the effective query and advances pagination internally', async () => {
    mocks.searchOff.mockResolvedValue({ products: [PRODUCT], count: 5, page: 2, pageSize: 2 });

    const result = await continueFoodSearch({ effectiveQuery: 'melanzane', nextPage: 2, italianOnly: true });

    expect(mocks.searchOff).toHaveBeenCalledWith('melanzane', {
      signal: undefined,
      italianOnly: true,
      page: 2,
    });
    expect(result.continuation).toEqual({ effectiveQuery: 'melanzane', nextPage: 3, italianOnly: true });
  });

  it('returns no continuation when the OFF page reaches the reported count', async () => {
    mocks.searchOffWithPartialMatch.mockResolvedValue({
      products: [PRODUCT],
      count: 2,
      page: 1,
      pageSize: 2,
      effectiveQuery: 'pasta',
    });

    const result = await searchFoods('pasta');

    expect(result.continuation).toBeNull();
  });

  it('retries a transient failure exactly once inside the domain module', async () => {
    vi.useFakeTimers();
    mocks.searchOffWithPartialMatch
      .mockRejectedValueOnce(Object.assign(new Error('network'), { name: 'NetworkError' }))
      .mockResolvedValueOnce({ products: [PRODUCT], count: 1, page: 1, pageSize: 24, effectiveQuery: 'pasta' });

    const pending = searchFoods('pasta');
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await pending;

    expect(result.foods).toEqual([FOOD]);
    expect(mocks.searchOffWithPartialMatch).toHaveBeenCalledTimes(2);
  });

  it('does not retry an unknown non-transient failure', async () => {
    mocks.searchOffWithPartialMatch.mockRejectedValue(new Error('bad payload'));

    await expect(searchFoods('pasta')).rejects.toMatchObject({
      name: 'FoodSearchError',
      kind: 'unknown',
    });
    expect(mocks.searchOffWithPartialMatch).toHaveBeenCalledTimes(1);
  });

  it('classifies a persistent server failure after the single retry', async () => {
    vi.useFakeTimers();
    mocks.searchOffWithPartialMatch.mockRejectedValue(Object.assign(new Error('server'), { status: 503 }));

    const pending = searchFoods('pasta');
    const assertion = expect(pending).rejects.toMatchObject({
      name: 'FoodSearchError',
      kind: 'unavailable',
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;

    expect(mocks.searchOffWithPartialMatch).toHaveBeenCalledTimes(2);
  });

  it('aborts during retry delay without issuing a second request', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    mocks.searchOffWithPartialMatch.mockRejectedValueOnce(
      Object.assign(new Error('timeout'), { name: 'TimeoutError' }),
    );

    const pending = searchFoods('pasta', { signal: controller.signal });
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve();
    controller.abort();
    await vi.runAllTimersAsync();
    await assertion;

    expect(mocks.searchOffWithPartialMatch).toHaveBeenCalledTimes(1);
  });
});

describe('barcode lookup policy', () => {
  it('maps a found OFF product into a food', async () => {
    mocks.getOffByBarcode.mockResolvedValue(PRODUCT);

    await expect(lookupFoodByBarcode('123')).resolves.toEqual({ kind: 'found', food: FOOD });
  });

  it('distinguishes not-found from nutritionally incomplete products', async () => {
    mocks.getOffByBarcode.mockResolvedValueOnce(null).mockResolvedValueOnce(PRODUCT);
    mocks.buildFoodFromOff.mockReturnValueOnce(null);

    await expect(lookupFoodByBarcode('missing')).resolves.toEqual({ kind: 'not-found' });
    await expect(lookupFoodByBarcode('incomplete')).resolves.toEqual({ kind: 'incomplete' });
  });
});
