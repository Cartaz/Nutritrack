import { defineConfig } from 'vitest/config';

// jsdom è necessario per i moduli che usano window, localStorage e document.
// Le soglie di coverage sono un gate CI conservativo sui moduli di dominio.
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
    setupFiles: ['./test/setup.ts'],
    // Node >= 25 espone un localStorage globale nativo che oscura quello di jsdom
    // (e senza --localstorage-file vale undefined). Disattivarlo rende l'ambiente
    // identico su Node 22, 24 e 26: i test usano sempre lo Storage di jsdom.
    execArgv: ['--no-experimental-webstorage'],
    // Il primo test che carica @zxing/library può richiedere più tempo.
    testTimeout: 10_000,
  },
});
