import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoodItem } from '../src/types';

const mocks = vi.hoisted(() => ({ searchFoods: vi.fn(), continueFoodSearch: vi.fn() }));
vi.mock('../src/lib/food-search', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/food-search')>()),
  searchFoods: mocks.searchFoods,
  continueFoodSearch: mocks.continueFoodSearch,
}));

import { FoodSearchSession } from '../src/components/foodSearchSession';

function food(id: string): FoodItem {
  return {
    id,
    name: `Food ${id}`,
    source: 'openfoodfacts',
    servingSize: 100,
    nutrition: { calories: 100, protein: 1, carbs: 1, fat: 1 },
    createdAt: 1,
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

describe('FoodSearchSession', () => {
  it('never queries while typing: only run() sends one request, always with the Italy filter', async () => {
    mocks.searchFoods.mockResolvedValue({ foods: [food('a')], totalCount: 1, continuation: null });
    const onChange = vi.fn();
    const session = new FoodSearchSession(onChange, () => true);

    session.setQuery('pa');
    session.setQuery('pas');
    session.setQuery('pasta');
    expect(mocks.searchFoods).not.toHaveBeenCalled();

    expect(session.run()).toBe(true);
    await settle();
    expect(mocks.searchFoods).toHaveBeenCalledTimes(1);
    expect(mocks.searchFoods).toHaveBeenCalledWith('pasta', expect.objectContaining({ italianOnly: true }));
    expect(session.results.map((f) => f.id)).toEqual(['a']);
    expect(session.searched).toBe(true);
    expect(session.loading).toBe(false);
  });

  it('refuses a too-short query without a request', () => {
    const session = new FoodSearchSession(vi.fn(), () => true);
    session.setQuery('p');
    expect(session.run()).toBe(false);
    expect(mocks.searchFoods).not.toHaveBeenCalled();
  });

  it('ignores a late response for a query the user has already changed', async () => {
    let resolve!: (value: unknown) => void;
    mocks.searchFoods.mockReturnValue(new Promise((r) => (resolve = r)));
    const session = new FoodSearchSession(vi.fn(), () => true);
    session.setQuery('pasta');
    session.run();
    session.setQuery('riso');
    resolve({ foods: [food('late')], totalCount: 1, continuation: null });
    await settle();
    expect(session.results).toEqual([]);
    expect(session.searched).toBe(false);
  });

  it('appends the next page without duplicates', async () => {
    const continuation = { effectiveQuery: 'pasta', nextPage: 2, italianOnly: true };
    mocks.searchFoods.mockResolvedValue({ foods: [food('a'), food('b')], totalCount: 3, continuation });
    mocks.continueFoodSearch.mockResolvedValue({ foods: [food('b'), food('c')], totalCount: 3, continuation: null });
    const session = new FoodSearchSession(vi.fn(), () => true);
    session.setQuery('pasta');
    session.run();
    await settle();
    expect(session.canLoadMore).toBe(true);
    expect(session.remainingCount).toBe(1);
    session.loadMore();
    await settle();
    expect(session.results.map((f) => f.id)).toEqual(['a', 'b', 'c']);
    expect(session.canLoadMore).toBe(false);
  });
});
