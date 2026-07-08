// Persistenza localStorage con backup, quota handling e multi-tab sync.
// Pattern 7 + 8 dello standard.
//
// Fix B1: ordine backup corretto (leggi PRIMA di sovrascrivere).
// Fix B2: _storageOK flippato a false nel branch SecurityError (previene loop RAF).
// Fix B3: strip immagini ricorsivo (diary.foodSnapshot.image + recipes.ingredients[].foodSnapshot.image).
// Fix B8: emitChange() dopo setState in multi-tab sync (UI si aggiorna nell'altro tab).
// Fix B10: emitChange() + saveData() in importDataJson (persiste prima del reload).
// Fix B19: rimosso dead code MAX_FOODS_BEFORE_PRUNE (non più referenziato).
//
// Fix C2 (CRITICAL): importDataJson valida chiavi riconosciute + versione schema.
// Fix C3 (CRITICAL): multi-tab — accoda update cross-tab mentre modal aperto, applica alla chiusura.
// Fix 7.2: _editingEntryId aggiunto al multi-tab skip-check.
// Fix 7.5: saveData skip se payload invariato.
// Fix 7.6: importDataJson propaga errori di saveData.
// Fix 7.9: BACKUP_KEY scritto solo se prev è JSON parseable.
// Fix 7.11: toast su strip immagini per quota.
// Fix 7.12: rimosso doppio save in importDataJson.
// Fix 7.13: warning su schema version mismatch.

import type { FoodItem, Recipe, DiaryEntry, DayDiary } from '../types';
import { BACKUP_KEY, STORAGE_KEY, STORAGE_WARN_BYTES, SCHEMA_VERSION } from './constants';
import { getState, setState, setStorageDisabled, subscribe, emitChange } from './store';
import { reconcileAll, estimateStorageBytes, isStorageWarn } from './normalize';

let _storageOK = true;
// Fix C3: queue di update cross-tab ricevuti mentre un modal era aperto
let _pendingMultiTabUpdate: { settings: unknown; foods: unknown; diary: unknown; recipes: unknown; favoriteFoodIds: unknown } | null = null;
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

interface PersistedPayload {
  version: number;
  settings: unknown;
  foods: unknown;
  diary: unknown;
  recipes: unknown;
  favoriteFoodIds: unknown;
}

function buildPayload(): PersistedPayload {
  const s = getState();
  return {
    version: SCHEMA_VERSION,
    settings: s.settings,
    foods: s.foods,
    diary: s.diary,
    recipes: s.recipes,
    favoriteFoodIds: s.favoriteFoodIds,
  };
}

