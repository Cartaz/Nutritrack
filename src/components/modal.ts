// Modal system: dialog generico con header, body e footer actions.
// Il contenuto testuale è il percorso sicuro; HTML ricco richiede un opt-in esplicito.

import { escapeAttr, escapeHtml } from '../lib/utils';

export interface ModalAction {
  label: string;
  variant?: 'primary' | 'outline' | 'danger';
  action: 'close' | 'confirm';
  /** id opzionale per identificare l'azione custom via data-modal-action */
  id?: string;
}

interface ModalCallbacks {
  /** Ritorna false per lasciare il modal aperto dopo una validazione fallita. */
  onConfirm?: (clickedEl?: HTMLElement) => boolean | void;
  onClose?: () => void;
  sticky?: boolean;
}

interface ModalBaseOptions {
  modalId?: string;
  title: string;
  actions: ModalAction[];
  /** Chiamato su click "confirm"; riceve il bottone cliccato per distinguere azioni con id diversi. */
  onConfirm?: (clickedEl?: HTMLElement) => boolean | void;
  /** Chiamato quando il modal viene chiuso da qualsiasi percorso. */
  onClose?: () => void;
  /** true per bloccare chiusura su overlay click (default false). */
  sticky?: boolean;
}

type ModalBodyOptions =
  | {
      /** Testo non trusted: il modal possiede l'escaping. */
      bodyText: string;
      trustedBodyHtml?: never;
    }
  | {
      /** Markup interno già costruito in sicurezza dal caller. Usare solo quando serve HTML ricco. */
      bodyText?: never;
      trustedBodyHtml: string;
    };

export type ShowModalOptions = ModalBaseOptions & ModalBodyOptions;

let _modalInit = false;
const _callbacks = new Map<string, ModalCallbacks>();
const _closing = new WeakSet<HTMLElement>();
let _previouslyFocused: HTMLElement | null = null;

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusableElements(overlay: HTMLElement): HTMLElement[] {
  return Array.from(overlay.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

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
        const result = cb.onConfirm(target);
        if (result === false) return;
      }
      closeModal(overlay);
      return;
    }
    if (action === 'overlay-close' && e.target === overlay) {
      closeModal(overlay);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const overlays = document.querySelectorAll('.modal-overlay');
    if (overlays.length === 0) return;
    closeModal(overlays[overlays.length - 1] as HTMLElement);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const overlays = document.querySelectorAll('.modal-overlay');
    if (overlays.length === 0) return;
    const top = overlays[overlays.length - 1] as HTMLElement;
    const focusable = getFocusableElements(top);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement;
    if (e.shiftKey) {
      if (active === first || !top.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last || !top.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  });
}

function closeModal(el: HTMLElement): void {
  if (_closing.has(el)) return;
  _closing.add(el);

  const modalId = el.dataset.modalId || '';
  const cb = _callbacks.get(modalId);

  // Rimuovere subito i callback rende idempotenti i click ripetuti durante il fade-out.
  if (_callbacks.get(modalId) === cb) {
    _callbacks.delete(modalId);
  }

  el.classList.remove('modal-show');
  setTimeout(() => {
    el.remove();
    if (document.querySelectorAll('.modal-overlay').length === 0) {
      document.body.classList.remove('modal-open');
    }

    // Un modal con lo stesso id può essere stato sostituito durante il fade-out.
    // In quel caso il vecchio onClose non deve ripulire lo stato appartenente al nuovo dialog.
    const replacementActive = _callbacks.has(modalId);
    if (!replacementActive && cb?.onClose) {
      try {
        cb.onClose();
      } catch (e) {
        console.error('[modal] onClose error', e);
      }
    }
    _closing.delete(el);
    if (!replacementActive && _previouslyFocused && typeof _previouslyFocused.focus === 'function') {
      try {
        _previouslyFocused.focus();
      } catch {
        /* noop */
      }
      _previouslyFocused = null;
    }
  }, 200);
}

export function showModal(opts: ShowModalOptions): HTMLElement {
  initModal();
  const modalId = opts.modalId || `modal-${Date.now()}`;

  const existing = document.querySelector<HTMLElement>(`.modal-overlay[data-modal-id="${modalId}"]`);
  if (existing) {
    closeModal(existing);
  }

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
      const idAttr = a.id ? ` data-modal-id-attr="${escapeAttr(a.id)}"` : '';
      return `<button type="button" class="btn btn-${variant}" data-modal-action="${actionAttr}"${idAttr}>${escapeHtml(a.label)}</button>`;
    })
    .join('');

  const bodyContent = 'bodyText' in opts ? escapeHtml(opts.bodyText) : opts.trustedBodyHtml;
  const safeModalId = escapeAttr(modalId);

  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title-${safeModalId}">
      <div class="modal-header">
        <h3 class="modal-title" id="modal-title-${safeModalId}">${escapeHtml(opts.title)}</h3>
        <button type="button" class="modal-close" data-modal-action="close" aria-label="Chiudi">✕</button>
      </div>
      <div class="modal-body">${bodyContent}</div>
      ${actionsHtml ? `<div class="modal-footer">${actionsHtml}</div>` : ''}
    </div>
  `;

  if (!opts.sticky) {
    overlay.dataset.modalAction = 'overlay-close';
  }

  _previouslyFocused = document.activeElement as HTMLElement;
  document.body.appendChild(overlay);
  document.body.classList.add('modal-open');

  requestAnimationFrame(() => overlay.classList.add('modal-show'));

  const firstAction = overlay.querySelector<HTMLElement>('.modal-footer .btn, .modal-close');
  if (firstAction) firstAction.focus();

  return overlay;
}

/** Chiude il modal con dato modalId, se presente. */
export function closeModalById(modalId: string): void {
  const el = document.querySelector<HTMLElement>(`.modal-overlay[data-modal-id="${modalId}"]`);
  if (el) closeModal(el);
}
