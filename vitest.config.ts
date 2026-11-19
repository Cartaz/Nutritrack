import { defineConfig } from 'vitest/config';
import { buildInfoDefines } from './build-info';

// jsdom è necessario per i moduli che usano window, localStorage e document.
// Coverage su tutto src/ con soglie separate per dominio e UI.
export default defineConfig({
  define: buildInfoDefines(),
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['test/**/*.{test,spec}.ts', 'src/**/*.{test,spec}.ts'],
    exclude: ['node_modules/**', 'dist/**', 'dev-dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',
      // Tutto src/ entra nel report, così il dato è onesto anche per la UI.
      include: ['src/**/*.ts'],
      // main.ts è solo bootstrap (e il remap di v8 non riesce a parsarlo da non caricato).
      exclude: ['src/main.ts', 'src/lib/constants.ts', 'src/vite-env.d.ts', 'src/**/*.test.ts', 'src/**/*.spec.ts'],
      // Soglie separate: la logica di dominio deve restare ben coperta; la UI parte dal
      // livello attuale e la soglia serve a non farla scendere.
      thresholds: {
        'src/lib/**': { statements: 75, branches: 70, functions: 75, lines: 75 },
        'src/{components,views}/**': { statements: 30, branches: 22, functions: 35, lines: 30 },
      },
    },
    setupFiles: ['./test/setup.ts'],
    // Node >= 25 espone un localStorage globale nativo che oscura quello di jsdom
    // (e senza --localstorage-file vale undefined). Disattivarlo rende l'ambiente
    // identico su Node 22, 24 e 26: i test usano sempre lo Storage di jsdom.
    execArgv: ['--no-experimental-webstorage'],
    // Il primo test che carica @zxing/library può richiedere più tempo.
    testTimeout: 10_000,
  },
});
