// Persistenza localStorage con backup, quota handling e multi-tab sync.
// Storage conosce esclusivamente PersistedState: UiState e lifecycle dei modal restano fuori.

import type { DayDiary, DiaryEntry, FoodItem, PersistedState, Recipe } from '../types';
import { BACKUP_KEY, SCHEMA_VERSION, STORAGE_KEY, STORAGE_WARN_BYTES } from './constants';
import {
  emitChange,
  getPersistedState,
  replacePersistedState,
  setStorageDisabled,
  subscribe,
} from './store';
import { estimateStorageBytes, isStorageWarn, reconcileAll } from './normalize';

let _storageOK = true;
let _revision = 0;
let _lastDataSignature = '';
let _quotaWarnedThisSession = false;
let _stripWarnedThisSession = false;
let _multiTabInit = false;
let _storageListener: ((event: StorageEvent) => void) | null = null;
let _autoSaveEnabled = false;
let _autoSaveUnsub: (() => void) | null = null;

(function detectStorage(): void {
  try {
    const key = '__nt_test_' + Date.now();
    localStorage.setItem(key, '1');
    localStorage.removeItem(key);
  } catch {
    _storageOK = false;
    console.warn('[storage] localStorage non disponibile (modalità privata?)');
  }
})();

export function isStorageAvailable(): boolean {
  return _storageOK;
}

interface PersistedPayload extends PersistedState {
  version: number;
  /** Revisione monotona usata per last-write-wins tra tab. */
  revision: number;
}

function dataSignature(data: PersistedState): string {
  return JSON.stringify(data);
}

function buildPayload(data: PersistedState = getPersistedState(), revision = _revision): PersistedPayload {
  return {
    version: SCHEMA_VERSION,
    revision,
    settings: data.settings,
    foods: data.foods,
    diary: data.diary,
    recipes: data.recipes,
    favoriteFoodIds: data.favoriteFoodIds,
    biometrics: data.biometrics,
  };
}

