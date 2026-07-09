// Test unitari per src/lib/clipboard.ts
//
// Verifica:
// - formatDiaryAsMarkdown: struttura markdown, totali, sub-totali per pasto, biometria, empty state
// - formatRecipeAsMarkdown: struttura, totali, per-porzione, ingredienti
// - copyToClipboard: mock navigator.clipboard + fallback execCommand

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { copyToClipboard, formatDiaryAsMarkdown, formatRecipeAsMarkdown } from '../src/lib/clipboard';
import { setState } from '../src/lib/store';
import type { Recipe, FoodItem } from '../src/types';

beforeEach(() => {
  setState({
    foods: [],
    diary: {},
    recipes: [],
    favoriteFoodIds: [],
    biometrics: {},
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeFood(name: string, calories: number, protein = 10, carbs = 20, fat = 5): FoodItem {
  return {
    id: `food_${name}`,
    name,
    source: 'custom',
    servingSize: 100,
    nutrition: { calories, protein, carbs, fat },
    createdAt: 0,
  };
}

describe('formatDiaryAsMarkdown', () => {
  it('diario vuoto: ritorna header con nota "nessuna voce"', () => {
    const md = formatDiaryAsMarkdown('2026-07-10');
    expect(md).toContain('# NutriTrack');
    expect(md).toContain('Nessuna voce registrata');
  });

  it('diario con entries: include header, totale giornata, pasti, sub-totali', () => {
    const food = makeFood('Pasta', 350);
    setState({
      diary: {
        '2026-07-10': [
          {
            id: 'e1',
            date: '2026-07-10',
            meal: 'lunch',
            foodSnapshot: food,
            quantity: 1,
            gramsOverride: 200,
            createdAt: 0,
          },
          {
            id: 'e2',
            date: '2026-07-10',
            meal: 'snack',
            foodSnapshot: makeFood('Mela', 52),
            quantity: 1,
            createdAt: 0,
          },
        ],
      },
    });
    const md = formatDiaryAsMarkdown('2026-07-10');
    // Header con data
    expect(md).toMatch(/^# NutriTrack/);
    // Totale giornata
    expect(md).toContain('Totale giornata');
    // Pasto pranzo
    expect(md).toContain('Pranzo');
    expect(md).toContain('Pasta');
    // Pasto spuntino
    expect(md).toContain('Spuntino');
    expect(md).toContain('Mela');
    // Sub-totali
    expect(md).toContain('Subtotale');
  });

  it('include biometria se presente', () => {
    setState({
      diary: {
        '2026-07-10': [
          {
            id: 'e1',
            date: '2026-07-10',
            meal: 'breakfast',
            foodSnapshot: makeFood('Caffè', 2),
            quantity: 1,
            createdAt: 0,
          },
        ],
      },
      biometrics: { '2026-07-10': { waterMl: 1500, sleepHours: 7.5, weightKg: 78.4 } },
    });
    const md = formatDiaryAsMarkdown('2026-07-10');
    expect(md).toContain('Biometria');
    expect(md).toContain('Acqua');
    expect(md).toContain('1500 ml');
    expect(md).toContain('Sonno');
    expect(md).toContain('7.5 h');
    expect(md).toContain('Peso');
    expect(md).toContain('78.4 kg');
  });

  it('non include sezione biometria se assente', () => {
    setState({
      diary: {
        '2026-07-10': [
          {
            id: 'e1',
            date: '2026-07-10',
            meal: 'breakfast',
            foodSnapshot: makeFood('Caffè', 2),
            quantity: 1,
            createdAt: 0,
          },
        ],
      },
    });
    const md = formatDiaryAsMarkdown('2026-07-10');
    expect(md).not.toContain('Biometria');
  });

  it('rispetta MEAL_ORDER: colazione prima di pranzo, cena, spuntino', () => {
    setState({
      diary: {
        '2026-07-10': [
          {
            id: 'e1',
            date: '2026-07-10',
            meal: 'snack',
            foodSnapshot: makeFood('Snack', 100),
            quantity: 1,
            createdAt: 0,
          },
          {
            id: 'e2',
            date: '2026-07-10',
            meal: 'breakfast',
            foodSnapshot: makeFood('Colazione', 200),
            quantity: 1,
            createdAt: 0,
          },
          {
            id: 'e3',
            date: '2026-07-10',
            meal: 'dinner',
            foodSnapshot: makeFood('Cena', 500),
            quantity: 1,
            createdAt: 0,
          },
          {
            id: 'e4',
            date: '2026-07-10',
            meal: 'lunch',
            foodSnapshot: makeFood('Pranzo', 400),
            quantity: 1,
            createdAt: 0,
          },
        ],
      },
    });
    const md = formatDiaryAsMarkdown('2026-07-10');
    const idxBreakfast = md.indexOf('Colazione');
    const idxLunch = md.indexOf('Pranzo');
    const idxDinner = md.indexOf('Cena');
    const idxSnack = md.indexOf('Spuntino');
    expect(idxBreakfast).toBeLessThan(idxLunch);
    expect(idxLunch).toBeLessThan(idxDinner);
    expect(idxDinner).toBeLessThan(idxSnack);
  });
});

describe('formatRecipeAsMarkdown', () => {
  it('include nome, descrizione, porzioni, totali, per-porzione, ingredienti', () => {
    const recipe: Recipe = {
      id: 'r1',
      name: 'Pasta al Pomodoro',
      description: 'Classico italiano',
      servings: 2,
      ingredients: [
        { id: 'i1', foodSnapshot: makeFood('Pasta', 350), grams: 200 },
        { id: 'i2', foodSnapshot: makeFood('Passata', 30), grams: 150 },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    const md = formatRecipeAsMarkdown(recipe);
    expect(md).toContain('# Pasta al Pomodoro');
    expect(md).toContain('Classico italiano');
    expect(md).toContain('**Porzioni:** 2');
    expect(md).toContain('**Totale:**');
    expect(md).toContain('**Per porzione:**');
    expect(md).toContain('Ingredienti');
    expect(md).toContain('200g **Pasta**');
    expect(md).toContain('150g **Passata**');
  });

  it('recipe senza description: omette la riga di quote', () => {
    const recipe: Recipe = {
      id: 'r1',
      name: 'Semplice',
      servings: 1,
      ingredients: [{ id: 'i1', foodSnapshot: makeFood('Pasta', 350), grams: 100 }],
      createdAt: 0,
      updatedAt: 0,
    };
    const md = formatRecipeAsMarkdown(recipe);
    expect(md).not.toContain('> ');
  });

  it('per-porzione = totale / servings', () => {
    const recipe: Recipe = {
      id: 'r1',
      name: 'Test',
      servings: 4,
      ingredients: [{ id: 'i1', foodSnapshot: makeFood('Ing', 400), grams: 100 }],
      createdAt: 0,
      updatedAt: 0,
    };
    const md = formatRecipeAsMarkdown(recipe);
    // 400 kcal/100g * 100g = 400 kcal totale → 100 kcal per porzione
    expect(md).toContain('**Totale:** 400 kcal');
    expect(md).toContain('**Per porzione:** 100 kcal');
  });
});

describe('copyToClipboard', () => {
  it('usa navigator.clipboard.writeText se disponibile', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });

    const ok = await copyToClipboard('testo');
    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith('testo');
  });

  it('fallback a execCommand se clipboard API non disponibile', async () => {
    // Rimuovi clipboard API
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
    const execSpy = vi.spyOn(document, 'execCommand').mockReturnValue(true);

    const ok = await copyToClipboard('testo legacy');
    expect(ok).toBe(true);
    expect(execSpy).toHaveBeenCalledWith('copy');
  });

  it('ritorna false se entrambi i path falliscono', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
    vi.spyOn(document, 'execCommand').mockImplementation(() => {
      throw new Error('denied');
    });

    const ok = await copyToClipboard('testo');
    expect(ok).toBe(false);
  });
});
