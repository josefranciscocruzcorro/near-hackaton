// Diagnostic helper for the video script: reproduces a flow and saves screenshots.
import { chromium } from '@playwright/test';

const OUT = process.env.PROBE_OUT ?? '.';
const DEMO = 'http://localhost:4173';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1920, height: 972 } });
await context.addInitScript(() => localStorage.setItem('tesorero.lang', 'en'));
const page = await context.newPage();
page.on('console', (m) => console.log('console:', m.type(), m.text().slice(0, 160)));
page.on('pageerror', (e) => console.log('pageerror:', e.message));

await page.goto(`${DEMO}/login`);
await page.getByTestId('demo-login-owner').click();
await page.waitForURL((u) => !u.pathname.startsWith('/login'));

// (a) payee form
await page.goto(`${DEMO}/payees`);
await page.getByTestId('new-payee-button').click();
await page.waitForTimeout(800);
const dialogs = page.getByRole('dialog');
console.log('dialogs:', await dialogs.count());
const name = dialogs.getByLabel('Name', { exact: false });
console.log('name fields:', await name.count());
for (let i = 0; i < (await name.count()); i++) console.log('  name', i, await name.nth(i).evaluate((e) => `${e.tagName} ${e.id} visible=${e.offsetParent !== null}`));
await page.screenshot({ path: `${OUT}/probe-payee.png` });

// (b) phone frame
await context.route(`${DEMO}/__phone`, (r) => r.fulfill({ contentType: 'text/html', body: `<iframe id="app" src="${DEMO}/" style="width:390px;height:844px"></iframe>` }));
await page.goto(`${DEMO}/__phone`);
await page.waitForTimeout(4000);
const frame = page.frames().find((f) => f.url().startsWith(DEMO) && f !== page.mainFrame());
console.log('iframe url:', frame?.url());
console.log('tabs in frame:', await page.frameLocator('#app').locator('[data-testid^="tab-"]').count());
await page.screenshot({ path: `${OUT}/probe-phone.png` });
await browser.close();
