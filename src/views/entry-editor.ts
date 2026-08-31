// Modal: editor di una entry del diario (modifica grammi).
// Permette di modificare la quantità di un cibo già inserito cliccando sulla riga.
// Supporta grammi liberi + porzioni personalizzate salvate sul food.

import {
  getState,
  getActiveDialog,
  closeEntryEditor,
  setDiaryEntryAmount,
  setDiaryEntryFoodSnapshot,
} from '../lib/store';
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

const _entryEditorState: EntryEditorState = {
  grams: '',
  creatingPortion: false,
  newPortionLabel: '',
  newPortionGrams: '',
};

let _entryEditorBound = false;
let _entryAmountBaseline: string | null = null;

function entryAmountSignature(entry: DiaryEntry): string {
  return JSON.stringify({
    quantity: entry.quantity,
    gramsOverride: entry.gramsOverride ?? null,
  });
}

function loadFromEntry(entryId: string): boolean {
  const entry = findEntryById(entryId);
  if (!entry) return false;
  const grams = entry.gramsOverride ?? entry.foodSnapshot.servingSize * entry.quantity;
  _entryEditorState.grams = String(grams);
  _entryEditorState.creatingPortion = false;
  _entryEditorState.newPortionLabel = '';
  _entryEditorState.newPortionGrams = '';
  return true;
}

/** Trova una entry nel diario per id (scansiona tutte le date). */
function findEntryById(entryId: string): DiaryEntry | null {
  for (const list of Object.values(getState().diary)) {
    const found = list.find((e) => e.id === entryId);
    if (found) return found;
  }
  return null;
}

export function renderEntryEditorModal(entryId: string): void {
  if (!loadFromEntry(entryId)) {
    _entryAmountBaseline = null;
    showToast('La voce del diario non esiste più', 'info');
    closeEntryEditor();
    return;
  }
  const entry = findEntryById(entryId)!;
  _entryAmountBaseline = entryAmountSignature(entry);

  showModal({
    modalId: 'entry-editor',
    title: 'Modifica quantità',
    bodyHtml: renderFormBody(entry),
    actions: [
      { label: 'Annulla', action: 'close', variant: 'outline' },
      { label: 'Salva', action: 'confirm', variant: 'primary' },
    ],
    onConfirm: () => handleSave(entryId),
    onClose: () => {
      _entryAmountBaseline = null;
      closeEntryEditor();
    },
  });

  bindEntryEditorModalEvents();
}

function renderFormBody(entry: DiaryEntry): string {
  const f = entry.foodSnapshot;
  const grams = Number(_entryEditorState.grams) || 0;
  const nutrition = {
    calories: Math.round((f.nutrition.calories * grams) / 100),
    protein: Math.round((f.nutrition.protein * grams) / 100),
    carbs: Math.round((f.nutrition.carbs * grams) / 100),
    fat: Math.round((f.nutrition.fat * grams) / 100),
  };
  const allPortions: CustomPortion[] = f.customPortions || [];
  const foodId = f.id;

  const portionsHtml =
    allPortions.length > 0
      ? `
      <div class="portion-chips">
        ${allPortions
          .map(
            (p) => `
          <button type="button" class="portion-chip${Number(_entryEditorState.grams) === p.grams ? ' active' : ''}" data-ee-action="usePortion" data-grams="${p.grams}">
            <span class="portion-chip-label">${escapeHtml(p.label)}</span>
            <span class="portion-chip-grams">${p.grams}g</span>
            <span class="portion-chip-del" data-ee-action="deleteCustomPortion" data-food-id="${escapeAttr(foodId)}" data-portion-id="${escapeAttr(p.id)}" role="button" aria-label="Elimina porzione">✕</span>
          </button>
        `,
          )
          .join('')}
      </div>
    `
      : '';

  const createPortionHtml = _entryEditorState.creatingPortion
    ? `
      <div class="portion-create-form">
        <div class="portion-create-grid">
          <input id="ee-new-portion-label" type="text" placeholder="Nome (es. 1 fetta, 1 tazza)" value="${escapeAttr(_entryEditorState.newPortionLabel)}" />
          <input id="ee-new-portion-grams" type="number" min="0" step="0.1" placeholder="Grammi" value="${escapeAttr(_entryEditorState.newPortionGrams)}" />
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
        <input id="ee-grams-input" type="number" min="0" max="10000" step="0.1" placeholder="es. 150" value="${escapeAttr(_entryEditorState.grams)}" />
      </div>
      <div class="portion-section">
        <p class="portion-section-title">Porzioni personalizzate</p>
        ${portionsHtml}
        ${createPortionHtml}
      </div>
      <div class="stat-row">
        ${renderStatBox('kcal', String(nutrition.calories))}
        ${renderStatBox('Proteine', `${nutrition.protein}g`)}
        ${renderStatBox('Carbo', `${nutrition.carbs}g`)}
        ${renderStatBox('Grassi', `${nutrition.fat}g`)}
      </div>
    </div>
  `;
}

