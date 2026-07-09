// Test unitari per src/lib/biometrics.ts e la normalizzazione biometria.
//
// Copre:
// - setWater / setSleep / setWeight (clamp + cancellazione su 0/NaN)
// - addWaterGlass / removeWaterGlass
// - computeWeightTrend (ordinamento + skip giorni senza peso)
// - computeWeightMovingAverage (media mobile trailing 7gg)
// - getLatestWeight
// - getBiometricForDisplay (inferenza peso)
// - normalizeBiometricEntry / normalizeBiometrics (range + chiavi data + scarto vuoti)

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setWater,
  addWaterGlass,
  removeWaterGlass,
  setSleep,
  setWeight,
  computeWeightTrend,
  computeWeightMovingAverage,
  getLatestWeight,
  getBiometricForDisplay,
  WATER_GLASS_ML,
} from '../src/lib/biometrics';
import { normalizeBiometricEntry, normalizeBiometrics } from '../src/lib/normalize';
import { getState, setState } from '../src/lib/store';
import { toDateKey } from '../src/lib/utils';

// Silenzia i toast nei test
vi.mock('../src/components/toast', () => ({
  showToast: vi.fn(),
}));

beforeEach(() => {
  setState({
    biometrics: {},
    foods: [],
    diary: {},
    recipes: [],
    favoriteFoodIds: [],
  });
});

describe('normalizeBiometricEntry', () => {
  it('ritorna entry vuota per input non oggetto', () => {
    expect(normalizeBiometricEntry(null)).toEqual({});
    expect(normalizeBiometricEntry('ciao')).toEqual({});
    expect(normalizeBiometricEntry([])).toEqual({});
  });

  it('accetta valori validi nei range', () => {
    expect(normalizeBiometricEntry({ waterMl: 1500, sleepHours: 7.5, weightKg: 80 })).toEqual({
      waterMl: 1500,
      sleepHours: 7.5,
      weightKg: 80,
    });
  });

  it('clampa waterMl fuori range', () => {
    expect(normalizeBiometricEntry({ waterMl: 999999 })).toEqual({ waterMl: 20000 });
    expect(normalizeBiometricEntry({ waterMl: -100 })).toEqual({});
  });

  it('clampa sleepHours fuori range', () => {
    expect(normalizeBiometricEntry({ sleepHours: 30 })).toEqual({ sleepHours: 24 });
    expect(normalizeBiometricEntry({ sleepHours: -2 })).toEqual({});
  });

  it('clampa weightKg fuori range', () => {
    expect(normalizeBiometricEntry({ weightKg: 10 })).toEqual({});
    expect(normalizeBiometricEntry({ weightKg: 600 })).toEqual({ weightKg: 500 });
  });

  it('scarta NaN e stringhe non numeriche', () => {
    expect(normalizeBiometricEntry({ waterMl: 'abc' })).toEqual({});
    expect(normalizeBiometricEntry({ waterMl: NaN })).toEqual({});
  });

  it('accetta stringhe numeriche valide', () => {
    expect(normalizeBiometricEntry({ waterMl: '1500' })).toEqual({ waterMl: 1500 });
  });

  it('ignora chiavi sconosciute', () => {
    expect(normalizeBiometricEntry({ waterMl: 500, foo: 'bar', steps: 10000 })).toEqual({
      waterMl: 500,
    });
  });
});

describe('normalizeBiometrics', () => {
  it('ritorna {} per input non oggetto', () => {
    expect(normalizeBiometrics(null)).toEqual({});
    expect(normalizeBiometrics('x')).toEqual({});
  });

  it('scarta chiavi data non valide', () => {
    const out = normalizeBiometrics({
      '2026-07-10': { waterMl: 1000 },
      'not-a-date': { waterMl: 2000 },
      '2026-13-45': { waterMl: 3000 }, // data invalida (round-trip)
    });
    expect(Object.keys(out)).toEqual(['2026-07-10']);
  });

  it('scarta entry completamente vuote dopo normalizzazione', () => {
    const out = normalizeBiometrics({
      '2026-07-10': { waterMl: 1000 },
      '2026-07-11': { waterMl: -5 }, // diventa vuota
      '2026-07-12': {}, // già vuota
    });
    expect(Object.keys(out)).toEqual(['2026-07-10']);
  });
});

