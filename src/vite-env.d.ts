/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// ============ BarcodeDetector API (Chromium/Android) ============
// Native API not yet in lib.dom.d.ts (Chrome 83+, Android WebView).
// On Safari iOS we fall back to @zxing/library (see src/lib/barcode.ts).

interface BarcodeDetectorOptions {
  formats?: string[];
}

interface DetectedBarcode {
  rawValue: string;
  format: string;
  boundingBox: DOMRectReadOnly;
  cornerPoints: { x: number; y: number }[];
}

declare class BarcodeDetector {
  constructor(options?: BarcodeDetectorOptions);
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
  static getSupportedFormats(): Promise<string[]>;
}

interface BarcodeDetectorConstructor {
  new (options?: BarcodeDetectorOptions): BarcodeDetector;
  getSupportedFormats(): Promise<string[]>;
}

interface Window {
  BarcodeDetector?: BarcodeDetectorConstructor;
}

// ============ requestVideoFrameCallback (Chromium) ============
// Used to schedule per-frame detection at the video's natural cadence
// instead of relying on requestAnimationFrame. Fallback to rAF in barcode.ts.

interface VideoFrameCallbackMetadata {
  presentationTime: number;
  expectedDisplayTime: number;
  width: number;
  height: number;
  mediaTime: number;
  presentedFrames: number;
  processingDuration?: number;
}

type VideoFrameRequestCallback = (now: number, metadata: VideoFrameCallbackMetadata) => void;

interface HTMLVideoElement {
  requestVideoFrameCallback?: (callback: VideoFrameRequestCallback) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
}
