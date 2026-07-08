// Modal: editor alimento (crea/modifica). Form con valori per 100g, lock kcal da macro.

import { getState, closeFoodEditor, addFood, updateFood, emitChange } from '../lib/store';
import { showToast } from '../components/toast';
import { showModal } from '../components/modal';
import { escapeAttr } from '../lib/utils';
import { KCAL_PER_GRAM, type NutritionPer100 } from '../types';
import { refreshSearchAfterCustomFood } from '../components/search';

interface FoodFormState {
  name: string;
  brand: string;
  barcode: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  fiber: string;
  sugar: string;
  salt: string;
  servingSize: string;
  servingLabel: string;
  lockFromMacros: boolean;
}

const _foodEditorState: FoodFormState = {
  name: '',
  brand: '',
  barcode: '',
  calories: '',
  protein: '',
  carbs: '',
  fat: '',
  fiber: '',
  sugar: '',
  salt: '',
  servingSize: '100',
  servingLabel: '',
  lockFromMacros: false,
};

let _foodEditorBound = false;
// Fix MEDIUM bug: traccia lo stato iniziale per dirty check su close.
let _foodEditorInitial: FoodFormState | null = null;

function resetFoodEditorState(): void {
  Object.assign(_foodEditorState, {
    name: '',
    brand: '',
    barcode: '',
    calories: '',
    protein: '',
    carbs: '',
    fat: '',
    fiber: '',
    sugar: '',
    salt: '',
    servingSize: '100',
    servingLabel: '',
    lockFromMacros: false,
  });
}

// Fix MEDIUM bug: snapshot dello stato iniziale per dirty check.
function snapshotState(): FoodFormState {
  return { ..._foodEditorState };
}

function isDirty(): boolean {
  if (!_foodEditorInitial) return false;
  return (
    _foodEditorState.name !== _foodEditorInitial.name ||
    _foodEditorState.brand !== _foodEditorInitial.brand ||
    _foodEditorState.barcode !== _foodEditorInitial.barcode ||
    _foodEditorState.calories !== _foodEditorInitial.calories ||
    _foodEditorState.protein !== _foodEditorInitial.protein ||
    _foodEditorState.carbs !== _foodEditorInitial.carbs ||
    _foodEditorState.fat !== _foodEditorInitial.fat ||
    _foodEditorState.fiber !== _foodEditorInitial.fiber ||
    _foodEditorState.sugar !== _foodEditorInitial.sugar ||
    _foodEditorState.salt !== _foodEditorInitial.salt ||
    _foodEditorState.servingSize !== _foodEditorInitial.servingSize ||
    _foodEditorState.servingLabel !== _foodEditorInitial.servingLabel ||
    _foodEditorState.lockFromMacros !== _foodEditorInitial.lockFromMacros
  );
}

function loadFromFood(foodId: string): void {
  const f = getState().foods.find((x) => x.id === foodId);
  if (!f) {
    resetFoodEditorState();
    return;
  }
  _foodEditorState.name = f.name;
  _foodEditorState.brand = f.brand || '';
  _foodEditorState.barcode = f.barcode || '';
  _foodEditorState.calories = String(Math.round(f.nutrition.calories));
  _foodEditorState.protein = String(Math.round(f.nutrition.protein));
  _foodEditorState.carbs = String(Math.round(f.nutrition.carbs));
  _foodEditorState.fat = String(Math.round(f.nutrition.fat));
  _foodEditorState.fiber = f.nutrition.fiber != null ? String(f.nutrition.fiber) : '';
  _foodEditorState.sugar = f.nutrition.sugar != null ? String(f.nutrition.sugar) : '';
  _foodEditorState.salt = f.nutrition.salt != null ? String(f.nutrition.salt) : '';
  _foodEditorState.servingSize = String(f.servingSize);
  _foodEditorState.servingLabel = f.servingLabel || '';
  _foodEditorState.lockFromMacros = false;
}

