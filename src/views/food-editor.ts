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

const _form: FoodFormState = {
  name: '', brand: '', calories: '', protein: '', carbs: '', fat: '',
  fiber: '', sugar: '', salt: '', servingSize: '100', servingLabel: '',
  lockFromMacros: false,
};

let _bound = false;

function resetForm(): void {
  Object.assign(_form, {
    name: '', brand: '', calories: '', protein: '', carbs: '', fat: '',
    fiber: '', sugar: '', salt: '', servingSize: '100', servingLabel: '',
    lockFromMacros: false,
  });
}

function loadFromFood(foodId: string): void {
  const f = getState().foods.find((x) => x.id === foodId);
  if (!f) { resetForm(); return; }
  _form.name = f.name;
  _form.brand = f.brand || '';
  _form.calories = String(f.nutrition.calories);
  _form.protein = String(f.nutrition.protein);
  _form.carbs = String(f.nutrition.carbs);
  _form.fat = String(f.nutrition.fat);
  _form.fiber = f.nutrition.fiber != null ? String(f.nutrition.fiber) : '';
  _form.sugar = f.nutrition.sugar != null ? String(f.nutrition.sugar) : '';
  _form.salt = f.nutrition.salt != null ? String(f.nutrition.salt) : '';
  _form.servingSize = String(f.servingSize);
  _form.servingLabel = f.servingLabel || '';
  _form.lockFromMacros = false;
}

export function renderFoodEditorModal(foodId: string | null): void {
  if (foodId && foodId !== 'new') {
    loadFromFood(foodId);
  } else {
    resetForm();
  }

  const editing = !!foodId && foodId !== 'new';
  showModal({
    modalId: 'food-editor',
    title: editing ? 'Modifica alimento' : 'Crea alimento custom',
    bodyHtml: formBody(editing),
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
    onClose: () => closeFoodEditor(),
    sticky: true,
  });

  bindEvents();
}

function formBody(editing: boolean): string {
  void editing;
  return `
    <div class="form">
      <label class="field">
        <span>Nome *</span>
        <input id="fe-name" type="text" value="${escapeAttr(_form.name)}" placeholder="es. Pane integrale fatto in casa" />
      </label>
      <label class="field">
        <span>Marca (opzionale)</span>
        <input id="fe-brand" type="text" value="${escapeAttr(_form.brand)}" placeholder="es. Fatto in casa" />
      </label>
      <div class="form-box">
        <div class="form-box-head">
          <span class="form-box-title">Valori per 100g / 100ml</span>
          <label class="switch-label">
            <input id="fe-lock" type="checkbox" ${_form.lockFromMacros ? 'checked' : ''} />
            <span>Calcola kcal da macro</span>
          </label>
        </div>
        <div class="form-grid-2">
          <label class="field"><span>Calorie (kcal)</span><input id="fe-calories" type="number" inputmode="decimal" value="${escapeAttr(_form.calories)}" ${_form.lockFromMacros ? 'disabled' : ''} /></label>
          <label class="field"><span>Porzione default (g/ml)</span><input id="fe-serving" type="number" inputmode="decimal" value="${escapeAttr(_form.servingSize)}" /></label>
          <label class="field"><span>Proteine (g)</span><input id="fe-protein" type="number" inputmode="decimal" value="${escapeAttr(_form.protein)}" /></label>
          <label class="field"><span>Carboidrati (g)</span><input id="fe-carbs" type="number" inputmode="decimal" value="${escapeAttr(_form.carbs)}" /></label>
          <label class="field"><span>Grassi (g)</span><input id="fe-fat" type="number" inputmode="decimal" value="${escapeAttr(_form.fat)}" /></label>
          <label class="field"><span>Fibre (g)</span><input id="fe-fiber" type="number" inputmode="decimal" value="${escapeAttr(_form.fiber)}" /></label>
          <label class="field"><span>Zuccheri (g)</span><input id="fe-sugar" type="number" inputmode="decimal" value="${escapeAttr(_form.sugar)}" /></label>
          <label class="field"><span>Sale (g)</span><input id="fe-salt" type="number" inputmode="decimal" value="${escapeAttr(_form.salt)}" /></label>
        </div>
      </div>
      <label class="field">
        <span>Etichetta porzione (opzionale)</span>
        <input id="fe-serving-label" type="text" value="${escapeAttr(_form.servingLabel)}" placeholder="es. 1 fetta, 1 tazza, 1 porzione" />
      </label>
      ${_form.lockFromMacros ? `<p class="hint-text">Le calorie sono calcolate automaticamente: P×4 + C×4 + G×9.</p>` : ''}
    </div>
  `;
}

