// Persistenza su IndexedDB con backup, sync tra tab e migrazione dai dati localStorage.
//
// Ownership: questo modulo possiede formato persistito, revisioni multi-tab, backup,
// reset persistente e riconciliazione degli snapshot ricevuti. Lo store non conosce
// chiavi, causalità o dettagli del browser storage.
//
// Record IndexedDB (store chiave → stringa, vedi idb.ts):
//   data   → documento JSON completo (schema versionato, vedi migrations.ts)
//   meta   → { version, revision, originTabId, syncKind } dello stesso documento, piccolo da leggere
//   backup → documento precedente valido (recovery se `data` risulta illeggibile)
//
// Lo stato in memoria resta la fonte di verità della sessione: le scritture sono asincrone,
// serializzate in coda e atomiche (lettura dei metadati + scrittura nella stessa transazione).

import type { AppState } from '../types';
import { LEGACY_BACKUP_KEY, LEGACY_STORAGE_KEYS, SCHEMA_VERSION, STORAGE_WARN_RATIO, SYNC_CHANNEL } from './constants';
import { getState, setState, setStorageDisabled, subscribe, emitChange, resetAll } from './store';
import { reconcileAll } from './normalize';
import { migratePersistedDocument, type MigrationFailureReason } from './migrations';
import { clearRuntimeDataCaches } from './localData';
import { idbGet, openDb, transact, __deleteDatabaseForTesting } from './idb';

const DATA = 'data';
const META = 'meta';
const BACKUP = 'backup';

interface PersistedState {
  settings: AppState['settings'];
  foods: AppState['foods'];
  diary: AppState['diary'];
  recipes: AppState['recipes'];
  favoriteFoodIds: AppState['favoriteFoodIds'];
  biometrics: AppState['biometrics'];
}

type SyncKind = 'state' | 'reset';

interface VersionStamp {
  revision: number;
  originTabId: string;
  syncKind: SyncKind;
}

type DecodedDocument =
  | { ok: true; document: Record<string, unknown>; fromVersion: number }
  | { ok: false; reason: 'invalid_json' | MigrationFailureReason; version?: number };

const INITIAL_STAMP: VersionStamp = { revision: 0, originTabId: '', syncKind: 'state' };

function createTabId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const _tabId = createTabId();
let _available = false;
let _currentStamp: VersionStamp = { ...INITIAL_STAMP };
let _lastSyncedStateSignature: string | null = null;
/** Documento di uno schema futuro trovato al caricamento: non va mai sovrascritto e l'export lo restituisce. */
let _unsupportedDocument: string | null = null;
let _writeQueue: Promise<unknown> = Promise.resolve();
let _channel: BroadcastChannel | null = null;

// ============ Stato e documenti ============

function buildStateSnapshot(): PersistedState {
  const s = getState();
  return {
    settings: s.settings,
    foods: s.foods,
    diary: s.diary,
    recipes: s.recipes,
    favoriteFoodIds: s.favoriteFoodIds,
    biometrics: s.biometrics,
  };
}

function stateFromDocument(document: Record<string, unknown>): PersistedState {
  const r = reconcileAll(document);
  return {
    settings: r.settings,
    foods: r.foods,
    diary: r.diary,
    recipes: r.recipes,
    favoriteFoodIds: r.favoriteFoodIds,
    biometrics: r.biometrics,
  };
}

function stateSignature(state: PersistedState): string {
  return JSON.stringify(state);
}

function readStamp(value: unknown): VersionStamp {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...INITIAL_STAMP };
  const obj = value as { revision?: unknown; originTabId?: unknown; syncKind?: unknown };
  const revision =
    typeof obj.revision === 'number' && Number.isFinite(obj.revision) && obj.revision >= 0
      ? Math.floor(obj.revision)
      : 0;
  const originTabId = typeof obj.originTabId === 'string' ? obj.originTabId.slice(0, 200) : '';
  const syncKind: SyncKind = obj.syncKind === 'reset' ? 'reset' : 'state';
  return { revision, originTabId, syncKind };
}

function parseMeta(raw: string | undefined): (VersionStamp & { version: number }) | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { version?: unknown };
    const version = typeof parsed.version === 'number' ? parsed.version : SCHEMA_VERSION;
    return { ...readStamp(parsed), version };
  } catch {
    return null;
  }
}

