// Helper imgTag: genera <img> con data-fallback per fallback delegato globale.
// Pattern 4 dello standard.

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
    `/>`
  );
}
