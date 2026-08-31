import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectBarcodeFromVideo, hasNativeBarcodeDetector, isBarcodeScanSupported } from '../src/lib/barcode';

class FakeBarcodeDetector {
  static async getSupportedFormats(): Promise<string[]> {
    return ['ean_13'];
  }

  async detect(): Promise<DetectedBarcode[]> {
    return [];
  }
}

describe('barcode lifecycle', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'BarcodeDetector', {
      configurable: true,
      value: FakeBarcodeDetector,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'BarcodeDetector', {
      configurable: true,
      value: undefined,
    });
    vi.restoreAllMocks();
  });

  it('rileva il backend nativo quando presente', () => {
    expect(hasNativeBarcodeDetector()).toBe(true);
  });

  it('considera lo scanner supportato quando getUserMedia è disponibile', () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn() },
    });
    expect(isBarcodeScanSupported()).toBe(true);
  });

  it('un abort durante il detector nativo risolve con null invece di lasciare la Promise pending', async () => {
    const controller = new AbortController();
    const video = document.createElement('video');
    const stream = { getTracks: () => [] } as unknown as MediaStream;

    const resultPromise = detectBarcodeFromVideo(stream, video, controller.signal);
    // createNativeDetector() è async: lascia che detectWithNative registri l'abort listener.
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();

    await expect(resultPromise).resolves.toBeNull();
  });
});