function readRevision(raw: unknown): number {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 0;
  const revision = (raw as { revision?: unknown }).revision;
  return typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

function readRevisionFromSerialized(raw: string | null): number {
  if (!raw) return 0;
  try {
    return readRevision(JSON.parse(raw));
  } catch {
    return 0;
  }
}

/** Strip ricorsivo delle sole immagini, preservando tutto il resto del dominio. */
function stripImages(data: PersistedState): PersistedState {
  const stripFood = (food: FoodItem): FoodItem => ({ ...food, image: undefined });
  const stripDiary = (diary: DayDiary): DayDiary => {
    const out: DayDiary = {};
    for (const [date, entries] of Object.entries(diary)) {
      out[date] = entries.map((entry: DiaryEntry) => ({
        ...entry,
        foodSnapshot: stripFood(entry.foodSnapshot),
      }));
    }
    return out;
  };
  const stripRecipe = (recipe: Recipe): Recipe => ({
    ...recipe,
    image: undefined,
    ingredients: recipe.ingredients.map((ingredient) => ({
      ...ingredient,
      foodSnapshot: stripFood(ingredient.foodSnapshot),
    })),
  });
  return {
    ...data,
    foods: data.foods.map(stripFood),
    diary: stripDiary(data.diary),
    recipes: data.recipes.map(stripRecipe),
  };
}

export type SaveDataResult = { ok: true } | { ok: false; error: string; fatal: boolean };

type PersistResult =
  | { ok: true; data: PersistedState; revision: number; stripped: boolean }
  | { ok: false; error: string; fatal: boolean };

function validJson(raw: string): boolean {
  try {
    JSON.parse(raw);
    return true;
  } catch {
    return false;
  }
}

function writeBackup(previous: string | null, nextSerialized: string): void {
  if (!previous || previous === nextSerialized || !validJson(previous)) return;
  try {
    localStorage.setItem(BACKUP_KEY, previous);
  } catch {
    // Il backup non deve trasformare un primary write riuscito in un fallimento.
  }
}

/**
 * Persiste un candidate senza toccare lo store. Il commit in-memory avviene solo
 * dopo il successo, così import e recovery sono transazionali dal punto di vista UI.
 */
function persistCandidate(candidate: PersistedState): PersistResult {
  if (!_storageOK) return { ok: false, error: 'storage non disponibile', fatal: false };

  let previous: string | null = null;
  try {
    previous = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Un read fallito non impedisce il tentativo di write.
  }

  const nextRevision = Math.max(_revision, readRevisionFromSerialized(previous)) + 1;
  const payload = buildPayload(candidate, nextRevision);
  const serialized = JSON.stringify(payload);

  try {
    localStorage.setItem(STORAGE_KEY, serialized);
    writeBackup(previous, serialized);
    return { ok: true, data: candidate, revision: nextRevision, stripped: false };
  } catch (e: unknown) {
    const err = e as { name?: string; code?: number };
    if (err.name === 'QuotaExceededError' || err.code === 22 || err.code === 1014) {
      const stripped = stripImages(candidate);
      const strippedSerialized = JSON.stringify(buildPayload(stripped, nextRevision));
      try {
        localStorage.setItem(STORAGE_KEY, strippedSerialized);
        writeBackup(previous, strippedSerialized);
        if (!_stripWarnedThisSession) {
          _stripWarnedThisSession = true;
          void import('../components/toast').then(({ showToast }) => {
            showToast('Spazio esaurito — immagini rimosse per fare spazio. Esporta un backup.', 'warning', 6000);
          });
        }
        return { ok: true, data: stripped, revision: nextRevision, stripped: true };
      } catch {
        _storageOK = false;
        console.error('[storage] storage esaurito anche dopo strip. Esporta backup. Salvataggio disabilitato.');
        return {
          ok: false,
          error: 'Quota superata anche dopo strip immagini. Esporta un backup e riprova.',
          fatal: true,
        };
      }
    }
    if (err.name === 'SecurityError' || err.code === 18) {
      _storageOK = false;
      setStorageDisabled(true);
      console.warn('[storage] modalità privata rilevata, salvataggio disabilitato');
      return { ok: false, error: 'Modalità privata: salvataggio disabilitato', fatal: false };
    }
    console.error('[storage] errore salvataggio', e);
    return { ok: false, error: 'Errore salvataggio generico', fatal: false };
  }
}

function recordPersisted(result: Extract<PersistResult, { ok: true }>): void {
  _revision = result.revision;
  _lastDataSignature = dataSignature(result.data);
}

/** Salva lo stato corrente. Skip se i dati persistenti non sono cambiati. */
export function saveData(): SaveDataResult {
  if (!_storageOK) return { ok: false, error: 'storage non disponibile', fatal: false };
  const candidate = getPersistedState();
  const signature = dataSignature(candidate);
  if (signature === _lastDataSignature) return { ok: true };

  const result = persistCandidate(candidate);
  if (!result.ok) return result;
  recordPersisted(result);

  if (result.stripped) {
    replacePersistedState(result.data);
    emitChange();
  }

  if (!_quotaWarnedThisSession) {
    const sizeInfo = checkStorageSize();
    if (sizeInfo.warn) {
      _quotaWarnedThisSession = true;
      void import('../components/toast').then(({ showToast }) => {
        showToast(
          `Attenzione: dati vicini al limite di quota (${Math.round((sizeInfo.bytes / 1024 / 1024) * 10) / 10}MB). Esporta un backup.`,
          'warning',
          6000,
        );
      });
    }
  }
  return { ok: true };
}

/** Carica da localStorage con fallback al backup, senza toccare UiState. */
export function loadData(): boolean {
  if (!_storageOK) return false;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return false;
  }
  if (!raw) return false;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    try {
      const backup = localStorage.getItem(BACKUP_KEY);
      if (!backup) return false;
      parsed = JSON.parse(backup);
      console.warn('[storage] parsing primario fallito, usato backup');
    } catch {
      return false;
    }
  }

  const reconciled = reconcileAll(parsed);
  replacePersistedState(reconciled);
  _revision = readRevision(parsed);
  _lastDataSignature = dataSignature(reconciled);
  return true;
}

export function checkStorageSize(): { bytes: number; warn: boolean } {
  const bytes = estimateStorageBytes(buildPayload());
  return { bytes, warn: isStorageWarn(bytes) };
}

export function shouldWarnQuota(): boolean {
  return checkStorageSize().bytes > STORAGE_WARN_BYTES * 0.9;
}

// ============ Auto-save ============

export function enableAutoSave(): void {
  if (_autoSaveEnabled || !_storageOK) return;
  _autoSaveEnabled = true;
  _autoSaveUnsub = subscribe(() => {
    saveData();
  });
}

export function disableAutoSave(): void {
  if (_autoSaveUnsub) {
    _autoSaveUnsub();
    _autoSaveUnsub = null;
  }
  _autoSaveEnabled = false;
}

// ============ Multi-tab sync ============

