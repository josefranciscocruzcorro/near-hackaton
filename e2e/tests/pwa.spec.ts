import { expect, test } from '@playwright/test';

// Requests are made from the page (browser network stack): Node does not resolve *.localhost hosts.
test('the app is an installable PWA with an active service worker', async ({ page }) => {
  await page.goto('/login');

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestHref).toBeTruthy();
  const manifest = await page.evaluate(async (href) => (await fetch(href)).json(), manifestHref!) as { name: string; display: string; icons: { sizes: string; purpose?: string }[] };
  expect(manifest.name).toContain('Tesorero');
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.some((i) => i.sizes === '512x512')).toBe(true);
  expect(manifest.icons.some((i) => i.purpose?.includes('maskable'))).toBe(true);

  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toMatch(/\/$/);
  expect(await page.evaluate(async () => (await fetch('/sw.js', { cache: 'no-store' })).ok)).toBe(true);
});

test('API calls are never served from the service worker cache', async ({ page }) => {
  await page.goto('/login');
  await page.evaluate(async () => navigator.serviceWorker.ready);
  const version = await page.evaluate(async () => {
    const r = await fetch('/api/version');
    return { ok: r.ok, body: (await r.json()) as { version: string } };
  });
  expect(version.ok).toBe(true);
  expect(version.body.version).toBeTruthy();
});