/** Fix B3: strip ricorsivo delle immagini da foods, diary.foodSnapshot, recipes, recipes.ingredients[].foodSnapshot */
function stripImages(payload: PersistedPayload): PersistedPayload {
  const stripFood = (f: FoodItem): FoodItem => ({ ...f, image: undefined });
  const stripDiary = (diary: unknown): DayDiary => {
    if (typeof diary !== 'object' || diary === null) return {};
    const out: DayDiary = {};
    for (const [date, entries] of Object.entries(diary as Record<string, unknown>)) {
      if (!Array.isArray(entries)) continue;
      out[date] = (entries as DiaryEntry[]).map((e) => ({
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
    foods: (payload.foods as FoodItem[]).map(stripFood),
    diary: stripDiary(payload.diary),
    recipes: (payload.recipes as Recipe[]).map(stripRecipe),
  };
}

/** Tipo risultato di saveData per permettere a importDataJson di propagare errori. */
export type SaveDataResult = { ok: true } | { ok: false; error: string; fatal: boolean };

/** Salva su localStorage con backup automatico e gestione quota.
 *  Fix 7.5: skip scrittura se payload invariato (risparmio I/O + storage events inutili). */
export function saveData(): SaveDataResult {
  if (!_storageOK) return { ok: false, error: 'storage non disponibile', fatal: false };
  const payload = buildPayload();
  const serialized = JSON.stringify(payload);

  // Fix B1: leggi PRIMA di sovrascrivere, così il backup contiene il valore precedente
  let prev: string | null = null;
  try {
    prev = localStorage.getItem(STORAGE_KEY);
  } catch {
    // ignore read error
  }

  // Fix 7.5: skip se payload invariato
  if (prev === serialized) {
    return { ok: true };
  }

  try {
    localStorage.setItem(STORAGE_KEY, serialized);
    // Backup snapshot precedente (solo se diverso dal nuovo)
    // Fix 7.9: scrivi BACKUP_KEY solo se prev è JSON parseable (non scrivere stringhe corrotte)
    if (prev && prev !== serialized) {
      try {
        JSON.parse(prev); // validate
        localStorage.setItem(BACKUP_KEY, prev);
      } catch {
        // prev è corrotto: non propagarlo al backup
      }
    }
    // Fix 7.7: warning quota runtime (once per sessione)
    if (!_quotaWarnedThisSession) {
      const sizeInfo = checkStorageSize();
      if (sizeInfo.warn) {
        _quotaWarnedThisSession = true;
        // Lazy import per evitare ciclo: toast.ts non dipende da storage.ts
        import('../components/toast').then(({ showToast }) => {
          showToast(`Attenzione: dati vicini al limite di quota (${Math.round(sizeInfo.bytes / 1024 / 1024 * 10) / 10}MB). Esporta un backup.`, 'warning', 6000);
        });
      }
    }
    return { ok: true };
  } catch (e: unknown) {
    const err = e as { name?: string; code?: number };
    if (err.name === 'QuotaExceededError' || err.code === 22 || err.code === 1014) {
      // Fix B3: strip ricorsivo delle immagini (foods + diary + recipes + ingredients)
      const stripped = stripImages(payload);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stripped));
        // Fix 7.11: feedback utente su strip (once per sessione)
        if (!_stripWarnedThisSession) {
          _stripWarnedThisSession = true;
          import('../components/toast').then(({ showToast }) => {
            showToast('Spazio esaurito — immagini rimosse per fare spazio. Esporta un backup.', 'warning', 6000);
          });
        }
        // Aggiorna lo state in-memory con il payload stripped (evita loop: prossimo save sarà già senza immagini)
        setState({
          foods: stripped.foods as FoodItem[],
          diary: stripped.diary as DayDiary,
          recipes: stripped.recipes as Recipe[],
        });
        return { ok: true };
      } catch {
        console.error('[storage] storage esaurito anche dopo strip. Esporta backup.');
        return { ok: false, error: 'Quota superata anche dopo strip immagini. Esporta un backup e riprova.', fatal: true };
      }
    } else if (err.name === 'SecurityError' || err.code === 18) {
      // Fix B2: flippa _storageOK a false per evitare loop RAF infinito
      _storageOK = false;
      setStorageDisabled(true);
      console.warn('[storage] modalità privata rilevata, salvataggio disabilitato');
      return { ok: false, error: 'Modalità privata: salvataggio disabilitato', fatal: false };
    } else {
      console.error('[storage] errore salvataggio', e);
      return { ok: false, error: 'Errore salvataggio generico', fatal: false };
    }
  }
}

/** Carica da localStorage con fallback backup */
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
    // parse fallito: prova backup
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
  setState({
    settings: reconciled.settings,
    foods: reconciled.foods,
    diary: reconciled.diary,
    recipes: reconciled.recipes,
    favoriteFoodIds: reconciled.favoriteFoodIds,
  });
  return true;
}

/** Verifica dimensione dati e ritorna true se in warning (>4.5MB) */
export function checkStorageSize(): { bytes: number; warn: boolean } {
  const bytes = estimateStorageBytes(buildPayload());
  return { bytes, warn: isStorageWarn(bytes) };
}

/** Avviso se ci si avvicina alla quota */
export function shouldWarnQuota(): boolean {
  return checkStorageSize().bytes > STORAGE_WARN_BYTES * 0.9;
}

// ============ Auto-save: subscribe a ogni emit ============

let _autoSaveEnabled = false;
// Fix 7.14: salva l'unsubscribe per permettere teardown in test/HMR
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

let _multiTabInit = false;
export function initMultiTabSync(): void {
  if (_multiTabInit || !_storageOK) return;
  _multiTabInit = true;
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    // Fix 7.15 (Safari iOS echo): se newValue === serialized corrente, skip (no-op)
    try {
      const parsed = JSON.parse(e.newValue);
      const reconciled = reconcileAll(parsed);
      // Skip se un modale è aperto (evita di sovrascrivere form)
      // Fix 7.2 (T7): aggiunto _editingEntryId al check
      const s = getState();
      const anyModalOpen =
        s._searchOpen ||
        s._editingFoodId !== null ||
        s._editingRecipeId !== null ||
        s._viewingRecipeId !== null ||
        s._confirmReset ||
        s._confirmDeleteFoodId !== null ||
        s._confirmDeleteRecipeId !== null ||
        s._addRecipeToMealPickerId !== null ||
        s._editingEntryId !== null;
      if (anyModalOpen) {
        // Fix C3 (CRITICAL): accoda l'update invece di scartarlo.
        // Verrà applicato quando tutti i modali saranno chiusi (vedi flushPendingMultiTabUpdate).
        _pendingMultiTabUpdate = {
          settings: reconciled.settings,
          foods: reconciled.foods,
          diary: reconciled.diary,
          recipes: reconciled.recipes,
          favoriteFoodIds: reconciled.favoriteFoodIds,
        };
        return;
      }
      applyMultiTabUpdate(reconciled);
    } catch {
      // ignore parse error da tab parziale
    }
  });
}