/** Ordine totale: revisione, poi reset sopra state a parità di revisione, poi origin id. */
function compareStamps(a: VersionStamp, b: VersionStamp): number {
  if (a.revision !== b.revision) return a.revision < b.revision ? -1 : 1;
  if (a.syncKind !== b.syncKind) return a.syncKind === 'reset' ? 1 : -1;
  if (a.originTabId === b.originTabId) return 0;
  return a.originTabId < b.originTabId ? -1 : 1;
}

/** Partial legacy backups are supported, but schema metadata alone is not user data. */
function isDataDocument(document: Record<string, unknown>): boolean {
  const containers = {
    settings: 'object',
    foods: 'array',
    diary: 'object',
    recipes: 'array',
    favoriteFoodIds: 'array',
    biometrics: 'object',
  } as const;
  let hasData = false;
  for (const [key, kind] of Object.entries(containers)) {
    if (!(key in document)) continue;
    hasData = true;
    const value = document[key];
    if (kind === 'array') {
      if (!Array.isArray(value)) return false;
    } else if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  }
  return hasData;
}

function decodeDocument(raw: string): DecodedDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
  const migrated = migratePersistedDocument(parsed);
  if (!migrated.ok) return { ok: false, reason: migrated.reason, version: migrated.version };
  if (!isDataDocument(migrated.document)) return { ok: false, reason: 'invalid_document' };
  return { ok: true, document: migrated.document, fromVersion: migrated.fromVersion };
}

function isUnsupportedSchema(decoded: DecodedDocument): boolean {
  return !decoded.ok && (decoded.reason === 'future_version' || decoded.reason === 'missing_migration');
}

function serializeDocument(state: PersistedState, stamp: VersionStamp): { data: string; meta: string } {
  const meta = { version: SCHEMA_VERSION, ...stamp };
  return { data: JSON.stringify({ ...meta, ...state }), meta: JSON.stringify(meta) };
}

function markSynced(state: PersistedState, stamp: VersionStamp): void {
  _currentStamp = { ...stamp };
  _lastSyncedStateSignature = stateSignature(state);
}

function applyStateSnapshot(state: PersistedState): void {
  setState({ ...state });
}

// ============ Disponibilità ============

/**
 * Apre IndexedDB. Va chiamata (e attesa) una volta all'avvio prima di loadData.
 * Se fallisce l'app lavora solo in memoria e la UI lo segnala.
 */
export async function initStorage(): Promise<boolean> {
  try {
    await openDb();
    _available = true;
  } catch (e) {
    _available = false;
    console.warn('[storage] IndexedDB non disponibile: i dati non verranno salvati', e);
  }
  if (_available) void requestPersistentStorage();
  return _available;
}

/** Chiede al browser di non sfrattare i dati sotto pressione di spazio (best effort). */
async function requestPersistentStorage(): Promise<void> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return;
    await navigator.storage?.persist?.();
  } catch {
    /* non supportato: nessun effetto */
  }
}

export function isStorageAvailable(): boolean {
  return _available;
}

// ============ Scrittura ============

export type SaveDataResult = { ok: true } | { ok: false; error: string; fatal: boolean };

const UNSUPPORTED_SCHEMA_ERROR =
  'I dati salvati usano una versione schema non supportata. Aggiorna NutriTrack prima di salvare.';

/** Accoda un'operazione di persistenza: le scritture non si sovrappongono mai. */
function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const run = _writeQueue.then(operation, operation);
  _writeQueue = run.catch(() => undefined);
  return run;
}

type WriteOutcome =
  | { kind: 'written'; stamp: VersionStamp; state: PersistedState }
  | { kind: 'remote-reset'; stamp: VersionStamp }
  | { kind: 'unsupported-schema' };

/**
 * Scrive uno snapshot con revisione strettamente maggiore di quella persistita e di quella nota.
 * Nella stessa transazione: un reset più recente scritto da un'altra tab è una barriera
 * (viene applicato invece di sovrascriverlo) e un documento di schema futuro non si tocca.
 */
