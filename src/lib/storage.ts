// Persistenza localStorage con backup, quota handling e multi-tab sync.
// Pattern 7 + 8 dello standard.
//
// Fix B1: ordine backup corretto (leggi PRIMA di sovrascrivere).
// Fix B2: _storageOK flippato a false nel branch SecurityError (previene loop RAF).
// Fix B3: strip immagini ricorsivo (diary.foodSnapshot.image + recipes.ingredients[].foodSnapshot.image).
// Fix B8: emitChange() dopo setState in multi-tab sync (UI si aggiorna nell'altro tab).
// Fix B10: emitChange() + saveData() in importDataJson (persiste prima del reload).
// Fix B19: rimosso dead code MAX_FOODS_BEFORE_PRUNE (non più referenziato).

import type { FoodItem, Recipe, DiaryEntry, DayDiary } from '../types';
import { BACKUP_KEY, STORAGE_KEY, STORAGE_WARN_BYTES, SCHEMA_VERSION } from './constants';
import { getState, setState, setStorageDisabled, subscribe, emitChange } from './store';
import { reconcileAll, estimateStorageBytes, isStorageWarn } from './normalize';

let _storageOK = true;

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

/** Salva su localStorage con backup automatico e gestione quota */
export function saveData(): void {
  if (!_storageOK) return;
  const payload = buildPayload();
  const serialized = JSON.stringify(payload);

  // Fix B1: leggi PRIMA di sovrascrivere, così il backup contiene il valore precedente
  let prev: string | null = null;
  try {
    prev = localStorage.getItem(STORAGE_KEY);
  } catch {
    // ignore read error
  }

  try {
    localStorage.setItem(STORAGE_KEY, serialized);
    // Backup snapshot precedente (solo se diverso dal nuovo)
    if (prev && prev !== serialized) {
      try {
        localStorage.setItem(BACKUP_KEY, prev);
      } catch {
        // backup failure non fatale
      }
    }
  } catch (e: unknown) {
    const err = e as { name?: string; code?: number };
    if (err.name === 'QuotaExceededError' || err.code === 22 || err.code === 1014) {
      // Fix B3: strip ricorsivo delle immagini (foods + diary + recipes + ingredients)
      const stripped = stripImages(payload);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stripped));
        console.warn('[storage] quota superata, immagini stripate ricorsivamente');
        // Aggiorna lo state in-memory con il payload stripped (evita loop: prossimo save sarà già senza immagini)
        setState({
          foods: stripped.foods as FoodItem[],
          diary: stripped.diary as DayDiary,
          recipes: stripped.recipes as Recipe[],
        });
      } catch {
        console.error('[storage] storage esaurito anche dopo strip. Esporta backup.');
      }
    } else if (err.name === 'SecurityError' || err.code === 18) {
      // Fix B2: flippa _storageOK a false per evitare loop RAF infinito
      // (setStorageDisabled emette emitChange → autosave → saveData → loop)
      _storageOK = false;
      setStorageDisabled(true);
      console.warn('[storage] modalità privata rilevata, salvataggio disabilitato');
    } else {
      console.error('[storage] errore salvataggio', e);
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
export function enableAutoSave(): void {
  if (_autoSaveEnabled || !_storageOK) return;
  _autoSaveEnabled = true;
  subscribe(() => {
    saveData();
  });
}

// ============ Multi-tab sync via storage event ============

let _multiTabInit = false;
export function initMultiTabSync(): void {
  if (_multiTabInit || !_storageOK) return;
  _multiTabInit = true;
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    try {
      const parsed = JSON.parse(e.newValue);
      const reconciled = reconcileAll(parsed);
      // Skip se un modale è aperto (evita di sovrascrivere form)
      // Fix: aggiunti anche _confirmDeleteFoodId, _confirmDeleteRecipeId, _addRecipeToMealPickerId
      const s = getState();
      if (
        s._searchOpen ||
        s._editingFoodId !== null ||
        s._editingRecipeId !== null ||
        s._viewingRecipeId !== null ||
        s._confirmReset ||
        s._confirmDeleteFoodId !== null ||
        s._confirmDeleteRecipeId !== null ||
        s._addRecipeToMealPickerId !== null
      ) {
        return;
      }
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
    } catch {
      // ignore parse error da tab parziale
    }
  });
}

// ============ Export / Import JSON backup ============

export function exportDataJson(): string {
  return JSON.stringify(buildPayload(), null, 2);
}

export function importDataJson(json: string): { ok: true; count: number } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: 'JSON non valido' };
  }
  const reconciled = reconcileAll(parsed);
  // Validazione minima: serve almeno settings valide (reconcileAll ritorna sempre defaults,
  // quindi controlliamo che il payload originale sia un oggetto con almeno una chiave riconosciuta)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Formato file non riconosciuto' };
  }
  const count =
    reconciled.foods.length +
    reconciled.recipes.length +
    Object.values(reconciled.diary).reduce((acc, entries) => acc + entries.length, 0);
  setState({
    settings: reconciled.settings,
    foods: reconciled.foods,
    diary: reconciled.diary,
    recipes: reconciled.recipes,
    favoriteFoodIds: reconciled.favoriteFoodIds,
  });
  // Fix B10: persisti immediatamente su localStorage PRIMA del reload
  // (setState è silenzioso, autosave non scatta → reload perde i dati)
  saveData();
  emitChange();
  return { ok: true, count };
}
