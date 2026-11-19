// Versione dell'app mostrata all'utente (Impostazioni → Informazioni).
// I valori arrivano dal build: vedi build-info.ts.

/** Es. "1.3.0 · 19/11/2026 · a1b2c3d" (il commit manca se il build non lo conosce). */
export function appVersionLabel(
  version: string = __APP_VERSION__,
  buildDate: string = __BUILD_DATE__,
  commit: string = __BUILD_COMMIT__,
): string {
  const date = new Date(buildDate);
  const parts = [version];
  if (!Number.isNaN(date.getTime())) {
    parts.push(date.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }));
  }
  if (commit) parts.push(commit);
  return parts.join(' · ');
}