async function writeSnapshot(
  state: PersistedState,
  syncKind: SyncKind,
  backup: 'previous' | 'delete' | { raw: string },
): Promise<SaveDataResult> {
  let outcome: WriteOutcome;
  try {
    outcome = await transact(
      [DATA, META],
      (values): { writes: Record<string, string | null>; result: WriteOutcome } => {
        const currentData = values.get(DATA);
        const meta = parseMeta(values.get(META));
        if (meta && meta.version > SCHEMA_VERSION) return { writes: {}, result: { kind: 'unsupported-schema' } };
        const persisted = meta ?? INITIAL_STAMP;
        if (syncKind === 'state' && persisted.syncKind === 'reset' && compareStamps(persisted, _currentStamp) > 0) {
          return { writes: {}, result: { kind: 'remote-reset', stamp: persisted } };
        }
        const stamp: VersionStamp = {
          revision: Math.max(_currentStamp.revision, persisted.revision) + 1,
          originTabId: _tabId,
          syncKind,
        };
        const serialized = serializeDocument(state, stamp);
        const writes: Record<string, string | null> = { [DATA]: serialized.data, [META]: serialized.meta };
        if (backup === 'delete') writes[BACKUP] = null;
        else if (backup !== 'previous') writes[BACKUP] = backup.raw;
        else if (currentData && meta?.syncKind !== 'reset') writes[BACKUP] = currentData;
        return { writes, result: { kind: 'written', stamp, state } };
      },
    );
  } catch (e) {
    return writeFailure(e);
  }

  if (outcome.kind === 'unsupported-schema') return { ok: false, error: UNSUPPORTED_SCHEMA_ERROR, fatal: false };
  if (outcome.kind === 'remote-reset') {
    applyResetSnapshot(outcome.stamp);
    return { ok: true };
  }
  markSynced(outcome.state, outcome.stamp);
  broadcast(outcome.stamp);
  void warnIfNearQuota();
  return { ok: true };
}

function writeFailure(e: unknown): SaveDataResult {
  const err = e as { name?: string };
  if (err?.name === 'QuotaExceededError') {
    setStorageDisabled(true);
    console.error('[storage] spazio esaurito', e);
    return {
      ok: false,
      error: 'Spazio di archiviazione esaurito. Esporta un backup e libera spazio sul dispositivo.',
      fatal: true,
    };
  }
  console.error('[storage] errore salvataggio', e);
  return { ok: false, error: 'Errore di salvataggio', fatal: false };
}

/** Salva lo stato se differisce dall'ultimo snapshot sincronizzato. */
export function saveData(): Promise<SaveDataResult> {
  return enqueue(async () => {
    if (!_available) return { ok: false, error: 'Salvataggio non disponibile', fatal: false };
    if (_unsupportedDocument !== null) return { ok: false, error: UNSUPPORTED_SCHEMA_ERROR, fatal: false };
    const state = buildStateSnapshot();
    if (_lastSyncedStateSignature === stateSignature(state)) return { ok: true };
    return writeSnapshot(state, 'state', 'previous');
  });
}

// ============ Caricamento e migrazione da localStorage ============

interface LegacySource {
  raw: string;
  backupRaw: string | null;
}

function readLegacyLocalStorage(): LegacySource | null {
  try {
    for (const key of LEGACY_STORAGE_KEYS) {
      const raw = localStorage.getItem(key);
      if (raw) return { raw, backupRaw: localStorage.getItem(LEGACY_BACKUP_KEY) };
    }
    const backupRaw = localStorage.getItem(LEGACY_BACKUP_KEY);
    return backupRaw ? { raw: backupRaw, backupRaw: null } : null;
  } catch {
    return null;
  }
}

function removeLegacyLocalStorage(): void {
  try {
    for (const key of LEGACY_STORAGE_KEYS) localStorage.removeItem(key);
    localStorage.removeItem(LEGACY_BACKUP_KEY);
  } catch {
    /* localStorage non accessibile: nulla da rimuovere */
  }
}

function migrationLoadError(decoded: DecodedDocument): void {
  if (decoded.ok) return;
  if (decoded.reason === 'future_version') {
    console.error(`[storage] schema futuro non supportato: ${decoded.version ?? 'sconosciuto'}`);
  } else if (decoded.reason === 'missing_migration') {
    console.error(`[storage] migrazione mancante dalla versione ${decoded.version ?? 'sconosciuta'}`);
  }
}