export function renderFoodEditorModal(foodId: string | null): void {
  if (foodId && foodId !== 'new') {
    loadFromFood(foodId);
  } else {
    resetFoodEditorState();
  }
  // Fix MEDIUM bug: snapshot iniziale per dirty check su close
  _foodEditorInitial = snapshotState();

  const editing = !!foodId && foodId !== 'new';
  showModal({
    modalId: 'food-editor',
    title: editing ? 'Modifica alimento' : 'Crea alimento custom',
    bodyHtml: renderFormBody(editing),
    actions: [
      { label: 'Annulla', action: 'close', variant: 'outline' },
      { label: editing ? 'Salva modifiche' : 'Crea alimento', action: 'confirm', variant: 'primary' },
    ],
    onConfirm: () => {
      // Fix B5: ritorna false per bloccare chiusura se validazione fallisce
      const result = handleSave(foodId);
      return result;
    },
    // Fix B6: cleanup state quando il modal viene chiuso (✕, ESC, overlay, o conferma successful)
    // Fix MEDIUM bug: dirty check — se ci sono modifiche non salvate, avvisa l'utente (non-blocking,
    // perché onClose viene chiamato dopo che il modal è già stato rimosso dal DOM).
    onClose: () => {
      if (isDirty()) {
        showToast('Modifiche non salvate', 'info', 2000);
      }
      closeFoodEditor();
      _foodEditorInitial = null;
    },
  });

  bindFoodEditorModalEvents();
}

function renderFormBody(editing: boolean): string {
  void editing;
  return `
    <div class="form">
      <label class="field">
        <span>Nome *</span>
        <input id="fe-name" type="text" value="${escapeAttr(_foodEditorState.name)}" placeholder="es. Pane integrale fatto in casa" />
      </label>
      <div class="form-grid-2">
        <label class="field">
          <span>Marca (opzionale)</span>
          <input id="fe-brand" type="text" value="${escapeAttr(_foodEditorState.brand)}" placeholder="es. Fatto in casa" />
        </label>
        <label class="field">
          <span>Barcode (opzionale)</span>
          <input id="fe-barcode" type="text" inputmode="numeric" value="${escapeAttr(_foodEditorState.barcode)}" placeholder="es. 8076809510053" maxlength="14" />
        </label>
      </div>
      <div class="form-box">
        <div class="form-box-head">
          <span class="form-box-title">Valori per 100g / 100ml</span>
          <label class="switch-label">
            <input id="fe-lock" type="checkbox" ${_foodEditorState.lockFromMacros ? 'checked' : ''} />
            <span>Calcola kcal da macro</span>
          </label>
        </div>
        <div class="form-grid-2">
          <label class="field"><span>Calorie (kcal)</span><input id="fe-calories" type="number" inputmode="decimal" value="${escapeAttr(_foodEditorState.calories)}" ${_foodEditorState.lockFromMacros ? 'disabled' : ''} /></label>
          <label class="field"><span>Porzione default (g/ml)</span><input id="fe-serving" type="number" inputmode="decimal" value="${escapeAttr(_foodEditorState.servingSize)}" /></label>
          <label class="field"><span>Proteine (g)</span><input id="fe-protein" type="number" inputmode="decimal" value="${escapeAttr(_foodEditorState.protein)}" /></label>
          <label class="field"><span>Carboidrati (g)</span><input id="fe-carbs" type="number" inputmode="decimal" value="${escapeAttr(_foodEditorState.carbs)}" /></label>
          <label class="field"><span>Grassi (g)</span><input id="fe-fat" type="number" inputmode="decimal" value="${escapeAttr(_foodEditorState.fat)}" /></label>
          <label class="field"><span>Fibre (g)</span><input id="fe-fiber" type="number" inputmode="decimal" value="${escapeAttr(_foodEditorState.fiber)}" /></label>
          <label class="field"><span>Zuccheri (g)</span><input id="fe-sugar" type="number" inputmode="decimal" value="${escapeAttr(_foodEditorState.sugar)}" /></label>
          <label class="field"><span>Sale (g)</span><input id="fe-salt" type="number" inputmode="decimal" value="${escapeAttr(_foodEditorState.salt)}" /></label>
        </div>
      </div>
      <label class="field">
        <span>Etichetta porzione (opzionale)</span>
        <input id="fe-serving-label" type="text" value="${escapeAttr(_foodEditorState.servingLabel)}" placeholder="es. 1 fetta, 1 tazza, 1 porzione" />
      </label>
      ${_foodEditorState.lockFromMacros ? `<p class="hint-text">Le calorie sono calcolate automaticamente: P×4 + C×4 + G×9.</p>` : ''}
    </div>
  `;
}

