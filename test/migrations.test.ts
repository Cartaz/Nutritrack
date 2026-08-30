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

  it('migrates an explicit schema 0 document to schema 1', () => {
    const result = migratePersistedDocument({ version: 0, foods: [] });

    expect(result).toEqual({
      ok: true,
      document: { version: 1, foods: [] },
      fromVersion: 0,
      toVersion: 1,
    });
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