/**
 * Carica i dati: IndexedDB, altrimenti (una volta sola) i dati localStorage delle versioni
 * precedenti, che vengono migrati in IndexedDB e poi rimossi. Se il documento principale è
 * illeggibile si usa il backup. Un documento migrato da uno schema precedente viene riscritto
 * subito nel formato corrente, con l'originale come backup.
 */
export async function loadData(): Promise<boolean> {
  if (!_available) return false;
  let raw: string | undefined;
  let backupRaw: string | null = null;
  let legacy: LegacySource | null = null;
  try {
    raw = await idbGet(DATA);
    if (raw === undefined) {
      legacy = readLegacyLocalStorage();
      raw = legacy?.raw;
      backupRaw = legacy?.backupRaw ?? null;
    }
  } catch (e) {
    console.error('[storage] lettura fallita', e);
    return false;
  }
  if (raw === undefined) return false;

  let decoded = decodeDocument(raw);
  if (isUnsupportedSchema(decoded)) {
    migrationLoadError(decoded);
    _unsupportedDocument = raw;
    return false;
  }

  let sourceRaw = raw;
  let fromBackup = false;
  if (!decoded.ok) {
    try {
      const candidate = legacy ? backupRaw : ((await idbGet(BACKUP)) ?? null);
      if (!candidate) return false;
      decoded = decodeDocument(candidate);
      if (!decoded.ok) {
        migrationLoadError(decoded);
        return false;
      }
      sourceRaw = candidate;
      fromBackup = true;
      console.warn('[storage] documento principale non valido, usato il backup');
    } catch {
      return false;
    }
  }

  const state = stateFromDocument(decoded.document);
  applyStateSnapshot(state);
  markSynced(state, readStamp(decoded.document));

  const needsRewrite = legacy !== null || fromBackup || decoded.fromVersion < SCHEMA_VERSION;
  if (needsRewrite) {
    const result = await enqueue(() => writeSnapshot(state, 'state', { raw: sourceRaw }));
    if (!result.ok) {
      console.warn('[storage] impossibile riscrivere i dati migrati:', result.error);
      return true;
    }
    // I dati localStorage si eliminano solo dopo il commit riuscito in IndexedDB.
    if (legacy) removeLegacyLocalStorage();
  }
  return true;
}

// ============ Quota ============

/** Uso stimato dello storage dell'origine rispetto alla quota concessa dal browser. */
export async function checkStorageSize(): Promise<{ usage: number; quota: number; warn: boolean }> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    const usage = estimate?.usage ?? 0;
    const quota = estimate?.quota ?? 0;
    return { usage, quota, warn: quota > 0 && usage / quota > STORAGE_WARN_RATIO };
  } catch {
    return { usage: 0, quota: 0, warn: false };
  }
}

export async function shouldWarnQuota(): Promise<boolean> {
  return (await checkStorageSize()).warn;
}

let _quotaWarned = false;
async function warnIfNearQuota(): Promise<void> {
  if (_quotaWarned) return;
  const { warn } = await checkStorageSize();
  if (!warn) return;
  _quotaWarned = true;
  const { showToast } = await import('../components/toast');
  showToast('Spazio di archiviazione quasi esaurito. Esporta un backup.', 'warning', 6000);
}

// ============ Auto-save ============

// Lo store sostituisce le slice persistite a ogni mutazione (mai modifiche in place):
// se nessun riferimento è cambiato, l'emit riguardava solo la UI e non c'è nulla da salvare.
let _lastPersistedSlices: readonly unknown[] | null = null;
let _autoSaveUnsub: (() => void) | null = null;

function persistedSlices(): readonly unknown[] {
  const s = getState();
  return [s.settings, s.foods, s.diary, s.recipes, s.favoriteFoodIds, s.biometrics];
}

function persistPendingState(): void {
  const slices = persistedSlices();
  if (_lastPersistedSlices && slices.every((slice, i) => slice === _lastPersistedSlices![i])) return;
  void saveData().then((result) => {
    if (result.ok) _lastPersistedSlices = slices;
    setStorageDisabled(!result.ok);
  });
}

