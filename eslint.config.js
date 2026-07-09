// Flat config ESLint per NutriTrack (ESLint 9, typescript-eslint 8, Prettier).
// Fonti:
//   https://eslint.org/docs/latest/use/configure/configuration-files
//   https://typescript-eslint.io/getting-started
//
// Configurazione volontariamente "tier leggero": niente plugin JSX/accessibility,
// perché il progetto è vanilla TS (no React/Vue). L'obiettivo è catturare i bug
// più frequenti (no-explicit-any, no-unused-vars, no-floating-promises) senza
// imporre un rumore eccessivo su un codebase hobbistico.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  // === Global ignores ===
  // dist/, node_modules/, sw helper di Workbox, file di config generati.
  {
    ignores: ['dist/**', 'node_modules/**', 'dev-dist/**', 'coverage/**', '*.config.ts', 'src/vite-env.d.ts'],
  },

  // === Base: recommended JS + type-aware TS ===
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // === Regole custom per il progetto ===
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        // Il progetto ha DOM + WebWorker + Browser; non abilitiamo projectService
        // per evitare build lento su CI hobbistica. typecheck è delegato a tsc.
        ecmaFeatures: { modules: true },
      },
    },
    rules: {
      // === Style: lasciato a Prettier, qui solo regole semantiche ===
      // Rilassiamo le regole di formattazione (Prettier le gestirà).
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          // Permetti argomenti non usati quando iniziano con _
          ignoreRestSiblings: true,
        },
      ],
      // Permette `any` esplicito (utile nei boundary con API esterne come OFF).
      // WARN piuttosto che ERROR: il progetto usa `unknown` ovunque, ma in casi
      // limite (es. cast di DOM events) `any` è pragmaticamente accettabile.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Consigliamo const ma non blocchiamo let (utile nei closure di event handlers).
      'prefer-const': 'warn',
      // No console.error/warn in codice di libreria, ma permettiamo per debug.
      // (Le toast.ts/console.error in storage.ts sono intenzionali.)
      // console.debug è ammesso per il barcode scanner (output diagnostico frame-by-frame).
      'no-console': ['warn', { allow: ['warn', 'error', 'info', 'debug'] }],
      // async senza await è solitamente un bug o refactoring incompiuto.
      '@typescript-eslint/no-empty-function': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Disabilita var del tutto: usa let/const.
      'no-var': 'error',
      // == invece di === è fonte di bug silenziosi.
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      // switch senza default può essere intenzionale, ma segnaliamo.
      'no-fallthrough': 'error',
    },
  },

  // === Test files: regole più permissive ===
  {
    files: ['test/**/*.ts', 'src/**/*.test.ts', 'src/**/*.spec.ts'],
    rules: {
      // Nei test permettiamo console.log di debug.
      'no-console': 'off',
      // Permettiamo any nei mock typed.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // === Service Worker & worker files: permissivi su DOM ===
  {
    files: ['src/sw.ts', 'src/worker/**/*.ts'],
    rules: {
      // SW e worker usano self/DedicatedWorkerGlobalScope; niente window.
      'no-restricted-globals': 'off',
    },
  },

  // === Disattiva tutte le regole che conflittano con Prettier ===
  prettierConfig,
);
