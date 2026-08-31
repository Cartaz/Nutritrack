import { describe, expect, it } from 'vitest';
import { shouldAutoAdvanceDate } from '../src/lib/utils';

describe('shouldAutoAdvanceDate', () => {
  it('non altera una data storica al semplice focus nello stesso giorno', () => {
    expect(shouldAutoAdvanceDate('2026-08-20', '2026-08-31', '2026-08-31')).toBe(false);
  });

  it('avanza quando cambia davvero il giorno e il dashboard era sul vecchio oggi', () => {
    expect(shouldAutoAdvanceDate('2026-08-31', '2026-08-31', '2026-09-01')).toBe(true);
  });

  it('non forza oggi dopo mezzanotte se l’utente sta consultando una data storica', () => {
    expect(shouldAutoAdvanceDate('2026-08-20', '2026-08-31', '2026-09-01')).toBe(false);
  });
});