function persistWhenHidden(): void {
  if (document.visibilityState === 'hidden') persistPendingState();
}

export function enableAutoSave(): void {
  if (_autoSaveUnsub || !_available) return;
  _autoSaveUnsub = subscribe(persistPendingState);
  window.addEventListener('pagehide', persistPendingState);
  document.addEventListener('visibilitychange', persistWhenHidden);
}

function disableAutoSave(): void {
  _autoSaveUnsub?.();
  _autoSaveUnsub = null;
  _lastPersistedSlices = null;
  window.removeEventListener('pagehide', persistPendingState);
  document.removeEventListener('visibilitychange', persistWhenHidden);
}

// ============ Sync tra tab ============

function broadcast(stamp: VersionStamp): void {
  try {
    _channel?.postMessage({ type: 'saved', stamp });
  } catch {
    /* canale chiuso: le altre tab leggeranno al prossimo salvataggio */
  }
}

function hasUnsyncedLocalState(): boolean {
  if (_lastSyncedStateSignature == null) return false;
  return stateSignature(buildStateSnapshot()) !== _lastSyncedStateSignature;
}

/** Un reset è una cancellazione globale: si applica subito, anche sopra modifiche locali. */
function applyResetSnapshot(stamp: VersionStamp): void {
  resetAll();
  markSynced(buildStateSnapshot(), stamp);
  window.dispatchEvent(new CustomEvent('nutritrack:multitab-sync'));
}

/**
 * Un'altra tab ha salvato. Il suo snapshot si applica solo se più recente; se questa tab ha
 * modifiche non ancora salvate, vengono salvate prima e ricevono una revisione più alta,
 * così uno snapshot remoto più vecchio non può mai sovrascrivere una modifica locale.
 */
async function handleRemoteSave(remoteStamp: VersionStamp): Promise<void> {
  if (compareStamps(remoteStamp, _currentStamp) <= 0) return;
  if (remoteStamp.syncKind === 'reset') {
    applyResetSnapshot(remoteStamp);
    return;
  }
  if (hasUnsyncedLocalState()) {
    await saveData();
    return;
  }
  await enqueue(async () => {
    const raw = await idbGet(DATA);
    if (!raw) return;
    const decoded = decodeDocument(raw);
    if (!decoded.ok) return;
    const stamp = readStamp(decoded.document);
    if (compareStamps(stamp, _currentStamp) <= 0) return;
    if (stamp.syncKind === 'reset') {
      applyResetSnapshot(stamp);
      return;
    }
    const state = stateFromDocument(decoded.document);
    if (stateSignature(state) !== stateSignature(buildStateSnapshot())) {
      applyStateSnapshot(state);
      emitChange();
      window.dispatchEvent(new CustomEvent('nutritrack:multitab-sync'));
    }
    markSynced(state, stamp);
  });
}

export function initMultiTabSync(): void {
  if (_channel || !_available || typeof BroadcastChannel === 'undefined') return;
  _channel = new BroadcastChannel(SYNC_CHANNEL);
  _channel.onmessage = (event: MessageEvent<{ type?: string; stamp?: unknown }>) => {
    if (event.data?.type !== 'saved') return;
    void handleRemoteSave(readStamp(event.data.stamp));
  };
}

// ============ Reset / Export / Import ============

export type ResetApplicationDataResult = { ok: true } | { ok: false; error: string };

/**
 * Cancella tutti i dati utente come singola operazione semantica. Il documento resta come
 * tombstone di reset revisionata (così le altre tab non possono resuscitare snapshot vecchi),
 * il backup viene eliminato insieme a eventuali dati localStorage residui.
 */
export function resetApplicationData(): Promise<ResetApplicationDataResult> {
  return enqueue(async () => {
    if (!_available) return { ok: false, error: 'Salvataggio non disponibile: impossibile completare il reset.' };
    const beforeState: AppState = { ...getState() };
    resetAll();
    const result = await writeSnapshot(buildStateSnapshot(), 'reset', 'delete');
    if (!result.ok) {
      // La UI deve osservare o tutto il vecchio stato o il reset completo, mai un mezzo reset.
      setState(beforeState);
      emitChange();
      return { ok: false, error: result.error };
    }
    removeLegacyLocalStorage();
    _unsupportedDocument = null;
    _quotaWarned = false;
    void clearRuntimeDataCaches();
    if (getState()._storageDisabled) setStorageDisabled(false);
    return { ok: true };
  });
}

