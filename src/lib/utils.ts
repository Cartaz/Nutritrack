// Helper puri: safeId, safeNum, safeImageUrl, escapeHtml, escapeAttr, parseISODateLocal.
// Nessun accesso DOM, testabili, riutilizzabili.

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape stringhe utente per innerHTML (anti-XSS) */
export function escapeHtml(s: unknown): string {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/** Escape per attributi HTML (url, classi, data-*) */
export function escapeAttr(s: unknown): string {
  return escapeHtml(s);
}

/** ID univoco prefixato (timestamp base36 + random) */
export function safeId(prefix = ''): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Number sanitizzato con fallback. Range opzionale [min,max]. */
export function safeNum(v: unknown, fallback = 0, min?: number, max?: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  let out = n;
  if (typeof min === 'number') out = Math.max(min, out);
  if (typeof max === 'number') out = Math.min(max, out);
  return out;
}

/** True se la stringa è un URL http(s) valido (anti-javascript:) */
export function safeImageUrl(url: unknown): string | undefined {
  if (typeof url !== 'string' || !url) return undefined;
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return undefined;
  // lunghezza guard
  if (trimmed.length > 2048) return undefined;
  return trimmed;
}

/** Parse YYYY-MM-DD -> Date timezone-safe (non usa new Date(isoString)).
 *  Fix B9: round-trip check — se la data normalizza a una diversa (es. 2024-13-45 -> 2025-02-14), ritorna NaN.
 */
export function parseISODateLocal(key: string): Date {
  const parts = key.split('-').map((p) => Number(p));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return new Date(NaN);
  }
  const [y, m, d] = parts;
  const date = new Date(y, m - 1, d);
  // Round-trip check: se JS ha normalizzato (es. month 13 -> anno+1), la data non corrisponde
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    return new Date(NaN);
  }
  return date;
}

/** Date -> YYYY-MM-DD (locale) */
export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Formatta data YYYY-MM-DD in italiano lungo (es. "lunedì 5 gennaio") */
export function formatDateIT(key: string): string {
  const d = parseISODateLocal(key);
  if (isNaN(d.getTime())) return key;
  return d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
}

/** True se la dateKey è oggi */
export function isToday(key: string): boolean {
  return key === toDateKey(new Date());
}

/** Valida formato YYYY-MM-DD stretto */
export function isValidDateKey(key: unknown): key is string {
  if (typeof key !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const d = parseISODateLocal(key);
  return !isNaN(d.getTime());
}

/** Debounce generico con cancel */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number
): (...args: A) => void {
  let t: ReturnType<typeof setTimeout> | null = null;
  return (...args: A) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Clamp numerico */
export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** Round a N decimali */
export function round(n: number, decimals = 1): number {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}
