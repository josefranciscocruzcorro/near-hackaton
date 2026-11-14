import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers';

test('approver imports a malicious invoice with AI and sees the fraud warnings before saving', async ({ page }) => {
  await loginAs(page, 'approver');
  await page.goto('/bills');
  await page.getByTestId('import-bill-button').click();
  await page.getByTestId('sample-menu').click();
  await page.getByTestId('sample-malicious').click();
  await expect(page.getByTestId('bill-import-textarea')).not.toHaveValue('');
  await page.getByTestId('bill-import-extract').click();

  // Real DeepSeek extraction + deterministic detector.
  const warnings = page.getByTestId('extraction-warnings');
  await expect(warnings).toBeVisible({ timeout: 90_000 });
  await expect(warnings.getByTestId('extraction-flag-SuspiciousInstructions')).toBeVisible();
  await expect(warnings.getByTestId('extraction-flag-PaymentDetailsMismatch')).toBeVisible();

  // Saving a flagged bill requires an explicit acknowledgement.
  await page.getByTestId('extraction-ack').click();
  await page.getByTestId('extraction-confirm').click();
  await expect(page.getByTestId('toast').first()).toBeVisible();
});

test('a normal invoice is extracted cleanly', async ({ page }) => {
  await loginAs(page, 'owner');
  await page.goto('/bills');
  await page.getByTestId('import-bill-button').click();
  await page.getByTestId('sample-menu').click();
  await page.getByTestId('sample-normal').click();
  await page.getByTestId('bill-import-extract').click();
  await expect(page.getByTestId('extraction-review')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('extraction-clean')).toBeVisible();
  await expect(page.getByTestId('matched-payee')).toBeVisible();
});