/** Export utente: solo schema + dati. Revision/origin/syncKind sono metadata interni. */
export function exportDataJson(): string {
  // Un documento di schema futuro non è idratabile: si esporta l'originale, non lo stato vuoto.
  if (_unsupportedDocument !== null) return _unsupportedDocument;
  return JSON.stringify({ version: SCHEMA_VERSION, ...buildStateSnapshot() }, null, 2);
}

function migrationImportError(reason: MigrationFailureReason, version?: number): string {
  if (reason === 'future_version') {
    return `Backup creato con uno schema più recente (${version ?? '?'}). Aggiorna NutriTrack prima di importarlo.`;
  }
  if (reason === 'missing_migration') {
    return `Migrazione dati non disponibile dalla versione ${version ?? '?'}.`;
  }
  if (reason === 'invalid_version') return 'Versione schema del backup non valida.';
  return 'Formato file non riconosciuto come documento NutriTrack.';
}

export type ImportResult = { ok: true; count: number; skipped?: number } | { ok: false; error: string };

/** Importa un backup JSON migrando lo schema e poi normalizzando i valori. */
export async function importDataJson(json: string): Promise<ImportResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: 'JSON non valido' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Formato file non riconosciuto' };
  }
  if (!isDataDocument(parsed as Record<string, unknown>)) {
    return { ok: false, error: 'File non riconosciuto come backup NutriTrack (dati assenti o formato non valido)' };
  }
  const migrated = migratePersistedDocument(parsed);
  if (!migrated.ok) return { ok: false, error: migrationImportError(migrated.reason, migrated.version) };
  const document = migrated.document as { foods?: unknown[]; recipes?: unknown[]; diary?: Record<string, unknown[]> };

  let rawTotal =
    (Array.isArray(document.foods) ? document.foods.length : 0) +
    (Array.isArray(document.recipes) ? document.recipes.length : 0);
  if (document.diary && typeof document.diary === 'object') {
    for (const entries of Object.values(document.diary)) if (Array.isArray(entries)) rawTotal += entries.length;
  }

  const importedState = stateFromDocument(migrated.document);
  const count =
    importedState.foods.length +
    importedState.recipes.length +
    Object.values(importedState.diary).reduce((acc, entries) => acc + entries.length, 0);
  const skipped = Math.max(0, rawTotal - count);

  const beforeState: AppState = { ...getState() };
  applyStateSnapshot(importedState);
  // Un import è una nuova modifica locale: riceve una revisione nuova, non quella del file.
  const saveResult = await saveData();
  if (!saveResult.ok) {
    setState(beforeState);
    emitChange();
    return { ok: false, error: saveResult.error };
  }
  emitChange();
  return { ok: true, count, skipped: skipped > 0 ? skipped : undefined };
}

// ============ Test ============

/** Solo test: riporta il modulo allo stato iniziale e cancella il database. */
export async function __resetStorageInternalForTesting(): Promise<void> {
  disableAutoSave();
  _channel?.close();
  _channel = null;
  await _writeQueue;
  _writeQueue = Promise.resolve();
  await __deleteDatabaseForTesting();
  _available = false;
  _currentStamp = { ...INITIAL_STAMP };
  _lastSyncedStateSignature = null;
  _unsupportedDocument = null;
  _quotaWarned = false;
  await initStorage();
}

/** Solo test: dimentica lo stato di sessione ma conserva il database (come un ricaricamento). */
export async function __simulateReloadForTesting(): Promise<void> {
  disableAutoSave();
  _channel?.close();
  _channel = null;
  await _writeQueue;
  _currentStamp = { ...INITIAL_STAMP };
  _lastSyncedStateSignature = null;
  _unsupportedDocument = null;
}

/** Solo test: simula il messaggio di salvataggio di un'altra tab. */
export function __handleRemoteSaveForTesting(stamp: unknown): Promise<void> {
  return handleRemoteSave(readStamp(stamp));
}
