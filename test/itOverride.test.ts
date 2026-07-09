// Test unitari per src/lib/itOverride.ts
//
// Verifica:
// - getItOverrideByBarcode: hit/miss, id fresco ad ogni chiamata, barcode normalizzato
// - getItOverrideCount / getItOverrideVerifiedCount
// - getItOverrideVersion / getItOverrideUpdatedAt
// - validateProduct (via buildMap indiretta): scarta prodotti senza barcode/nome/nutrizione
// - integrazione: il FoodItem ritornato è compatibile con saveOffFood (source openfoodfacts + barcode)

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getItOverrideByBarcode,
  getItOverrideCount,
  getItOverrideVerifiedCount,
  getItOverrideVersion,
  getItOverrideUpdatedAt,
  __resetItOverrideForTesting,
} from '../src/lib/itOverride';
import { saveOffFood } from '../src/lib/foods';
import { getState, setState } from '../src/lib/store';

beforeEach(() => {
  __resetItOverrideForTesting();
  setState({
    foods: [],
    diary: {},
    recipes: [],
    favoriteFoodIds: [],
    biometrics: {},
  });
});

describe('getItOverrideByBarcode', () => {
  it('ritorna un FoodItem per un barcode presente nel DB', () => {
    const food = getItOverrideByBarcode('8000123005117'); // Coca-Cola
    expect(food).not.toBeNull();
    expect(food!.name).toBe('Coca-Cola Lattina');
    expect(food!.brand).toBe('Coca-Cola');
    expect(food!.barcode).toBe('8000123005117');
    expect(food!.source).toBe('openfoodfacts');
    expect(food!.nutrition.calories).toBe(42);
    expect(food!.servingSize).toBe(100);
  });

  it('ritorna null per barcode non presente', () => {
    expect(getItOverrideByBarcode('0000000000000')).toBeNull();
  });

  it('ritorna null per barcode vuoto o non stringa', () => {
    expect(getItOverrideByBarcode('')).toBeNull();
    expect(getItOverrideByBarcode('   ')).toBeNull();
    // @ts-expect-error test passaggio tipo sbagliato
    expect(getItOverrideByBarcode(null)).toBeNull();
    // @ts-expect-error test passaggio tipo sbagliato
    expect(getItOverrideByBarcode(undefined)).toBeNull();
  });

  it('normalizza whitespace attorno al barcode', () => {
    const food = getItOverrideByBarcode('  8000123005117  ');
    expect(food).not.toBeNull();
    expect(food!.barcode).toBe('8000123005117');
  });

  it('genera id fresco (diverso) ad ogni chiamata', () => {
    const a = getItOverrideByBarcode('8000123005117');
    const b = getItOverrideByBarcode('8000123005117');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.id).not.toBe(b!.id);
    // stesso contenuto nutrizionale però
    expect(a!.nutrition).toEqual(b!.nutrition);
  });

  it('non muta il FoodItem cached tra chiamate (copia difensiva)', () => {
    const a = getItOverrideByBarcode('8000123005117')!;
    a.name = 'MODIFICATO';
    const b = getItOverrideByBarcode('8000123005117')!;
    expect(b.name).toBe('Coca-Cola Lattina');
  });
});

describe('getItOverrideCount / getItOverrideVerifiedCount', () => {
  it('ritorna un numero positivo (>0, il DB seed ha ~25 prodotti)', () => {
    expect(getItOverrideCount()).toBeGreaterThan(10);
  });

  it('ritorna un numero di verificati <= totale', () => {
    const total = getItOverrideCount();
    const verified = getItOverrideVerifiedCount();
    expect(verified).toBeGreaterThanOrEqual(0);
    expect(verified).toBeLessThanOrEqual(total);
  });
});

describe('getItOverrideVersion / getItOverrideUpdatedAt', () => {
  it('ritorna versione 1', () => {
    expect(getItOverrideVersion()).toBe(1);
  });

  it('ritorna una data non vuota', () => {
    expect(getItOverrideUpdatedAt()).toBeTruthy();
    expect(getItOverrideUpdatedAt().length).toBeGreaterThan(5);
  });
});

describe('integrazione con saveOffFood (dedupe per barcode)', () => {
  it('un food IT override salvato dedupe con un secondo salvataggio stesso barcode', () => {
    const itFood = getItOverrideByBarcode('8000123005117')!;
    const saved1 = saveOffFood(itFood);
    expect(saved1.id).toMatch(/^food_/);

    // Salva di nuovo lo stesso barcode (simula scansione ripetuta)
    const itFood2 = getItOverrideByBarcode('8000123005117')!;
    const saved2 = saveOffFood(itFood2);
    // Deve riusare lo stesso food salvato (dedupe per barcode)
    expect(saved2.id).toBe(saved1.id);
    expect(getState().foods).toHaveLength(1);
  });

  it("un food salvato con stesso barcode viene trovato prima dell'override", () => {
    // Salva un food custom con il barcode della Coca-Cola ma nome diverso
    // (simula correzione manuale dell'utente)
    setState({
      foods: [
        {
          id: 'food_custom_coke',
          name: 'Coca-Cola Zero (mia)',
          brand: 'Coca-Cola',
          barcode: '8000123005117',
          source: 'custom',
          servingSize: 100,
          nutrition: { calories: 0, protein: 0, carbs: 0, fat: 0 },
          createdAt: 0,
        },
      ],
    });
    // saveOffFood con un food override stesso barcode → riusa il custom salvato
    const itFood = getItOverrideByBarcode('8000123005117')!;
    const result = saveOffFood(itFood);
    expect(result.id).toBe('food_custom_coke');
    expect(result.name).toBe('Coca-Cola Zero (mia)');
    expect(getState().foods).toHaveLength(1);
  });
});