function bindEvents(): void {
  if (_bound) return;
  _bound = true;
  document.addEventListener('input', (e) => {
    const t = e.target as HTMLElement;
    if (!t.id || !t.id.startsWith('fe-')) return;
    if (!document.querySelector('[data-modal-id="food-editor"]')) return;
    const v = (t as HTMLInputElement).value;
    switch (t.id) {
      case 'fe-name':         _form.name = v; break;
      case 'fe-brand':        _form.brand = v; break;
      case 'fe-calories':     _form.calories = v; break;
      case 'fe-protein':      _form.protein = v; recalcKcal(); break;
      case 'fe-carbs':        _form.carbs = v; recalcKcal(); break;
      case 'fe-fat':          _form.fat = v; recalcKcal(); break;
      case 'fe-fiber':        _form.fiber = v; break;
      case 'fe-sugar':        _form.sugar = v; break;
      case 'fe-salt':         _form.salt = v; break;
      case 'fe-serving':      _form.servingSize = v; break;
      case 'fe-serving-label':_form.servingLabel = v; break;
    }
  });
  document.addEventListener('change', (e) => {
    const t = e.target as HTMLElement;
    if (t.id === 'fe-lock') {
      _form.lockFromMacros = (t as HTMLInputElement).checked;
      // re-render
      const overlay = document.querySelector('[data-modal-id="food-editor"]');
      if (overlay) {
        const body = overlay.querySelector('.modal-body') as HTMLElement;
        body.innerHTML = formBody(!!getState()._editingFoodId);
      }
      recalcKcal();
    }
  });
}

function recalcKcal(): void {
  if (!_form.lockFromMacros) return;
  const p = Number(_form.protein) || 0;
  const c = Number(_form.carbs) || 0;
  const f = Number(_form.fat) || 0;
  _form.calories = String(Math.round(p * KCAL_PER_GRAM.protein + c * KCAL_PER_GRAM.carbs + f * KCAL_PER_GRAM.fat));
  const calInput = document.querySelector<HTMLInputElement>('#fe-calories');
  if (calInput) calInput.value = _form.calories;
}

/** Fix B5: ritorna false per bloccare chiusura modal se validazione fallisce. */
function handleSave(foodId: string | null): boolean {
  if (!_form.name.trim()) {
    showToast('Inserisci il nome dell\'alimento', 'error');
    return false;
  }
  const nutrition: NutritionPer100 = {
    calories: Number(_form.calories) || 0,
    protein: Number(_form.protein) || 0,
    carbs: Number(_form.carbs) || 0,
    fat: Number(_form.fat) || 0,
    fiber: _form.fiber ? Number(_form.fiber) : undefined,
    sugar: _form.sugar ? Number(_form.sugar) : undefined,
    salt: _form.salt ? Number(_form.salt) : undefined,
  };
  const payload = {
    name: _form.name.trim(),
    brand: _form.brand.trim() || undefined,
    source: 'custom' as const,
    servingSize: Number(_form.servingSize) || 100,
    servingLabel: _form.servingLabel.trim() || undefined,
    nutrition,
  };
  if (foodId && foodId !== 'new') {
    updateFood(foodId, payload);
    showToast('Alimento aggiornato', 'success');
  } else {
    addFood(payload);
    showToast('Alimento custom creato', 'success');
    // Se il search dialog era aperto per aggiungere custom, refresha
    if (getState()._searchOpen) {
      refreshSearchAfterCustomFood();
    }
  }
  // NOTA: non chiamiamo closeFoodEditor() qui — ci pensa onClose callback del modal.
  // Chiamiamo solo emitChange per re-render.
  emitChange();
  return true;
}
