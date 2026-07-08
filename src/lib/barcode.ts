// Barcode scanner: native BarcodeDetector API (Chrome/Android) con fallback
// dinamico a @zxing/library per Safari iOS dove BarcodeDetector non è disponibile.
//
// P0 #2 della roadmap hobbistica.
//
// Pattern:
// - detectBarcodeFromVideo(video, signal) → Promise<string | null>
// - Tenta native BarcodeDetector prima (più veloce, niente bundle weight su Chrome)
// - Fallback a ZXing via dynamic import (caricato solo se necessario)
// - Cleanup garantito via AbortSignal: caller può cancellare in qualsiasi momento
//
// Formati target: EAN-13, EAN-8, UPC-A, UPC-E (codici a barre prodotto alimentari)
// Code-128 / Code-39 inclusi come fallback per prodotti non alimentari.

/** Formati preferiti per scanner prodotto (alimentari). */
const PREFERRED_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'] as const;

/** True se BarcodeDetector nativa è disponibile (Chrome/Android). */
export function hasNativeBarcodeDetector(): boolean {
  return typeof window !== 'undefined' && typeof window.BarcodeDetector === 'function';
}

/** True se l'API fotocamera (getUserMedia) è disponibile. Necessaria per qualsiasi scanner. */
export function isCameraAvailable(): boolean {
  return typeof navigator !== 'undefined'
    && !!navigator.mediaDevices
    && typeof navigator.mediaDevices.getUserMedia === 'function';
}

/** Verifica se lo scanner può funzionare su questo device (camera + almeno un backend). */
export function isBarcodeScanSupported(): boolean {
  // ZXing è sempre disponibile come fallback (dynamic import), quindi basta la camera.
  return isCameraAvailable();
}

// ============ Native BarcodeDetector (Chrome/Android) ============

async function createNativeDetector(): Promise<BarcodeDetector | null> {
  if (!hasNativeBarcodeDetector() || !window.BarcodeDetector) return null;
  try {
    // Alcuni browser supportano BarcodeDetector ma non l'argomento `formats`.
    // Proviamo prima con formats, fallback a constructor senza options.
    try {
      return new window.BarcodeDetector({ formats: [...PREFERRED_FORMATS] });
    } catch {
      return new window.BarcodeDetector();
    }
  } catch {
    return null;
  }
}

/** Loop di detection nativa via requestVideoFrameCallback (fallback rAF). */
async function detectWithNative(
  video: HTMLVideoElement,
  signal: AbortSignal
): Promise<string | null> {
  const detector = await createNativeDetector();
  if (!detector) return null;

  return new Promise<string | null>((resolve) => {
    if (signal.aborted) {
      resolve(null);
      return;
    }
    let stopped = false;

    const stop = () => {
      if (stopped) return;
      stopped = true;
      signal.removeEventListener('abort', onAbort);
      resolve(null);
    };
    const onAbort = () => stop();
    signal.addEventListener('abort', onAbort, { once: true });

    const tick = async (): Promise<void> => {
      if (stopped || signal.aborted) return;
      // video.readyState >= 2 = HAVE_CURRENT_DATA, evita errori detect su frame vuoto
      if (video.readyState < 2) {
        scheduleNext();
        return;
      }
      try {
        const results = await detector.detect(video);
        if (stopped || signal.aborted) return;
        if (results && results.length > 0 && results[0].rawValue) {
          stopped = true;
          signal.removeEventListener('abort', onAbort);
          resolve(results[0].rawValue);
          return;
        }
      } catch {
        // Frame errori transitori (video pausa, frame vuoto): ignora e continua.
      }
      scheduleNext();
    };

    const scheduleNext = (): void => {
      if (stopped || signal.aborted) return;
      if (typeof video.requestVideoFrameCallback === 'function') {
        video.requestVideoFrameCallback(() => { void tick(); });
      } else {
        requestAnimationFrame(() => { void tick(); });
      }
    };

    // Avvia il loop
    void tick();
  });
}

