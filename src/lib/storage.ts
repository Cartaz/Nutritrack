// Persistenza localStorage con backup, quota handling e multi-tab sync.
//
// Ownership: questo modulo possiede formato persistito, revisioni multi-tab, backup,
// quota handling e riconciliazione degli snapshot ricevuti. Lo store non deve conoscere
// causalità o metadata di sincronizzazione.

import type { AppState, FoodItem, Recipe, DiaryEntry, DayDiary } from '../types';
import { BACKUP_KEY, STORAGE_KEY, STORAGE_WARN_BYTES, SCHEMA_VERSION } from './constants';
import { getState, setState, setStorageDisabled, subscribe, emitChange } from './store';
import { reconcileAll, estimateStorageBytes, isStorageWarn } from './normalize';

interface PersistedState {
  settings: AppState['settings'];
  foods: AppState['foods'];
  diary: AppState['diary'];
  recipes: AppState['recipes'];
  favoriteFoodIds: AppState['favoriteFoodIds'];
  biometrics: AppState['biometrics'];
}

interface VersionStamp {
  revision: number;
  originTabId: string;
}

interface PersistedPayload extends PersistedState, VersionStamp {
  version: number;
}

interface ParsedPersistedPayload {
  state: PersistedState;
  stamp: VersionStamp;
  signature: string;
}

type PendingMultiTabUpdate = ParsedPersistedPayload;

const LEGACY_STAMP: VersionStamp = { revision: 0, originTabId: '' };

function createTabId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const _tabId = createTabId();
let _storageOK = true;
let _currentStamp: VersionStamp = { ...LEGACY_STAMP };
let _lastSyncedStateSignature: string | null = null;
let _pendingMultiTabUpdate: PendingMultiTabUpdate | null = null;
let _quotaWarnedThisSession = false;
let _stripWarnedThisSession = false;

// Rilevazione modalità privata / storage non disponibile (IIFE all'avvio).
(function detectStorage(): void {
  try {
    const k = '__nt_test_' + Date.now();
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
  } catch {
    _storageOK = false;
    console.warn('[storage] localStorage non disponibile (modalità privata?)');
  }
})();

export function isStorageAvailable(): boolean {
  return _storageOK;
}

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

function stateFromReconciled(reconciled: ReturnType<typeof reconcileAll>): PersistedState {
  return {
    settings: reconciled.settings,
    foods: reconciled.foods,
    diary: reconciled.diary,
    recipes: reconciled.recipes,
    favoriteFoodIds: reconciled.favoriteFoodIds,
    biometrics: reconciled.biometrics,
  };
}

function stateSignature(state: PersistedState): string {
  return JSON.stringify(state);
}

function buildPayload(state: PersistedState, stamp: VersionStamp): PersistedPayload {
  return {
    version: SCHEMA_VERSION,
    revision: stamp.revision,
    originTabId: stamp.originTabId,
    ...state,
  };
}

function readStamp(value: unknown): VersionStamp {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...LEGACY_STAMP };
  const obj = value as { revision?: unknown; originTabId?: unknown };
  const revision =
    typeof obj.revision === 'number' && Number.isFinite(obj.revision) && obj.revision >= 0
      ? Math.floor(obj.revision)
      : 0;
  const originTabId = typeof obj.originTabId === 'string' ? obj.originTabId.slice(0, 200) : '';
  return { revision, originTabId };
}

/** Ordine totale per snapshot con la stessa revisione, utile solo in caso di write concorrenti. */
function compareStamps(a: VersionStamp, b: VersionStamp): number {
  if (a.revision !== b.revision) return a.revision < b.revision ? -1 : 1;
  if (a.originTabId === b.originTabId) return 0;
  return a.originTabId < b.originTabId ? -1 : 1;
}

function parsePersistedRaw(raw: string): ParsedPersistedPayload | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const state = stateFromReconciled(reconcileAll(parsed));
    return {
      state,
      stamp: readStamp(parsed),
      signature: stateSignature(state),
    };
  } catch {
    return null;
  }
}

