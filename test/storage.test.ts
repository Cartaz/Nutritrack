// Persistenza su IndexedDB (fake-indexeddb in test): salvataggio, caricamento, backup,
// migrazione dai dati localStorage, schema futuro, import/export, reset, autosave, sync tra tab.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEGACY_BACKUP_KEY, SCHEMA_VERSION } from '../src/lib/constants';
import { __deleteDatabaseForTesting, idbGet, transact } from '../src/lib/idb';
import {
  __handleRemoteSaveForTesting,
  __resetStorageInternalForTesting,
  checkStorageSize,
  enableAutoSave,
  exportDataJson,
  importDataJson,
  initStorage,
  isStorageAvailable,
  loadData,
  resetApplicationData,
  saveData,
} from '../src/lib/storage';
import {
  addDiaryEntry,
  emitChange,
  getState,
  resetAll,
  setCurrentDate,
  setState,
  updateSettings,
} from '../src/lib/store';
import type { DiaryEntry, FoodItem } from '../src/types';

const DATE = '2026-03-01';
const IMAGE = 'https://images.openfoodfacts.org/images/products/800/front_it.3.200.jpg';

const FOOD: FoodItem = {
  id: 'food_1',
  name: 'Pasta',
  source: 'openfoodfacts',
  barcode: '8001234567895',
  servingSize: 80,
  nutrition: { calories: 350, protein: 12, carbs: 70, fat: 2 },
  image: IMAGE,
  createdAt: 1,
};

const ZERO_FOOD: FoodItem = {
  id: 'water',
  name: 'Acqua',
  source: 'custom',
  servingSize: 200,
  nutrition: { calories: 0, protein: 0, carbs: 0, fat: 0 },
  createdAt: 1,
};

function entry(overrides: Partial<DiaryEntry> = {}): DiaryEntry {
  return {
    id: 'e1',
    date: DATE,
    meal: 'lunch',
    foodId: FOOD.id,
    foodSnapshot: FOOD,
    quantity: 1,
    createdAt: 2,
    ...overrides,
  };
}

function v1Document(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    revision: 4,
    originTabId: 'old-tab',
    syncKind: 'state',
    settings: { calorieGoal: 1900 },
    foods: [FOOD],
    diary: { [DATE]: [entry()] },
    recipes: [],
    favoriteFoodIds: [],
    biometrics: {},
    ...extra,
  });
}

async function putRaw(values: Record<string, string | null>): Promise<void> {
  await transact([], () => ({ writes: values, result: undefined }));
}

async function persisted(): Promise<Record<string, unknown> & { revision: number; version: number }> {
  return JSON.parse((await idbGet('data'))!);
}

function failWrites(error: Error = new DOMException('Quota exceeded', 'QuotaExceededError')): void {
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
    throw error;
  });
}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