function applyMultiTabUpdate(reconciled: ReturnType<typeof reconcileAll>): void {
  // Fix 7.15: confronta con stato corrente per evitare echo (Safari iOS)
  const current = getState();
  const currentSig = JSON.stringify({
    settings: current.settings,
    foods: current.foods,
    diary: current.diary,
    recipes: current.recipes,
    favoriteFoodIds: current.favoriteFoodIds,
  });
  const newSig = JSON.stringify({
    settings: reconciled.settings,
    foods: reconciled.foods,
    diary: reconciled.diary,
    recipes: reconciled.recipes,
    favoriteFoodIds: reconciled.favoriteFoodIds,
  });
  if (currentSig === newSig) return; // no-op, evita echo
  setState({
    settings: reconciled.settings,
    foods: reconciled.foods,
    diary: reconciled.diary,
    recipes: reconciled.recipes,
    favoriteFoodIds: reconciled.favoriteFoodIds,
  });
  // Fix B8: emitChange() per aggiornare la UI (setState è silenzioso)
  emitChange();
  // Notifica custom event per badge/aggiornamenti
  window.dispatchEvent(new CustomEvent('nutritrack:multitab-sync'));
}

/** Da chiamare alla chiusura di ogni modal: se c'è un update cross-tab pending, applicalo.
 *  Fix C3 (CRITICAL): previene sovrascrittura stale quando il modal viene chiuso. */
export function flushPendingMultiTabUpdate(): void {
  if (!_pendingMultiTabUpdate) return;
  const s = getState();
  const anyModalOpen =
    s._searchOpen ||
    s._editingFoodId !== null ||
    s._editingRecipeId !== null ||
    s._viewingRecipeId !== null ||
    s._confirmReset ||
    s._confirmDeleteFoodId !== null ||
    s._confirmDeleteRecipeId !== null ||
    s._addRecipeToMealPickerId !== null ||
    s._editingEntryId !== null;
  if (anyModalOpen) return; // altri modali ancora aperti
  const pending = _pendingMultiTabUpdate;
  _pendingMultiTabUpdate = null;
  const reconciled = reconcileAll(pending);
  applyMultiTabUpdate(reconciled);
}

// ============ Export / Import JSON backup ============

export function exportDataJson(): string {
  return JSON.stringify(buildPayload(), null, 2);
}

/** Importa un backup JSON.
 *  Fix C2 (CRITICAL): valida chiavi riconosciute + versione schema (prima {} o JSON sconosciuto cancellava tutti i dati).
 *  Fix 7.6: propaga errori di saveData (silenzioso prima).
 *  Fix 7.8: count post-reconcile ma con feedback su scarti.
 *  Fix 7.12: rimosso doppio save. */
export function importDataJson(json: string): { ok: true; count: number; skipped?: number } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: 'JSON non valido' };
  }
  // Validazione minima: deve essere un oggetto con almeno una chiave riconosciuta
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Formato file non riconosciuto' };
  }
  // Fix C2 (CRITICAL): richiedi almeno una chiave riconosciuta del payload NutriTrack
  const KNOWN_KEYS = ['version', 'settings', 'foods', 'diary', 'recipes', 'favoriteFoodIds'];
  const hasKnownKey = KNOWN_KEYS.some((k) => k in (parsed as Record<string, unknown>));
  if (!hasKnownKey) {
    return { ok: false, error: 'File non riconosciuto come backup NutriTrack (nessuna chiave valida)' };
  }
  // Fix 7.13: warning su version mismatch (non bloccante, reconcileAll gestisce)
  const parsedObj = parsed as { version?: unknown };
  if (parsedObj.version !== undefined && typeof parsedObj.version === 'number' && parsedObj.version !== SCHEMA_VERSION) {
    console.warn(`[storage] import con versione schema ${parsedObj.version} (attesa ${SCHEMA_VERSION}). Tentativo di migrazione...`);
  }

  // Conta raw items PRIMA di reconcile per feedback su scarti (Fix 7.8)
  const rawParsed = parsed as {
    foods?: unknown[];
    recipes?: unknown[];
    diary?: Record<string, unknown[]>;
    favoriteFoodIds?: unknown[];
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
  const count =
    reconciled.foods.length +
    reconciled.recipes.length +
    Object.values(reconciled.diary).reduce((acc, entries) => acc + entries.length, 0);
  const skipped = Math.max(0, rawTotal - count);

  setState({
    settings: reconciled.settings,
    foods: reconciled.foods,
    diary: reconciled.diary,
    recipes: reconciled.recipes,
    favoriteFoodIds: reconciled.favoriteFoodIds,
  });
  // Fix B10: persisti immediatamente su localStorage PRIMA del reload
  // Fix 7.6: propaga errori di saveData
  const saveResult = saveData();
  if (!saveResult.ok) {
    return { ok: false, error: saveResult.error };
  }
  // Fix 7.12: rimosso emitChange() ridondante (autosave subscribe gestisce; saveData già chiamato)
  // Ma serve emitChange per triggerare il render dell'UI con i nuovi dati
  emitChange();
  return { ok: true, count, skipped: skipped > 0 ? skipped : undefined };
}
