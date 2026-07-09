// Test unitari per src/lib/gamification.ts
//
// Verifica:
// - computeStreak: streak corrente, longest, tolleranza "ieri tracciato ma oggi no"
// - getBadgeStatuses: flag unlocked corretto per ogni badge
// - countUnlockedBadges
// - edge cases: diario vuoto, gap, date non consecutive

import { describe, it, expect, beforeEach } from 'vitest';
import { computeStreak, getBadgeStatuses, countUnlockedBadges, BADGES } from '../src/lib/gamification';
import { getState, setState } from '../src/lib/store';
import type { DayDiary, FoodItem, DiaryEntry, AppState } from '../src/types';
import { toDateKey } from '../src/lib/utils';

beforeEach(() => {
  setState({
    foods: [],
    diary: {},
    recipes: [],
    favoriteFoodIds: [],
    biometrics: {},
  });
});

function makeFood(id: string): FoodItem {
  return {
    id,
    name: id,
    source: 'custom',
    servingSize: 100,
    nutrition: { calories: 100, protein: 5, carbs: 20, fat: 2 },
    createdAt: 0,
  };
}

function makeEntry(date: string): DiaryEntry {
  return {
    id: `e_${date}`,
    date,
    meal: 'lunch',
    foodSnapshot: makeFood(`food_${date}`),
    quantity: 1,
    createdAt: 0,
  };
}

/** Crea un diario con entry nei giorni specificati (offset da oggi, negativo = passato). */
function diaryFromDays(dayOffsets: number[]): DayDiary {
  const out: DayDiary = {};
  for (const offset of dayOffsets) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    const key = toDateKey(d);
    out[key] = [makeEntry(key)];
  }
  return out;
}

describe('computeStreak', () => {
  it('diario vuoto: current=0, longest=0, lastTrackedDate=null', () => {
    const s = computeStreak({});
    expect(s.current).toBe(0);
    expect(s.longest).toBe(0);
    expect(s.lastTrackedDate).toBeNull();
  });

  it('streak corrente: oggi tracciato, giorni precedenti consecutivi', () => {
    const diary = diaryFromDays([0, -1, -2, -3]);
    const s = computeStreak(diary);
    expect(s.current).toBe(4);
    expect(s.longest).toBe(4);
  });

  it('tolleranza: ieri tracciato ma oggi no → streak vivo (current = quello di ieri)', () => {
    const diary = diaryFromDays([-1, -2, -3]);
    const s = computeStreak(diary);
    expect(s.current).toBe(3);
  });

  it('streak rotto: gap di 2+ giorni → current=0 anche se ci sono tracciature passate', () => {
    const diary = diaryFromDays([-3, -4, -5]); // gap di 2 giorni da oggi
    const s = computeStreak(diary);
    expect(s.current).toBe(0);
    expect(s.longest).toBe(3); // ma longest conta la run passata
  });

  it('longest: conta la run più lunga anche se non è quella corrente', () => {
    // run di 5 giorni 10 giorni fa, poi niente
    const diary = diaryFromDays([-10, -11, -12, -13, -14]);
    const s = computeStreak(diary);
    expect(s.current).toBe(0); // streak rotto
    expect(s.longest).toBe(5);
  });

  it('longest con più run: tiene la massima', () => {
    // run di 3, gap, run di 5
    const diary = diaryFromDays([-1, -2, -3, -10, -11, -12, -13, -14]);
    const s = computeStreak(diary);
    expect(s.current).toBe(3); // -1,-2,-3 (più tolleranza oggi non tracciato)
    expect(s.longest).toBe(5); // -10..-14
  });

  it('lastTrackedDate: ultima data tracciata in ordine cronologico', () => {
    const diary = diaryFromDays([-5, -2, -10, -1]);
    const s = computeStreak(diary);
    const expectedLast = (() => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return toDateKey(d);
    })();
    expect(s.lastTrackedDate).toBe(expectedLast);
  });

  it('giorni con 0 entry non contano come tracciati', () => {
    const today = toDateKey(new Date());
    const diary: DayDiary = {
      [today]: [], // 0 entry
    };
    const s = computeStreak(diary);
    expect(s.current).toBe(0);
    expect(s.longest).toBe(0);
  });
});

