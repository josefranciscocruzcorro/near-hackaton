import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers';

test.describe.configure({ mode: 'serial' });

test('owner runs the AI agent: routine bills settle, exceptions go to humans, the injected bill is not paid', async ({ page }) => {
  await loginAs(page, 'owner');
  await page.goto('/agent');
  await page.getByTestId('run-agent-button').click();

  const detail = page.getByTestId('agent-run-detail');
  // Real DeepSeek call: allow time for the model to plan.
  await expect(detail).toContainText(/Completed/i, { timeout: 110_000 });
  await expect(detail.getByTestId('policy-reason').first()).toBeVisible();
  await expect(detail).toContainText('ACR-2041');
  await expect(detail).toContainText('ACR-2042-URGENT');
  await expect(detail).toContainText(/Requires approval/);

  // Auto-approved payments are quoted with NEAR Intents and settle (Simulation).
  await page.goto('/payments');
  await expect(page.getByTestId('payment-row').filter({ hasText: 'ACR-2041' })).toContainText(/Settled/, { timeout: 60_000 });
});

test('owner runs a red-team drill: dangerous bills are blocked and no payment is created', async ({ page }) => {
  await loginAs(page, 'owner');
  await page.goto('/payments');
  const before = await page.getByTestId('payment-row').count();

  await page.goto('/agent');
  await page.getByTestId('run-drill').click();
  await expect(page.getByTestId('drill-notice')).toBeVisible({ timeout: 30_000 });
  const detail = page.getByTestId('agent-run-detail');
  await expect(detail).toContainText(/Blocked/);
  await expect(detail).toContainText(/Payee is not on the allowlist|not on the allowlist/i);

  await page.goto('/payments');
  await expect(page.getByTestId('payment-row')).toHaveCount(before);
});

test('approver approves one exception and rejects another with a reason', async ({ page }) => {
  await loginAs(page, 'approver');
  await page.goto('/approvals');
  const items = page.getByTestId('approval-item');
  await expect(items.first()).toBeVisible();
  const count = await items.count();
  expect(count).toBeGreaterThanOrEqual(2);

  // Reasoning card shows why a human is needed.
  await expect(items.first().getByTestId('policy-reason').first()).toBeVisible();

  // Reject requires a note.
  await items.nth(1).getByTestId('reject-button').click();
  await page.getByTestId('reject-note').fill('Address change not confirmed by phone.');
  await page.getByTestId('reject-confirm').click();
  await expect(page.getByTestId('toast').first()).toBeVisible();

  await items.first().getByTestId('approve-button').click();
  await expect(page.getByTestId('toast').first()).toBeVisible();
  await expect(page.getByTestId('approval-item')).toHaveCount(count - 2);

  await page.goto('/payments');
  await expect(page.getByTestId('payment-row').filter({ hasText: /Rejected/ })).toHaveCount(1);
});

test('auditor sees every action in the audit log', async ({ page }) => {
  await loginAs(page, 'auditor');
  await page.goto('/audit');
  const entries = page.getByTestId('audit-entry');
  await expect(entries.first()).toBeVisible();
  await expect(page.getByText(/approver@tesorero\.demo/).first()).toBeVisible();
  await expect(page.getByText(/Red-team drill/).first()).toBeVisible();
});
