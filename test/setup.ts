// IndexedDB in memoria (jsdom non lo implementa): la persistenza dell'app vive lì.
import 'fake-indexeddb/auto';

// Setup globale per i test Vitest (jsdom).
//
// I test intercettano la persistenza con vi.spyOn(Storage.prototype, ...): serve quindi
// lo Storage reale di jsdom. vitest.config.ts disattiva il webstorage nativo di Node
// (che altrimenti lo oscura su Node >= 25); qui falliamo subito, con un messaggio chiaro,
// se l'ambiente non è quello atteso invece di far fallire in modo opaco singoli test.
if (typeof Storage === 'undefined' || !(globalThis.localStorage instanceof Storage)) {
  throw new Error('test/setup.ts: localStorage non è lo Storage di jsdom. Verifica execArgv in vitest.config.ts.');
}

// jsdom non implementa document.execCommand('copy') — forniamo uno stub
// che i test possono spyare/moccare. Il path legacy di clipboard.ts lo usa
// come fallback quando navigator.clipboard non è disponibile.
if (typeof document !== 'undefined' && typeof document.execCommand !== 'function') {
  (document as unknown as { execCommand: (cmd: string) => boolean }).execCommand = (cmd: string): boolean => {
    if (cmd === 'copy') return true;
    return false;
  };
}

// jsdom non implementa navigator.clipboard — forniamo uno stub di default
// che i test possono sovrascrivere con Object.defineProperty.
if (typeof navigator !== 'undefined' && !(navigator as { clipboard?: unknown }).clipboard) {
  Object.defineProperty(navigator, 'clipboard', {
    value: {
      writeText: async (): Promise<void> => {
        /* stub */
      },
    },
    configurable: true,
  });
}
