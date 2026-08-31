import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeModalById, showModal } from '../src/components/modal';

describe('modal contracts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<button id="origin">Origine</button>';
  });

  afterEach(() => {
    for (const overlay of document.querySelectorAll<HTMLElement>('.modal-overlay')) {
      const id = overlay.dataset.modalId;
      if (id) closeModalById(id);
    }
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('non chiude il modal quando onConfirm ritorna false', () => {
    const onConfirm = vi.fn(() => false);
    showModal({
      modalId: 'validation',
      title: 'Validazione',
      bodyHtml: '<p>Body</p>',
      actions: [{ label: 'Salva', action: 'confirm', variant: 'primary' }],
      onConfirm,
    });

    document.querySelector<HTMLElement>('[data-modal-id="validation"] [data-modal-action="confirm"]')?.click();
    vi.advanceTimersByTime(250);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-modal-id="validation"]')).not.toBeNull();
  });

  it('esegue onConfirm una sola volta anche con doppio click durante il fade-out', () => {
    const onConfirm = vi.fn();
    showModal({
      modalId: 'double-click',
      title: 'Conferma',
      bodyHtml: '<p>Body</p>',
      actions: [{ label: 'Salva', action: 'confirm', variant: 'primary' }],
      onConfirm,
    });

    const button = document.querySelector<HTMLElement>(
      '[data-modal-id="double-click"] [data-modal-action="confirm"]',
    );
    button?.click();
    button?.click();

    expect(onConfirm).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(250);
    expect(document.querySelector('[data-modal-id="double-click"]')).toBeNull();
  });

  it('sostituendo un modal con lo stesso id non esegue onClose del vecchio sul nuovo stato', () => {
    const oldClose = vi.fn();
    const newClose = vi.fn();

    showModal({
      modalId: 'replace-me',
      title: 'Vecchio',
      bodyHtml: '<p>A</p>',
      actions: [{ label: 'OK', action: 'close' }],
      onClose: oldClose,
    });
    showModal({
      modalId: 'replace-me',
      title: 'Nuovo',
      bodyHtml: '<p>B</p>',
      actions: [{ label: 'OK', action: 'close' }],
      onClose: newClose,
    });

    vi.advanceTimersByTime(250);

    expect(oldClose).not.toHaveBeenCalled();
    const overlays = document.querySelectorAll('[data-modal-id="replace-me"]');
    expect(overlays).toHaveLength(1);
    expect(overlays[0]?.textContent).toContain('Nuovo');

    closeModalById('replace-me');
    vi.advanceTimersByTime(250);
    expect(newClose).toHaveBeenCalledTimes(1);
  });
});
