// Modal: editor di una entry del diario (modifica grammi).
// Permette di modificare la quantità di un cibo già inserito cliccando sulla riga.
// Supporta grammi liberi + porzioni personalizzate salvate sul food.

import { getState, closeEntryEditor, emitChange } from '../lib/store';
import { updateDiaryEntry } from '../lib/store';
import { addCustomPortionToFood, removeCustomPortionFromFood } from '../lib/foods';
import { showToast } from '../components/toast';
import { showModal } from '../components/modal';
import { escapeHtml, escapeAttr, safeId } from '../lib/utils';
import { imgTag } from '../components/img';
import type { DiaryEntry, CustomPortion } from '../types';

// ============ Internal form state ============

interface EntryEditorState {
  grams: string;
  creatingPortion: boolean;
  newPortionLabel: string;
  newPortionGrams: string;
}

const _form: EntryEditorState = {
  grams: '',
  creatingPortion: false,
  newPortionLabel: '',
  newPortionGrams: '',
};

let _bound = false;

function loadFromEntry(entry: DiaryEntry): void {
  const grams = entry.gramsOverride ?? entry.foodSnapshot.servingSize * entry.quantity;
  _form.grams = String(grams);
  _form.creatingPortion = false;
  _form.newPortionLabel = '';
  _form.newPortionGrams = '';
}

export function renderEntryEditorModal(entryId: string): void {
  // Trova la entry nel diario (potrebbe essere in qualsiasi data)
  const state = getState();
  let entry: DiaryEntry | undefined;
  for (const list of Object.values(state.diary)) {
    const found = list.find((e) => e.id === entryId);
    if (found) { entry = found; break; }
  }
  if (!entry) {
    closeEntryEditor();
    return;
  }
  loadFromEntry(entry);

  showModal({
    modalId: 'entry-editor',
    title: 'Modifica quantità',
    bodyHtml: formBody(entry),
    actions: [
      { label: 'Annulla', action: 'close', variant: 'outline' },
      { label: 'Salva', action: 'confirm', variant: 'primary' },
    ],
    onConfirm: () => {
      const result = handleSave(entry!);
      return result;
    },
    onClose: () => closeEntryEditor(),
    sticky: true,
  });

  bindEvents();
}

function formBody(entry: DiaryEntry): string {
  const f = entry.foodSnapshot;
  const grams = Number(_form.grams) || 0;
  const nutrition = {
    calories: Math.round((f.nutrition.calories * grams) / 100),
    protein: Math.round((f.nutrition.protein * grams) / 100),
    carbs: Math.round((f.nutrition.carbs * grams) / 100),
    fat: Math.round((f.nutrition.fat * grams) / 100),
  };
  const allPortions: CustomPortion[] = f.customPortions || [];
  const foodId = f.id;

  const portionsHtml = allPortions.length > 0
    ? `
      <div class="portion-chips">
        ${allPortions.map((p) => `
          <button type="button" class="portion-chip${Number(_form.grams) === p.grams ? ' active' : ''}" data-ee-action="usePortion" data-grams="${p.grams}">
            <span class="portion-chip-label">${escapeHtml(p.label)}</span>
            <span class="portion-chip-grams">${p.grams}g</span>
            <span class="portion-chip-del" data-ee-action="deleteCustomPortion" data-food-id="${escapeAttr(foodId)}" data-portion-id="${escapeAttr(p.id)}" role="button" aria-label="Elimina porzione">✕</span>
          </button>
        `).join('')}
      </div>
    `
    : '';

  const createPortionHtml = _form.creatingPortion
    ? `
      <div class="portion-create-form">
        <div class="portion-create-grid">
          <input id="ee-new-portion-label" type="text" placeholder="Nome (es. 1 fetta, 1 tazza)" value="${escapeAttr(_form.newPortionLabel)}" />
          <input id="ee-new-portion-grams" type="number" min="0" step="0.1" placeholder="Grammi" value="${escapeAttr(_form.newPortionGrams)}" />
        </div>
        <div class="portion-create-actions">
          <button type="button" class="btn btn-outline btn-sm" data-ee-action="cancelCreatePortion">Annulla</button>
          <button type="button" class="btn btn-primary btn-sm" data-ee-action="confirmCreatePortion">Salva porzione</button>
        </div>
      </div>
    `
    : `
      <button type="button" class="btn btn-outline btn-sm btn-block portion-create-btn" data-ee-action="startCreatePortion">
        <span aria-hidden="true">＋</span> Crea porzione personalizzata
      </button>
    `;

  return `
    <div class="ee-selected">
      <div class="ee-food-head">
        ${imgTag(f.image, f.name, 'thumb', f.source === 'custom' ? '✏️' : '🥫')}
        <div class="ee-food-info">
          <p class="ee-food-name">${escapeHtml(f.name)}</p>
          ${f.brand ? `<p class="ee-food-brand">${escapeHtml(f.brand)}</p>` : ''}
          <div class="badge-row">
            <span class="badge badge-secondary">${Math.round(f.nutrition.calories)} kcal / 100g</span>
            <span class="badge">P ${Math.round(f.nutrition.protein)}g</span>
            <span class="badge">C ${Math.round(f.nutrition.carbs)}g</span>
            <span class="badge">G ${Math.round(f.nutrition.fat)}g</span>
          </div>
        </div>
      </div>
      <div class="qty-row-single">
        <label for="ee-grams-input" class="field-label">Grammi / ml</label>
        <input id="ee-grams-input" type="number" min="0" step="0.1" placeholder="es. 150" value="${escapeAttr(_form.grams)}" />
      </div>
      <div class="portion-section">
        <p class="portion-section-title">Porzioni personalizzate</p>
        ${portionsHtml}
        ${createPortionHtml}
      </div>
      <div class="stat-row">
        ${statBox('kcal', String(nutrition.calories))}
        ${statBox('Proteine', `${nutrition.protein}g`)}
        ${statBox('Carbo', `${nutrition.carbs}g`)}
        ${statBox('Grassi', `${nutrition.fat}g`)}
      </div>
    </div>
  `;
}

