// Test unitari per src/lib/storage.ts
//
// Copre: saveData, loadData, backup recovery, quota handling (mock), export/import JSON,
// multi-tab sync (storage event simulation).
//
// Nota: jsdom non implementa la quota reale, quindi testiamo i path di errore
// mockando localStorage.setItem per throw QuotaExceededError.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  saveData,
  loadData,
  exportDataJson,
  importDataJson,
  isStorageAvailable,
  checkStorageSize,
  __resetStorageInternalForTesting,
} from '../src/lib/storage';
import { STORAGE_KEY, BACKUP_KEY, SCHEMA_VERSION } from '../src/lib/constants';
import { getState, setState } from '../src/lib/store';

// Reset dello store e localStorage prima di ogni test.
beforeEach(() => {
  localStorage.clear();
  // Fix MEDIUM bug: resetta lo stato interno del modulo storage (_storageOK, flag sessione)
  // perché il test "QuotaExceededError anche dopo strip, ritorna fatal" flippa _storageOK a false
  // e questo persiste contaminando i test successivi.
  __resetStorageInternalForTesting();
  // Reset dello store a stato vuoto
  setState({
    settings: { calorieGoal: 2000, macroSplit: { proteinPct: 30, carbsPct: 40, fatPct: 30 }, theme: 'system' },
    foods: [],
    diary: {},
    recipes: [],
    favoriteFoodIds: [],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isStorageAvailable', () => {
  it('ritorna true in jsdom con localStorage funzionante', () => {
    expect(isStorageAvailable()).toBe(true);
  });
});

describe('saveData', () => {
  it('salva payload su localStorage', () => {
    setState({
      foods: [
        {
          id: 'f1',
          name: 'Mela',
          source: 'custom',
          servingSize: 100,
          nutrition: { calories: 52, protein: 0.3, carbs: 14, fat: 0.2 },
          createdAt: 0,
        },
      ],
    });
    const r = saveData();
    expect(r.ok).toBe(true);
    const stored = localStorage.getItem(STORAGE_KEY);
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.foods).toHaveLength(1);
    expect(parsed.foods[0].name).toBe('Mela');
  });

  it('salva backup del payload precedente', () => {
    // Primo save
    setState({
      foods: [
        {
          id: 'f1',
          name: 'Prima',
          source: 'custom',
          servingSize: 100,
          nutrition: { calories: 10, protein: 1, carbs: 1, fat: 1 },
          createdAt: 0,
        },
      ],
    });
    saveData();

    // Secondo save con payload diverso
    setState({
      foods: [
        {
          id: 'f2',
          name: 'Seconda',
          source: 'custom',
          servingSize: 100,
          nutrition: { calories: 20, protein: 2, carbs: 2, fat: 2 },
          createdAt: 0,
        },
      ],
    });
    saveData();

    const backup = localStorage.getItem(BACKUP_KEY);
    expect(backup).not.toBeNull();
    const backupParsed = JSON.parse(backup!);
    expect(backupParsed.foods[0].name).toBe('Prima');
  });

  it('skip scrittura se payload invariato (no-op)', () => {
    setState({ foods: [] });
    saveData();
    const before = localStorage.getItem(STORAGE_KEY);

    // Spy per verificare che setItem non venga chiamato di nuovo
    const spy = vi.spyOn(Storage.prototype, 'setItem');

    saveData(); // stesso payload
    expect(spy).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before);
  });

  it('scrive versione schema nel payload', () => {
    saveData();
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.version).toBe(SCHEMA_VERSION);
  });

  it('su QuotaExceededError, strip immagini e riprova', () => {
    setState({
      foods: [
        {
          id: 'f1',
          name: 'Mela',
          source: 'custom',
          servingSize: 100,
          nutrition: { calories: 52, protein: 0.3, carbs: 14, fat: 0.2 },
          image: 'https://example.com/big.jpg',
          createdAt: 0,
        },
      ],
    });

    // Mock: prima chiamata throw QuotaExceededError, seconda ha successo
    let callCount = 0;
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      callCount++;
      if (callCount === 1 && key === STORAGE_KEY) {
        const err = new Error('quota exceeded');
        err.name = 'QuotaExceededError';
        throw err;
      }
      return originalSetItem.call(this, key, value);
    });

    const r = saveData();
    expect(r.ok).toBe(true);

    // Verifica che il payload salvato non abbia immagini
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.foods[0].image).toBeUndefined();
  });

  it('su QuotaExceededError anche dopo strip, ritorna fatal', () => {
    setState({
      foods: [
        {
          id: 'f1',
          name: 'Mela',
          source: 'custom',
          servingSize: 100,
          nutrition: { calories: 52, protein: 0.3, carbs: 14, fat: 0.2 },
          createdAt: 0,
        },
      ],
    });

    // Mock: tutte le chiamate throw QuotaExceededError
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      const err = new Error('quota exceeded');
      err.name = 'QuotaExceededError';
      throw err;
    });

    const r = saveData();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.fatal).toBe(true);
    }
  });
});