function renderStatBox(label: string, value: string): string {
  return `<div class="stat-box"><p class="stat-label">${escapeHtml(label)}</p><p class="stat-value">${escapeHtml(value)}</p></div>`;
}

function currentEntry(): DiaryEntry | null {
  const dialog = getActiveDialog();
  if (dialog?.type !== 'entry-editor') return null;
  return findEntryById(dialog.entryId);
}

function rerenderModalBody(): void {
  const overlay = document.querySelector('[data-modal-id="entry-editor"]');
  if (!overlay) return;
  const body = overlay.querySelector('.modal-body') as HTMLElement;
  const entry = currentEntry();
  if (!entry) return;
  body.innerHTML = renderFormBody(entry);
  const gramsInput = document.querySelector<HTMLInputElement>('#ee-grams-input');
  if (gramsInput) gramsInput.focus();
}

function bindEntryEditorModalEvents(): void {
  if (_entryEditorBound) return;
  _entryEditorBound = true;

  document.addEventListener('input', (e) => {
    const t = e.target as HTMLElement;
    if (!document.querySelector('[data-modal-id="entry-editor"]')) return;
    if (t.id === 'ee-grams-input') {
      _entryEditorState.grams = (t as HTMLInputElement).value;
      rerenderModalBodyKeepInput(t as HTMLInputElement);
      return;
    }
    if (t.id === 'ee-new-portion-label') {
      _entryEditorState.newPortionLabel = (t as HTMLInputElement).value;
      return;
    }
    if (t.id === 'ee-new-portion-grams') {
      _entryEditorState.newPortionGrams = (t as HTMLInputElement).value;
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
          _entryEditorState.grams = String(grams);
          _entryEditorState.creatingPortion = false;
          rerenderModalBody();
        }
        return;
      }
      case 'startCreatePortion': {
        _entryEditorState.creatingPortion = true;
        _entryEditorState.newPortionLabel = '';
        _entryEditorState.newPortionGrams = _entryEditorState.grams || '';
        rerenderModalBody();
        requestAnimationFrame(() => {
          if (!document.querySelector('[data-modal-id="entry-editor"]')) return;
          const inp = document.querySelector<HTMLInputElement>('#ee-new-portion-label');
          if (inp && document.activeElement === document.body) inp.focus();
        });
        return;
      }
      case 'cancelCreatePortion': {
        _entryEditorState.creatingPortion = false;
        _entryEditorState.newPortionLabel = '';
        _entryEditorState.newPortionGrams = '';
        rerenderModalBody();
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
    const t = e.target as HTMLElement;
    if (e.key === 'Enter' && (t.id === 'ee-new-portion-label' || t.id === 'ee-new-portion-grams')) {
      e.preventDefault();
      createCustomPortion();
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && t.closest('[data-ee-action="deleteCustomPortion"]')) {
      e.preventDefault();
      (t.closest('[data-ee-action="deleteCustomPortion"]') as HTMLElement).click();
    }
  });
}

