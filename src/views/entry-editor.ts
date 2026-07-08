// Modal: editor di una entry del diario (modifica grammi).
// Permette di modificare la quantità di un cibo già inserito cliccando sulla riga.
// Supporta grammi liberi + porzioni personalizzate salvate sul food.

import { getState, closeEntryEditor, updateDiaryEntry } from '../lib/store';
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
    // Fix 2.5 (T2): entry non esiste più (eliminata in altro tab o resetAll)
    showToast('La voce del diario non esiste più', 'info');
    closeEntryEditor();
    return;
  }
  const entry = findEntryById(entryId)!;

  showModal({
    modalId: 'entry-editor',
    title: 'Modifica quantità',
    bodyHtml: renderFormBody(entry),
    actions: [
      { label: 'Annulla', action: 'close', variant: 'outline' },
      { label: 'Salva', action: 'confirm', variant: 'primary' },
    ],
    onConfirm: () => {
      return handleSave(entryId);
    },
    onClose: () => closeEntryEditor(),
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

  const portionsHtml = allPortions.length > 0
    ? `
      <div class="portion-chips">
        ${allPortions.map((p) => `
          <button type="button" class="portion-chip${Number(_entryEditorState.grams) === p.grams ? ' active' : ''}" data-ee-action="usePortion" data-grams="${p.grams}">
            <span class="portion-chip-label">${escapeHtml(p.label)}</span>
            <span class="portion-chip-grams">${p.grams}g</span>
            <span class="portion-chip-del" data-ee-action="deleteCustomPortion" data-food-id="${escapeAttr(foodId)}" data-portion-id="${escapeAttr(p.id)}" role="button" aria-label="Elimina porzione">✕</span>
          </button>
        `).join('')}
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

/** Ritorna la entry attualmente in modifica, oppure null. */
function currentEntry(): DiaryEntry | null {
  const id = getState()._editingEntryId;
  if (!id) return null;
  return findEntryById(id);
}

function rerenderModalBody(): void {
  const overlay = document.querySelector('[data-modal-id="entry-editor"]');
  if (!overlay) return;
  const body = overlay.querySelector('.modal-body') as HTMLElement;
  const entry = currentEntry();
  if (!entry) return;
  body.innerHTML = renderFormBody(entry);
  // Preserva il focus sull'input grams se era attivo
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
      // Aggiorna solo la stat row (cheap) — re-render del body per semplicità
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
        // Fix BUG #15-equivalent (T5): requestAnimationFrame con guard per non rubare focus
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
    if (e.key !== 'Enter') return;
    const t = e.target as HTMLElement;
    if (t.id === 'ee-new-portion-label' || t.id === 'ee-new-portion-grams') {
      e.preventDefault();
      createCustomPortion();
      return;
    }
    // Fix 2.6 (T2): keyboard activation per delete-portion (span role=button)
    if ((e.key === 'Enter' || e.key === ' ') && t.closest('[data-ee-action="deleteCustomPortion"]')) {
      e.preventDefault();
      (t.closest('[data-ee-action="deleteCustomPortion"]') as HTMLElement).click();
      return;
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
  // Aggiorna solo la stat row senza toccare l'input
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
  // Se il food è salvato: persisti prima via store (genera l'id reale),
  // poi aggiorna lo snapshot con la porzione ritornata (stesso id).
  // Se non è salvato: genera id locale per lo snapshot.
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
  // Aggiorna lo snapshot della entry (così la UI si aggiorna e l'id è coerente)
  updateDiaryEntry(entry.id, {
    foodSnapshot: { ...f, customPortions: newCustomPortions.length > 0 ? newCustomPortions : undefined },
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
  // Aggiorna lo snapshot della entry (undefined se vuoto, per consistenza col normalizer)
  updateDiaryEntry(entry.id, {
    foodSnapshot: { ...f, customPortions: newCustomPortions.length > 0 ? newCustomPortions : undefined },
  });
  // Se il food è salvato, rimuovi la porzione anche dai foods
  const isSaved = getState().foods.some((x) => x.id === foodId);
  if (isSaved) {
    removeCustomPortionFromFood(foodId, portionId);
  }
  rerenderModalBody();
}

function handleSave(entryId: string): boolean {
  const entry = findEntryById(entryId);
  // Fix 2.5 (T2): se la entry non esiste più (eliminata in altro tab), chiudi il modal con feedback
  if (!entry) {
    showToast('La voce del diario non esiste più', 'info');
    closeEntryEditor();
    return true; // permetti chiusura
  }
  const grams = Number(_entryEditorState.grams);
  if (!Number.isFinite(grams) || grams <= 0) {
    showToast('Inserisci i grammi', 'info');
    return false;
  }
  // Fix 2.14 (T2): upper bound su grammi (max 10kg per singola entry)
  const MAX_GRAMS = 10_000;
  if (grams > MAX_GRAMS) {
    showToast(`Grammi eccessivi (max ${MAX_GRAMS}g = 10kg)`, 'error');
    return false;
  }
  updateDiaryEntry(entry.id, {
    quantity: 1,
    gramsOverride: grams,
  });
  showToast('Quantità aggiornata', 'success');
  return true;
}
