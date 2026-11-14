import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers';

test.describe.configure({ mode: 'serial' });

test('the public demo says so and never offers Live mode', async ({ page }) => {
  await loginAs(page, 'owner');
  await expect(page.getByTestId('demo-banner')).toBeVisible();
  await page.goto('/settings');
  await expect(page.getByTestId('instance-card')).toBeVisible();
  await expect(page.getByTestId('mode-live-locked')).toBeVisible();
  await expect(page.getByTestId('mode-live')).toBeDisabled();
});

test('owner invites a user who can sign in; deactivating them ends their session at once', async ({ page, browser }) => {
  const email = `e2e-${Date.now()}@example.com`;
  const password = 'E2e-temporary-pass-1';

  await loginAs(page, 'owner');
  await page.goto('/users');
  await page.getByTestId('invite-user-button').click();
  await page.getByTestId('user-email').fill(email);
  await page.getByTestId('user-name').fill('E2E Approver');
  await page.getByTestId('user-password').fill(password);
  await page.getByTestId('user-form-submit').click();
  const row = page.getByTestId('users-row').filter({ hasText: email });
  await expect(row).toBeVisible();

  // The new user signs in from another browser context.
  const other = await browser.newContext();
  const userPage = await other.newPage();
  await userPage.goto('/login');
  await userPage.getByTestId('login-email').fill(email);
  await userPage.getByTestId('login-password').fill(password);
  await userPage.getByTestId('login-submit').click();
  await expect(userPage).not.toHaveURL(/\/login/);

  // Owner deactivates them → their next request is rejected and they land on the login page.
  await row.getByTestId('edit-user-button').click();
  await page.getByTestId('user-active-toggle').click();
  await page.getByTestId('user-form-submit').click();
  await expect(row).toContainText(/Inactive/i);

  await userPage.goto('/payments');
  await expect(userPage).toHaveURL(/\/login/, { timeout: 15_000 });
  await other.close();
});

test('on the public demo the shared accounts are protected: their password cannot be changed', async ({ page }) => {
  await loginAs(page, 'auditor');
  await page.getByTestId('user-menu-trigger').click();
  await page.getByTestId('change-password-button').click();
  await page.getByTestId('change-password-current').fill('Demo!2026');
  await page.getByTestId('change-password-new').fill('Auditor-new-pass-2026');
  await page.getByTestId('change-password-confirm').fill('Auditor-new-pass-2026');
  await page.getByTestId('change-password-submit').click();
  await expect(page.getByTestId('change-password-error')).toContainText(/read-only on the public demo/i);
  await expect(page).not.toHaveURL(/\/login/);
});

test('owner resets the public demo and the sample bills are back', async ({ page }) => {
  await loginAs(page, 'owner');
  await page.goto('/settings');
  await page.getByTestId('reset-demo-button').click();
  await page.getByTestId('reset-demo-confirm').click();
  await expect(page.getByTestId('toast').first()).toBeVisible();

  await page.goto('/payments');
  await expect(page.getByTestId('payment-row')).toHaveCount(2);
  await page.goto('/agent');
  await expect(page.getByTestId('agent-run-item')).toHaveCount(0);
});
