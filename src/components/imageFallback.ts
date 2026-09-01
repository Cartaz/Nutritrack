// Image fallback delegato globale in capture-phase.
// Un solo owner gestisce sia errori di rete sia immagini caricate con naturalWidth=0.

let _init = false;

function replaceBrokenImage(target: EventTarget | null): void {
  if (!(target instanceof HTMLImageElement)) return;
  if (!target.dataset.fallback) return;
  const emoji = target.dataset.fallback || '🥫';
  const cls = target.className || 'thumb';
  const placeholder = document.createElement('div');
  placeholder.className = `${cls} thumb-placeholder`;
  placeholder.setAttribute('aria-hidden', 'true');
  placeholder.textContent = emoji;
  target.replaceWith(placeholder);
}

export function initImageFallback(): void {
  if (_init) return;
  _init = true;

  document.addEventListener('error', (e) => replaceBrokenImage(e.target), true);
  document.addEventListener(
    'load',
    (e) => {
      const target = e.target;
      if (!(target instanceof HTMLImageElement)) return;
      if (target.naturalWidth !== 0) return;
      replaceBrokenImage(target);
    },
    true,
  );
}
