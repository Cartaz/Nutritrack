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

const _foodEditorState: FoodFormState = {
  name: '', brand: '', calories: '', protein: '', carbs: '', fat: '',
  fiber: '', sugar: '', salt: '', servingSize: '100', servingLabel: '',
  lockFromMacros: false,
};

let _foodEditorBound = false;

function resetFoodEditorState(): void {
  Object.assign(_foodEditorState, {
    name: '', brand: '', calories: '', protein: '', carbs: '', fat: '',
    fiber: '', sugar: '', salt: '', servingSize: '100', servingLabel: '',
    lockFromMacros: false,
  });
}

function loadFromFood(foodId: string): void {
  const f = getState().foods.find((x) => x.id === foodId);
  if (!f) { resetFoodEditorState(); return; }
  _foodEditorState.name = f.name;
  _foodEditorState.brand = f.brand || '';
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
    onClose: () => closeFoodEditor(),
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
      <label class="field">
        <span>Marca (opzionale)</span>
        <input id="fe-brand" type="text" value="${escapeAttr(_foodEditorState.brand)}" placeholder="es. Fatto in casa" />
      </label>
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
      case 'fe-name':         _foodEditorState.name = v; break;
      case 'fe-brand':        _foodEditorState.brand = v; break;
      case 'fe-calories':     _foodEditorState.calories = v; break;
      case 'fe-protein':      _foodEditorState.protein = v; recalcKcal(); break;
      case 'fe-carbs':        _foodEditorState.carbs = v; recalcKcal(); break;
      case 'fe-fat':          _foodEditorState.fat = v; recalcKcal(); break;
      case 'fe-fiber':        _foodEditorState.fiber = v; break;
      case 'fe-sugar':        _foodEditorState.sugar = v; break;
      case 'fe-salt':         _foodEditorState.salt = v; break;
      case 'fe-serving':      _foodEditorState.servingSize = v; break;
      case 'fe-serving-label':_foodEditorState.servingLabel = v; break;
    }
  });
  document.addEventListener('change', (e) => {
    const t = e.target as HTMLElement;
    if (t.id === 'fe-lock') {
      _foodEditorState.lockFromMacros = (t as HTMLInputElement).checked;
      // re-render
      const overlay = document.querySelector('[data-modal-id="food-editor"]');
      if (overlay) {
        const body = overlay.querySelector('.modal-body') as HTMLElement;
        body.innerHTML = renderFormBody(!!getState()._editingFoodId);
      }
      recalcKcal();
    }
  });
}

function recalcKcal(): void {
  if (!_foodEditorState.lockFromMacros) return;
  const p = Number(_foodEditorState.protein) || 0;
  const c = Number(_foodEditorState.carbs) || 0;
  const f = Number(_foodEditorState.fat) || 0;
  _foodEditorState.calories = String(Math.round(p * KCAL_PER_GRAM.protein + c * KCAL_PER_GRAM.carbs + f * KCAL_PER_GRAM.fat));
  const calInput = document.querySelector<HTMLInputElement>('#fe-calories');
  if (calInput) calInput.value = _foodEditorState.calories;
}

/** Fix B5: ritorna false per bloccare chiusura modal se validazione fallisce. */
function handleSave(foodId: string | null): boolean {
  if (!_foodEditorState.name.trim()) {
    showToast('Inserisci il nome dell\'alimento', 'error');
    return false;
  }
  const nutrition: NutritionPer100 = {
    calories: Number(_foodEditorState.calories) || 0,
    protein: Number(_foodEditorState.protein) || 0,
    carbs: Number(_foodEditorState.carbs) || 0,
    fat: Number(_foodEditorState.fat) || 0,
    fiber: _foodEditorState.fiber ? Number(_foodEditorState.fiber) : undefined,
    sugar: _foodEditorState.sugar ? Number(_foodEditorState.sugar) : undefined,
    salt: _foodEditorState.salt ? Number(_foodEditorState.salt) : undefined,
  };
  const payload = {
    name: _foodEditorState.name.trim(),
    brand: _foodEditorState.brand.trim() || undefined,
    source: 'custom' as const,
    servingSize: Number(_foodEditorState.servingSize) || 100,
    servingLabel: _foodEditorState.servingLabel.trim() || undefined,
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
