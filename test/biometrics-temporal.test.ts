import { describe, expect, it } from 'vitest';
import { computeWeightMovingAverage, getBiometricForDisplay } from '../src/lib/biometrics';

describe('biometric temporal semantics', () => {
  describe('historical weight inference', () => {
    it('usa l’ultimo peso passato anche quando esistono misurazioni future', () => {
      const biometrics = {
        '2026-07-10': { weightKg: 80 },
        '2026-07-15': { waterMl: 1000 },
        '2026-07-20': { weightKg: 78 },
      };

      const display = getBiometricForDisplay(biometrics, '2026-07-15');

      expect(display.weightKg).toBe(80);
      expect(display.weightKgInferred).toBe(true);
    });

    it('non inferisce un peso quando esistono solo misurazioni future', () => {
      const biometrics = {
        '2026-07-15': { waterMl: 1000 },
        '2026-07-20': { weightKg: 78 },
      };

      const display = getBiometricForDisplay(biometrics, '2026-07-15');

      expect(display.weightKg).toBeUndefined();
      expect(display.weightKgInferred).toBe(false);
    });
  });

  describe('calendar moving-average window', () => {
    it('interpreta una finestra di 7 giorni come calendario, non come 7 osservazioni', () => {
      const points = [
        { date: '2026-07-01', weightKg: 80 },
        { date: '2026-07-08', weightKg: 78 },
        { date: '2026-07-15', weightKg: 76 },
      ];

      const result = computeWeightMovingAverage(points, 7);

      expect(result.map((point) => point.ma7)).toEqual([80, 78, 76]);
    });

    it('include fino a 6 giorni prima ed esclude il punto esattamente 7 giorni prima', () => {
      const points = [
        { date: '2026-07-01', weightKg: 82 },
        { date: '2026-07-02', weightKg: 80 },
        { date: '2026-07-08', weightKg: 78 },
      ];

      const result = computeWeightMovingAverage(points, 7);

      expect(result[2].ma7).toBe(79);
    });
  });
});