beforeEach(async () => {
  localStorage.clear();
  await __resetStorageInternalForTesting();
  resetAll();
  setState({ currentDate: DATE, _storageDisabled: false });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('availability', () => {
  it('opens IndexedDB', () => {
    expect(isStorageAvailable()).toBe(true);
  });

  it('works in memory only, and says so, when IndexedDB is unavailable', async () => {
    await __deleteDatabaseForTesting();
    vi.stubGlobal('indexedDB', undefined);
    expect(await initStorage()).toBe(false);
    expect(isStorageAvailable()).toBe(false);
    expect((await saveData()).ok).toBe(false);
  });
});

describe('saveData', () => {
  it('writes the current schema with a revision, and a no-op save writes nothing', async () => {
    setState({ foods: [FOOD] });
    expect(await saveData()).toEqual({ ok: true });
    const first = await persisted();
    expect(first.version).toBe(SCHEMA_VERSION);
    expect(first.revision).toBe(1);
    expect(first.foods).toEqual([FOOD]);

    expect(await saveData()).toEqual({ ok: true });
    expect((await persisted()).revision).toBe(1);
  });

  it('keeps the previous document as backup', async () => {
    setState({ foods: [FOOD] });
    await saveData();
    const previous = await idbGet('data');
    setState({ foods: [FOOD, ZERO_FOOD] });
    await saveData();
    expect(await idbGet('backup')).toBe(previous);
    expect((await persisted()).revision).toBe(2);
  });

  it('serializes concurrent saves in order', async () => {
    setState({ settings: { ...getState().settings, calorieGoal: 1800 } });
    const a = saveData();
    setState({ settings: { ...getState().settings, calorieGoal: 1900 } });
    const b = saveData();
    await Promise.all([a, b]);
    const doc = await persisted();
    expect((doc.settings as { calorieGoal: number }).calorieGoal).toBe(1900);
  });

  it('reports a quota failure as fatal and disables saving in application state', async () => {
    await saveData();
    setState({ foods: [FOOD] });
    failWrites();
    expect(await saveData()).toMatchObject({ ok: false, fatal: true });
    expect(getState()._storageDisabled).toBe(true);
  });
});

describe('loadData', () => {
  it('returns false on an empty profile', async () => {
    expect(await loadData()).toBe(false);
  });

  it('round-trips data, including explicit zero nutrition in foods, diary and recipes', async () => {
    setState({
      foods: [ZERO_FOOD],
      diary: { [DATE]: [entry({ foodId: ZERO_FOOD.id, foodSnapshot: ZERO_FOOD })] },
      recipes: [
        {
          id: 'recipe',
          name: 'Acqua aromatizzata',
          servings: 1,
          ingredients: [{ id: 'ing', foodId: ZERO_FOOD.id, foodSnapshot: ZERO_FOOD, grams: 200 }],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    await saveData();
    resetAll();
    expect(await loadData()).toBe(true);
    expect(getState().foods).toEqual([ZERO_FOOD]);
    expect(getState().diary[DATE]).toHaveLength(1);
    expect(getState().recipes).toHaveLength(1);
  });

  it('falls back to the backup when the main document is corrupt, and repairs it', async () => {
    await putRaw({ data: '{corrupt', backup: v1Document() });
    expect(await loadData()).toBe(true);
    expect(getState().settings.calorieGoal).toBe(1900);
    expect((await persisted()).version).toBe(SCHEMA_VERSION);
  });

  it('returns false when both main document and backup are corrupt', async () => {
    await putRaw({ data: '{corrupt', backup: '{also corrupt' });
    expect(await loadData()).toBe(false);
  });

  it('normalizes invalid entities away', async () => {
    await putRaw({
      data: JSON.stringify({ version: SCHEMA_VERSION, foods: [FOOD, { id: 'x', nutrition: {} }], diary: {} }),
    });
    expect(await loadData()).toBe(true);
    expect(getState().foods.map((f) => f.id)).toEqual([FOOD.id]);
  });
});

describe('migration from localStorage (versions before IndexedDB)', () => {
  it('migrates data under the v1 key, keeps the original as backup and removes localStorage data', async () => {
    const legacy = v1Document();
    localStorage.setItem('nutritrack_data_v1', legacy);
    localStorage.setItem(LEGACY_BACKUP_KEY, v1Document({ settings: { calorieGoal: 1500 } }));

    expect(await loadData()).toBe(true);

    expect(getState().settings.calorieGoal).toBe(1900);
    const doc = await persisted();
    expect(doc.version).toBe(SCHEMA_VERSION);
    expect(doc.revision).toBe(5);
    const migratedEntry = (doc.diary as Record<string, DiaryEntry[]>)[DATE][0];
    expect(migratedEntry.foodSnapshot).not.toHaveProperty('image');
    expect((doc.foods as FoodItem[])[0].image).toBe(IMAGE);
    expect(await idbGet('backup')).toBe(legacy);
    expect(localStorage.getItem('nutritrack_data_v1')).toBeNull();
    expect(localStorage.getItem(LEGACY_BACKUP_KEY)).toBeNull();
  });

  it('migrates data under the fixed localStorage key used by schema 2', async () => {
    localStorage.setItem('nutritrack_data', JSON.stringify({ version: 2, foods: [FOOD], diary: {} }));
    expect(await loadData()).toBe(true);
    expect(getState().foods).toEqual([FOOD]);
    expect(localStorage.getItem('nutritrack_data')).toBeNull();
  });

  it('migrates an unversioned (schema 0) document through every step', async () => {
    localStorage.setItem('nutritrack_data_v1', JSON.stringify({ settings: { calorieGoal: 1700 }, foods: [] }));
    expect(await loadData()).toBe(true);
    expect(getState().settings.calorieGoal).toBe(1700);
    expect((await persisted()).version).toBe(SCHEMA_VERSION);
  });

  it('leaves localStorage untouched if the IndexedDB write fails', async () => {
    localStorage.setItem('nutritrack_data_v1', v1Document());
    failWrites();
    expect(await loadData()).toBe(true);
    expect(localStorage.getItem('nutritrack_data_v1')).not.toBeNull();
  });
});

describe('schema boundary', () => {
  const future = JSON.stringify({ version: SCHEMA_VERSION + 1, foods: [{ id: 'future' }] });

  it('does not hydrate a future schema, exports it unchanged and never overwrites it', async () => {
    await putRaw({ data: future, meta: JSON.stringify({ version: SCHEMA_VERSION + 1, revision: 9 }) });
    expect(await loadData()).toBe(false);
    expect(exportDataJson()).toBe(future);
    setState({ foods: [FOOD] });
    expect((await saveData()).ok).toBe(false);
    expect(await idbGet('data')).toBe(future);
  });

  it('rejects a future-schema import with an explicit compatibility error', async () => {
    const result = await importDataJson(future);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/schema più recente/);
  });

  it('accepts an unversioned import and persists it as the current schema', async () => {
    const result = await importDataJson(JSON.stringify({ settings: { calorieGoal: 2222 }, foods: [FOOD] }));
    expect(result).toMatchObject({ ok: true, count: 1 });
    expect((await persisted()).version).toBe(SCHEMA_VERSION);
  });
});

describe('export / import', () => {
  it('exports data with the schema version and without sync metadata', async () => {
    setState({ foods: [FOOD] });
    await saveData();
    const exported = JSON.parse(exportDataJson());
    expect(exported.version).toBe(SCHEMA_VERSION);
    expect(exported.foods).toEqual([FOOD]);
    for (const key of ['revision', 'originTabId', 'syncKind']) expect(exported).not.toHaveProperty(key);
  });

  it.each([
    ['{not json', 'JSON non valido'],
    ['[]', 'Formato file non riconosciuto'],
    ['{"version":2}', 'File non riconosciuto'],
    ['{"foods":"invalid"}', 'File non riconosciuto'],
    ['{"settings":null}', 'File non riconosciuto'],
    ['{"diary":[]}', 'File non riconosciuto'],
  ])('rejects %s without touching existing data', async (json, message) => {
    setState({ foods: [FOOD] });
    const result = await importDataJson(json);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain(message);
    expect(getState().foods).toEqual([FOOD]);
  });

  it('drops invalid entities and reports how many were skipped', async () => {
    const result = await importDataJson(JSON.stringify({ foods: [FOOD, { name: '' }, { id: 'x' }], diary: {} }));
    expect(result).toEqual({ ok: true, count: 1, skipped: 2 });
  });

  it('rolls back an import when persistence fails', async () => {
    setState({ settings: { ...getState().settings, calorieGoal: 2100 } });
    failWrites(new Error('write failed'));
    const result = await importDataJson(JSON.stringify({ settings: { calorieGoal: 1300 }, foods: [] }));
    expect(result.ok).toBe(false);
    expect(getState().settings.calorieGoal).toBe(2100);
  });
});

describe('reset', () => {
  it('writes a reset tombstone, removes the backup and any localStorage leftovers', async () => {
    setState({ foods: [FOOD] });
    await saveData();
    setState({ foods: [FOOD, ZERO_FOOD] });
    await saveData();
    expect(await idbGet('backup')).toBeDefined();
    localStorage.setItem('nutritrack_data_v1', v1Document());

    expect(await resetApplicationData()).toEqual({ ok: true });

    const doc = await persisted();
    expect(doc.syncKind).toBe('reset');
    expect(doc.foods).toEqual([]);
    expect(await idbGet('backup')).toBeUndefined();
    expect(localStorage.getItem('nutritrack_data_v1')).toBeNull();
    expect(getState().foods).toEqual([]);
  });

  it('rolls back the in-memory reset if the tombstone cannot be written', async () => {
    setState({ foods: [FOOD] });
    await saveData();
    failWrites(new Error('write failed'));
    expect((await resetApplicationData()).ok).toBe(false);
    expect(getState().foods).toEqual([FOOD]);
  });
});

describe('autosave', () => {
  it('skips persistence for UI-only emits and persists data changes', async () => {
    await saveData();
    enableAutoSave();
    const put = vi.spyOn(IDBObjectStore.prototype, 'put');

    emitChange(); // es. un tasto nella ricerca: cambia solo lo stato UI
    await frame();
    setCurrentDate('2026-03-05'); // navigazione: non è un dato persistito
    await frame();
    expect(put).not.toHaveBeenCalled();

    addDiaryEntry({ date: '2026-03-05', meal: 'snack', foodId: FOOD.id, foodSnapshot: FOOD, quantity: 1 });
    await vi.waitFor(async () => expect((await persisted()).diary).toHaveProperty('2026-03-05'));
  });

  it('flushes an unrendered change when the page is hidden or leaves', async () => {
    await saveData();
    enableAutoSave();
    updateSettings({ calorieGoal: 2300 });
    window.dispatchEvent(new Event('pagehide'));
    await vi.waitFor(async () => expect((await persisted()).settings).toMatchObject({ calorieGoal: 2300 }));

    updateSettings({ calorieGoal: 2400 });
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(async () => expect((await persisted()).settings).toMatchObject({ calorieGoal: 2400 }));
  });

  it('does not copy the library image into new diary snapshots', () => {
    const created = addDiaryEntry({ date: DATE, meal: 'dinner', foodId: FOOD.id, foodSnapshot: FOOD, quantity: 1 });
    expect(created?.foodSnapshot).not.toHaveProperty('image');
  });
});

describe('sync between tabs', () => {
  /** Simula un'altra tab: scrive un documento più recente e manda il suo avviso. */
  async function remoteSave(patch: Record<string, unknown>, revision: number, syncKind = 'state'): Promise<void> {
    const stamp = { revision, originTabId: 'other-tab', syncKind };
    const doc = {
      version: SCHEMA_VERSION,
      ...stamp,
      foods: [],
      diary: {},
      recipes: [],
      favoriteFoodIds: [],
      biometrics: {},
      ...patch,
    };
    await putRaw({ data: JSON.stringify(doc), meta: JSON.stringify({ version: SCHEMA_VERSION, ...stamp }) });
    await __handleRemoteSaveForTesting(stamp);
  }

  it('applies a newer snapshot from another tab', async () => {
    await saveData();
    await remoteSave({ foods: [FOOD] }, 5);
    expect(getState().foods).toEqual([FOOD]);
  });

  it('ignores a notification older than the current state', async () => {
    setState({ foods: [ZERO_FOOD] });
    await saveData(); // revisione 1
    setState({ foods: [ZERO_FOOD, FOOD] });
    await saveData(); // revisione 2
    await __handleRemoteSaveForTesting({ revision: 1, originTabId: 'other-tab', syncKind: 'state' });
    expect(getState().foods).toHaveLength(2);
  });

  it('commits a local unsaved change first, so an older remote snapshot cannot overwrite it', async () => {
    await saveData();
    setState({ foods: [ZERO_FOOD] }); // modifica locale non ancora salvata
    await remoteSave({ foods: [FOOD] }, 2);
    expect(getState().foods).toEqual([ZERO_FOOD]);
    const doc = await persisted();
    expect(doc.foods).toEqual([ZERO_FOOD]);
    expect(doc.revision).toBe(3);
  });

  it('applies a remote reset immediately, even over local unsaved changes', async () => {
    await saveData();
    setState({ foods: [FOOD] });
    await remoteSave({}, 4, 'reset');
    expect(getState().foods).toEqual([]);
  });

  it('a reset written by another tab is a barrier: a local save applies it instead of overwriting it', async () => {
    await saveData();
    const stamp = { revision: 7, originTabId: 'other-tab', syncKind: 'reset' };
    await putRaw({
      data: JSON.stringify({ version: SCHEMA_VERSION, ...stamp, foods: [] }),
      meta: JSON.stringify({ version: SCHEMA_VERSION, ...stamp }),
    });
    setState({ foods: [FOOD] }); // l'avviso del reset è andato perso
    expect((await saveData()).ok).toBe(true);
    expect(getState().foods).toEqual([]);
    expect((await persisted()).syncKind).toBe('reset');
  });
});

describe('checkStorageSize', () => {
  it('warns above 80% of the browser quota', async () => {
    vi.stubGlobal('navigator', { ...navigator, storage: { estimate: async () => ({ usage: 81, quota: 100 }) } });
    expect(await checkStorageSize()).toMatchObject({ usage: 81, quota: 100, warn: true });
  });

  it('does not warn when the estimate is unavailable', async () => {
    vi.stubGlobal('navigator', { ...navigator, storage: undefined });
    expect((await checkStorageSize()).warn).toBe(false);
  });
});