function markSynced(state: PersistedState, stamp: VersionStamp): void {
  _currentStamp = { ...stamp };
  _lastSyncedStateSignature = stateSignature(state);
  if (_pendingMultiTabUpdate && !isRemoteNewer(_pendingMultiTabUpdate)) {
    _pendingMultiTabUpdate = null;
  }
}

function hasUnsyncedLocalState(): boolean {
  if (_lastSyncedStateSignature == null) return false;
  return stateSignature(buildStateSnapshot()) !== _lastSyncedStateSignature;
}

function isRemoteNewer(remote: ParsedPersistedPayload): boolean {
  // Backward compatibility: payload pre-revision are revision 0. While this tab is
  // still at revision 0, preserve the old physical-last-write behavior.
  if (remote.stamp.revision === 0 && _currentStamp.revision === 0) {
    return remote.signature !== _lastSyncedStateSignature;
  }
  return compareStamps(remote.stamp, _currentStamp) > 0;
}

function applyStateSnapshot(state: PersistedState): void {
  setState({
    settings: state.settings,
    foods: state.foods,
    diary: state.diary,
    recipes: state.recipes,
    favoriteFoodIds: state.favoriteFoodIds,
    biometrics: state.biometrics,
  });
}

/** Strip ricorsivo delle immagini da foods, diary.foodSnapshot, recipes e ingredient snapshots. */
function stripImages(payload: PersistedPayload): PersistedPayload {
  const stripFood = (f: FoodItem): FoodItem => ({ ...f, image: undefined });
  const stripDiary = (diary: DayDiary): DayDiary => {
    const out: DayDiary = {};
    for (const [date, entries] of Object.entries(diary)) {
      out[date] = entries.map((e: DiaryEntry) => ({
        ...e,
        foodSnapshot: stripFood(e.foodSnapshot),
      }));
    }
    return out;
  };
  const stripRecipe = (r: Recipe): Recipe => ({
    ...r,
    image: undefined,
    ingredients: r.ingredients.map((ing) => ({
      ...ing,
      foodSnapshot: stripFood(ing.foodSnapshot),
    })),
  });
  return {
    ...payload,
    foods: payload.foods.map(stripFood),
    diary: stripDiary(payload.diary),
    recipes: payload.recipes.map(stripRecipe),
  };
}

function writeBackupIfValid(previousRaw: string | null, newRaw: string): void {
  if (!previousRaw || previousRaw === newRaw) return;
  try {
    JSON.parse(previousRaw);
    localStorage.setItem(BACKUP_KEY, previousRaw);
  } catch {
    // Non propagare un primario corrotto al backup.
  }
}

function warnIfNearQuota(): void {
  if (_quotaWarnedThisSession) return;
  const sizeInfo = checkStorageSize();
  if (!sizeInfo.warn) return;
  _quotaWarnedThisSession = true;
  void import('../components/toast').then(({ showToast }) => {
    showToast(
      `Attenzione: dati vicini al limite di quota (${Math.round((sizeInfo.bytes / 1024 / 1024) * 10) / 10}MB). Esporta un backup.`,
      'warning',
      6000,
    );
  });
}

/** Tipo risultato di saveData per permettere a importDataJson di propagare errori. */
export type SaveDataResult = { ok: true } | { ok: false; error: string; fatal: boolean };

/**
 * Persiste uno snapshot locale con una revisione strettamente maggiore della base nota.
 * Tutta la complessità di versioning rimane qui: i caller forniscono solo lo stato.
 */
