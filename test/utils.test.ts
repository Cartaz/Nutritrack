// Test unitari per src/lib/utils.ts
//
// Copre: escapeHtml, safeId, safeNum, parseISODateLocal, isValidDateKey, debounce,
// clamp, round. Sono funzioni "util" usate ovunque — bug qui = bug ovunque.

import { describe, it, expect, vi } from 'vitest';
import {
  escapeHtml,
  escapeAttr,
  safeId,
  safeNum,
  safeImageUrl,
  parseISODateLocal,
  toDateKey,
  isValidDateKey,
  debounce,
  clamp,
  round,
} from '../src/lib/utils';

describe('escapeHtml', () => {
  it('escapa i caratteri HTML pericolosi', () => {
    // Nota: anche '/' viene escapato (anti </script> injection)
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;&#x2F;script&gt;');
    expect(escapeHtml('"quote"')).toBe('&quot;quote&quot;');
    expect(escapeHtml("'apostrophe'")).toBe('&#39;apostrophe&#39;');
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapa / in contesti script (anti </script>)', () => {
    expect(escapeHtml('</script>')).toBe('&lt;&#x2F;script&gt;');
  });

  it('ritorna stringa vuota per null/undefined', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('converte non-string in stringa', () => {
    expect(escapeHtml(123)).toBe('123');
  });
});

describe('escapeAttr', () => {
  it('alias di escapeHtml', () => {
    expect(escapeAttr('<a href="x">')).toBe('&lt;a href=&quot;x&quot;&gt;');
  });
});

describe('safeId', () => {
  it('genera ID univoco con prefix', () => {
    const id1 = safeId('food_');
    const id2 = safeId('food_');
    expect(id1).not.toBe(id2);
    expect(id1.startsWith('food_')).toBe(true);
  });

  it('funziona senza prefix', () => {
    const id = safeId();
    expect(id.length).toBeGreaterThan(5);
  });

  it('genera ID univoci in loop veloce (no collisioni nello stesso ms)', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(safeId('x_'));
    }
    expect(ids.size).toBe(1000);
  });
});

describe('safeNum', () => {
  it('ritorna numero valido', () => {
    expect(safeNum(42)).toBe(42);
    expect(safeNum('42')).toBe(42);
    expect(safeNum('3.14')).toBe(3.14);
  });

  it('ritorna fallback per stringa vuota o whitespace', () => {
    expect(safeNum('', 99)).toBe(99);
    expect(safeNum('   ', 99)).toBe(99);
  });

  it('ritorna fallback per non-numero', () => {
    expect(safeNum('abc', 99)).toBe(99);
    expect(safeNum(null, 99)).toBe(99);
    expect(safeNum(undefined, 99)).toBe(99);
    expect(safeNum(NaN, 99)).toBe(99);
  });

  it('clampa a min', () => {
    expect(safeNum(-5, 0, 0)).toBe(0);
    expect(safeNum(-5, 0, 10)).toBe(10); // max applicato: -5 clamped a [10, undefined]? no, solo max
  });

  it('clampa a max', () => {
    expect(safeNum(100, 0, 0, 50)).toBe(50);
  });

  it('clampa a range [min, max]', () => {
    expect(safeNum(25, 0, 0, 50)).toBe(25);
    expect(safeNum(-10, 0, 0, 50)).toBe(0);
    expect(safeNum(100, 0, 0, 50)).toBe(50);
  });

  it('converte boolean true → 1, false → 0', () => {
    expect(safeNum(true)).toBe(1);
    expect(safeNum(false)).toBe(0);
  });
});

describe('safeImageUrl', () => {
  it('accetta URL http/https', () => {
    expect(safeImageUrl('https://example.com/img.jpg')).toBe('https://example.com/img.jpg');
    expect(safeImageUrl('http://example.com/img.jpg')).toBe('http://example.com/img.jpg');
  });

  it('ritorna undefined per javascript: URL', () => {
    expect(safeImageUrl('javascript:alert(1)')).toBeUndefined();
  });

  it('ritorna undefined per data: URL', () => {
    expect(safeImageUrl('data:image/png;base64,abc')).toBeUndefined();
  });

  it('ritorna undefined per stringa vuota', () => {
    expect(safeImageUrl('')).toBeUndefined();
    expect(safeImageUrl('   ')).toBeUndefined();
  });

  it('ritorna undefined per non-string', () => {
    expect(safeImageUrl(null)).toBeUndefined();
    expect(safeImageUrl(123)).toBeUndefined();
  });

  it('ritorna undefined per URL > 2048 char', () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(2100);
    expect(safeImageUrl(longUrl)).toBeUndefined();
  });

  it('trimma whitespace', () => {
    expect(safeImageUrl('  https://example.com/img.jpg  ')).toBe('https://example.com/img.jpg');
  });
});