describe('setWater / setSleep / setWeight', () => {
  it('setWater memorizza il valore arrotondato', () => {
    setWater('2026-07-10', 1537.6);
    expect(getState().biometrics['2026-07-10'].waterMl).toBe(1538);
  });

  it('setWater clampa al range massimo', () => {
    setWater('2026-07-10', 99999);
    expect(getState().biometrics['2026-07-10'].waterMl).toBe(20000);
  });

  it('setWater con 0 cancella il campo waterMl', () => {
    setWater('2026-07-10', 1000);
    setWater('2026-07-10', 0);
    expect(getState().biometrics['2026-07-10']?.waterMl).toBeUndefined();
  });

  it('setWater con NaN non modifica lo stato', () => {
    setWater('2026-07-10', 1000);
    setWater('2026-07-10', NaN);
    expect(getState().biometrics['2026-07-10'].waterMl).toBe(1000);
  });

  it('setSleep memorizza con 1 decimale', () => {
    setSleep('2026-07-10', 7.555);
    expect(getState().biometrics['2026-07-10'].sleepHours).toBe(7.6);
  });

  it('setSleep clampa a 24', () => {
    setSleep('2026-07-10', 30);
    expect(getState().biometrics['2026-07-10'].sleepHours).toBe(24);
  });

  it('setWeight memorizza con 1 decimale', () => {
    setWeight('2026-07-10', 78.456);
    expect(getState().biometrics['2026-07-10'].weightKg).toBe(78.5);
  });

  it('setWeight clampa al range [20, 500]', () => {
    setWeight('2026-07-10', 5);
    expect(getState().biometrics['2026-07-10']?.weightKg).toBeUndefined();
    setWeight('2026-07-10', 600);
    expect(getState().biometrics['2026-07-10'].weightKg).toBe(500);
  });

  it('entry vuota viene rimossa dalla mappa (no rumore)', () => {
    setWater('2026-07-10', 1000);
    setWater('2026-07-10', 0);
    expect(getState().biometrics['2026-07-10']).toBeUndefined();
  });

  it('campi indipendenti: cancellare acqua non tocca peso', () => {
    setWater('2026-07-10', 1000);
    setWeight('2026-07-10', 80);
    setWater('2026-07-10', 0);
    expect(getState().biometrics['2026-07-10']).toEqual({ weightKg: 80 });
  });
});

describe('addWaterGlass / removeWaterGlass', () => {
  it('addWaterGlass aggiunge WATER_GLASS_ML partendo da zero', () => {
    addWaterGlass('2026-07-10');
    expect(getState().biometrics['2026-07-10'].waterMl).toBe(WATER_GLASS_ML);
  });

  it('addWaterGlass somma al valore esistente', () => {
    setWater('2026-07-10', 1000);
    addWaterGlass('2026-07-10');
    expect(getState().biometrics['2026-07-10'].waterMl).toBe(1000 + WATER_GLASS_ML);
  });

  it('removeWaterGlass non va sotto zero', () => {
    setWater('2026-07-10', 100);
    removeWaterGlass('2026-07-10');
    // 100 - 200 = clampato a 0 → cancella il campo
    expect(getState().biometrics['2026-07-10']?.waterMl).toBeUndefined();
  });

  it('removeWaterGlass su entry inesistente resta a zero (cancella)', () => {
    removeWaterGlass('2026-07-10');
    expect(getState().biometrics['2026-07-10']).toBeUndefined();
  });
});

describe('computeWeightTrend', () => {
  it('ritorna array vuoto se nessun peso registrato', () => {
    expect(computeWeightTrend({})).toEqual([]);
  });

  it('salta giorni senza peso', () => {
    const bio = {
      '2026-07-08': { waterMl: 1000 },
      '2026-07-09': { weightKg: 80 },
      '2026-07-10': { sleepHours: 7 },
      '2026-07-11': { weightKg: 79.5 },
    };
    const trend = computeWeightTrend(bio);
    expect(trend).toEqual([
      { date: '2026-07-09', weightKg: 80 },
      { date: '2026-07-11', weightKg: 79.5 },
    ]);
  });

  it('ordina cronologicamente anche se input disordinato', () => {
    const bio = {
      '2026-07-11': { weightKg: 79.5 },
      '2026-07-09': { weightKg: 80 },
      '2026-07-10': { weightKg: 79.8 },
    };
    const trend = computeWeightTrend(bio);
    expect(trend.map((p) => p.date)).toEqual(['2026-07-09', '2026-07-10', '2026-07-11']);
  });

  it('salta pesi non finiti o <= 0', () => {
    const bio = {
      '2026-07-09': { weightKg: NaN },
      '2026-07-10': { weightKg: 0 },
      '2026-07-11': { weightKg: -5 },
      '2026-07-12': { weightKg: 80 },
    };
    const trend = computeWeightTrend(bio);
    expect(trend).toEqual([{ date: '2026-07-12', weightKg: 80 }]);
  });
});

