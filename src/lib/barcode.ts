// Barcode scanner: native BarcodeDetector API (Chrome/Android) con fallback
// dinamico a @zxing/library per Safari iOS dove BarcodeDetector non è disponibile.
//
// P0 #2 della roadmap hobbistica.
//
// Pattern:
// - detectBarcodeFromVideo(stream, video, signal) → Promise<string | null>
// - Tenta native BarcodeDetector prima (più veloce, niente bundle weight su Chrome)
// - Fallback a ZXing via dynamic import (caricato solo se necessario)
// - Cleanup garantito via AbortSignal: caller può cancellare in qualsiasi momento
//
// Formati target: EAN-13, EAN-8, UPC-A, UPC-E (codici a barre prodotto alimentari)
// Code-128 / Code-39 inclusi come fallback per prodotti non alimentari.
//
// FIX (post-P0): due bug causavano "scanner bloccato in modalità scansione":
//  1. ZXing: decodeFromVideoDevice(null, ...) chiamava getUserMedia una seconda
//     volta, creando un conflitto con lo stream già attaccato al <video>. Su iOS
//     questo faceva sì che la callback di decode non venisse mai invocata.
//     FIX: usare decodeFromStream(stream, video, ...) che riusa lo stream esistente.
//  2. Native: requestVideoFrameCallback non fire affidabilmente su tutti i setup
//     (es. Chrome desktop con webcam USB). Il loop di detection si bloccava.
//     FIX: usare setInterval(200ms) — meno elegante ma sempre affidabile.

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
      const detector = new window.BarcodeDetector({ formats: [...PREFERRED_FORMATS] });
      console.debug('[barcode] native BarcodeDetector created with formats');
      return detector;
    } catch (e) {
      console.debug('[barcode] native BarcodeDetector formats rejected, fallback to default', e);
      return new window.BarcodeDetector();
    }
  } catch (e) {
    console.warn('[barcode] native BarcodeDetector constructor failed', e);
    return null;
  }
}

/** Loop di detection nativa via setInterval.
 *  Più affidabile di requestVideoFrameCallback che su alcuni setup (Chrome desktop
 *  con webcam USB) non fire mai, lasciando il loop bloccato. */
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
    let frameCount = 0;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const stop = (): void => {
      if (stopped) return;
      stopped = true;
      signal.removeEventListener('abort', onAbort);
      if (intervalId !== null) clearInterval(intervalId);
    };
    const onAbort = (): void => stop();
    signal.addEventListener('abort', onAbort, { once: true });

    intervalId = setInterval(async () => {
      if (stopped || signal.aborted) return;
      // Aspetta che il video abbia frame reali (readyState >= 2 + dimensioni > 0)
      if (video.readyState < 2 || video.videoWidth === 0) return;
      frameCount++;
      if (frameCount % 15 === 0) {
        console.debug(`[barcode] native: frame #${frameCount}, video ${video.videoWidth}x${video.videoHeight}, readyState=${video.readyState}`);
      }
      try {
        const results = await detector.detect(video);
        if (stopped || signal.aborted) return;
        if (results && results.length > 0 && results[0].rawValue) {
          const value = results[0].rawValue;
          const format = results[0].format;
          console.debug(`[barcode] native DETECTED: "${value}" (format: ${format})`);
          stop();
          resolve(value);
          return;
        }
      } catch (e) {
        // Non-fatal: log periodico per debug
        if (frameCount % 15 === 0) {
          console.debug('[barcode] native detect error (non-fatal):', e);
        }
      }
    }, 200); // 5 detections/sec — bilanciamento reattività / CPU
  });
}

// ============ ZXing fallback (Safari iOS + qualsiasi browser senza BarcodeDetector) ============

/** Carica @zxing/library dinamicamente solo quando serve.
 *  FIX: usa decodeFromStream(stream, video, callback) invece di decodeFromVideoDevice.
 *  decodeFromVideoDevice chiamava getUserMedia una seconda volta, creando un conflitto
 *  con lo stream già attaccato. decodeFromStream riusa lo stream esistente. */
async function detectWithZxing(
  stream: MediaStream,
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
  // 200ms = timeBetweenScansMillis (ritardo tra decode SUCCESSIVE, non tra tentativi)
  const reader = new BrowserMultiFormatReader(hints, 200);
  console.debug('[barcode] using ZXing (decodeFromStream)');

  return new Promise<string | null>((resolve, reject) => {
    if (signal.aborted) {
      resolve(null);
      return;
    }
    let stopped = false;
    let stoppedCallback = false;
    let frameCount = 0;

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

    // decodeFromStream(stream, video, callback) — riusa lo stream esistente,
    // NON chiama getUserMedia. La callback fire per ogni tentativo di decode
    // (con result se trovato, con err se non trovato — err è normale).
    reader
      .decodeFromStream(stream, video, (result, err) => {
        if (stopped) return;
        frameCount++;
        if (frameCount % 15 === 0) {
          console.debug(`[barcode] zxing: frame #${frameCount}`);
        }
        if (result) {
          const text = result.getText();
          if (text) {
            console.debug(`[barcode] zxing DETECTED: "${text}"`);
            stopped = true;
            signal.removeEventListener('abort', onAbort);
            stopReader();
            resolve(text);
          }
        }
        void err; // err non usato: errori per-frame sono normali in ZXing continuous mode
      })
      .then(() => {
        console.debug('[barcode] zxing decodeFromStream started OK');
        if (signal.aborted) {
          stopReader();
        }
      })
      .catch((e: unknown) => {
        if (stopped) return;
        signal.removeEventListener('abort', onAbort);
        console.error('[barcode] zxing error:', e);
        reject(e instanceof Error ? e : new Error(String(e)));
      });
  });
}

// ============ Public API ============

/** Avvia la detection del barcode dal video element.
 *  - stream: MediaStream già ottenuto dal caller (evita double getUserMedia in ZXing)
 *  - video: <video> con srcObject già impostato sullo stream
 *  - signal: AbortSignal per cancellare
 *
 *  Risolve con il testo del barcode al primo rilevamento.
 *  Risolve con null se abortito via signal.
 *  Reject su errore irrecuperabile (es. backend non disponibile).
 *
 *  Strategia: prova native BarcodeDetector; se non disponibile o se ritorna null
 *  senza abort, fallback a ZXing. */
export async function detectBarcodeFromVideo(
  stream: MediaStream,
  video: HTMLVideoElement,
  signal: AbortSignal
): Promise<string | null> {
  // Path nativo
  if (hasNativeBarcodeDetector()) {
    console.debug('[barcode] trying native BarcodeDetector');
    try {
      const result = await detectWithNative(video, signal);
      if (result) return result;
      // Se abortito durante native, non tentare ZXing (evita camera re-init).
      if (signal.aborted) return null;
      console.debug('[barcode] native returned null without abort, falling back to ZXing');
    } catch (e) {
      console.warn('[barcode] native BarcodeDetector failed, falling back to ZXing', e);
    }
  }
  // Fallback ZXing
  return detectWithZxing(stream, video, signal);
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
