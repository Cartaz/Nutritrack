import { afterEach, describe, expect, it, vi } from 'vitest';
import { promptForUpdate } from '../src/components/updatePrompt';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('service worker update prompt', () => {
  it('applies the waiting worker and reloads only when the user confirms', () => {
    const applyUpdate = vi.fn(async () => {});
    promptForUpdate(applyUpdate);

    const overlay = document.querySelector<HTMLElement>('[data-modal-id="app-update"]');
    expect(overlay).not.toBeNull();
    expect(applyUpdate).not.toHaveBeenCalled();

    overlay!.querySelector<HTMLElement>('[data-modal-action="confirm"]')!.click();
    expect(applyUpdate).toHaveBeenCalledWith(true);
  });

  it('does nothing when the user postpones', () => {
    const applyUpdate = vi.fn(async () => {});
    promptForUpdate(applyUpdate);
    document
      .querySelector<HTMLElement>('[data-modal-id="app-update"] .modal-footer [data-modal-action="close"]')!
      .click();
    expect(applyUpdate).not.toHaveBeenCalled();
  });
});
