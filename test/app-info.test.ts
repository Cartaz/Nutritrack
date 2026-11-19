import { describe, expect, it } from 'vitest';
import { appVersionLabel } from '../src/lib/appInfo';
import pkg from '../package.json';

describe('app version label', () => {
  it('shows version, build date in Italian format and commit', () => {
    expect(appVersionLabel('1.3.0', '2026-11-19T10:00:00.000Z', 'a1b2c3d')).toBe('1.3.0 · 19/11/2026 · a1b2c3d');
  });

  it('omits what the build does not know', () => {
    expect(appVersionLabel('1.3.0', 'not-a-date', '')).toBe('1.3.0');
  });

  it('defaults to the version declared in package.json', () => {
    expect(appVersionLabel().startsWith(pkg.version)).toBe(true);
  });
});
