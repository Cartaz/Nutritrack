import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from '../src/lib/constants';
import { migratePersistedDocument } from '../src/lib/migrations';

describe('persisted schema migrations', () => {
  it('treats an unversioned legacy document as schema 0 and migrates it sequentially to current', () => {
    const result = migratePersistedDocument({
      settings: { calorieGoal: 1800 },
      revision: 7,
      originTabId: 'tab-a',
      syncKind: 'state',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fromVersion).toBe(0);
    expect(result.toVersion).toBe(SCHEMA_VERSION);
    expect(result.document.version).toBe(SCHEMA_VERSION);
    expect(result.document.settings).toEqual({ calorieGoal: 1800 });
    expect(result.document.revision).toBe(7);
    expect(result.document.originTabId).toBe('tab-a');
    expect(result.document.syncKind).toBe('state');
  });

  it('migrates an explicit schema 0 document through every step to the current schema', () => {
    const result = migratePersistedDocument({ version: 0, foods: [] });

    expect(result).toEqual({
      ok: true,
      document: { version: SCHEMA_VERSION, foods: [] },
      fromVersion: 0,
      toVersion: SCHEMA_VERSION,
    });
  });

  it('v1 → v2 drops the duplicated image URL from diary snapshots and keeps everything else', () => {
    const entry = {
      id: 'e1',
      date: '2026-01-01',
      meal: 'lunch',
      foodId: 'food_1',
      quantity: 1,
      foodSnapshot: {
        id: 'food_1',
        name: 'Pasta',
        image: 'https://images.openfoodfacts.org/p.jpg',
        nutrition: { calories: 350, protein: 12, carbs: 70, fat: 2 },
      },
    };
    const food = { id: 'food_1', name: 'Pasta', image: 'https://images.openfoodfacts.org/p.jpg' };
    const result = migratePersistedDocument({ version: 1, foods: [food], diary: { '2026-01-01': [entry] } });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const migrated = (result.document.diary as Record<string, (typeof entry)[]>)['2026-01-01'][0];
    expect(migrated.foodSnapshot).not.toHaveProperty('image');
    expect(migrated.foodSnapshot.name).toBe('Pasta');
    expect(migrated.foodSnapshot.nutrition).toEqual(entry.foodSnapshot.nutrition);
    expect(result.document.foods).toEqual([food]);
  });

  it('accepts the current schema without inventing a migration', () => {
    const document = { version: SCHEMA_VERSION, foods: [{ id: 'keep-me' }] };
    const result = migratePersistedDocument(document);

    expect(result).toEqual({
      ok: true,
      document,
      fromVersion: SCHEMA_VERSION,
      toVersion: SCHEMA_VERSION,
    });
  });

  it('rejects a future schema instead of silently normalizing it', () => {
    expect(migratePersistedDocument({ version: SCHEMA_VERSION + 1, foods: [] })).toEqual({
      ok: false,
      reason: 'future_version',
      version: SCHEMA_VERSION + 1,
    });
  });

  it.each([['1'], [-1], [0.5], [NaN], [Infinity]])('rejects invalid version marker %p', (version) => {
    expect(migratePersistedDocument({ version })).toEqual({ ok: false, reason: 'invalid_version' });
  });

  it.each([null, [], 'payload', 1])('rejects non-object persisted document %p', (document) => {
    expect(migratePersistedDocument(document)).toEqual({ ok: false, reason: 'invalid_document' });
  });
});