// ============ ZXing fallback (Safari iOS + qualsiasi browser senza BarcodeDetector) ============

/** Carica @zxing/library dinamicamente solo quando serve.
 *  ZXing API note:
 *   - decodeFromVideoDevice(deviceId, video, callback) → Promise<void>
 *   - Per stoppare: reader.stopContinuousDecode() + reader.reset()
 *   - callback signature: (result: Result, error?: Exception) => any
 *     error viene emesso per ogni frame senza codice rilevato (normale, ignora)
 */
async function detectWithZxing(
  video: HTMLVideoElement,
  signal: AbortSignal
): Promise<string | null> {
  const mod = await import('@zxing/library');
  const BrowserMultiFormatReader = mod.BrowserMultiFormatReader;
  const DecodeHintType = mod.DecodeHintType;

  // Hint: limita ai formati prodotto per ridurre falsi positivi e velocizzare.
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    'EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'CODE_128', 'CODE_39',
  ]);
  // tryHarder disattivato per ridurre latenza per-frame su mobile.
  const reader = new BrowserMultiFormatReader(hints, 200);

  return new Promise<string | null>((resolve, reject) => {
    if (signal.aborted) {
      resolve(null);
      return;
    }
    let stopped = false;
    let stoppedCallback = false;

    const stopReader = (): void => {
      if (stoppedCallback) return;
      stoppedCallback = true;
      try { reader.stopContinuousDecode(); } catch { /* noop */ }
      try { reader.reset(); } catch { /* noop */ }
    };
    const onAbort = (): void => {
      if (stopped) return;
      stopped = true;
      stopReader();
      resolve(null);
    };
    signal.addEventListener('abort', onAbort, { once: true });

    // decodeFromVideoDevice restituisce Promise<void>; il callback viene invocato
    // per ogni frame decodificato (result) o con errore (err, normale frame senza codice).
    reader
      .decodeFromVideoDevice(null, video, (result, err) => {
        if (stopped) return;
        // err è normale: ZXing emette errore per ogni frame senza codice rilevato.
        if (result) {
          const text = result.getText();
          if (text) {
            stopped = true;
            signal.removeEventListener('abort', onAbort);
            stopReader();
            resolve(text);
          }
        }
        void err; // err non usato: errori per-frame sono normali in ZXing continuous mode
      })
      .then(() => {
        // decodeFromVideoDevice resolved: stream avviato correttamente.
        // Se nel frattempo è stato abortito, fermiamo subito.
        if (signal.aborted) {
          stopReader();
        }
      })
      .catch((e: unknown) => {
        if (stopped) return;
        signal.removeEventListener('abort', onAbort);
        reject(e instanceof Error ? e : new Error(String(e)));
      });
  });
}

// ============ Public API ============

/** Avvia la detection del barcode dal video element.
 *  - Risolve con il testo del barcode al primo rilevamento.
 *  - Risolve con null se abortito via signal.
 *  - Reject su errore irrecuperabile (es. backend non disponibile).
 *
 *  Strategia: prova native BarcodeDetector; se non disponibile o se ritorna null
 *  senza abort, fallback a ZXing. */
export async function detectBarcodeFromVideo(
  video: HTMLVideoElement,
  signal: AbortSignal
): Promise<string | null> {
  // Path nativo
  if (hasNativeBarcodeDetector()) {
    try {
      const result = await detectWithNative(video, signal);
      if (result) return result;
      // Se abortito durante native, non tentare ZXing (evita camera re-init).
      if (signal.aborted) return null;
    } catch (e) {
      console.warn('[barcode] native BarcodeDetector failed, falling back to ZXing', e);
    }
  }
  // Fallback ZXing
  return detectWithZxing(video, signal);
}

/** Richiede la camera posteriore (facingMode environment). */
export async function startCameraStream(): Promise<MediaStream> {
  if (!isCameraAvailable()) {
    throw new Error('Camera API non disponibile in questo browser');
  }
  return navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  });
}
