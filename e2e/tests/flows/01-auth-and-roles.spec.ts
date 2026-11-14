import { expect, test } from '@playwright/test';
import { expectBlocked, loginAs } from '../helpers';

test.describe('authentication', () => {
  test('wrong password shows an error and keeps the user on the login page', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('login-email').fill('owner@tesorero.demo');
    await page.getByTestId('login-password').fill('not-the-password');
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('login-error')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('protected pages redirect to login when signed out', async ({ page }) => {
    await page.goto('/payments');
    await expect(page).toHaveURL(/\/login/);
  });

  for (const role of ['owner', 'approver', 'auditor'] as const) {
    test(`${role} signs in with the demo button, sees the role and can sign out`, async ({ page }) => {
      await loginAs(page, role);
      await expect(page.getByTestId('user-menu-trigger')).toContainText(new RegExp(role, 'i'));
      await page.getByTestId('user-menu-trigger').click();
      await expect(page.getByTestId('user-role')).toContainText(new RegExp(role, 'i'));
      await page.getByTestId('logout-button').click();
      await expect(page).toHaveURL(/\/login/);
    });
  }
});

test.describe('role coherence (UI matches API permissions)', () => {
  test('auditor sees everything but every write action is blocked with an explanation', async ({ page }) => {
    await loginAs(page, 'auditor');
    await page.goto('/bills');
    await expectBlocked(page, 'new-bill-button');
    await expectBlocked(page, 'import-bill-button');
    await page.goto('/agent');
    await expectBlocked(page, 'run-agent-button');
    await expectBlocked(page, 'run-drill');
    await page.goto('/payees');
    await expectBlocked(page, 'new-payee-button');

    // Read + export are allowed.
    await page.goto('/payments');
    const download = page.waitForEvent('download');
    await page.getByTestId('export-csv-button').click();
    expect((await download).suggestedFilename()).toMatch(/^tesorero-payments-\d{8}\.csv$/);
  });

  test('approver can add bills but cannot manage payees, policy or the agent', async ({ page }) => {
    await loginAs(page, 'approver');
    await page.goto('/bills');
    await expect(page.getByTestId('new-bill-button')).not.toHaveAttribute('aria-disabled', 'true');
    await page.goto('/payees');
    await expectBlocked(page, 'new-payee-button');
    await page.goto('/agent');
    await expectBlocked(page, 'run-agent-button');
    await page.goto('/policies');
    await expect(page.getByTestId('policy-form')).toBeVisible();
    await expectBlocked(page, 'policy-save');
  });
});