describe('parseISODateLocal', () => {
  it('parsa data valida YYYY-MM-DD', () => {
    const d = parseISODateLocal('2024-01-15');
    expect(d.getFullYear()).toBe(2024);
    expect(d.getMonth()).toBe(0); // gennaio
    expect(d.getDate()).toBe(15);
  });

  it('ritorna NaN per formato non stretto', () => {
    expect(isNaN(parseISODateLocal('2024-1-5').getTime())).toBe(true);
    expect(isNaN(parseISODateLocal('ciao').getTime())).toBe(true);
    expect(isNaN(parseISODateLocal('2024/01/15').getTime())).toBe(true);
  });

  it('round-trip check: data invalida che JS normalizzerebbe', () => {
    // 2024-13-45 → JS normalizzerebbe a 2025-02-14
    expect(isNaN(parseISODateLocal('2024-13-45').getTime())).toBe(true);
    expect(isNaN(parseISODateLocal('2024-02-30').getTime())).toBe(true); // 30 febbraio non esiste
    expect(isNaN(parseISODateLocal('2024-00-15').getTime())).toBe(true); // mese 0
  });

  it('accetta 29 febbraio in anno bisestile', () => {
    const d = parseISODateLocal('2024-02-29');
    expect(d.getMonth()).toBe(1);
    expect(d.getDate()).toBe(29);
  });

  it('rigetta 29 febbraio in anno non bisestile', () => {
    expect(isNaN(parseISODateLocal('2023-02-29').getTime())).toBe(true);
  });
});

describe('toDateKey', () => {
  it('formatta Date in YYYY-MM-DD', () => {
    const d = new Date(2024, 0, 15); // 15 gennaio 2024
    expect(toDateKey(d)).toBe('2024-01-15');
  });

  it('padding per mese/giorno < 10', () => {
    const d = new Date(2024, 2, 5); // 5 marzo 2024
    expect(toDateKey(d)).toBe('2024-03-05');
  });
});

describe('isValidDateKey', () => {
  it('true per data valida', () => {
    expect(isValidDateKey('2024-01-15')).toBe(true);
    expect(isValidDateKey('2024-12-31')).toBe(true);
  });

  it('false per data invalida', () => {
    expect(isValidDateKey('2024-13-01')).toBe(false);
    expect(isValidDateKey('2024-02-30')).toBe(false);
    expect(isValidDateKey('ciao')).toBe(false);
    expect(isValidDateKey('2024-1-5')).toBe(false);
    expect(isValidDateKey(123)).toBe(false);
    expect(isValidDateKey(null)).toBe(false);
  });

  it('funziona come type guard (string vs non-string)', () => {
    const x: unknown = '2024-01-15';
    if (isValidDateKey(x)) {
      // Qui x è tipato come string
      expect(x.length).toBe(10);
    }
  });
});

describe('debounce', () => {
  it('esegue fn solo dopo il delay', async () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 100);

    d();
    d();
    d();

    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('passa gli argomenti alla fn', async () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 100);

    d('a', 1);
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledWith('a', 1);

    vi.useRealTimers();
  });

  it('cancel() previene esecuzione', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 100);

    d();
    d.cancel();
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});

describe('clamp', () => {
  it('clampa valore dentro range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('ritorna min per NaN/Infinity (valori non finiti)', () => {
    // clamp ritorna sempre min per input non finito (comportamento predicibile)
    expect(clamp(NaN, 0, 10)).toBe(0);
    expect(clamp(Infinity, 0, 10)).toBe(0);
    expect(clamp(-Infinity, 0, 10)).toBe(0);
  });
});

describe('round', () => {
  it('arrotonda a 1 decimale di default', () => {
    expect(round(1.45)).toBe(1.5);
    expect(round(1.44)).toBe(1.4);
  });

  it('arrotonda a N decimali', () => {
    expect(round(1.23456, 2)).toBe(1.23);
    expect(round(1.23456, 3)).toBe(1.235);
    expect(round(1.23456, 0)).toBe(1);
  });

  it('gestisce IEEE754 con Number.EPSILON (round(1.005, 2))', () => {
    // Senza EPSILON: round(1.005, 2) = 1 (bug)
    // Con EPSILON: round(1.005, 2) = 1.01
    expect(round(1.005, 2)).toBe(1.01);
  });

  it('ritorna 0 per non finito', () => {
    expect(round(NaN)).toBe(0);
    expect(round(Infinity)).toBe(0);
  });
});