/** Re-render del body preservando il focus e cursore sull'input grams. */
function rerenderModalBodyKeepInput(activeInput: HTMLInputElement): void {
  const overlay = document.querySelector('[data-modal-id="entry-editor"]');
  if (!overlay) return;
  const body = overlay.querySelector('.modal-body') as HTMLElement;
  const entry = currentEntry();
  if (!entry) return;
  const grams = Number(_entryEditorState.grams) || 0;
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
      ${renderStatBox('kcal', String(nutrition.calories))}
      ${renderStatBox('Proteine', `${nutrition.protein}g`)}
      ${renderStatBox('Carbo', `${nutrition.carbs}g`)}
      ${renderStatBox('Grassi', `${nutrition.fat}g`)}
    `;
  }
  const chips = body.querySelectorAll<HTMLElement>('.portion-chip');
  chips.forEach((chip) => {
    const chipGrams = Number(chip.dataset.grams || '0');
    if (chipGrams === grams) chip.classList.add('active');
    else chip.classList.remove('active');
  });
  void activeInput;
}

function createCustomPortion(): void {
  const entry = currentEntry();
  if (!entry) return;
  const f = entry.foodSnapshot;
  const label = _entryEditorState.newPortionLabel.trim();
  const grams = Number(_entryEditorState.newPortionGrams);
  if (!label) {
    showToast('Inserisci un nome per la porzione', 'info');
    return;
  }
  if (!Number.isFinite(grams) || grams <= 0) {
    showToast('Inserisci i grammi della porzione', 'info');
    return;
  }
  const isSaved = getState().foods.some((x) => x.id === f.id);
  let portion: CustomPortion;
  if (isSaved) {
    const created = addCustomPortionToFood(f.id, label, grams);
    if (!created) return;
    portion = created;
  } else {
    portion = {
      id: safeId('port_'),
      label,
      grams: Math.max(0.1, Math.round(grams * 10) / 10),
    };
  }
  const newCustomPortions = [...(f.customPortions || []), portion];
  setDiaryEntryFoodSnapshot(entry.id, {
    ...f,
    customPortions: newCustomPortions.length > 0 ? newCustomPortions : undefined,
  });
  _entryEditorState.creatingPortion = false;
  _entryEditorState.newPortionLabel = '';
  _entryEditorState.newPortionGrams = '';
  rerenderModalBody();
}

function deleteCustomPortion(foodId: string, portionId: string): void {
  const entry = currentEntry();
  if (!entry) return;
  const f = entry.foodSnapshot;
  const newCustomPortions = (f.customPortions || []).filter((p) => p.id !== portionId);
  setDiaryEntryFoodSnapshot(entry.id, {
    ...f,
    customPortions: newCustomPortions.length > 0 ? newCustomPortions : undefined,
  });
  const isSaved = getState().foods.some((x) => x.id === foodId);
  if (isSaved) {
    removeCustomPortionFromFood(foodId, portionId);
  }
  rerenderModalBody();
}

function handleSave(entryId: string): boolean {
  const entry = findEntryById(entryId);
  if (!entry) {
    showToast('La voce del diario non esiste più', 'info');
    closeEntryEditor();
    return true;
  }
  const grams = Number(_entryEditorState.grams);
  if (!Number.isFinite(grams) || grams <= 0) {
    showToast('Inserisci i grammi', 'info');
    return false;
  }
  const MAX_GRAMS = 10_000;
  if (grams > MAX_GRAMS) {
    showToast(`Grammi eccessivi (max ${MAX_GRAMS}g = 10kg)`, 'error');
    return false;
  }
  if (_entryAmountBaseline === null || entryAmountSignature(entry) !== _entryAmountBaseline) {
    showToast(
      "La quantità è stata modificata in un altro tab. Le modifiche locali non sono state applicate: riapri l'editor sui dati aggiornati.",
      'warning',
      6500,
    );
    return false;
  }
  setDiaryEntryAmount(entry.id, 1, grams);
  showToast('Quantità aggiornata', 'success');
  return true;
}
