import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoodItem, OffProduct } from '../src/types';

const mocks = vi.hoisted(() => ({
  searchOff: vi.fn(),
  getOffByBarcode: vi.fn(),
  buildFoodFromOff: vi.fn(),
}));

vi.mock('../src/lib/api', () => ({
  searchOff: mocks.searchOff,
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
  it('maps one initial search to one searchOff call and keeps pagination opaque', async () => {
    mocks.searchOff.mockResolvedValue({ products: [PRODUCT], count: 5, page: 1, pageSize: 2 });

    const result = await searchFoods(' melanzan ', { italianOnly: true });

    expect(mocks.searchOff).toHaveBeenCalledTimes(1);
    expect(mocks.searchOff).toHaveBeenCalledWith('melanzan', { signal: undefined, italianOnly: true, page: 1 });
    expect(result.foods).toEqual([FOOD]);
    expect(result.continuation).toEqual({ effectiveQuery: 'melanzan', nextPage: 2, italianOnly: true });
  });

  it('continues pagination with exactly one explicit request', async () => {
    mocks.searchOff.mockResolvedValue({ products: [PRODUCT], count: 5, page: 2, pageSize: 2 });
    const result = await continueFoodSearch({ effectiveQuery: 'melanzan', nextPage: 2, italianOnly: true });
    expect(mocks.searchOff).toHaveBeenCalledTimes(1);
    expect(result.continuation).toEqual({ effectiveQuery: 'melanzan', nextPage: 3, italianOnly: true });
  });

  it('does not retry a transient textual-search failure automatically', async () => {
    mocks.searchOff.mockRejectedValue(Object.assign(new Error('network'), { name: 'NetworkError' }));
    await expect(searchFoods('pasta')).rejects.toMatchObject({ name: 'FoodSearchError', kind: 'network' });
    expect(mocks.searchOff).toHaveBeenCalledTimes(1);
  });
});

describe('barcode lookup policy', () => {
  it('keeps a single retry for point barcode lookup', async () => {
    vi.useFakeTimers();
    mocks.getOffByBarcode
      .mockRejectedValueOnce(Object.assign(new Error('network'), { name: 'NetworkError' }))
      .mockResolvedValueOnce(PRODUCT);
    const pending = lookupFoodByBarcode('123');
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(pending).resolves.toEqual({ kind: 'found', food: FOOD });
    expect(mocks.getOffByBarcode).toHaveBeenCalledTimes(2);
  });

  it('distinguishes not-found from nutritionally incomplete products', async () => {
    mocks.getOffByBarcode.mockResolvedValueOnce(null).mockResolvedValueOnce(PRODUCT);
    mocks.buildFoodFromOff.mockReturnValueOnce(null);
    await expect(lookupFoodByBarcode('missing')).resolves.toEqual({ kind: 'not-found' });
    await expect(lookupFoodByBarcode('incomplete')).resolves.toEqual({ kind: 'incomplete' });
  });
});
