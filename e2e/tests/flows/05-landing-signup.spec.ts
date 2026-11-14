import fs from 'node:fs';
import { expect, test } from '@playwright/test';

// Multitenancy (ADR-0006): the landing lives on the base domain, each organization on its own subdomain.
const LANDING = process.env.E2E_LANDING_URL ?? 'http://localhost:4173';
const API_LOG = process.env.E2E_API_LOG;

/** Without SMTP the API logs e-mails; read the newest link for this address from the log. */
function linkFromLog(email: string, marker: string): string {
  if (!API_LOG) throw new Error('E2E_API_LOG is not set (run through run-local.sh)');
  const log = fs.readFileSync(API_LOG, 'utf8');
  const blocks = log.split('E-mail to ').filter((b) => b.startsWith(email));
  const last = blocks.at(-1) ?? '';
  const match = last.match(new RegExp(`https?://\\S*${marker.replace(/[?]/g, '\\?')}\\S*`));
  if (!match) throw new Error(`no ${marker} link for ${email}`);
  return match[0];
}

/** E-mails are queued (Hangfire) and sent a moment after the request: wait for the link to show up. */
async function waitForLink(email: string, marker: string): Promise<string> {
  let link = '';
  await expect
    .poll(() => {
      try {
        link = linkFromLog(email, marker);
        return true;
      } catch {
        return false;
      }
    }, { timeout: 20_000 })
    .toBe(true);
  return link;
}

test.describe.configure({ mode: 'serial' });

const slug = `bakery-${Date.now().toString(36)}`;
const email = `ana@${slug}.example`;

test('the landing presents the product, the videos and the live demo', async ({ page }) => {
  await page.goto(LANDING);
  await expect(page.getByTestId('landing-hero')).toBeVisible();
  await expect(page.getByTestId('landing-video')).toBeVisible();
  await page.getByTestId('video-tab-es').click();
  await expect(page.getByTestId('landing-video')).toHaveAttribute('src', /tesorero-demo-es\.mp4/);
  await expect(page.getByTestId('landing-demo-link').first()).toHaveAttribute('href', /demo\.localhost/);
});

test('a business signs up: subdomain and NEAR account are checked live, then the e-mail is verified', async ({ page }) => {
  await page.goto(`${LANDING}/#signup`);
  await page.getByTestId('signup-org').fill('Panadería E2E');
  await page.getByTestId('signup-slug').fill(slug);
  await expect(page.getByTestId('signup-slug-status')).toContainText(/available|disponible/i);
  await page.getByTestId('signup-name').fill('Ana Sol');
  await page.getByTestId('signup-email').fill(email);

  // Real NEAR mainnet lookup through the API.
  await page.getByTestId('signup-near').fill('this-account-does-not-exist-e2e.near');
  await expect(page.getByTestId('signup-near-status')).toContainText(/not found|no existe|doesn|not exist/i, { timeout: 20_000 });
  await page.getByTestId('signup-near').fill('cruzespejose.near');
  await expect(page.getByTestId('signup-near-status')).toContainText(/exists|existe|found|encontrad/i, { timeout: 20_000 });

  await page.getByTestId('signup-terms').check();
  await page.getByTestId('signup-submit').click();
  await expect(page.getByTestId('signup-success')).toContainText(email);

  // Nothing exists before the e-mail is verified.
  const before = await page.request.get(`${LANDING}/api/signup/slug?value=${slug}`);
  expect((await before.json()).available).toBe(true);

  await page.goto(await waitForLink(email, '/verify?token='));
  await expect(page.getByTestId('verify-success')).toContainText(slug);
});

test('the owner sets up the organization with the e-mailed one-time link and starts clean', async ({ page }) => {
  const setup = await waitForLink(email, '/setup?token=');
  expect(setup).toContain(`${slug}.localhost`);
  await page.goto(setup);
  await expect(page.getByTestId('setup-org')).toHaveValue('Panadería E2E');
  await page.getByTestId('setup-name').fill('Ana Sol');
  await page.getByTestId('setup-email').fill(email);
  await page.getByTestId('setup-password').fill('Panaderia-E2E-2026!');
  await page.getByTestId('setup-confirm').fill('Panaderia-E2E-2026!');
  await page.getByTestId('setup-submit').click();
  await expect(page).not.toHaveURL(/\/setup/);

  // Isolation: the new organization sees none of the demo's payees or bills.
  await page.goto(`http://${slug}.localhost:4173/payees`);
  await expect(page.getByTestId('payee-row')).toHaveCount(0);
  await page.goto(`http://${slug}.localhost:4173/settings`);
  await expect(page.getByTestId('agent-account')).toContainText(/[0-9a-f]{10}/);
});

test('the new owner gets a getting-started checklist and prepares the treasury with one NEAR deposit address', async ({ page }) => {
  const org = `http://${slug}.localhost:4173`;
  await page.goto(`${org}/login`);
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill('Panaderia-E2E-2026!');
  await page.getByTestId('login-submit').click();
  await expect(page).not.toHaveURL(/\/login/);

  // A fresh organization is guided step by step.
  await expect(page.getByTestId('onboarding-checklist')).toBeVisible();
  await expect(page.getByTestId('onboarding-item-treasury')).toBeVisible();

  // Treasury: the three accounts are explained, and the owner prepares the contract (real NEAR mainnet lookup of the wallet).
  await page.goto(`${org}/treasury`);
  await expect(page.getByTestId('treasury-accounts')).toBeVisible();
  await page.getByTestId('setup-owner').fill('this-wallet-does-not-exist-e2e.near');
  await page.getByTestId('setup-max').fill('50');
  await page.getByTestId('setup-daily').fill('100');
  await page.getByTestId('setup-submit').click();
  await expect(page.getByTestId('setup-form')).toContainText(/does not exist|no existe/i, { timeout: 20_000 });

  await page.getByTestId('setup-owner').fill('cruzespejose.near');
  await page.getByTestId('setup-submit').click();
  await expect(page.getByTestId('setup-fund')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('setup-fund-address')).toContainText(/[0-9a-f]{64}/);
  await expect(page.getByTestId('setup-fund-qr')).toBeVisible();
  await expect(page.getByTestId('setup-received')).toBeVisible();

  // Funding is only offered once the treasury exists and is locked.
  await expect(page.getByTestId('fund-button')).toHaveCount(0);
});
