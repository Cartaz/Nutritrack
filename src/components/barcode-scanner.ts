// Barcode scanner modal: <video> + camera + detection loop.
// Self-contained (non passa da modal.ts) per gestire lifecycle camera + AbortController.
//
// P0 #2 della roadmap hobbistica.
//
// Usage:
//   openBarcodeScanner({
//     onDetected: (barcode) => { ... },
//     onError:    (err)    => { ... },  // opzionale
//   });
//
// Il modal si chiude da solo su:
//   - detection riuscita (dopo 400ms per feedback visivo)
//   - click su Annulla / ✕ / overlay
//   - ESC
//   - errore camera non recuperabile (dopo 3s per feedback)

import { detectBarcodeFromVideo, startCameraStream, isBarcodeScanSupported } from '../lib/barcode';
import { escapeHtml } from '../lib/utils';
import { showModal } from './modal';

interface ScannerOptions {
  onDetected: (barcode: string) => void;
  onError?: (error: Error) => void;
}

let _activeScanner: { cleanup: () => void } | null = null;

/** True se lo scanner è attualmente aperto. */
export function isBarcodeScannerOpen(): boolean {
  return _activeScanner !== null;
}

/** Apre il modal scanner. Ignora chiamate multiple mentre è già aperto. */
export function openBarcodeScanner(opts: ScannerOptions): void {
  if (_activeScanner) return;

  // Pre-check: se nemmeno la camera è disponibile, mostra errore inline senza aprire modal.
  if (!isBarcodeScanSupported()) {
    opts.onError?.(new Error('Camera API non disponibile in questo browser'));
    showUnsupportedToast();
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay modal-show barcode-scanner-overlay';
  overlay.dataset.modalId = 'barcode-scanner';
  overlay.innerHTML = `
    <div class="modal barcode-modal" role="dialog" aria-modal="true" aria-labelledby="barcode-title">
      <div class="modal-header">
        <h3 class="modal-title" id="barcode-title"><span aria-hidden="true">📷</span> Scansiona codice a barre</h3>
        <button type="button" class="modal-close" data-scanner-action="cancel" aria-label="Chiudi">✕</button>
      </div>
      <div class="scanner-body">
        <div class="scanner-video-wrap">
          <video id="scanner-video" autoplay muted playsinline></video>
          <div class="scanner-overlay-frame" aria-hidden="true"></div>
        </div>
        <p class="scanner-status" data-scanner-status>Avvio fotocamera…</p>
        <p class="scanner-hint">Inquadra il codice a barre del prodotto (EAN-13, EAN-8, UPC).</p>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline btn-block" data-scanner-action="cancel">Annulla</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.classList.add('modal-open');

  const video = overlay.querySelector<HTMLVideoElement>('#scanner-video')!;
  const statusEl = overlay.querySelector<HTMLElement>('[data-scanner-status]')!;

  const abortCtrl = new AbortController();
  let stream: MediaStream | null = null;
  let stopped = false;

  const cleanup = (): void => {
    if (stopped) return;
    stopped = true;
    try { abortCtrl.abort(); } catch { /* noop */ }
    if (stream) {
      stream.getTracks().forEach((t) => { try { t.stop(); } catch { /* noop */ } });
      stream = null;
    }
    if (video.srcObject) {
      try {
        (video.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      } catch { /* noop */ }
      video.srcObject = null;
    }
    overlay.classList.remove('modal-show');
    setTimeout(() => {
      overlay.remove();
      if (!document.querySelector('.modal-overlay')) {
        document.body.classList.remove('modal-open');
      }
    }, 200);
    _activeScanner = null;
  };

  _activeScanner = { cleanup };

  // ESC handler (capture per intercettare PRIMA di modal.ts)
  const escHandler = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    if (!document.querySelector('[data-modal-id="barcode-scanner"]')) return;
    // Solo se lo scanner è il modal top
    const overlays = document.querySelectorAll('.modal-overlay');
    const top = overlays[overlays.length - 1] as HTMLElement | undefined;
    if (!top || top.dataset.modalId !== 'barcode-scanner') return;
    e.stopPropagation();
    e.preventDefault();
    cleanup();
    document.removeEventListener('keydown', escHandler, true);
  };
  document.addEventListener('keydown', escHandler, true);

  // Click handler: Annulla / ✕ / overlay background
  overlay.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-scanner-action="cancel"]')) {
      cleanup();
      return;
    }
    // Click diretto sull'overlay (sfondo) → chiudi
    if (e.target === overlay) {
      cleanup();
    }
  });

  // Avvia camera + detection
  void (async () => {
    try {
      stream = await startCameraStream();
      if (stopped) return; // cleanup avvenuto durante await getUserMedia
      video.srcObject = stream;
      // Attendi metadata + play
      await video.play().catch(() => { /* play può fallire se interrotto, ignora */ });
      if (stopped) return;
      statusEl.textContent = 'Inquadra il codice a barre…';

      const barcode = await detectBarcodeFromVideo(video, abortCtrl.signal);
      if (stopped) return; // cleanup durante detection
      if (barcode) {
        statusEl.textContent = `Codice rilevato: ${escapeHtml(barcode)}`;
        statusEl.classList.add('scanner-status-success');
        // Feedback aptico se supportato
        if (typeof navigator.vibrate === 'function') {
          try { navigator.vibrate(80); } catch { /* noop */ }
        }
        // Delay per dare feedback visivo prima di chiudere
        setTimeout(() => {
          if (stopped) return;
          const b = barcode;
          cleanup();
          opts.onDetected(b);
        }, 500);
      } else if (!abortCtrl.signal.aborted) {
        // Detection terminata senza risultato e senza abort — caso anomalo
        statusEl.textContent = 'Nessun codice rilevato. Riprova.';
        setTimeout(() => {
          if (!stopped) cleanup();
        }, 1800);
      }
    } catch (e) {
      if (stopped) return;
      const err = e instanceof Error ? e : new Error(String(e));
      const isDenied = err.name === 'NotAllowedError' || err.name === 'SecurityError';
      const isNotFound = err.name === 'NotFoundError' || err.name === 'OverconstrainedError';
      if (isDenied) {
        statusEl.textContent = 'Permesso fotocamera negato. Abilita l\'accesso nelle impostazioni del browser.';
      } else if (isNotFound) {
        statusEl.textContent = 'Nessuna fotocamera trovata su questo dispositivo.';
      } else {
        statusEl.textContent = `Errore: ${err.message}`;
      }
      statusEl.classList.add('scanner-status-error');
      opts.onError?.(err);
      setTimeout(() => {
        if (!stopped) cleanup();
      }, 2500);
    }
  })();
}

/** Toast breve per device senza camera API. */
function showUnsupportedToast(): void {
  showModal({
    modalId: 'barcode-unsupported',
    title: 'Scanner non disponibile',
    bodyHtml: '<p>Il tuo browser non supporta l\'accesso alla fotocamera oppure non dispone di una camera. Puoi comunque cercare i prodotti per nome.</p>',
    actions: [{ label: 'OK', action: 'close', variant: 'primary' }],
  });
}

/** Chiude forzatamente lo scanner (es. da altro codice). */
export function closeBarcodeScanner(): void {
  _activeScanner?.cleanup();
}
