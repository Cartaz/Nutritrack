// Test unitari per src/lib/api.ts
//
// Verifica la logica di retry con backoff per errori transitori (issue #1):
// - NetworkError (TypeError di fetch) → retry sulla stessa istanza, poi prossima
// - TimeoutError (abort interno) → retry sulla stessa istanza, poi prossima
// - HTTP 5xx → retry sulla stessa istanza, poi prossima
// - HTTP 429 → retry sulla stessa istanza, poi prossima
// - HTTP 4xx (non 429) → NO retry, propaga subito (errore del client)
// - navigator.onLine === false → OfflineError prima di fetch
// - AbortSignal esterno già aborted → AbortError prima di fetch
// - Successo al primo tentativo → nessun retry

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiGetJson, ApiError, isTransientError } from '../src/lib/api';

// Mock globale di fetch
const fetchMock = vi.fn();
globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

// navigator.onLine default true
Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

/** Helper: crea una Response mock minimale */
function mockResponse(status: number, body: unknown, contentType = 'application/json'): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': contentType }),
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('isTransientError', () => {
  it('classifica NetworkError come transitorio', () => {
    expect(isTransientError(new ApiError('Network', 'NetworkError'))).toBe(true);
  });

  it('classifica TimeoutError come transitorio', () => {
    expect(isTransientError(new ApiError('Timeout', 'TimeoutError'))).toBe(true);
  });

  it('classifica HTTP 5xx come transitorio', () => {
    expect(isTransientError(new ApiError('Server error', 'ApiError', 500))).toBe(true);
    expect(isTransientError(new ApiError('Server error', 'ApiError', 503))).toBe(true);
  });

  it('classifica HTTP 429 come transitorio', () => {
    expect(isTransientError(new ApiError('Rate limited', 'ApiError', 429))).toBe(true);
  });

  it('NON classifica HTTP 404 come transitorio', () => {
    expect(isTransientError(new ApiError('Not found', 'ApiError', 404))).toBe(false);
  });

  it('NON classifica HTTP 400 come transitorio', () => {
    expect(isTransientError(new ApiError('Bad request', 'ApiError', 400))).toBe(false);
  });

  it('classifica TypeError nativo come transitorio (network failure)', () => {
    expect(isTransientError(new TypeError('Failed to fetch'))).toBe(true);
  });
});

