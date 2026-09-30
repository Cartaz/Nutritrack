import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSearchLimiterForTesting, searchOff } from '../src/lib/api';

const fetchMock = vi.fn();

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  __resetSearchLimiterForTesting();
});

describe('OFF textual search request budget', () => {
  it('allows service-worker cached search results while offline', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    fetchMock.mockResolvedValue(response(200, { count: 1, products: [{ product_name: 'Cached' }] }));
    expect((await searchOff('pasta')).count).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports offline cache misses without retrying', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    fetchMock.mockResolvedValue(response(503, {}));
    await expect(searchOff('pasta')).rejects.toMatchObject({ name: 'OfflineError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not consume search slots for operations aborted before sending', async () => {
    const controller = new AbortController();
    controller.abort();
    for (let i = 0; i < 10; i++) {
      await expect(searchOff('pasta', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    }
    fetchMock.mockResolvedValue(response(200, { count: 0, products: [] }));
    await expect(searchOff('pasta')).resolves.toMatchObject({ count: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses exactly one HTTP request for one search action', async () => {
    fetchMock.mockResolvedValue(response(200, { count: 0, page: 1, page_size: 30, products: [] }));
    await searchOff('pasta');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not evade a 429 by retrying or switching host', async () => {
    fetchMock.mockResolvedValue(response(429, {}));
    await expect(searchOff('pasta')).rejects.toMatchObject({ name: 'RateLimitError', status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('blocks the tenth client-side search inside a rolling minute', async () => {
    fetchMock.mockResolvedValue(response(200, { count: 0, page: 1, page_size: 30, products: [] }));
    for (let i = 0; i < 9; i++) await searchOff(`pasta-${i}`);
    await expect(searchOff('pasta-9')).rejects.toMatchObject({ name: 'RateLimitError', status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(9);
  });
});