function bindFoodEditorModalEvents(): void {
  if (_foodEditorBound) return;
  _foodEditorBound = true;
  document.addEventListener('input', (e) => {
    const t = e.target as HTMLElement;
    if (!t.id || !t.id.startsWith('fe-')) return;
    if (!document.querySelector('[data-modal-id="food-editor"]')) return;
    const v = (t as HTMLInputElement).value;
    switch (t.id) {
      case 'fe-name':
        _foodEditorState.name = v;
        break;
      case 'fe-brand':
        _foodEditorState.brand = v;
        break;
      case 'fe-barcode':
        _foodEditorState.barcode = v;
        break;
      case 'fe-calories':
        _foodEditorState.calories = v;
        break;
      case 'fe-protein':
        _foodEditorState.protein = v;
        recalcKcal();
        break;
      case 'fe-carbs':
        _foodEditorState.carbs = v;
        recalcKcal();
        break;
      case 'fe-fat':
        _foodEditorState.fat = v;
        recalcKcal();
        break;
      case 'fe-fiber':
        _foodEditorState.fiber = v;
        break;
      case 'fe-sugar':
        _foodEditorState.sugar = v;
        break;
      case 'fe-salt':
        _foodEditorState.salt = v;
        break;
      case 'fe-serving':
        _foodEditorState.servingSize = v;
        break;
      case 'fe-serving-label':
        _foodEditorState.servingLabel = v;
        break;
    }
  });
  document.addEventListener('change', (e) => {
    const t = e.target as HTMLElement;
    if (t.id === 'fe-lock') {
      _foodEditorState.lockFromMacros = (t as HTMLInputElement).checked;
      // Fix BUG #9 (T3): aggiorna solo gli attributi necessari invece di re-renderare tutto il body
      // (prima: il checkbox appena toggled veniva distrutto/ricreato e perdeva il focus)
      const calInput = document.querySelector<HTMLInputElement>('#fe-calories');
      if (calInput) {
        calInput.disabled = _foodEditorState.lockFromMacros;
      }
      const hint = document.querySelector<HTMLElement>('.hint-text');
      if (_foodEditorState.lockFromMacros && !hint) {
        const form = document.querySelector<HTMLElement>('.form');
        if (form) {
          const hintEl = document.createElement('p');
          hintEl.className = 'hint-text';
          hintEl.textContent = 'Le calorie sono calcolate automaticamente: P×4 + C×4 + G×9.';
          form.appendChild(hintEl);
        }
      } else if (!_foodEditorState.lockFromMacros && hint) {
        hint.remove();
      }
      recalcKcal();
      // Mantieni focus sul checkbox
      const lockCheckbox = document.querySelector<HTMLInputElement>('#fe-lock');
      if (lockCheckbox) lockCheckbox.focus();
    }
  });
}

