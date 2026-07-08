// Setup globale per i test Vitest (jsdom).
//
// jsdom non implementa localStorage in modo completo in tutte le versioni;
// per essere sicuri usiamo un'implementazione in-memory based su Map.
// Questo previene errori silenziosi quando storage.ts fa detectStorage IIFE
// all'avvio.

class LocalStorageMock implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  key(index: number): string | null {
    const keys = Array.from(this.store.keys());
    return index >= 0 && index < keys.length ? keys[index] : null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

// Installa solo se non già presente (jsdom più recenti potrebbero averlo).
if (!('localStorage' in globalThis) || !(globalThis as { localStorage?: Storage }).localStorage) {
  (globalThis as { localStorage: Storage }).localStorage = new LocalStorageMock();
}

// window è definita in jsdom; sync con globalThis per storage.ts che fa
// window.addEventListener('storage', ...).
if (typeof window !== 'undefined' && !window.localStorage) {
  (window as unknown as { localStorage: Storage }).localStorage = (
    globalThis as { localStorage: Storage }
  ).localStorage;
}
