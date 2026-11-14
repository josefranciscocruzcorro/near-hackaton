import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, loginAs } from './helpers';

const viewports = [
  { name: 'phone-360', width: 360, height: 800 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'laptop-1280', width: 1280, height: 800 },
  { name: 'desktop-1920', width: 1920, height: 1080 },
];

const pages = ['/', '/bills', '/approvals', '/payments', '/agent', '/payees', '/policies', '/audit', '/settings'];

for (const vp of viewports) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`${vp.name} ${scheme}: every page fits, has no serious a11y violations and is captured`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.emulateMedia({ colorScheme: scheme });
      await loginAs(page, 'owner');

      for (const path of pages) {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        await expect(page.locator('main')).toBeVisible();
        await expectNoHorizontalScroll(page);

        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`), `${path}`).toEqual([]);

        const name = path === '/' ? 'overview' : path.slice(1);
        await page.screenshot({ path: `screenshots/${vp.name}-${scheme}-${name}.png`, fullPage: true });
      }
    });
  }
}

test('login page is accessible and fits on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/login');
  await expectNoHorizontalScroll(page);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
  expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  await page.screenshot({ path: 'screenshots/phone-360-light-login.png', fullPage: true });
});
