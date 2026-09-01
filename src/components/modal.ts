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

type CloseReason = 'normal' | 'superseded';

let _modalInit = false;
const _callbacks = new WeakMap<HTMLElement, ModalCallbacks>();
const _returnFocus = new WeakMap<HTMLElement, HTMLElement | null>();
const _closing = new WeakSet<HTMLElement>();

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusableElements(overlay: HTMLElement): HTMLElement[] {
  return Array.from(overlay.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

/**
 * Restituisce il modal più recente con questo id.
 * Durante il fade-out possono coesistere per ~200 ms un modal sostituito e il suo
 * successore; cercare dall'ultimo evita di agire accidentalmente sul vecchio overlay.
 */
function getLatestModalById(modalId: string): HTMLElement | null {
  const overlays = document.querySelectorAll<HTMLElement>('.modal-overlay');
  for (let i = overlays.length - 1; i >= 0; i--) {
    if (overlays[i].dataset.modalId === modalId) return overlays[i];
  }
  return null;
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
      const cb = _callbacks.get(overlay);
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

function closeModal(el: HTMLElement, reason: CloseReason = 'normal'): void {
  if (_closing.has(el)) return;
  _closing.add(el);

  const cb = _callbacks.get(el);
  const returnFocus = _returnFocus.get(el) ?? null;

  // Ogni overlay possiede i propri callback. Rimuoverli subito rende idempotenti i
  // click ripetuti durante il fade-out senza farli ricadere sul modal sostitutivo.
  _callbacks.delete(el);
  _returnFocus.delete(el);

  el.classList.remove('modal-show');
  setTimeout(() => {
    el.remove();
    if (document.querySelectorAll('.modal-overlay').length === 0) {
      document.body.classList.remove('modal-open');
    }

    // Un modal sostituito non deve pulire stato o focus che appartengono al successore.
    if (reason === 'normal' && cb?.onClose) {
      try {
        cb.onClose();
      } catch (e) {
        console.error('[modal] onClose error', e);
      }
    }
    _closing.delete(el);

    if (reason === 'normal' && returnFocus && typeof returnFocus.focus === 'function') {
      try {
        returnFocus.focus();
      } catch {
        /* noop */
      }
    }
  }, 200);
}

export function showModal(opts: ShowModalOptions): HTMLElement {
  initModal();
  const modalId = opts.modalId || `modal-${Date.now()}`;

  // Se sostituiamo lo stesso modal, ereditiamo il suo target di ritorno del focus.
  // In questo modo chiudere il successore riporta all'elemento precedente alla prima apertura,
  // non a un bottone del modal ormai rimosso.
  const existing = getLatestModalById(modalId);
  const returnFocus = existing
    ? (_returnFocus.get(existing) ?? (document.activeElement as HTMLElement | null))
    : (document.activeElement as HTMLElement | null);
  if (existing) {
    closeModal(existing, 'superseded');
  }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.dataset.modalId = modalId;
  if (opts.sticky) overlay.dataset.sticky = '1';

  _callbacks.set(overlay, {
    onConfirm: opts.onConfirm,
    onClose: opts.onClose,
  });
  _returnFocus.set(overlay, returnFocus);

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

  document.body.appendChild(overlay);
  document.body.classList.add('modal-open');

  requestAnimationFrame(() => overlay.classList.add('modal-show'));

  const firstAction = overlay.querySelector<HTMLElement>('.modal-footer .btn, .modal-close');
  if (firstAction) firstAction.focus();

  return overlay;
}

/** Chiude il modal più recente con dato modalId, se presente. */
export function closeModalById(modalId: string): void {
  const el = getLatestModalById(modalId);
  if (el) closeModal(el);
}
