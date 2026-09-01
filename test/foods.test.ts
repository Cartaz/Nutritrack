import { beforeEach, describe, expect, it } from 'vitest';
import { addCustomPortionToFood, saveOffFood } from '../src/lib/foods';
import { getState, setState } from '../src/lib/store';
import type { FoodItem } from '../src/types';

function food(overrides: Partial<FoodItem> = {}): FoodItem {
  return {
    id: 'off-temp',
    name: 'Pasta',
    brand: 'Marca',
    barcode: '8000000000001',
    source: 'openfoodfacts',
    servingSize: 100,
    nutrition: { calories: 350, protein: 12, carbs: 70, fat: 2 },
    createdAt: 1,
    ...overrides,
  };
}

beforeEach(() => {
  setState({
    foods: [],
    diary: {},
    recipes: [],
    favoriteFoodIds: [],
    biometrics: {},
  });
});

describe('saveOffFood', () => {
  it('riusa il food salvato con lo stesso barcode', () => {
    const existing = food({ id: 'food-existing', createdAt: 10 });
    setState({ foods: [existing] });

    const saved = saveOffFood(food({ id: 'off-new', name: 'Nome remoto aggiornato' }));

    expect(saved).toBe(existing);
    expect(getState().foods).toEqual([existing]);
  });

  it('deduplica per nome e marca case-insensitive quando manca il barcode', () => {
    const existing = food({ id: 'food-existing', name: 'Pasta', brand: 'Marca', barcode: undefined });
    setState({ foods: [existing] });

    const saved = saveOffFood(food({ id: 'off-new', name: 'pasta', brand: 'MARCA', barcode: undefined }));

    expect(saved).toBe(existing);
    expect(getState().foods).toHaveLength(1);
  });

  it('assegna una nuova identità locale a un alimento remoto non ancora salvato', () => {
    const saved = saveOffFood(food());

    expect(saved.id).toMatch(/^food_/);
    expect(saved.id).not.toBe('off-temp');
    expect(getState().foods).toHaveLength(1);
    expect(getState().foods[0].id).toBe(saved.id);
  });
});

describe('custom food portions', () => {
  it('normalizza label e grammi prima di affidare la porzione allo store', () => {
    const existing = food({ id: 'food-1', source: 'custom', barcode: undefined, customPortions: undefined });
    setState({ foods: [existing] });

    const portion = addCustomPortionToFood(existing.id, '  Tazza  ', 123.46);

    expect(portion).toMatchObject({ label: 'Tazza', grams: 123.5 });
    expect(portion?.id).toMatch(/^port_/);
    expect(getState().foods[0].customPortions).toEqual([portion]);
  });

  it('rifiuta label duplicate senza mutare le porzioni esistenti', () => {
    const existing = food({
      id: 'food-1',
      source: 'custom',
      barcode: undefined,
      customPortions: [{ id: 'portion-1', label: 'Tazza', grams: 120 }],
    });
    setState({ foods: [existing] });

    const portion = addCustomPortionToFood(existing.id, ' tAZZa ', 100);

    expect(portion).toBeNull();
    expect(getState().foods[0].customPortions).toEqual(existing.customPortions);
  });
});