function applyMultiTabUpdate(reconciled: PersistedState, revision: number): void {
  const signature = dataSignature(reconciled);
  if (revision < _revision) return;
  if (revision === _revision && signature === _lastDataSignature) return;

  replacePersistedState(reconciled);
  _revision = Math.max(_revision, revision);
  _lastDataSignature = signature;
  emitChange();
  window.dispatchEvent(new CustomEvent('nutritrack:multitab-sync'));
}

export function initMultiTabSync(): void {
  if (_multiTabInit || !_storageOK) return;
  _multiTabInit = true;
  _storageListener = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      const parsed = JSON.parse(event.newValue);
      const reconciled = reconcileAll(parsed);
      const rawRevision = readRevision(parsed);
      // Compatibilità con tab legacy senza revision: trattalo come nuova write.
      const revision = rawRevision > 0 ? rawRevision : _revision + 1;
      applyMultiTabUpdate(reconciled, revision);
    } catch {
      // Ignora storage event corrotto/parziale; non modifica lo stato valido corrente.
    }
  };
  window.addEventListener('storage', _storageListener);
}

/**
 * Compatibilità con il vecchio renderer. Non esistono più update pending: la
 * sincronizzazione riguarda solo PersistedState ed è indipendente dai modal.
 */
export function flushPendingMultiTabUpdate(): void {
  // no-op intenzionale
}

// ============ Export / Import backup ============

export function exportDataJson(): string {
  return JSON.stringify(buildPayload(), null, 2);
}

export function clearAllStoredData(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(BACKUP_KEY);
  } catch {
    /* ignore */
  }
  _revision = 0;
  _lastDataSignature = '';
  _quotaWarnedThisSession = false;
  _stripWarnedThisSession = false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Un backup completo deve contenere tutte le collezioni presenti fin dalla v1.0. */
function validateBackupEnvelope(parsed: unknown): string | null {
  if (!isRecord(parsed)) return 'Formato file non riconosciuto';
  if (typeof parsed.version !== 'number' || !Number.isInteger(parsed.version) || parsed.version < 1) {
    return 'Backup NutriTrack senza versione schema valida';
  }
  if (parsed.version > SCHEMA_VERSION) {
    return `Backup creato con una versione più recente (schema ${parsed.version}); aggiorna NutriTrack prima di importarlo`;
  }
  const required = ['settings', 'foods', 'diary', 'recipes', 'favoriteFoodIds'] as const;
  const missing = required.filter((key) => !(key in parsed));
  if (missing.length > 0) {
    return `Backup incompleto: mancano ${missing.join(', ')}`;
  }
  return null;
}

/** Import completo e atomico: valida -> normalizza -> persiste -> commit in RAM. */
export function importDataJson(
  json: string,
): { ok: true; count: number; skipped?: number } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: 'JSON non valido' };
  }

  const envelopeError = validateBackupEnvelope(parsed);
  if (envelopeError) return { ok: false, error: envelopeError };

  const raw = parsed as {
    foods?: unknown[];
    recipes?: unknown[];
    diary?: Record<string, unknown[]>;
  };
  const rawFoodsCount = Array.isArray(raw.foods) ? raw.foods.length : 0;
  const rawRecipesCount = Array.isArray(raw.recipes) ? raw.recipes.length : 0;
  let rawEntriesCount = 0;
  if (raw.diary && typeof raw.diary === 'object') {
    for (const entries of Object.values(raw.diary)) {
      if (Array.isArray(entries)) rawEntriesCount += entries.length;
    }
  }
  const rawTotal = rawFoodsCount + rawRecipesCount + rawEntriesCount;

  const candidate = reconcileAll(parsed);
  const count =
    candidate.foods.length +
    candidate.recipes.length +
    Object.values(candidate.diary).reduce((total, entries) => total + entries.length, 0);
  const skipped = Math.max(0, rawTotal - count);

  // Persisti PRIMA di modificare lo stato in-memory: fallimento = nessun side effect sul dominio.
  const persisted = persistCandidate(candidate);
  if (!persisted.ok) return { ok: false, error: persisted.error };

  replacePersistedState(persisted.data);
  recordPersisted(persisted);
  emitChange();
  return { ok: true, count, skipped: skipped > 0 ? skipped : undefined };
}

/** Reset completo dello stato interno, solo per isolamento dei test. */
export function __resetStorageInternalForTesting(): void {
  disableAutoSave();
  if (_storageListener) {
    window.removeEventListener('storage', _storageListener);
    _storageListener = null;
  }
  _multiTabInit = false;
  _storageOK = true;
  _revision = 0;
  _lastDataSignature = '';
  _quotaWarnedThisSession = false;
  _stripWarnedThisSession = false;
}