describe('loadData', () => {
  it('carica payload valido da localStorage', () => {
    const payload = {
      version: SCHEMA_VERSION,
      settings: { calorieGoal: 1800, macroSplit: { proteinPct: 40, carbsPct: 30, fatPct: 30 }, theme: 'dark' },
      foods: [
        {
          id: 'f1',
          name: 'Mela',
          source: 'custom',
          servingSize: 100,
          nutrition: { calories: 52, protein: 0.3, carbs: 14, fat: 0.2 },
          createdAt: 0,
        },
      ],
      diary: {},
      recipes: [],
      favoriteFoodIds: [],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));

    const ok = loadData();
    expect(ok).toBe(true);
    const s = getState();
    expect(s.settings.calorieGoal).toBe(1800);
    expect(s.foods).toHaveLength(1);
    expect(s.foods[0].name).toBe('Mela');
  });

  it('ritorna false se localStorage vuoto', () => {
    expect(loadData()).toBe(false);
  });

  it('fallback a backup se JSON primario è corrotto', () => {
    // JSON primario corrotto
    localStorage.setItem(STORAGE_KEY, '{not valid json');
    // Backup valido
    const backupPayload = {
      version: SCHEMA_VERSION,
      settings: { calorieGoal: 2200, macroSplit: { proteinPct: 30, carbsPct: 40, fatPct: 30 }, theme: 'light' },
      foods: [],
      diary: {},
      recipes: [],
      favoriteFoodIds: [],
    };
    localStorage.setItem(BACKUP_KEY, JSON.stringify(backupPayload));

    const ok = loadData();
    expect(ok).toBe(true);
    expect(getState().settings.calorieGoal).toBe(2200);
  });

  it('ritorna false se sia primario che backup sono corrotti', () => {
    localStorage.setItem(STORAGE_KEY, '{corrupt');
    localStorage.setItem(BACKUP_KEY, '{also corrupt');
    expect(loadData()).toBe(false);
  });

  it('normalizza dati corrotti nel payload (es. food senza nome)', () => {
    const payload = {
      version: SCHEMA_VERSION,
      settings: { calorieGoal: 2000, macroSplit: { proteinPct: 30, carbsPct: 40, fatPct: 30 }, theme: 'system' },
      foods: [
        // Valido
        {
          id: 'f1',
          name: 'Mela',
          source: 'custom',
          servingSize: 100,
          nutrition: { calories: 52, protein: 0.3, carbs: 14, fat: 0.2 },
          createdAt: 0,
        },
        // Invalido (no nome) → scartato
        {
          id: 'f2',
          name: '',
          source: 'custom',
          servingSize: 100,
          nutrition: { calories: 10, protein: 1, carbs: 1, fat: 1 },
          createdAt: 0,
        },
      ],
      diary: {},
      recipes: [],
      favoriteFoodIds: [],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));

    loadData();
    expect(getState().foods).toHaveLength(1);
    expect(getState().foods[0].id).toBe('f1');
  });
});

describe('exportDataJson', () => {
  it('esporta payload JSON formattato', () => {
    setState({
      foods: [
        {
          id: 'f1',
          name: 'Mela',
          source: 'custom',
          servingSize: 100,
          nutrition: { calories: 52, protein: 0.3, carbs: 14, fat: 0.2 },
          createdAt: 0,
        },
      ],
    });

    const json = exportDataJson();
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(SCHEMA_VERSION);
    expect(parsed.foods).toHaveLength(1);
    expect(parsed.foods[0].name).toBe('Mela');
  });

  it('include tutte le chiavi del payload', () => {
    const json = exportDataJson();
    const parsed = JSON.parse(json);
    expect(parsed).toHaveProperty('version');
    expect(parsed).toHaveProperty('settings');
    expect(parsed).toHaveProperty('foods');
    expect(parsed).toHaveProperty('diary');
    expect(parsed).toHaveProperty('recipes');
    expect(parsed).toHaveProperty('favoriteFoodIds');
  });
});

