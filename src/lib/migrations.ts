import { SCHEMA_VERSION } from './constants';

type JsonObject = Record<string, unknown>;
type MigrationStep = (document: JsonObject) => JsonObject;

export type MigrationFailureReason = 'invalid_document' | 'invalid_version' | 'future_version' | 'missing_migration';

export type MigrationResult =
  | { ok: true; document: JsonObject; fromVersion: number; toVersion: number }
  | { ok: false; reason: MigrationFailureReason; version?: number };

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readSchemaVersion(document: JsonObject): { ok: true; version: number } | { ok: false; version?: number } {
  if (document.version === undefined) return { ok: true, version: 0 };
  if (typeof document.version !== 'number' || !Number.isInteger(document.version) || document.version < 0) {
    return { ok: false };
  }
  return { ok: true, version: document.version };
}

/** Legacy payloads without a version marker are schema 0. V1 only adds the explicit marker. */
function migrate0To1(document: JsonObject): JsonObject {
  return { ...document, version: 1 };
}

const MIGRATIONS: Readonly<Record<number, MigrationStep>> = {
  0: migrate0To1,
};

/**
 * Upgrades a persisted document to the current schema before normalization.
 * Migration owns schema evolution only; value validation belongs to normalize.ts.
 */
export function migratePersistedDocument(raw: unknown): MigrationResult {
  if (!isObject(raw)) return { ok: false, reason: 'invalid_document' };

  const versionResult = readSchemaVersion(raw);
  if (!versionResult.ok) return { ok: false, reason: 'invalid_version' };

  const fromVersion = versionResult.version;
  if (fromVersion > SCHEMA_VERSION) {
    return { ok: false, reason: 'future_version', version: fromVersion };
  }

  let version = fromVersion;
  let document: JsonObject = raw;
  while (version < SCHEMA_VERSION) {
    const migrate = MIGRATIONS[version];
    if (!migrate) return { ok: false, reason: 'missing_migration', version };
    document = migrate(document);
    version += 1;
    document = { ...document, version };
  }

  return { ok: true, document, fromVersion, toVersion: version };
}