describe('computeWeightMovingAverage', () => {
  it('ritorna array vuoto per input vuoto', () => {
    expect(computeWeightMovingAverage([])).toEqual([]);
  });

  it('primo punto: ma7 = valore stesso (finestra di 1)', () => {
    const points = [{ date: '2026-07-09', weightKg: 80 }];
    const out = computeWeightMovingAverage(points, 7);
    expect(out[0].ma7).toBe(80);
  });

  it('media mobile trailing su 7 punti', () => {
    const points = [
      { date: '2026-07-01', weightKg: 80 },
      { date: '2026-07-02', weightKg: 80 },
      { date: '2026-07-03', weightKg: 79 },
      { date: '2026-07-04', weightKg: 79 },
      { date: '2026-07-05', weightKg: 78 },
      { date: '2026-07-06', weightKg: 78 },
      { date: '2026-07-07', weightKg: 77 },
      { date: '2026-07-08', weightKg: 77 },
    ];
    const out = computeWeightMovingAverage(points, 7);
    // Al punto 7 (index 6): media di [80,80,79,79,78,78,77] = 551/7 = 78.714... → 78.7
    expect(out[6].ma7).toBe(78.7);
    // Al punto 8 (index 7): finestra trailing 7 = [80,79,79,78,78,77,77] = 548/7 = 78.285 → 78.3
    expect(out[7].ma7).toBe(78.3);
  });

  it('con meno di 7 punti usa la disponibilità', () => {
    const points = [
      { date: '2026-07-01', weightKg: 80 },
      { date: '2026-07-02', weightKg: 78 },
    ];
    const out = computeWeightMovingAverage(points, 7);
    expect(out[0].ma7).toBe(80);
    expect(out[1].ma7).toBe(79); // (80+78)/2
  });
});

describe('getLatestWeight', () => {
  it('ritorna null se nessun peso', () => {
    expect(getLatestWeight({})).toBeNull();
  });

  it('ritorna il punto più recente', () => {
    const bio = {
      '2026-07-09': { weightKg: 80 },
      '2026-07-11': { weightKg: 79.5 },
      '2026-07-10': { weightKg: 79.8 },
    };
    expect(getLatestWeight(bio)).toEqual({ date: '2026-07-11', weightKg: 79.5 });
  });
});

describe('getBiometricForDisplay', () => {
  it('ritorna la entry grezza se il peso è già presente', () => {
    const bio = { '2026-07-10': { waterMl: 1000, weightKg: 80 } };
    const out = getBiometricForDisplay(bio, '2026-07-10');
    expect(out.weightKg).toBe(80);
    expect(out.weightKgInferred).toBe(false);
  });

  it("inferisce il peso dall'ultimo valore noto se manca oggi", () => {
    const bio = {
      '2026-07-08': { weightKg: 80 },
      '2026-07-10': { waterMl: 1000 },
    };
    const out = getBiometricForDisplay(bio, '2026-07-10');
    expect(out.weightKg).toBe(80);
    expect(out.weightKgInferred).toBe(true);
  });

  it('non inferisce se non ci sono pesi passati', () => {
    const bio = { '2026-07-10': { waterMl: 1000 } };
    const out = getBiometricForDisplay(bio, '2026-07-10');
    expect(out.weightKg).toBeUndefined();
    expect(out.weightKgInferred).toBe(false);
  });

  it('non inferisce dal peso di oggi stesso (evita self-reference)', () => {
    const today = toDateKey(new Date());
    const bio = { [today]: { weightKg: 80 } };
    const out = getBiometricForDisplay(bio, today);
    expect(out.weightKg).toBe(80);
    expect(out.weightKgInferred).toBe(false);
  });
});
