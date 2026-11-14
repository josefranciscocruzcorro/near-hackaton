import { chromium } from '@playwright/test';
const DEMO = 'http://localhost:4173';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1920, height: 972 }, serviceWorkers: 'block' });
await context.addInitScript(() => localStorage.setItem('tesorero.lang', 'en'));
const page = await context.newPage();
page.setDefaultTimeout(5000);
await page.goto(`${DEMO}/login`);
await page.getByTestId('demo-login-owner').click();
await page.waitForURL((u) => !u.pathname.startsWith('/login'));
await page.goto(`${DEMO}/payees`);
await page.getByTestId('new-payee-button').click();
const dlg = page.getByRole('dialog');
const steps = [
  ['name', () => dlg.getByLabel('Name', { exact: false }).first().fill('Quito Bakery')],
  ['email', () => dlg.getByLabel('Email', { exact: false }).first().fill('pagos@quitobakery.example')],
  ['token-search', () => page.getByTestId('token-search').fill('base')],
  ['token-select box', () => page.getByTestId('token-select').boundingBox().then((b) => console.log('   box', JSON.stringify(b)))],
  ['token-select value', () => page.getByTestId('token-select').locator('option', { hasText: /USDC/ }).first().getAttribute('value').then((v) => { console.log('   value', v); return page.getByTestId('token-select').selectOption(v); })],
  ['recipient', () => page.getByTestId('payee-recipient').fill('0x12345')],
  ['allowlisted box', () => page.getByTestId('payee-allowlisted').boundingBox().then((b) => console.log('   box', JSON.stringify(b)))],
];
for (const [n, f] of steps) { try { await f(); console.log('ok', n); } catch (e) { console.log('FAIL', n, e.message.split('\n')[0]); } }
await page.screenshot({ path: process.env.PROBE_OUT + '/probe-payee2.png' });
await page.goto(`${DEMO}/payments`);
await browser.close();
