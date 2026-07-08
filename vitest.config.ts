/// <reference types="vitest" />
import { defineConfig } from 'vite';

// Configurazione Vitest per NutriTrack.
//
// Scelte:
//  - environment: 'jsdom' perché alcuni moduli (storage.ts, components/*)
//    usano `window.addEventListener`, `localStorage`, `document`.
//    I moduli lib/* puri sono testabili anche in node, ma jsdom è necessario
//    per non rompere su side-effect di import (es. IIFE detectStorage).
//  - globals: false — preferiamo import espliciti di `describe/it/expect`
//    per chiarezza e per evitare collisioni con tipi globali.
//  - coverage: v8 (più veloce di istanbul, no instrumentazione babel).
//    Soglie minime: statements 60%, branches 50%, functions 60%, lines 60%.
//    Sono soglie conservative — il progetto non ha test pregressi, l'obiettivo
//    del quick win è "primi test critici", non copertura totale.

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['test/**/*.{test,spec}.ts', 'src/**/*.{test,spec}.ts'],
    exclude: ['node_modules/**', 'dist/**', 'dev-dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/lib/**/*.ts'],
      exclude: ['src/lib/constants.ts', 'src/**/*.test.ts', 'src/**/*.spec.ts'],
      thresholds: {
        statements: 60,
        branches: 50,
        functions: 60,
        lines: 60,
      },
    },
    // Restore jsdom localStorage tra i test (vitest fa isolation per file,
    // ma dentro lo stesso file i test condividono window).
    setupFiles: ['./test/setup.ts'],
    // Timeout generoso: il primo test che carica @zxing/library è lento.
    testTimeout: 10_000,
  },
});
