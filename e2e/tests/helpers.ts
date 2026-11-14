import { expect, type Page } from '@playwright/test';

export type Role = 'owner' | 'approver' | 'auditor';

/** Logs in through the real login page using the one-click demo account buttons. */
export async function loginAs(page: Page, role: Role): Promise<void> {
  await page.goto('/login');
  await page.evaluate(() => {
    localStorage.setItem('tesorero.lang', 'en');
  });
  await page.getByTestId(`demo-login-${role}`).click();
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByTestId('user-menu-trigger')).toBeVisible();
}

export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'page must not scroll horizontally').toBeLessThanOrEqual(1);
}

/** Blocked actions stay visible but are aria-disabled with an explanation (GuardedButton). */
export async function expectBlocked(page: Page, testId: string): Promise<void> {
  const button = page.getByTestId(testId).first();
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute('aria-disabled', 'true');
}
