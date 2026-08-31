import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const barcodeMocks = vi.hoisted(() => ({
  detectBarcodeFromVideo: vi.fn(),
  startCameraStream: vi.fn(),
  isBarcodeScanSupported: vi.fn(),
}));

vi.mock('../src/lib/barcode', () => barcodeMocks);

import { closeBarcodeScanner, isBarcodeScannerOpen, openBarcodeScanner } from '../src/components/barcode-scanner';

describe('barcode scanner component lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    barcodeMocks.isBarcodeScanSupported.mockReturnValue(true);
    barcodeMocks.detectBarcodeFromVideo.mockResolvedValue(null);
  });

  afterEach(() => {
    closeBarcodeScanner();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('non apre scanner duplicati', () => {
    barcodeMocks.startCameraStream.mockReturnValue(new Promise<MediaStream>(() => {}));

    openBarcodeScanner({ onDetected: vi.fn() });
    openBarcodeScanner({ onDetected: vi.fn() });

    expect(document.querySelectorAll('[data-modal-id="barcode-scanner"]')).toHaveLength(1);
    expect(isBarcodeScannerOpen()).toBe(true);
  });

  it('ferma uno stream che arriva dopo che lo scanner è già stato chiuso', async () => {
    let resolveStream: ((stream: MediaStream) => void) | undefined;
    const pendingStream = new Promise<MediaStream>((resolve) => {
      resolveStream = resolve;
    });
    barcodeMocks.startCameraStream.mockReturnValue(pendingStream);

    const stop = vi.fn();
    const stream = {
      getTracks: () => [{ stop }],
    } as unknown as MediaStream;

    openBarcodeScanner({ onDetected: vi.fn() });
    closeBarcodeScanner();
    resolveStream?.(stream);
    await Promise.resolve();
    await Promise.resolve();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(isBarcodeScannerOpen()).toBe(false);
  });
});
