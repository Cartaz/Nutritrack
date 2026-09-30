import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  matchPrecache: vi.fn(),
  networkHandle: vi.fn(),
  setCatchHandler: vi.fn(),
  navigation: vi.fn(),
  registerRoute: vi.fn(),
}));

vi.mock('workbox-precaching', () => ({
  precacheAndRoute: vi.fn(),
  cleanupOutdatedCaches: vi.fn(),
  matchPrecache: mocks.matchPrecache,
}));
vi.mock('workbox-core', () => ({ clientsClaim: vi.fn() }));
vi.mock('workbox-routing', () => ({
  NavigationRoute: class {
    constructor(handler: unknown) {
      mocks.navigation(handler);
    }
  },
  registerRoute: mocks.registerRoute,
  setCatchHandler: mocks.setCatchHandler,
}));
vi.mock('workbox-strategies', () => ({
  NetworkFirst: class {
    handle = mocks.networkHandle;
  },
  CacheFirst: class {},
}));
vi.mock('workbox-expiration', () => ({ ExpirationPlugin: class {} }));
vi.mock('workbox-cacheable-response', () => ({ CacheableResponsePlugin: class {} }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal('self', { registration: { scope: 'https://example.test/Nutritrack/' }, addEventListener: vi.fn() });
});

afterEach(() => vi.unstubAllGlobals());

describe('production service worker fallbacks', () => {
  it('resolves the revisioned precache shell relative to the deployed scope', async () => {
    await import('../src/sw');
    const shell = new Response('<html>NutriTrack</html>');
    mocks.networkHandle.mockRejectedValue(new Error('offline'));
    mocks.matchPrecache.mockResolvedValue(shell);
    const handler = mocks.navigation.mock.calls[0][0];
    expect(await handler({ request: { destination: 'document' } })).toBe(shell);
    expect(mocks.matchPrecache).toHaveBeenCalledWith('https://example.test/Nutritrack/index.html');
  });

  it('uses HTML only for navigation, never for failed API or image requests', async () => {
    await import('../src/sw');
    const shell = new Response('<html>NutriTrack</html>');
    mocks.matchPrecache.mockResolvedValue(shell);
    const handler = mocks.setCatchHandler.mock.calls[0][0];
    expect(await handler({ request: { destination: 'document' } })).toBe(shell);
    mocks.matchPrecache.mockClear();
    for (const destination of ['', 'image', 'script']) {
      const response = await handler({ request: { destination } });
      expect(response.status).toBe(503);
      expect(await response.text()).toBe('Offline');
    }
    expect(mocks.matchPrecache).not.toHaveBeenCalled();
  });
});