function writeLocalSnapshot(state: PersistedState, previousRaw: string | null, baseRevision: number): SaveDataResult {
  const stamp: VersionStamp = {
    revision: Math.max(0, Math.floor(baseRevision)) + 1,
    originTabId: _tabId,
  };
  const payload = buildPayload(state, stamp);
  const serialized = JSON.stringify(payload);

  try {
    localStorage.setItem(STORAGE_KEY, serialized);
    writeBackupIfValid(previousRaw, serialized);
    markSynced(state, stamp);
    warnIfNearQuota();
    return { ok: true };
  } catch (e: unknown) {
    const err = e as { name?: string; code?: number };
    if (err.name === 'QuotaExceededError' || err.code === 22 || err.code === 1014) {
      const stripped = stripImages(payload);
      const strippedSerialized = JSON.stringify(stripped);
      try {
        localStorage.setItem(STORAGE_KEY, strippedSerialized);
        writeBackupIfValid(previousRaw, strippedSerialized);
        if (!_stripWarnedThisSession) {
          _stripWarnedThisSession = true;
          void import('../components/toast').then(({ showToast }) => {
            showToast('Spazio esaurito — immagini rimosse per fare spazio. Esporta un backup.', 'warning', 6000);
          });
        }
        // Mantieni lo state in-memory identico allo snapshot effettivamente persistito.
        setState({
          foods: stripped.foods,
          diary: stripped.diary,
          recipes: stripped.recipes,
        });
        markSynced(buildStateSnapshot(), stamp);
        return { ok: true };
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

/**
 * Salva lo stato se differisce dall'ultimo snapshot sincronizzato.
 * La nuova revisione è maggiore sia della revisione vista da questo tab sia di quella
 * attualmente presente in localStorage, così una modifica locale successiva a un evento
 * remoto pending non può essere sovrascritta da quel vecchio evento.
 */
export function saveData(): SaveDataResult {
  if (!_storageOK) return { ok: false, error: 'storage non disponibile', fatal: false };

  const state = buildStateSnapshot();
  const signature = stateSignature(state);

  let previousRaw: string | null = null;
  try {
    previousRaw = localStorage.getItem(STORAGE_KEY);
  } catch {
    // La write successiva produrrà il risultato appropriato.
  }
  const previous = previousRaw ? parsePersistedRaw(previousRaw) : null;

  // Prima chiamata dopo bootstrap: se localStorage contiene già lo stesso stato,
  // adottane la revisione senza creare una write/backup artificiale.
  if (_lastSyncedStateSignature == null && previous?.signature === signature) {
    markSynced(state, previous.stamp);
    return { ok: true };
  }

  if (_lastSyncedStateSignature === signature) return { ok: true };

  const baseRevision = Math.max(_currentStamp.revision, previous?.stamp.revision ?? 0);
  return writeLocalSnapshot(state, previousRaw, baseRevision);
}

/** Carica da localStorage con fallback backup. Payload legacy senza revision metadata restano compatibili. */
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

  const state = stateFromReconciled(reconcileAll(parsed));
  applyStateSnapshot(state);
  markSynced(state, readStamp(parsed));
  return true;
}

/** Verifica dimensione dati persistiti e ritorna true se in warning (>4.5MB). */
export function checkStorageSize(): { bytes: number; warn: boolean } {
  const bytes = estimateStorageBytes(buildPayload(buildStateSnapshot(), _currentStamp));
  return { bytes, warn: isStorageWarn(bytes) };
}

export function shouldWarnQuota(): boolean {
  return checkStorageSize().bytes > STORAGE_WARN_BYTES * 0.9;
}

// ============ Auto-save: subscribe a ogni emit ============

let _autoSaveEnabled = false;
let _autoSaveUnsub: (() => void) | null = null;
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

// ============ Multi-tab sync via storage event ============

function isAnyModalOpen(): boolean {
  const s = getState();
  return (
    s._searchOpen ||
    s._editingFoodId !== null ||
    s._editingRecipeId !== null ||
    s._viewingRecipeId !== null ||
    s._confirmReset ||
    s._confirmDeleteFoodId !== null ||
    s._confirmDeleteRecipeId !== null ||
    s._addRecipeToMealPickerId !== null ||
    s._editingEntryId !== null
  );
}

function queuePendingRemote(remote: PendingMultiTabUpdate): void {
  if (!_pendingMultiTabUpdate) {
    _pendingMultiTabUpdate = remote;
    return;
  }
  if (remote.stamp.revision === 0 && _pendingMultiTabUpdate.stamp.revision === 0) {
    // Legacy: non esiste causalità esplicita, quindi l'ultimo storage event fisico vince.
    _pendingMultiTabUpdate = remote;
    return;
  }
  if (compareStamps(remote.stamp, _pendingMultiTabUpdate.stamp) > 0) {
    _pendingMultiTabUpdate = remote;
  }
}

/** Applica uno snapshot remoto solo dopo averne verificato la causalità. */
function applyMultiTabUpdate(remote: ParsedPersistedPayload): void {
  if (!isRemoteNewer(remote)) return;

  const currentSignature = stateSignature(buildStateSnapshot());
  if (currentSignature === remote.signature) {
    // Stessi dati, metadata più nuovi: adotta soltanto la nuova versione.
    markSynced(remote.state, remote.stamp);
    return;
  }

  applyStateSnapshot(remote.state);
  markSynced(remote.state, remote.stamp);
  emitChange();
  window.dispatchEvent(new CustomEvent('nutritrack:multitab-sync'));
}

/**
 * Se due tab hanno prodotto la stessa revisione leggendo contemporaneamente lo stesso
 * predecessore, originTabId fornisce un tie-break deterministico. Se il localStorage
 * fisico contiene il perdente, il vincitore viene riscritto con revision+1 per rendere
 * persistente la convergenza anche dopo un reload.
 */
function repairStalePhysicalSnapshot(rawRemote: string, remote: ParsedPersistedPayload): void {
  if (compareStamps(remote.stamp, _currentStamp) >= 0) return;
  let currentRaw: string | null = null;
  try {
    currentRaw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return;
  }
  if (currentRaw !== rawRemote) return; // l'evento era già obsoleto anche a livello fisico

  const state = buildStateSnapshot();
  if (stateSignature(state) !== _lastSyncedStateSignature) return; // saveData gestirà il locale dirty
  void writeLocalSnapshot(state, currentRaw, Math.max(_currentStamp.revision, remote.stamp.revision));
}

function handleStorageEvent(e: StorageEvent): void {
  if (e.key !== STORAGE_KEY || !e.newValue) return;
  const remote = parsePersistedRaw(e.newValue);
  if (!remote) return;

  if (!isRemoteNewer(remote)) {
    repairStalePhysicalSnapshot(e.newValue, remote);
    return;
  }

  // Un emit locale può essere ancora in attesa del RAF autosave. Prima di applicare
  // un remote snapshot a UI libera, commetti sincronicamente quel locale dirty.
  if (!isAnyModalOpen() && hasUnsyncedLocalState()) {
    const saved = saveData();
    if (!saved.ok) {
      queuePendingRemote(remote);
      return;
    }
    if (!isRemoteNewer(remote)) return;
  }

  if (isAnyModalOpen()) {
    queuePendingRemote(remote);
    return;
  }

  applyMultiTabUpdate(remote);
}

let _multiTabInit = false;
export function initMultiTabSync(): void {
  if (_multiTabInit || !_storageOK) return;
  _multiTabInit = true;
  window.addEventListener('storage', handleStorageEvent);
}

/**
 * Alla chiusura dell'ultimo modal, salva prima qualsiasi stato locale dirty e solo dopo
 * valuta lo snapshot remoto pending. Un pending con revisione più vecchia viene scartato.
 */
export function flushPendingMultiTabUpdate(): void {
  if (!_pendingMultiTabUpdate || isAnyModalOpen()) return;

  const pending = _pendingMultiTabUpdate;
  _pendingMultiTabUpdate = null;

  if (hasUnsyncedLocalState()) {
    const saved = saveData();
    if (!saved.ok) {
      _pendingMultiTabUpdate = pending;
      return;
    }
  }

  if (isRemoteNewer(pending)) applyMultiTabUpdate(pending);
}

/**
 * Reset interno per test (non usare in produzione). Rimuove anche il listener multi-tab
 * così ogni test parte da un lifecycle reale e isolato.
 */
export function __resetStorageInternalForTesting(): void {
  disableAutoSave();
  if (_multiTabInit) {
    window.removeEventListener('storage', handleStorageEvent);
    _multiTabInit = false;
  }
  _storageOK = true;
  _quotaWarnedThisSession = false;
  _stripWarnedThisSession = false;
  _pendingMultiTabUpdate = null;
  _currentStamp = { ...LEGACY_STAMP };
  _lastSyncedStateSignature = null;
}

// ============ Export / Import JSON backup ============

/** Export utente: solo schema + dati. Revision/origin sono metadata interni alla persistenza. */
export function exportDataJson(): string {
  return JSON.stringify({ version: SCHEMA_VERSION, ...buildStateSnapshot() }, null, 2);
}

/** Cancella sia la chiave primaria che il backup da localStorage. */
export function clearAllStoredData(): void {
  if (!_storageOK) return;
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
  _quotaWarnedThisSession = false;
  _stripWarnedThisSession = false;
  _pendingMultiTabUpdate = null;
  _currentStamp = { ...LEGACY_STAMP };
  _lastSyncedStateSignature = null;
}

/** Importa un backup JSON validando struttura e contenuto prima di sostituire lo state. */
export function importDataJson(
  json: string,
): { ok: true; count: number; skipped?: number } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: 'JSON non valido' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Formato file non riconosciuto' };
  }
  const KNOWN_KEYS = ['version', 'settings', 'foods', 'diary', 'recipes', 'favoriteFoodIds', 'biometrics'];
  const hasKnownKey = KNOWN_KEYS.some((k) => k in (parsed as Record<string, unknown>));
  if (!hasKnownKey) {
    return { ok: false, error: 'File non riconosciuto come backup NutriTrack (nessuna chiave valida)' };
  }

  const parsedObj = parsed as { version?: unknown };
  if (
    parsedObj.version !== undefined &&
    typeof parsedObj.version === 'number' &&
    parsedObj.version !== SCHEMA_VERSION
  ) {
    console.warn(
      `[storage] import con versione schema ${parsedObj.version} (attesa ${SCHEMA_VERSION}). Tentativo di migrazione...`,
    );
  }

  const rawParsed = parsed as {
    foods?: unknown[];
    recipes?: unknown[];
    diary?: Record<string, unknown[]>;
  };
  const rawFoodsCount = Array.isArray(rawParsed.foods) ? rawParsed.foods.length : 0;
  const rawRecipesCount = Array.isArray(rawParsed.recipes) ? rawParsed.recipes.length : 0;
  let rawEntriesCount = 0;
  if (rawParsed.diary && typeof rawParsed.diary === 'object') {
    for (const val of Object.values(rawParsed.diary)) {
      if (Array.isArray(val)) rawEntriesCount += val.length;
    }
  }
  const rawTotal = rawFoodsCount + rawRecipesCount + rawEntriesCount;

  const reconciled = reconcileAll(parsed);
  const importedState = stateFromReconciled(reconciled);
  const count =
    importedState.foods.length +
    importedState.recipes.length +
    Object.values(importedState.diary).reduce((acc, entries) => acc + entries.length, 0);
  const skipped = Math.max(0, rawTotal - count);

  applyStateSnapshot(importedState);
  // Non adottare revision/origin presenti nel file importato: un import è una nuova
  // modifica locale e deve ricevere una nuova revisione rispetto allo storage corrente.
  const saveResult = saveData();
  if (!saveResult.ok) {
    return { ok: false, error: saveResult.error };
  }
  emitChange();
  return { ok: true, count, skipped: skipped > 0 ? skipped : undefined };
}
