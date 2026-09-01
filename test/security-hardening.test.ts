import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { showModal } from '../src/components/modal';
import { imgTag } from '../src/components/img';
import { initImageFallback } from '../src/components/imageFallback';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('modal content boundary', () => {
  it('renders bodyText as text instead of executable markup', () => {
    const payload = '<img src=x onerror="globalThis.__modalXss = true"><strong>unsafe</strong>';

    const overlay = showModal({
      modalId: 'safe-text',
      title: '<Unsafe title>',
      bodyText: payload,
      actions: [],
    });

    const body = overlay.querySelector<HTMLElement>('.modal-body');
    expect(body?.textContent).toBe(payload);
    expect(body?.querySelector('img')).toBeNull();
    expect(body?.querySelector('strong')).toBeNull();
    expect(overlay.querySelector('.modal-title')?.textContent).toBe('<Unsafe title>');
  });

  it('renders rich internal markup only through trustedBodyHtml', () => {
    const overlay = showModal({
      modalId: 'trusted-html',
      title: 'Trusted',
      trustedBodyHtml: '<strong data-test="trusted">contenuto</strong>',
      actions: [],
    });

    expect(overlay.querySelector('[data-test="trusted"]')?.textContent).toBe('contenuto');
  });
});

describe('image fallback boundary', () => {
  it('emits no inline JavaScript handlers', () => {
    const html = imgTag('https://images.openfoodfacts.org/example.jpg', 'Prodotto', 'thumb', '🥫');

    expect(html).toContain('data-fallback=');
    expect(html).not.toMatch(/\son\w+=/i);
  });

  it('replaces a zero-width loaded image through the delegated listener', () => {
    initImageFallback();
    const image = document.createElement('img');
    image.className = 'thumb';
    image.dataset.fallback = '🥫';
    document.body.appendChild(image);

    image.dispatchEvent(new Event('load'));

    const placeholder = document.querySelector<HTMLElement>('.thumb-placeholder');
    expect(placeholder?.textContent).toBe('🥫');
    expect(document.body.contains(image)).toBe(false);
  });

  it('replaces an image that emits an error through the same owner', () => {
    initImageFallback();
    const image = document.createElement('img');
    image.className = 'thumb';
    image.dataset.fallback = '✏️';
    document.body.appendChild(image);

    image.dispatchEvent(new Event('error'));

    const placeholder = document.querySelector<HTMLElement>('.thumb-placeholder');
    expect(placeholder?.textContent).toBe('✏️');
    expect(document.body.contains(image)).toBe(false);
  });
});

describe('content security policy', () => {
  it('keeps script execution and network destinations constrained', () => {
    const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    const match = indexHtml.match(/http-equiv="Content-Security-Policy"[\s\S]*?content="([^"]+)"/);
    expect(match).not.toBeNull();
    const policy = match?.[1] ?? '';

    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).toContain("style-src 'self' 'unsafe-inline'");

    for (const origin of [
      'https://it.openfoodfacts.org',
      'https://world.openfoodfacts.org',
      'https://fr.openfoodfacts.org',
      'https://es.openfoodfacts.org',
      'https://de.openfoodfacts.org',
    ]) {
      expect(policy).toContain(origin);
    }
  });
});