describe('importDataJson', () => {
  it('importa JSON valido', () => {
    const payload = {
      version: SCHEMA_VERSION,
      settings: { calorieGoal: 2500, macroSplit: { proteinPct: 40, carbsPct: 30, fatPct: 30 }, theme: 'dark' },
      foods: [
        {
          id: 'f1',
          name: 'Importata',
          source: 'custom',
          servingSize: 100,
          nutrition: { calories: 100, protein: 5, carbs: 10, fat: 2 },
          createdAt: 0,
        },
      ],
      diary: {},
      recipes: [],
      favoriteFoodIds: [],
    };

    const r = importDataJson(JSON.stringify(payload));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.count).toBe(1);
    }
    expect(getState().foods[0].name).toBe('Importata');
    expect(getState().settings.calorieGoal).toBe(2500);
  });

  it('rigetta JSON non valido', () => {
    const r = importDataJson('{invalid json');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('non valido');
    }
  });

  it('rigetta JSON non-oggetto (es. array)', () => {
    const r = importDataJson('[1, 2, 3]');
    expect(r.ok).toBe(false);
  });

  it('rigetta JSON senza chiavi riconosciute (Fix C2)', () => {
    const r = importDataJson(JSON.stringify({ random: 'data', another: 123 }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('non riconosciuto');
    }
  });

  it('accetta JSON con almeno una chiave riconosciuta', () => {
    const r = importDataJson(JSON.stringify({ settings: { calorieGoal: 1500 } }));
    expect(r.ok).toBe(true);
  });

  it('scarta entità invalide e ritorna count + skipped', () => {
    const payload = {
      version: SCHEMA_VERSION,
      foods: [
        {
          id: 'f1',
          name: 'Valida',
          source: 'custom',
          servingSize: 100,
          nutrition: { calories: 100, protein: 1, carbs: 1, fat: 1 },
        },
        {
          id: 'f2',
          name: '',
          source: 'custom',
          servingSize: 100,
          nutrition: { calories: 1, protein: 1, carbs: 1, fat: 1 },
        },
        { id: 'f3', name: 'Senza nutrition', source: 'custom', servingSize: 100 },
      ],
    };
    const r = importDataJson(JSON.stringify(payload));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.count).toBe(1);
      expect(r.skipped).toBe(2);
    }
  });

  it('persiste su localStorage dopo import', () => {
    const payload = {
      version: SCHEMA_VERSION,
      foods: [
        {
          id: 'f1',
          name: 'Persistente',
          source: 'custom',
          servingSize: 100,
          nutrition: { calories: 100, protein: 1, carbs: 1, fat: 1 },
        },
      ],
    };
    importDataJson(JSON.stringify(payload));

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.foods).toHaveLength(1);
    expect(stored.foods[0].name).toBe('Persistente');
  });
});

describe('checkStorageSize', () => {
  it('ritorna byte > 0 per stato non vuoto', () => {
    setState({
      foods: [
        {
          id: 'f1',
          name: 'Test',
          source: 'custom',
          servingSize: 100,
          nutrition: { calories: 100, protein: 1, carbs: 1, fat: 1 },
          createdAt: 0,
        },
      ],
    });
    const r = checkStorageSize();
    expect(r.bytes).toBeGreaterThan(0);
    // Stato piccolo → no warning
    expect(r.warn).toBe(false);
  });
});

describe('SaveData + LoadData roundtrip', () => {
  it('salva e ricarica mantenendo i dati', () => {
    setState({
      settings: { calorieGoal: 1850, macroSplit: { proteinPct: 35, carbsPct: 35, fatPct: 30 }, theme: 'dark' },
      foods: [
        {
          id: 'f1',
          name: 'Mela',
          source: 'custom',
          servingSize: 100,
          nutrition: { calories: 52, protein: 0.3, carbs: 14, fat: 0.2 },
          createdAt: 1700000000000,
        },
        {
          id: 'f2',
          name: 'Pane',
          source: 'custom',
          servingSize: 50,
          nutrition: { calories: 250, protein: 8, carbs: 50, fat: 2 },
          createdAt: 1700000000001,
        },
      ],
      diary: {
        '2024-01-15': [
          {
            id: 'e1',
            date: '2024-01-15',
            meal: 'breakfast',
            foodId: 'f1',
            foodSnapshot: {
              id: 'f1',
              name: 'Mela',
              source: 'custom',
              servingSize: 100,
              nutrition: { calories: 52, protein: 0.3, carbs: 14, fat: 0.2 },
              createdAt: 0,
            },
            quantity: 2,
            createdAt: 1700000000000,
          },
        ],
      },
      recipes: [],
      favoriteFoodIds: ['f1'],
    });

    const saveResult = saveData();
    expect(saveResult.ok).toBe(true);

    // Reset store e ricarica
    setState({
      settings: { calorieGoal: 2000, macroSplit: { proteinPct: 30, carbsPct: 40, fatPct: 30 }, theme: 'system' },
      foods: [],
      diary: {},
      recipes: [],
      favoriteFoodIds: [],
    });

    loadData();

    const s = getState();
    expect(s.settings.calorieGoal).toBe(1850);
    expect(s.foods).toHaveLength(2);
    expect(s.foods[0].name).toBe('Mela');
    expect(s.diary['2024-01-15']).toHaveLength(1);
    expect(s.diary['2024-01-15'][0].quantity).toBe(2);
    expect(s.favoriteFoodIds).toEqual(['f1']);
  });
});