function recalcKcal(): void {
  if (!_foodEditorState.lockFromMacros) return;
  // Fix BUG #5 (T3): clampa i negativi a 0 prima del calcolo (prima: protein=-10 → calories=9 fuorviante)
  const p = Math.max(0, Number(_foodEditorState.protein) || 0);
  const c = Math.max(0, Number(_foodEditorState.carbs) || 0);
  const f = Math.max(0, Number(_foodEditorState.fat) || 0);
  _foodEditorState.calories = String(
    Math.round(p * KCAL_PER_GRAM.protein + c * KCAL_PER_GRAM.carbs + f * KCAL_PER_GRAM.fat),
  );
  const calInput = document.querySelector<HTMLInputElement>('#fe-calories');
  if (calInput) calInput.value = _foodEditorState.calories;
}

/** Fix B5: ritorna false per bloccare chiusura modal se validazione fallisce. */
function handleSave(foodId: string | null): boolean {
  if (!_foodEditorState.name.trim()) {
    showToast("Inserisci il nome dell'alimento", 'error');
    return false;
  }

  // Helper di validazione: parse strict, rifiuta stringhe non numeriche
  // (es. "abc", "1.2.3", "" → errore). Permette 0 e decimali positivi.
  const parseNum = (raw: string, fieldLabel: string, required: boolean): number | undefined => {
    const trimmed = raw.trim();
    if (!required) {
      if (trimmed === '') return undefined;
    } else if (trimmed === '') {
      showToast(`Inserisci un valore per ${fieldLabel}`, 'error');
      return NaN; // sentinel per "errore validazione"
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n)) {
      showToast(`${fieldLabel}: valore non valido ("${trimmed}")`, 'error');
      return NaN;
    }
    if (n < 0) {
      showToast(`${fieldLabel}: il valore non può essere negativo`, 'error');
      return NaN;
    }
    return n;
  };

  const calories = parseNum(_foodEditorState.calories, 'Calorie', true);
  if (calories === undefined || Number.isNaN(calories)) return false;
  const protein = parseNum(_foodEditorState.protein, 'Proteine', true);
  if (protein === undefined || Number.isNaN(protein)) return false;
  const carbs = parseNum(_foodEditorState.carbs, 'Carboidrati', true);
  if (carbs === undefined || Number.isNaN(carbs)) return false;
  const fat = parseNum(_foodEditorState.fat, 'Grassi', true);
  if (fat === undefined || Number.isNaN(fat)) return false;
  const servingSize = parseNum(_foodEditorState.servingSize, 'Porzione default', true);
  if (servingSize === undefined || Number.isNaN(servingSize)) return false;
  if (servingSize === 0) {
    showToast('Porzione default: il valore deve essere maggiore di 0', 'error');
    return false;
  }

  // Fix MEDIUM bug: se calories=0 ma almeno un macro > 0, stima kcal da macro (algoritmo Atwater).
  // Stesso comportamento di buildFoodFromOff. Prima l'utente poteva salvare un food con
  // calories=0 e macro>0, creando inconsistenza con i food OFF che vengono ricalcolati.
  let finalCalories = calories;
  if (calories === 0) {
    const macroKcal =
      Math.max(0, protein) * KCAL_PER_GRAM.protein +
      Math.max(0, carbs) * KCAL_PER_GRAM.carbs +
      Math.max(0, fat) * KCAL_PER_GRAM.fat;
    if (macroKcal > 0) {
      finalCalories = Math.round(macroKcal);
      showToast(`Calorie calcolate dai macro: ${finalCalories} kcal`, 'info', 3000);
    }
  }

  // Campi opzionali: undefined se vuoti, errore se non parsabili
  const fiber = parseNum(_foodEditorState.fiber, 'Fibre', false);
  if (fiber !== undefined && Number.isNaN(fiber)) return false;
  const sugar = parseNum(_foodEditorState.sugar, 'Zuccheri', false);
  if (sugar !== undefined && Number.isNaN(sugar)) return false;
  const salt = parseNum(_foodEditorState.salt, 'Sale', false);
  if (salt !== undefined && Number.isNaN(salt)) return false;

  // Fix BUG #6 (T3): clamp lunghezza name/brand/servingLabel su save (coerente con normalize.ts)
  const trimmedName = _foodEditorState.name.trim().slice(0, 300);
  const trimmedBrand = _foodEditorState.brand.trim().slice(0, 200) || undefined;
  // Fix MEDIUM bug: supporta campo barcode (validazione: solo cifre, max 14)
  const trimmedBarcode = _foodEditorState.barcode.trim().slice(0, 14) || undefined;
  if (trimmedBarcode && !/^\d{6,14}$/.test(trimmedBarcode)) {
    showToast('Barcode non valido: inserisci 6-14 cifre (EAN/UPC)', 'error');
    return false;
  }
  const trimmedServingLabel = _foodEditorState.servingLabel.trim().slice(0, 100) || undefined;

  const nutrition: NutritionPer100 = {
    calories: finalCalories,
    protein,
    carbs,
    fat,
    fiber,
    sugar,
    salt,
  };
  const payload = {
    name: trimmedName,
    brand: trimmedBrand,
    barcode: trimmedBarcode,
    source: 'custom' as const,
    servingSize,
    servingLabel: trimmedServingLabel,
    nutrition,
  };

  // Fix BUG #4 (T3): validazione logica macro (P+C+F non può superare 100g per valori per-100g)
  const macroSum = protein + carbs + fat;
  if (macroSum > 100) {
    showToast(
      `Attenzione: la somma dei macro (${macroSum.toFixed(1)}g) supera 100g (valori per 100g). Verifica i valori.`,
      'warning',
      5000,
    );
  }
  // Fix BUG #4 (T3): verifica coerenza kcal vs kcal da macro (tolleranza 5% per arrotondamenti/altri nutrienti)
  const macroKcal = protein * KCAL_PER_GRAM.protein + carbs * KCAL_PER_GRAM.carbs + fat * KCAL_PER_GRAM.fat;
  if (calories < macroKcal * 0.95 && macroKcal > 0) {
    showToast(
      `Le calorie inserite (${calories}) sono inferiori a quelle derivanti dai macro (${Math.round(macroKcal)}). Verifica.`,
      'warning',
      5000,
    );
  }

  if (foodId && foodId !== 'new') {
    updateFood(foodId, payload);
    // Fix MEDIUM bug: avvisa l'utente che le entries del diario esistenti non verranno aggiornate
    // (foodSnapshot è una snapshot al momento dell'aggiunta, non un riferimento live).
    const diaryEntriesUsingFood = Object.values(getState().diary).some((entries) =>
      entries.some((e) => e.foodId === foodId),
    );
    showToast(
      diaryEntriesUsingFood
        ? 'Alimento aggiornato. Le voci del diario esistenti manterranno i valori precedenti (snapshot).'
        : 'Alimento aggiornato',
      diaryEntriesUsingFood ? 'info' : 'success',
      5000,
    );
  } else {
    addFood(payload);
    showToast('Alimento custom creato', 'success');
    // Se il search dialog era aperto per aggiungere custom, refresha
    if (getState()._searchOpen) {
      refreshSearchAfterCustomFood();
    }
    // Fix R3 (T4): se il recipe editor era aperto (sub-search ingrediente), refresha anche quello
    if (getState()._editingRecipeId !== null) {
      import('../views/recipe-editor')
        .then(({ refreshRecipeEditor }) => {
          refreshRecipeEditor();
        })
        .catch(() => {
          /* noop */
        });
    }
  }
  // NOTA: non chiamiamo closeFoodEditor() qui — ci pensa onClose callback del modal.
  // Chiamiamo solo emitChange per re-render.
  // Fix MEDIUM bug: resetta _foodEditorInitial così onClose non triggera dirty check
  _foodEditorInitial = snapshotState();
  emitChange();
  return true;
}
