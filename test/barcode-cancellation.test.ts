import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectBarcodeFromVideo } from '../src/lib/barcode';

class EmptyBarcodeDetector {
  static async getSupportedFormats(): Promise<string[]> {
    return ['ean_13'];
  }

  async detect(): Promise<DetectedBarcode[]> {
    return [];
  }
}

describe('native barcode cancellation', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'BarcodeDetector', {
      configurable: true,
      value: EmptyBarcodeDetector,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'BarcodeDetector', {
      configurable: true,
      value: undefined,
    });
  });

  it('risolve null quando viene abortito invece di lasciare una Promise pendente', async () => {
    const controller = new AbortController();
    const video = document.createElement('video');
    const stream = { getTracks: () => [] } as unknown as MediaStream;

    const result = detectBarcodeFromVideo(stream, video, controller.signal);
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();

    await expect(result).resolves.toBeNull();
  });
});
