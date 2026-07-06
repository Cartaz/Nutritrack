// Modal system: dialog generico con header, body HTML, footer actions.
// initModal() binda handler globali una sola volta (click su [data-modal-action]).
//
// Fix B5: onConfirm può ritornare false per bloccare la chiusura (validation bypass).
// Fix B6: onClose callback per cleanup state quando il modal viene chiuso via ✕/ESC/overlay.
// Fix B20: _confirmCallbacks pulito in closeModal per evitare memory leak.

import { escapeHtml } from '../lib/utils';

export interface ModalAction {
  label: string;
  variant?: 'primary' | 'outline' | 'danger';
  action: 'close' | 'confirm';
  /** id opzionale per identificare l'azione custom via data-modal-action */
  id?: string;
}

interface ModalCallbacks {
  onConfirm?: () => boolean | void;  // ritorna false per bloccare chiusura
  onClose?: () => void;              // chiamato quando il modal viene chiuso (qualsiasi path)
  sticky?: boolean;
}

let _modalInit = false;
const _callbacks = new Map<string, ModalCallbacks>();
// Track overlay già in chiusura per evitare double-close (e double onClose)
const _closing = new WeakSet<HTMLElement>();

function initModal(): void {
  if (_modalInit) return;
  _modalInit = true;
  document.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('[data-modal-action]') as HTMLElement | null;
    if (!target) return;
    const action = target.dataset.modalAction;
    const overlay = target.closest('.modal-overlay') as HTMLElement | null;
    if (!overlay) return;
    if (action === 'close') {
      closeModal(overlay);
      return;
    }
    if (action === 'confirm') {
      const modalId = overlay.dataset.modalId || '';
      const cb = _callbacks.get(modalId);
      if (cb?.onConfirm) {
        const result = cb.onConfirm();
        // Fix B5: se onConfirm ritorna false esplicitamente, NON chiudere (validation bypass)
        if (result === false) return;
      }
      closeModal(overlay);
      return;
    }
    if (action === 'overlay-close' && target === overlay) {
      closeModal(overlay);
    }
  });
  // ESC per chiudere modale top
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const overlays = document.querySelectorAll('.modal-overlay');
    if (overlays.length === 0) return;
    const top = overlays[overlays.length - 1] as HTMLElement;
    closeModal(top);
  });
}

function closeModal(el: HTMLElement): void {
  // Evita double-close (ESC + click contemporanei)
  if (_closing.has(el)) return;
  _closing.add(el);

  const modalId = el.dataset.modalId || '';
  const cb = _callbacks.get(modalId);

  el.classList.remove('modal-show');
  setTimeout(() => {
    el.remove();
    if (document.querySelectorAll('.modal-overlay').length === 0) {
      document.body.classList.remove('modal-open');
    }
    // Fix B6: onClose callback per cleanup state
    if (cb?.onClose) {
      try { cb.onClose(); } catch (e) { console.error('[modal] onClose error', e); }
    }
    // Fix B20: cleanup callbacks per evitare memory leak
    _callbacks.delete(modalId);
    _closing.delete(el);
  }, 200);
}

export interface ShowModalOptions {
  modalId?: string;
  title: string;
  bodyHtml: string;
  actions: ModalAction[];
  /** Chiamato su click "confirm". Ritorna false per bloccare la chiusura (validazione fallita). */
  onConfirm?: () => boolean | void;
  /** Chiamato quando il modal viene chiuso (✕, ESC, overlay click, o confirm successful). Per cleanup state. */
  onClose?: () => void;
  /** true per bloccare chiusura su overlay click (default false) */
  sticky?: boolean;
}

export function showModal(opts: ShowModalOptions): HTMLElement {
  initModal();
  const modalId = opts.modalId || `modal-${Date.now()}`;

  // Se esiste già un modal con stesso id, chiudilo prima (dedupe)
  const existing = document.querySelector<HTMLElement>(`.modal-overlay[data-modal-id="${modalId}"]`);
  if (existing) {
    closeModal(existing);
  }

  // Fix B5/B6/B20: registra callbacks
  _callbacks.set(modalId, {
    onConfirm: opts.onConfirm,
    onClose: opts.onClose,
    sticky: opts.sticky,
  });

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.dataset.modalId = modalId;
  if (opts.sticky) overlay.dataset.sticky = '1';

  const actionsHtml = opts.actions
    .map((a) => {
      const variant = a.variant || 'outline';
      const actionAttr = a.action === 'close' ? 'close' : 'confirm';
      const idAttr = a.id ? ` data-modal-id-attr="${escapeHtml(a.id)}"` : '';
      return `<button type="button" class="btn btn-${variant}" data-modal-action="${actionAttr}"${idAttr}>${escapeHtml(a.label)}</button>`;
    })
    .join('');

  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title-${modalId}">
      <div class="modal-header">
        <h3 class="modal-title" id="modal-title-${modalId}">${escapeHtml(opts.title)}</h3>
        <button type="button" class="modal-close" data-modal-action="close" aria-label="Chiudi">✕</button>
      </div>
      <div class="modal-body">${opts.bodyHtml}</div>
      ${actionsHtml ? `<div class="modal-footer">${actionsHtml}</div>` : ''}
    </div>
  `;

  // Click su overlay chiude (a meno che sticky)
  if (!opts.sticky) {
    overlay.dataset.modalAction = 'overlay-close';
  }

  document.body.appendChild(overlay);
  document.body.classList.add('modal-open');

  // animazione
  requestAnimationFrame(() => overlay.classList.add('modal-show'));

  // focus management: focus sul primo bottone azione o close
  const firstAction = overlay.querySelector<HTMLElement>('.modal-footer .btn, .modal-close');
  if (firstAction) firstAction.focus();

  return overlay;
}

/** Chiude tutti i modal con dato modalId */
export function closeModalById(modalId: string): void {
  const el = document.querySelector<HTMLElement>(`.modal-overlay[data-modal-id="${modalId}"]`);
  if (el) closeModal(el);
}
