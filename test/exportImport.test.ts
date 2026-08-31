import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exportDataJson: vi.fn(() => '{"version":1}'),
  importDataJson: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('../src/lib/storage', () => ({
  exportDataJson: mocks.exportDataJson,
  importDataJson: mocks.importDataJson,
}));
vi.mock('../src/components/toast', () => ({ showToast: mocks.showToast }));

import { handleExport, handleImport } from '../src/components/exportImport';

describe('backup export/import UI boundary', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:nutritrack-test'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('esporta il JSON con filename timestampato e revoca la blob URL', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    handleExport();

    expect(mocks.exportDataJson).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(mocks.showToast).toHaveBeenCalledWith('Backup esportato', 'success');

    vi.advanceTimersByTime(10_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:nutritrack-test');
  });

  it('blocca file oltre 50 MB prima di chiedere conferma o leggere il contenuto', () => {
    const confirmMock = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmMock);
    const tooLarge = { size: 51 * 1024 * 1024 } as File;

    handleImport(tooLarge);

    expect(confirmMock).not.toHaveBeenCalled();
    expect(mocks.importDataJson).not.toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith(expect.stringContaining('File troppo grande'), 'error', 6000);
  });

  it('non modifica dati se l’utente annulla la conferma di import', () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    const file = { size: 1024 } as File;

    handleImport(file);

    expect(mocks.importDataJson).not.toHaveBeenCalled();
  });
});
