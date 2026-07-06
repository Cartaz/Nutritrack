// Toast system: container singolo, tipi success/error/warning/info.
// Auto-dismiss configurable, stack verticale top-center.

import { escapeHtml } from '../lib/utils';

type ToastType = 'success' | 'error' | 'warning' | 'info';

let _toastId = 0;
let _container: HTMLElement | null = null;
const _active = new Map<number, HTMLElement>();

function getContainer(): HTMLElement {
  if (_container && document.body.contains(_container)) return _container;
  _container = document.createElement('div');
  _container.className = 'toast-container';
  _container.setAttribute('role', 'status');
  _container.setAttribute('aria-live', 'polite');
  document.body.appendChild(_container);
  return _container;
}

export function showToast(message: string, type: ToastType = 'info', durationMs = 3500): void {
  const id = ++_toastId;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.dataset.toastId = String(id);
  el.innerHTML = `<span class="toast-icon" aria-hidden="true">${iconFor(type)}</span><span class="toast-msg">${escapeHtml(message)}</span>`;
  getContainer().appendChild(el);
  _active.set(id, el);

  // animazione entrata
  requestAnimationFrame(() => el.classList.add('toast-show'));

  const timeout = setTimeout(() => dismiss(id), durationMs);
  el.addEventListener('click', () => {
    clearTimeout(timeout);
    dismiss(id);
  });
}

function dismiss(id: number): void {
  const el = _active.get(id);
  if (!el) return;
  el.classList.remove('toast-show');
  el.classList.add('toast-hide');
  setTimeout(() => {
    el.remove();
    _active.delete(id);
  }, 250);
}

function iconFor(t: ToastType): string {
  switch (t) {
    case 'success': return '✓';
    case 'error':   return '✕';
    case 'warning': return '!';
    case 'info':    return 'i';
  }
}
