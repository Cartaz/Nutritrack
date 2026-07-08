// Helper imgTag: genera <img> con data-fallback per fallback delegato globale.
// Pattern 4 dello standard.
//
// Fix LOW bug (E2E): aggiunto onload che verifica naturalWidth>0 — alcuni CDN (es. images.openfoodfacts.org)
// rispondono 200 con body vuoto/corrotto, l'evento error non fire ma naturalWidth===0 indica immagine rotta.
// In quel caso scateniamo manualmente l'evento error per triggerare il fallback globale di imageFallback.ts.

import { safeImageUrl, escapeAttr } from '../lib/utils';

export function imgTag(src: unknown, alt: string, cls = 'thumb', fallbackEmoji = '🥫'): string {
  const safe = safeImageUrl(src);
  if (!safe) {
    return `<div class="${escapeAttr(cls)} thumb-placeholder" aria-hidden="true">${escapeAttr(fallbackEmoji)}</div>`;
  }
  return (
    `<img ` +
    `class="${escapeAttr(cls)}" ` +
    `src="${escapeAttr(safe)}" ` +
    `alt="${escapeAttr(alt)}" ` +
    `loading="lazy" ` +
    `data-fallback="${escapeAttr(fallbackEmoji)}" ` +
    // Fix LOW bug: se naturalWidth===0 dopo load, l'immagine è rotta (CDN 200 con body vuoto).
    // Dispatch manuale di 'error' per triggerare il fallback globale di imageFallback.ts.
    `onload="if(this.naturalWidth===0){this.dispatchEvent(new Event('error',{bubbles:false}))}" ` +
    `/>`
  );
}
