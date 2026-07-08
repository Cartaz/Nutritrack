// Barcode scanner modal: <video> + camera + detection loop.
// Self-contained (non passa da modal.ts) per gestire lifecycle camera + AbortController.
//
// P0 #2 della roadmap hobbistica.
//
// FIX (post-P0):
//  - Passa lo stream esistente a detectBarcodeFromVideo (evita double getUserMedia in ZXing)
//  - Aggiunge fallback "Inserisci codice manualmente" per UX quando la detection
//    non riesce (barcode danneggiato, camera non rileva, ecc.)
//  - Non chiude automaticamente il modal su errore camera: lascia l'opzione manuale
//
// Usage:
//   openBarcodeScanner({
//     onDetected: (barcode) => { ... },
//     onError:    (err)    => { ... },  // opzionale
//   });
//
// Il modal si chiude da solo su:
//   - detection riuscita (dopo 500ms per feedback visivo)
//   - click su Annulla / ✕ / overlay
//   - ESC

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
        <div class="scanner-manual">
          <button type="button" class="btn btn-ghost btn-sm" data-scanner-action="toggleManual">⌨️ Inserisci codice manualmente</button>
          <div class="scanner-manual-form" data-manual-form style="display:none">
            <input type="text" inputmode="numeric" pattern="[0-9]*" placeholder="Es. 8076809510053" data-manual-input maxlength="14" />
            <button type="button" class="btn btn-primary btn-sm" data-scanner-action="submitManual">Cerca</button>
          </div>
        </div>
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
  // Fix HIGH bug (memory leak): escHandler viene registrato su document con capture=true.
  // Prima veniva rimosso SOLO dentro se stesso (riga 146), MAI in cleanup(). Quindi se lo
  // scanner veniva chiuso via Annulla/overlay/detection, l'escHandler restava attivo e si
  // accumulava ad ogni apertura. Ora lo dichiariamo a livello di funzione così cleanup()
  // può rimuoverlo esplicitamente.
  let escHandler: ((e: KeyboardEvent) => void) | null = null;

  const cleanup = (): void => {
    if (stopped) return;
    stopped = true;
    try {
      abortCtrl.abort();
    } catch {
      /* noop */
    }
    // Fix HIGH bug: rimuovi esplicitamente l'escHandler per evitare memory leak.
    // Prima era rimosso solo dentro se stesso (se l'utente premeva ESC), ma non negli
    // altri path di chiusura (Annulla, overlay click, detection riuscita).
    if (escHandler) {
      document.removeEventListener('keydown', escHandler, true);
      escHandler = null;
    }
    if (stream) {
      stream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          /* noop */
        }
      });
      stream = null;
    }
    if (video.srcObject) {
      try {
        (video.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      } catch {
        /* noop */
      }
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

  // Helper: chiude lo scanner e propaga il barcode rilevato (manuale o da camera)
  const finishWithBarcode = (barcode: string): void => {
    if (stopped) return;
    const b = barcode;
    cleanup();
    opts.onDetected(b);
  };

  // ESC handler (capture per intercettare PRIMA di modal.ts)
  // Fix HIGH bug: assegnato a variabile esterna per permettere cleanup() di rimuoverlo.
  escHandler = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    if (!document.querySelector('[data-modal-id="barcode-scanner"]')) return;
    // Solo se lo scanner è il modal top
    const overlays = document.querySelectorAll('.modal-overlay');
    const top = overlays[overlays.length - 1] as HTMLElement | undefined;
    if (!top || top.dataset.modalId !== 'barcode-scanner') return;
    e.stopPropagation();
    e.preventDefault();
    cleanup();
    // cleanup() rimuove già escHandler, non serve rimuoverlo qui
  };
  document.addEventListener('keydown', escHandler, true);

  // Click handler: Annulla / ✕ / overlay background / toggleManual / submitManual
  overlay.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-scanner-action="cancel"]')) {
      cleanup();
      return;
    }
    if (target.closest('[data-scanner-action="toggleManual"]')) {
      const form = overlay.querySelector<HTMLElement>('[data-manual-form]');
      if (form) {
        const willShow = form.style.display === 'none';
        form.style.display = willShow ? 'flex' : 'none';
        if (willShow) {
          const input = form.querySelector<HTMLInputElement>('[data-manual-input]');
          input?.focus();
        }
      }
      return;
    }
    if (target.closest('[data-scanner-action="submitManual"]')) {
      const input = overlay.querySelector<HTMLInputElement>('[data-manual-input]');
      if (input) {
        const code = input.value.trim();
        // Fix LOW bug: validazione barcode manuale — accetta solo 6-14 cifre (EAN-8/13, UPC-A/E).
        // Prima qualsiasi stringa non vuota veniva inviata a OFF, sprecando una richiesta 404.
        if (code) {
          if (!/^\d{6,14}$/.test(code)) {
            statusEl.textContent = 'Codice non valido: inserisci 6-14 cifre (EAN/UPC).';
            statusEl.classList.add('scanner-status-error');
            input.focus();
            input.select();
            return;
          }
          finishWithBarcode(code);
        }
      }
      return;
    }
    // Click diretto sull'overlay (sfondo) → chiudi
    if (e.target === overlay) {
      cleanup();
    }
  });

  // Enter key nel manual input → submit
  overlay.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const target = e.target as HTMLElement;
    if (target.matches('[data-manual-input]')) {
      e.preventDefault();
      const input = target as HTMLInputElement;
      const code = input.value.trim();
      // Fix LOW bug: stessa validazione del click submitManual (6-14 cifre)
      if (code) {
        if (!/^\d{6,14}$/.test(code)) {
          statusEl.textContent = 'Codice non valido: inserisci 6-14 cifre (EAN/UPC).';
          statusEl.classList.add('scanner-status-error');
          input.focus();
          input.select();
          return;
        }
        finishWithBarcode(code);
      }
    }
  });

  // Avvia camera + detection
  void (async () => {
    try {
      stream = await startCameraStream();
      if (stopped) return; // cleanup avvenuto durante await getUserMedia
      video.srcObject = stream;
      // Attendi metadata + play
      let playFailed = false;
      await video.play().catch((e) => {
        // play() può fallire su iOS senza user gesture o se interrotto — logghiamo per debug
        console.warn('[scanner] video.play() failed:', e);
        playFailed = true;
      });
      if (stopped) return;
      if (playFailed) {
        // Fix LOW bug: se video.play() fallisce (es. iOS senza user gesture), non avviare
        // il loop di detection (non fire mai perché readyState < 2 perennemente) e informa
        // l'utente che deve inserire il codice manualmente.
        statusEl.textContent = 'Impossibile avviare la fotocamera. Inserisci il codice manualmente.';
        statusEl.classList.add('scanner-status-error');
        return;
      }
      statusEl.textContent = 'Inquadra il codice a barre…';

      // FIX: passa lo stream esistente a detectBarcodeFromVideo (evita double getUserMedia in ZXing)
      const barcode = await detectBarcodeFromVideo(stream, video, abortCtrl.signal);
      if (stopped) return; // cleanup durante detection
      if (barcode) {
        statusEl.textContent = `Codice rilevato: ${escapeHtml(barcode)}`;
        statusEl.classList.add('scanner-status-success');
        // Feedback aptico se supportato
        if (typeof navigator.vibrate === 'function') {
          try {
            navigator.vibrate(80);
          } catch {
            /* noop */
          }
        }
        // Delay per dare feedback visivo prima di chiudere
        setTimeout(() => {
          if (stopped) return;
          finishWithBarcode(barcode);
        }, 500);
      } else if (!abortCtrl.signal.aborted) {
        // Detection terminata senza risultato e senza abort — caso anomalo
        // Non chiudere: lascia l'opzione manuale disponibile
        statusEl.textContent = 'Nessun codice rilevato. Prova ad avvicinare il codice o inseriscilo manualmente.';
      }
    } catch (e) {
      if (stopped) return;
      const err = e instanceof Error ? e : new Error(String(e));
      const isDenied = err.name === 'NotAllowedError' || err.name === 'SecurityError';
      const isNotFound = err.name === 'NotFoundError' || err.name === 'OverconstrainedError';
      if (isDenied) {
        statusEl.textContent = 'Permesso fotocamera negato. Inserisci il codice manualmente.';
      } else if (isNotFound) {
        statusEl.textContent = 'Nessuna fotocamera trovata. Inserisci il codice manualmente.';
      } else {
        statusEl.textContent = `Errore fotocamera: ${err.message}. Puoi inserire il codice manualmente.`;
      }
      statusEl.classList.add('scanner-status-error');
      opts.onError?.(err);
      // FIX: NON chiudere automaticamente — lascia l'opzione manuale disponibile.
      // L'utente chiude con Annulla / ✕ / ESC quando vuole.
    }
  })();
}

/** Toast breve per device senza camera API. */
function showUnsupportedToast(): void {
  showModal({
    modalId: 'barcode-unsupported',
    title: 'Scanner non disponibile',
    bodyHtml:
      "<p>Il tuo browser non supporta l'accesso alla fotocamera oppure non dispone di una camera. Puoi comunque cercare i prodotti per nome.</p>",
    actions: [{ label: 'OK', action: 'close', variant: 'primary' }],
  });
}

/** Chiude forzatamente lo scanner (es. da altro codice). */
export function closeBarcodeScanner(): void {
  _activeScanner?.cleanup();
}