describe('apiGetJson - retry logic', () => {
  it('successo al primo tentativo: nessun retry', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, { ok: true }));

    const result = await apiGetJson(() => 'https://example.com/api');

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('network failure: retry sulla stessa istanza poi passa alla prossima', async () => {
    // Use fake timers to speed up the retry delay
    vi.useFakeTimers();

    // Istanza 1 attempt 1: network error
    // Istanza 1 attempt 2 (retry): network error
    // Istanza 2 attempt 1: success
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(mockResponse(200, { ok: true }));

    const promise = apiGetJson(() => 'https://example.com/api');

    // Avanza i timer per i retry delay (500ms × 1 = 500ms)
    await vi.advanceTimersByTimeAsync(600);

    const result = await promise;

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('HTTP 500: retry sulla stessa istanza, poi passa alla prossima', async () => {
    vi.useFakeTimers();

    fetchMock
      .mockResolvedValueOnce(mockResponse(500, { error: 'server' }))
      .mockResolvedValueOnce(mockResponse(500, { error: 'server' }))
      .mockResolvedValueOnce(mockResponse(200, { ok: true }));

    const promise = apiGetJson(() => 'https://example.com/api');

    await vi.advanceTimersByTimeAsync(600);
    const result = await promise;

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('HTTP 429 (rate limit): retry sulla stessa istanza, poi passa alla prossima', async () => {
    vi.useFakeTimers();

    fetchMock
      .mockResolvedValueOnce(mockResponse(429, { error: 'rate limited' }))
      .mockResolvedValueOnce(mockResponse(200, { ok: true }));

    const promise = apiGetJson(() => 'https://example.com/api');

    await vi.advanceTimersByTimeAsync(600);
    const result = await promise;

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('HTTP 404: NO retry, propaga subito', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(404, { error: 'not found' }, 'application/json'));

    await expect(apiGetJson(() => 'https://example.com/api')).rejects.toThrow();
    // Solo 1 chiamata: nessun retry su 4xx (eccetto 429)
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('HTTP 400: NO retry, propaga subito', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(400, { error: 'bad request' }, 'application/json'));

    await expect(apiGetJson(() => 'https://example.com/api')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('navigator.onLine === false: lancia OfflineError senza chiamare fetch', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

    await expect(apiGetJson(() => 'https://example.com/api')).rejects.toMatchObject({
      name: 'OfflineError',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('AbortSignal esterno già aborted: lancia AbortError senza chiamare fetch', async () => {
    const ctrl = new AbortController();
    ctrl.abort();

    await expect(
      apiGetJson(() => 'https://example.com/api', { signal: ctrl.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('AbortSignal esterno aborted durante retry: propaga AbortError', async () => {
    vi.useFakeTimers();

    const ctrl = new AbortController();
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const promise = apiGetJson(() => 'https://example.com/api', { signal: ctrl.signal });
    // Cattura subito per evitare unhandled rejection
    const catchPromise = promise.catch((e) => e);

    // Abortisce durante il retry delay (sleep viene interrotto → AbortError)
    setTimeout(() => ctrl.abort(), 100);
    await vi.advanceTimersByTimeAsync(200);

    const err = await catchPromise;
    expect(err).toMatchObject({ name: 'AbortError' });

    // Cleanup: lascia che tutte le promise pendenti vengano gestite
    await vi.advanceTimersByTimeAsync(1000);
  });

  it('tutte le istanze falliscono: lancia ultimo errore (NetworkError)', async () => {
    vi.useFakeTimers();

    // Tutte le istanze falliscono con network error (con retry)
    // OFF_INSTANCES ha 5 istanze × 2 tentativi = 10 fetch totali
    for (let i = 0; i < 10; i++) {
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    }

    const promise = apiGetJson(() => 'https://example.com/api');

    // Cattura esplicitamente per evitare unhandled rejection
    const catchPromise = promise.catch((e) => e);

    // Avanza timer per tutti i retry delay (5 istanze × 1 retry × 500ms = 2500ms)
    await vi.advanceTimersByTimeAsync(20_000);

    const err = await catchPromise;
    expect(err).toMatchObject({ name: 'NetworkError' });
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it('deadline globale rispettata: esce anche se ci sono istanze da provare', async () => {
    vi.useFakeTimers();

    // Mock Date.now per simulare il passare del tempo
    let fakeNow = 1_000_000;
    const realDateNow = Date.now;
    Date.now = vi.fn(() => fakeNow);

    // Avanza il tempo ad ogni fetch per simulare timeout lunghi
    fetchMock.mockImplementation(() => {
      fakeNow += 12_000; // ogni fetch "dura" 12s (oltre il timeout di 10s)
      return Promise.reject(new TypeError('Failed to fetch'));
    });

    const promise = apiGetJson(() => 'https://example.com/api');
    const catchPromise = promise.catch((e) => e);
    await vi.advanceTimersByTimeAsync(30_000);

    const err = await catchPromise;
    expect(err).toBeInstanceOf(Error);

    // Verifica che non abbia provato tutte e 5 le istanze (deadline 20s dovrebbe fermare prima)
    expect(fetchMock.mock.calls.length).toBeLessThan(10);

    Date.now = realDateNow;
  });

  it('response non-JSON su 200: passa alla prossima istanza', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse(200, '<html>not json</html>', 'text/html'))
      .mockResolvedValueOnce(mockResponse(200, { ok: true }));

    const result = await apiGetJson(() => 'https://example.com/api');

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('response 5xx non-JSON: passa alla prossima istanza', async () => {
    vi.useFakeTimers();

    fetchMock
      .mockResolvedValueOnce(mockResponse(503, '<html>error</html>', 'text/html'))
      .mockResolvedValueOnce(mockResponse(503, '<html>error</html>', 'text/html'))
      .mockResolvedValueOnce(mockResponse(200, { ok: true }));

    const promise = apiGetJson(() => 'https://example.com/api');
    const catchPromise = promise.then((v) => v).catch((e) => e);
    await vi.advanceTimersByTimeAsync(600);
    const result = await catchPromise;

    expect(result).toEqual({ ok: true });
  });
});

describe('apiGetJson - timeout behavior', () => {
  it('timeout interno su singola istanza: retry poi passa alla prossima', async () => {
    vi.useFakeTimers();

    // Helper: fetch che rejecta con AbortError quando il signal abortisce
    const hangingFetch = (_url: string, opts?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        const signal = opts?.signal as AbortSignal | undefined;
        if (signal) {
          if (signal.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
          }
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        }
      });

    // Istanza 1 attempt 1: hang → timeout → reject AbortError
    // Istanza 1 attempt 2 (retry): hang → timeout → reject AbortError
    // Istanza 2 attempt 1: success
    fetchMock
      .mockImplementationOnce(hangingFetch)
      .mockImplementationOnce(hangingFetch)
      .mockResolvedValueOnce(mockResponse(200, { ok: true }));

    const promise = apiGetJson(() => 'https://example.com/api', { timeoutMs: 100 });

    // Avanza il tempo per triggerare i timeout dei tentativi
    // Attempt 1: timeout 100ms
    await vi.advanceTimersByTimeAsync(150);
    // Retry delay: 500ms
    await vi.advanceTimersByTimeAsync(550);
    // Attempt 2: timeout 100ms
    await vi.advanceTimersByTimeAsync(150);

    const result = await promise;
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