function statBox(label: string, value: string): string {
  return `<div class="stat-box"><p class="stat-label">${escapeHtml(label)}</p><p class="stat-value">${escapeHtml(value)}</p></div>`;
}

/** Ritorna la entry attualmente in modifica, oppure null. */
function currentEntry(): DiaryEntry | null {
  const id = getState()._editingEntryId;
  if (!id) return null;
  for (const list of Object.values(getState().diary)) {
    const found = list.find((e) => e.id === id);
    if (found) return found;
  }
  return null;
}

function reRenderBody(): void {
  const overlay = document.querySelector('[data-modal-id="entry-editor"]');
  if (!overlay) return;
  const body = overlay.querySelector('.modal-body') as HTMLElement;
  const entry = currentEntry();
  if (!entry) return;
  body.innerHTML = formBody(entry);
  // Preserva il focus sull'input grams se era attivo
  const gramsInput = document.querySelector<HTMLInputElement>('#ee-grams-input');
  if (gramsInput) gramsInput.focus();
}

function bindEvents(): void {
  if (_bound) return;
  _bound = true;

  document.addEventListener('input', (e) => {
    const t = e.target as HTMLElement;
    if (!document.querySelector('[data-modal-id="entry-editor"]')) return;
    if (t.id === 'ee-grams-input') {
      _form.grams = (t as HTMLInputElement).value;
      // Aggiorna solo la stat row (cheap) — re-render del body per semplicità
      reRenderBodyKeepInput(t as HTMLInputElement);
      return;
    }
    if (t.id === 'ee-new-portion-label') {
      _form.newPortionLabel = (t as HTMLInputElement).value;
      return;
    }
    if (t.id === 'ee-new-portion-grams') {
      _form.newPortionGrams = (t as HTMLInputElement).value;
      return;
    }
  });

  document.addEventListener('click', (e) => {
    if (!document.querySelector('[data-modal-id="entry-editor"]')) return;
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-ee-action]');
    if (!target) return;
    const action = target.dataset.eeAction;
    switch (action) {
      case 'usePortion': {
        const grams = Number(target.dataset.grams || '0');
        if (grams > 0) {
          _form.grams = String(grams);
          _form.creatingPortion = false;
          reRenderBody();
        }
        return;
      }
      case 'startCreatePortion': {
        _form.creatingPortion = true;
        _form.newPortionLabel = '';
        _form.newPortionGrams = _form.grams || '';
        reRenderBody();
        setTimeout(() => {
          const inp = document.querySelector<HTMLInputElement>('#ee-new-portion-label');
          if (inp) inp.focus();
        }, 0);
        return;
      }
      case 'cancelCreatePortion': {
        _form.creatingPortion = false;
        _form.newPortionLabel = '';
        _form.newPortionGrams = '';
        reRenderBody();
        return;
      }
      case 'confirmCreatePortion': {
        createCustomPortion();
        return;
      }
      case 'deleteCustomPortion': {
        const foodId = target.dataset.foodId || '';
        const portionId = target.dataset.portionId || '';
        deleteCustomPortion(foodId, portionId);
        return;
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    if (!document.querySelector('[data-modal-id="entry-editor"]')) return;
    if (e.key !== 'Enter') return;
    const t = e.target as HTMLElement;
    if (t.id === 'ee-new-portion-label' || t.id === 'ee-new-portion-grams') {
      e.preventDefault();
      createCustomPortion();
      return;
    }
  });
}

/** Re-render del body preservando il focus e cursore sull'input grams. */
function reRenderBodyKeepInput(activeInput: HTMLInputElement): void {
  const overlay = document.querySelector('[data-modal-id="entry-editor"]');
  if (!overlay) return;
  const body = overlay.querySelector('.modal-body') as HTMLElement;
  const entry = currentEntry();
  if (!entry) return;
  // Aggiorna solo la stat row senza toccare l'input
  const grams = Number(_form.grams) || 0;
  const f = entry.foodSnapshot;
  const nutrition = {
    calories: Math.round((f.nutrition.calories * grams) / 100),
    protein: Math.round((f.nutrition.protein * grams) / 100),
    carbs: Math.round((f.nutrition.carbs * grams) / 100),
    fat: Math.round((f.nutrition.fat * grams) / 100),
  };
  const statRow = body.querySelector('.stat-row');
  if (statRow) {
    statRow.innerHTML = `
      ${statBox('kcal', String(nutrition.calories))}
      ${statBox('Proteine', `${nutrition.protein}g`)}
      ${statBox('Carbo', `${nutrition.carbs}g`)}
      ${statBox('Grassi', `${nutrition.fat}g`)}
    `;
  }
  // Aggiorna stato active dei portion chips
  const chips = body.querySelectorAll<HTMLElement>('.portion-chip');
  chips.forEach((chip) => {
    const chipGrams = Number(chip.dataset.grams || '0');
    if (chipGrams === grams) chip.classList.add('active');
    else chip.classList.remove('active');
  });
  // Mantieni focus sull'input (non toccarlo)
  void activeInput;
}

function createCustomPortion(): void {
  const entry = currentEntry();
  if (!entry) return;
  const f = entry.foodSnapshot;
  const label = _form.newPortionLabel.trim();
  const grams = Number(_form.newPortionGrams);
  if (!label) {
    showToast('Inserisci un nome per la porzione', 'info');
    return;
  }
  if (!grams || grams <= 0) {
    showToast('Inserisci i grammi della porzione', 'info');
    return;
  }
  const portion: CustomPortion = {
    id: safeId('port_'),
    label,
    grams: Math.max(0.1, Math.round(grams * 10) / 10),
  };
  const newCustomPortions = [...(f.customPortions || []), portion];
  // Aggiorna sempre lo snapshot della entry (così la UI si aggiorna)
  updateDiaryEntry(entry.id, {
    foodSnapshot: { ...f, customPortions: newCustomPortions },
  });
  // Se il food è anche salvato nei foods, persisti la porzione anche lì
  const isSaved = getState().foods.some((x) => x.id === f.id);
  if (isSaved) {
    addCustomPortionToFood(f.id, label, grams);
  }
  _form.creatingPortion = false;
  _form.newPortionLabel = '';
  _form.newPortionGrams = '';
  reRenderBody();
}

function deleteCustomPortion(foodId: string, portionId: string): void {
  const entry = currentEntry();
  if (!entry) return;
  const f = entry.foodSnapshot;
  const newCustomPortions = (f.customPortions || []).filter((p) => p.id !== portionId);
  // Aggiorna sempre lo snapshot della entry
  updateDiaryEntry(entry.id, {
    foodSnapshot: { ...f, customPortions: newCustomPortions },
  });
  // Se il food è salvato, rimuovi la porzione anche dai foods
  const isSaved = getState().foods.some((x) => x.id === foodId);
  if (isSaved) {
    removeCustomPortionFromFood(foodId, portionId);
  }
  reRenderBody();
}

function handleSave(entry: DiaryEntry): boolean {
  const grams = Number(_form.grams);
  if (!grams || grams <= 0) {
    showToast('Inserisci i grammi', 'info');
    return false;
  }
  updateDiaryEntry(entry.id, {
    quantity: 1,
    gramsOverride: grams,
  });
  showToast('Quantità aggiornata', 'success');
  emitChange();
  return true;
}