describe('getBadgeStatuses', () => {
  it('state vuoto: nessun badge sbloccato', () => {
    const badges = getBadgeStatuses(getState());
    expect(badges.every((b) => !b.unlocked)).toBe(true);
  });

  it('first_entry sbloccato con 1 entry nel diario', () => {
    setState({ diary: diaryFromDays([0]) });
    const badges = getBadgeStatuses(getState());
    const firstEntry = badges.find((b) => b.id === 'first_entry');
    expect(firstEntry?.unlocked).toBe(true);
  });

  it('first_week sbloccato con streak longest >= 7', () => {
    setState({ diary: diaryFromDays([0, -1, -2, -3, -4, -5, -6]) });
    const badges = getBadgeStatuses(getState());
    const firstWeek = badges.find((b) => b.id === 'first_week');
    expect(firstWeek?.unlocked).toBe(true);
  });

  it('100_days sbloccato con 100 giorni tracciati (non consecutivi)', () => {
    const offsets: number[] = [];
    for (let i = 0; i < 100; i++) offsets.push(-i - 1); // 100 giorni, 1 entry ogni 2 giorni
    // ma devono essere 100 date distinte
    const out: DayDiary = {};
    for (let i = 0; i < 100; i++) {
      const d = new Date();
      d.setDate(d.getDate() - (i + 1));
      const key = toDateKey(d);
      out[key] = [makeEntry(key)];
    }
    setState({ diary: out });
    const badges = getBadgeStatuses(getState());
    const centurion = badges.find((b) => b.id === '100_days');
    expect(centurion?.unlocked).toBe(true);
  });

  it('first_recipe sbloccato con 1 ricetta', () => {
    setState({
      recipes: [
        {
          id: 'r1',
          name: 'Test',
          servings: 1,
          ingredients: [{ id: 'i1', foodSnapshot: makeFood('f1'), grams: 100 }],
          createdAt: 0,
          updatedAt: 0,
        },
      ],
    });
    const badges = getBadgeStatuses(getState());
    expect(badges.find((b) => b.id === 'first_recipe')?.unlocked).toBe(true);
  });

  it('10_recipes sbloccato con 10 ricette', () => {
    const recipes = Array.from({ length: 10 }, (_, i) => ({
      id: `r${i}`,
      name: `R${i}`,
      servings: 1,
      ingredients: [{ id: `i${i}`, foodSnapshot: makeFood(`f${i}`), grams: 100 }],
      createdAt: 0,
      updatedAt: 0,
    }));
    setState({ recipes });
    const badges = getBadgeStatuses(getState());
    expect(badges.find((b) => b.id === '10_recipes')?.unlocked).toBe(true);
  });

  it('biometric sbloccato con 1 entry biometrica', () => {
    setState({ biometrics: { '2026-07-10': { waterMl: 500 } } });
    const badges = getBadgeStatuses(getState());
    expect(badges.find((b) => b.id === 'biometric')?.unlocked).toBe(true);
  });

  it('water_goal sbloccato con >= 2000 ml in un giorno', () => {
    setState({ biometrics: { '2026-07-10': { waterMl: 2000 } } });
    const badges = getBadgeStatuses(getState());
    expect(badges.find((b) => b.id === 'water_goal')?.unlocked).toBe(true);
  });

  it('water_goal NON sbloccato con < 2000 ml', () => {
    setState({ biometrics: { '2026-07-10': { waterMl: 1500 } } });
    const badges = getBadgeStatuses(getState());
    expect(badges.find((b) => b.id === 'water_goal')?.unlocked).toBe(false);
  });
});

describe('countUnlockedBadges', () => {
  it('state vuoto: 0', () => {
    expect(countUnlockedBadges(getState())).toBe(0);
  });

  it('conta correttamente i badge sbloccati', () => {
    const state: AppState = {
      ...getState(),
      diary: { '2026-07-10': [makeEntry('2026-07-10')] },
      recipes: [
        {
          id: 'r1',
          name: 'Test',
          servings: 1,
          ingredients: [{ id: 'i1', foodSnapshot: makeFood('f1'), grams: 100 }],
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      biometrics: { '2026-07-10': { waterMl: 2500 } },
    };
    // Sbloccati: first_entry, first_recipe, biometric, water_goal = 4
    expect(countUnlockedBadges(state)).toBe(4);
  });
});

describe('BADGES definizioni', () => {
  it('tutti i badge hanno id, name, description, icon, isUnlocked unici', () => {
    const ids = new Set(BADGES.map((b) => b.id));
    expect(ids.size).toBe(BADGES.length);
    for (const b of BADGES) {
      expect(typeof b.id).toBe('string');
      expect(typeof b.name).toBe('string');
      expect(typeof b.description).toBe('string');
      expect(typeof b.icon).toBe('string');
      expect(typeof b.isUnlocked).toBe('function');
    }
  });
});
