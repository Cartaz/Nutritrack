import { afterEach, describe, expect, it } from 'vitest';
import { computeWeightMovingAverage, getBiometricForDisplay } from '../src/lib/biometrics';
import { detectBarcodeFromVideo } from '../src/lib/barcode';
import { normalizeMacroSplit } from '../src/lib/nutrition';

const originalBarcodeDetector = window.BarcodeDetector;

afterEach(() => {
  Object.defineProperty(window, 'BarcodeDetector', {
    value: originalBarcodeDetector,
    configurable: true,
    writable: true,
  });
});

describe('strategic audit regressions', () => {
  describe('biometric temporal inference', () => {
    it('never infers a historical weight from a future measurement', () => {
      const biometrics = {
        '2026-07-10': { weightKg: 80 },
        '2026-07-15': { waterMl: 1000 },
        '2026-07-20': { weightKg: 78 },
      };

      const display = getBiometricForDisplay(biometrics, '2026-07-15');

      expect(display.weightKg).toBe(80);
      expect(display.weightKgInferred).toBe(true);
    });

    it('does not infer a weight when only future measurements exist', () => {
      const biometrics = {
        '2026-07-15': { waterMl: 1000 },
        '2026-07-20': { weightKg: 78 },
      };

      const display = getBiometricForDisplay(biometrics, '2026-07-15');

      expect(display.weightKg).toBeUndefined();
      expect(display.weightKgInferred).toBe(false);
    });
  });

  describe('biometric calendar windows', () => {
    it('interprets a 7-day moving average as 7 calendar days, not 7 observations', () => {
      const points = [
        { date: '2026-07-01', weightKg: 80 },
        { date: '2026-07-08', weightKg: 78 },
        { date: '2026-07-15', weightKg: 76 },
      ];

      const result = computeWeightMovingAverage(points, 7);

      expect(result.map((point) => point.ma7)).toEqual([80, 78, 76]);
    });

    it('includes measurements up to 6 days before and excludes one exactly 7 days before', () => {
      const points = [
        { date: '2026-07-01', weightKg: 82 },
        { date: '2026-07-02', weightKg: 80 },
        { date: '2026-07-08', weightKg: 78 },
      ];

      const result = computeWeightMovingAverage(points, 7);

      // On July 8, July 2 is inside the trailing 7 calendar days; July 1 is outside.
      expect(result[2].ma7).toBe(79);
    });
  });

  describe('macro split invariant', () => {
    it.each([
      { proteinPct: 99.6, carbsPct: 0, fatPct: 0 },
      { proteinPct: 60.1, carbsPct: 40.1, fatPct: 0 },
      { proteinPct: 33.2, carbsPct: 33.2, fatPct: 33.2 },
      { proteinPct: 40, carbsPct: 40, fatPct: 40 },
      { proteinPct: -10, carbsPct: 50, fatPct: 50 },
    ])('normalizes $proteinPct/$carbsPct/$fatPct to 100%', (input) => {
      const result = normalizeMacroSplit(input);
      const sum = result.proteinPct + result.carbsPct + result.fatPct;

      expect(sum).toBeCloseTo(100, 10);
      expect(result.proteinPct).toBeGreaterThanOrEqual(0);
      expect(result.carbsPct).toBeGreaterThanOrEqual(0);
      expect(result.fatPct).toBeGreaterThanOrEqual(0);
    });
  });

  describe('barcode cancellation contract', () => {
    it('resolves null when the native detector is aborted after starting', async () => {
      class NeverDetectBarcodeDetector {
        constructor(_options?: BarcodeDetectorOptions) {
          void _options;
        }

        static async getSupportedFormats(): Promise<string[]> {
          return ['ean_13'];
        }

        async detect(_source: CanvasImageSource): Promise<DetectedBarcode[]> {
          void _source;
          return [];
        }
      }

      Object.defineProperty(window, 'BarcodeDetector', {
        value: NeverDetectBarcodeDetector,
        configurable: true,
        writable: true,
      });

      const controller = new AbortController();
      const video = document.createElement('video');
      const detection = detectBarcodeFromVideo({} as MediaStream, video, controller.signal);

      // Let detectWithNative create the detector and install its abort listener.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      controller.abort();

      const result = await Promise.race([
        detection,
        new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 100)),
      ]);

      expect(result).toBeNull();
    });
  });
});
