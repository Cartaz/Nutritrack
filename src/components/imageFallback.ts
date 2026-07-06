// Image fallback delegato globale in capture-phase.
// Pattern 4 dello standard: un solo handler globale sostituisce <img> falliti con placeholder <div>.

let _init = false;

export function initImageFallback(): void {
  if (_init) return;
  _init = true;
  // capture-phase per intercettare errori img prima di altri handler
  document.addEventListener(
    'error',
    (e) => {
      const target = e.target;
      if (!(target instanceof HTMLImageElement)) return;
      if (!target.dataset.fallback) return;
      const emoji = target.dataset.fallback || '🥫';
      const cls = target.className || 'thumb';
      const placeholder = document.createElement('div');
      placeholder.className = `${cls} thumb-placeholder`;
      placeholder.setAttribute('aria-hidden', 'true');
      placeholder.textContent = emoji;
      target.replaceWith(placeholder);
    },
    true
  );
}
