// Records the Tesorero story as high-quality JPEG frames (CDP screencast) with a visible cursor.
// Each scene lasts at least as long as its longest narration (EN/ES) so one recording serves both languages.
// Usage: VIDEO_WORK=<dir> node video/record.mjs [fromSceneId]
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const WORK = process.env.VIDEO_WORK;
if (!WORK) throw new Error('VIDEO_WORK is required');
const scenes = JSON.parse(fs.readFileSync(path.join(HERE, 'scenes.json'), 'utf8'));
const durations = JSON.parse(fs.readFileSync(path.join(WORK, 'durations.json'), 'utf8'));
// Production addresses, served by the local stack (stack.sh): the browser never leaves this machine.
const BASE = 'tesorero.gesco.ec';
const LANDING = `https://${BASE}`;
const DEMO = `https://demo.${BASE}`;
const ORG_SLUG = 'panaderia-sol';
const ORG = `https://${ORG_SLUG}.${BASE}`;
const ORG_EMAIL = 'ana@panaderiasol.example';
const API = 'http://localhost:5080';
const DIST = path.join(ROOT, 'frontend', 'dist');
const MEDIA = path.join(ROOT, 'media');
const MAIL = path.join(WORK, 'mail');
const VW = 1920;
const VH = 972;

const FRAMES = path.join(WORK, 'frames');
fs.rmSync(FRAMES, { recursive: true, force: true });
fs.mkdirSync(FRAMES, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const issues = [];
const note = (msg) => {
  issues.push(msg);
  console.log('  ! ' + msg);
};

// ---------- visible cursor (top layer, survives modal dialogs) ----------
const CURSOR = `(() => {
  if (window.__demoCursor) return; window.__demoCursor = true;
  const install = () => {
    const c = document.createElement('div');
    c.id = '__demo_cursor';
    c.setAttribute('popover', 'manual');
    c.innerHTML = '<svg width="30" height="30" viewBox="0 0 30 30" style="display:block"><path d="M4 2 L4 24 L9.8 18.6 L13.6 27 L17.4 25.3 L13.6 17.2 L21.4 17.2 Z" fill="#0b0b0c" stroke="#ffffff" stroke-width="1.8" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: 'fixed', inset: 'auto', left: '0px', top: '0px', margin: '0', padding: '0', border: '0', background: 'transparent', overflow: 'visible', pointerEvents: 'none', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.35))', transform: 'translate(-4px,-2px)' });
    document.documentElement.appendChild(c);
    const show = () => { try { if (c.matches(':popover-open')) c.hidePopover(); c.showPopover(); } catch {} };
    show();
    let p = { x: 960, y: 520 };
    try { p = JSON.parse(sessionStorage.getItem('__cur') || 'null') || p; } catch {}
    const place = (x, y) => { c.style.left = x + 'px'; c.style.top = y + 'px'; };
    place(p.x, p.y);
    if (window !== window.top) c.style.display = 'none';
    addEventListener('mousemove', (e) => {
      c.style.display = 'block';
      place(e.clientX, e.clientY);
      try { sessionStorage.setItem('__cur', JSON.stringify({ x: e.clientX, y: e.clientY })); } catch {}
      if (window !== window.top) { try { window.top.postMessage({ __cursor: 'hide' }, '*'); } catch {} }
    }, true);
    addEventListener('message', (e) => { if (e.data && e.data.__cursor === 'hide') c.style.display = 'none'; });
    addEventListener('mousedown', () => {
      const r = document.createElement('div');
      Object.assign(r.style, { position: 'absolute', left: '-15px', top: '-16px', width: '36px', height: '36px', borderRadius: '50%', border: '3px solid #0E9F6E', background: 'rgba(14,159,110,.28)', transform: 'scale(.35)', opacity: '1', transition: 'transform .5s ease-out, opacity .5s ease-out' });
      c.appendChild(r);
      requestAnimationFrame(() => requestAnimationFrame(() => { r.style.transform = 'scale(1.7)'; r.style.opacity = '0'; }));
      setTimeout(() => r.remove(), 650);
    }, true);
    // Keep the cursor above dialogs and toasts, which also live in the top layer.
    new MutationObserver(show).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['open'], childList: true });
  };
  if (document.documentElement) install(); else document.addEventListener('DOMContentLoaded', install);
})();`;

// ---------- cards ----------
const card = (body) => `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;font-family:Inter,'Segoe UI',system-ui,sans-serif;background:#0b0b0c;color:#f5f5f4}
  .wrap{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;text-align:center;
    background:radial-gradient(1200px 600px at 50% 40%, rgba(52,211,153,.18), transparent 70%)}
  .logo{width:96px;height:96px;border-radius:24px;background:#34D399;color:#0b0b0c;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:54px}
  h1{margin:0;font-size:88px;letter-spacing:-.03em} h2{margin:0;font-size:34px;font-weight:500;color:#d4d4d8;max-width:1300px;line-height:1.35}
  .tag{font-size:22px;color:#a1a1aa;letter-spacing:.08em;text-transform:uppercase}
  .flow{display:flex;align-items:stretch;gap:18px;margin-top:10px}
  .box{width:250px;padding:22px 18px;border-radius:16px;background:#141416;border:1px solid #26262a;text-align:left}
  .box b{display:block;font-size:22px;margin-bottom:8px;color:#34D399} .box span{font-size:18px;color:#d4d4d8;line-height:1.4}
  .arrow{align-self:center;font-size:34px;color:#52525b} .chain{border-color:#34D399;box-shadow:0 0 0 1px #34D399 inset}
  #__demo_cursor{display:none!important}
</style></head><body><div class="wrap">${body}</div></body></html>`;

const TITLE = card(`<div class="logo">T</div><h1>Tesorero</h1>
  <h2>An AI treasurer that pays your suppliers on any chain, only inside the rules you set.</h2>
  <div class="tag">tesorero.gesco.ec · USDC on NEAR · NEAR Intents · one private organization per business</div>`);
const CONTRACT = card(`<h2 style="font-size:40px;color:#f5f5f4">Two layers of guardrails</h2>
  <div class="flow">
    <div class="box"><b>1 · AI agent</b><span>Reads invoices and proposes today's payments, with its reasoning.</span></div><div class="arrow">→</div>
    <div class="box"><b>2 · Policy engine</b><span>Deterministic rules: limits, budgets, allowlist, cool-down, reserve.</span></div><div class="arrow">→</div>
    <div class="box"><b>3 · Humans</b><span>Approve or reject the exceptions, by role.</span></div><div class="arrow">→</div>
    <div class="box chain"><b>4 · Treasury contract</b><span>On NEAR: agent-only pay, per-payment and daily caps, no duplicates, pause.</span></div><div class="arrow">→</div>
    <div class="box"><b>5 · NEAR Intents</b><span>Delivers USDC, USDT or SOL on the payee's chain.</span></div>
  </div>
  <div class="tag" style="margin-top:18px">Even a compromised server can move at most the on-chain daily limit</div>`);
const CLOSING = card(`<div class="logo">T</div><h1>Tesorero</h1>
  <h2>The AI proposes · the rules decide · humans approve the exceptions · NEAR Intents pays on any chain.</h2>
  <div class="tag">Try it at tesorero.gesco.ec · Built at NEAR HACKATHON</div>`);
const PHONE = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:#f5f5f4;font-family:Inter,'Segoe UI',system-ui,sans-serif}
  .stage{height:100%;display:flex;align-items:center;justify-content:center;gap:90px}
  .phone{width:414px;height:870px;border-radius:56px;background:#0b0b0c;padding:13px;box-shadow:0 30px 80px rgba(0,0,0,.25)}
  iframe{width:390px;height:844px;border:0;border-radius:44px;background:#fff;display:block}
  .side{max-width:520px} .side h3{font-size:44px;margin:0 0 14px;color:#1c1917;letter-spacing:-.02em} .side p{font-size:24px;color:#57534e;line-height:1.45;margin:0}
</style></head><body><div class="stage">
  <div class="phone"><iframe id="app" src="${DEMO}/"></iframe></div>
  <div class="side"><h3>Installable PWA</h3><p>Same app on any phone. Updates itself with every release, works in light and dark mode, English and Spanish.</p></div>
</div></body></html>`;

// ---------- Ana's wallet, off camera (local NEAR network started by stack.sh) ----------
function wallet(...args) {
  const out = execFileSync('bash', [path.join(ROOT, 'e2e', 'sandbox', 'wallet.sh'), ...args], {
    env: { ...process.env, SANDBOX_ENV: path.join(WORK, 'usdc.env') }, encoding: 'utf8', timeout: 300_000,
  });
  console.log('  wallet', args.join(' '), '->', out.trim().split('\n').at(-1));
}

// ---------- mail view (the exact e-mails the API saved in <work>/mail) ----------
const escapeHtml = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function mailsTo(to) {
  if (!fs.existsSync(MAIL)) return [];
  return fs.readdirSync(MAIL).filter((f) => f.endsWith('.json')).sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(MAIL, f), 'utf8')))
    .filter((m) => m.To === to);
}
async function waitForMail(to, marker) {
  for (let i = 0; i < 60; i++) {
    const hit = mailsTo(to).filter((m) => m.Html.includes(marker)).at(-1);
    if (hit) return hit;
    await sleep(500);
  }
  throw new Error(`no e-mail with ${marker} for ${to}`);
}
const MAIL_PAGE = (mails, open) => `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;font-family:Inter,'Segoe UI',system-ui,sans-serif;background:#eef0f3;color:#1c1917}
  .app{display:grid;grid-template-columns:240px 420px 1fr;height:100%}
  .side{background:#1f2937;color:#e5e7eb;padding:26px 18px} .side h1{font-size:22px;margin:0 0 26px;letter-spacing:-.01em}
  .side div{padding:10px 12px;border-radius:8px;font-size:16px;margin-bottom:4px} .side .on{background:#374151;font-weight:600}
  .list{background:#fff;border-right:1px solid #e5e7eb;overflow:hidden} .list h2{font-size:15px;color:#6b7280;margin:0;padding:22px 22px 12px;text-transform:uppercase;letter-spacing:.06em}
  .item{padding:16px 22px;border-top:1px solid #f1f5f9} .item.sel{background:#ecfdf5;box-shadow:inset 3px 0 0 #047857}
  .item b{display:block;font-size:16px} .item span{display:block;font-size:15px;color:#374151;margin-top:4px} .item small{color:#9ca3af;font-size:13px}
  .read{padding:34px 48px;overflow:auto} .meta{background:#fff;border-radius:12px;padding:22px 26px;margin-bottom:18px;border:1px solid #e5e7eb}
  .meta h3{margin:0 0 10px;font-size:24px} .meta div{font-size:15px;color:#4b5563;line-height:1.6}
  .body{background:#fff;border-radius:12px;border:1px solid #e5e7eb;padding:8px 10px}
</style></head><body><div class="app">
  <div class="side"><h1>Mail</h1><div class="on">Inbox</div><div>Starred</div><div>Sent</div><div>Archive</div></div>
  <div class="list"><h2>Inbox</h2>${mails.slice().reverse().map((m) => `<div class="item ${m === open ? 'sel' : ''}"><b>Tesorero</b><span>${escapeHtml(m.Subject)}</span><small>just now</small></div>`).join('')}</div>
  <div class="read"><div class="meta"><h3>${escapeHtml(open.Subject)}</h3>
    <div><b>From:</b> Tesorero &lt;no-reply@${BASE}&gt;</div><div><b>To:</b> ${escapeHtml(open.To)}</div></div>
    <div class="body" data-testid="mail-body">${open.Html}</div></div>
</div></body></html>`;

// ---------- local router: https://*.tesorero.gesco.ec → frontend/dist + API (Host header kept) ----------
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain' };
function apiRequest(route, url) {
  const req = route.request();
  return new Promise((resolve, reject) => {
    const body = req.postDataBuffer();
    const headers = { ...req.headers(), host: url.host };
    delete headers['content-length'];
    if (body) headers['content-length'] = String(body.length);
    const r = http.request(`${API}${url.pathname}${url.search}`, { method: req.method(), headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}
async function serve(route) {
  const url = new URL(route.request().url());
  const p = decodeURIComponent(url.pathname);
  if (p.startsWith('/api/') || p === '/health') {
    const res = await apiRequest(route, url);
    const headers = Object.fromEntries(Object.entries(res.headers)
      .filter(([k]) => !['transfer-encoding', 'connection', 'content-length'].includes(k))
      .map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v)]));
    return route.fulfill({ status: res.status, headers, body: res.body });
  }
  if (p === '/__card/title') return route.fulfill({ contentType: 'text/html', body: TITLE });
  if (p === '/__card/contract') return route.fulfill({ contentType: 'text/html', body: CONTRACT });
  if (p === '/__card/closing') return route.fulfill({ contentType: 'text/html', body: CLOSING });
  if (p === '/__phone') return route.fulfill({ contentType: 'text/html', body: PHONE });
  if (p.startsWith('/__mail/')) {
    const kind = p.split('/')[2];
    const open = await waitForMail(ORG_EMAIL, kind === 'verify' ? '/verify?token=' : '/setup?token=');
    return route.fulfill({ contentType: 'text/html', body: MAIL_PAGE(mailsTo(ORG_EMAIL), open) });
  }
  if (p.startsWith('/media/')) {
    const file = path.join(MEDIA, path.basename(p));
    if (fs.existsSync(file) && !file.endsWith('.mp4')) return route.fulfill({ path: file, contentType: TYPES[path.extname(file)] ?? 'application/octet-stream' });
    return route.fulfill({ status: 404, body: '' });
  }
  const file = path.join(DIST, p);
  if (p !== '/' && fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({ path: file, contentType: TYPES[path.extname(file)] ?? 'application/octet-stream' });
  return route.fulfill({ path: path.join(DIST, 'index.html'), contentType: 'text/html' });
}

// ---------- browser ----------
const browser = await chromium.launch({ headless: true, args: ['--force-device-scale-factor=1', '--hide-scrollbars'] });
// Service workers are blocked: the PWA's navigation fallback would otherwise swallow the /__card and /__phone pages.
const context = await browser.newContext({ viewport: { width: VW, height: VH }, locale: 'en-US', colorScheme: 'light', acceptDownloads: true, serviceWorkers: 'block' });
await context.addInitScript(CURSOR);
await context.addInitScript(() => { try { if (!localStorage.getItem('tesorero.lang')) localStorage.setItem('tesorero.lang', 'en'); } catch {} });
await context.route((u) => u.hostname === BASE || u.hostname.endsWith(`.${BASE}`), (r) => serve(r).catch((e) => { note(`router: ${e.message}`); return r.abort(); }));
const page = await context.newPage();
page.setDefaultTimeout(30_000);
page.on('pageerror', (e) => note(`page error: ${e.message}`));
// 4xx answers are expected in the story (validation, demo protection): only page errors and 5xx are issues.
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_ABORTED|status of 4\d\d/.test(m.text())) note(`console error: ${m.text().slice(0, 200)}`); });
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) note(`HTTP ${r.status()} ${r.url()}`); });

const cdp = await context.newCDPSession(page);
const frames = [];
let frameNo = 0;
cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
  const n = ++frameNo;
  const file = `${String(n).padStart(6, '0')}.jpg`;
  fs.writeFileSync(path.join(FRAMES, file), Buffer.from(data, 'base64'));
  frames.push({ file, t: metadata.timestamp });
  try { await cdp.send('Page.screencastFrameAck', { sessionId }); } catch {}
});

// ---------- mouse helpers ----------
let mouse = { x: 960, y: 520 };
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
async function moveToXY(x, y, ms) {
  const from = { ...mouse };
  const dist = Math.hypot(x - from.x, y - from.y);
  const duration = ms ?? Math.min(900, Math.max(280, dist * 0.9));
  const steps = Math.max(10, Math.round(duration / 16));
  for (let i = 1; i <= steps; i++) {
    const k = ease(i / steps);
    await page.mouse.move(from.x + (x - from.x) * k, from.y + (y - from.y) * k);
    await sleep(duration / steps);
  }
  mouse = { x, y };
}
async function center(locator) {
  await locator.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
  const b = await locator.boundingBox({ timeout: 8000 }).catch(() => null);
  if (!b) throw new Error(`not visible: ${locator}`);
  return { x: b.x + b.width / 2, y: b.y + Math.min(b.height / 2, 22) };
}
async function moveTo(locator, ms) {
  const p = await center(locator);
  await moveToXY(p.x, p.y, ms);
}
async function click(locator) {
  await moveTo(locator);
  await sleep(140);
  await page.mouse.down();
  await sleep(80);
  await page.mouse.up();
  await sleep(250);
}
async function hover(locator, ms = 1100) {
  try {
    await moveTo(locator);
    await sleep(ms);
  } catch (e) {
    note(`hover failed: ${e.message.split('\n')[0]}`);
  }
}
async function type(locator, text, delay = 38) {
  await click(locator);
  await locator.pressSequentially(text, { delay });
}
async function scroll(dy, ms = 1200) {
  const steps = Math.max(8, Math.round(ms / 40));
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, dy / steps);
    await sleep(ms / steps);
  }
}
const tid = (id) => page.getByTestId(id);
const first = (l) => l.first();
async function nav(id) {
  const link = tid(`nav-${id}`);
  await click(link);
  await page.waitForLoadState('networkidle').catch(() => {});
  await sleep(500);
}
async function logout() {
  await click(tid('user-menu-trigger'));
  await sleep(400);
  await click(tid('logout-button'));
  await page.waitForURL(/\/login/);
  await sleep(500);
}
async function loginAs(role) {
  await click(tid(`demo-login-${role}`));
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await page.waitForLoadState('networkidle').catch(() => {});
  await sleep(600);
}
async function toast() {
  await tid('toast').first().waitFor({ timeout: 15_000 }).catch(() => note('expected a toast'));
}

// ---------- scenes ----------
const timeline = [];
const idles = [];
let t0 = 0;
/** Marks the silent wait after a scene's narration (e.g. the AI thinking) so compose.py cuts it out. */
function trimWait(ctx, doneAtMs) {
  const narrationEnd = ctx.start + ctx.minMs;
  if (doneAtMs - narrationEnd > 3000) idles.push({ from: (narrationEnd + 600) / 1000 - t0, to: (doneAtMs - 1200) / 1000 - t0 });
}
const actions = {
  's01-title': async () => {
    await page.goto(`${LANDING}/__card/title`);
    await moveToXY(1700, 900, 600);
  },
  's02-landing': async () => {
    await page.goto(LANDING);
    await tid('landing-hero').waitFor();
    await sleep(600);
    await hover(tid('hero-visual'), 1500);
    await scroll(760, 1200);
    await hover(tid('video-tab-es'), 900);
    await hover(tid('video-tab-en'), 600);
    for (let i = 0; i < 3; i++) {
      await scroll(820, 1100);
      await sleep(400);
    }
    await scroll(-6000, 1000);
    await hover(first(tid('landing-demo-link')), 700);
  },
  's03-login': async () => {
    await click(first(tid('landing-demo-link')));
    await page.waitForURL(/demo\.tesorero\.gesco\.ec\/login/);
    await page.waitForLoadState('networkidle').catch(() => {});
    await sleep(1400);
    for (const r of ['owner', 'approver', 'auditor']) await hover(tid(`demo-login-${r}`), 900);
    await sleep(900);
    await loginAs('owner');
  },
  's04-overview': async () => {
    for (const text of ['Spent today', 'Spent this month', 'Pending approvals']) await hover(first(page.getByText(text, { exact: false })), 1300);
    await hover(first(page.getByText('Category budgets')), 1200);
    await scroll(520, 1600);
    await sleep(1500);
    await scroll(-520, 1200);
  },

  's05-palette': async () => {
    await page.keyboard.press('Control+k');
    await sleep(700);
    await page.keyboard.type('pay', { delay: 120 });
    await sleep(700);
    await click(first(tid('palette-option-nav-payees')));
    await page.waitForURL(/\/payees/);
  },

  's06-payees': async () => {
    await sleep(600);
    for (const name of ['Andes Coffee Roasters', 'María López Studio', 'Kai Nakamura', 'Lumen Cloud']) await hover(first(tid('payee-row').filter({ hasText: name })), 1200);
    await hover(first(tid('payee-row').filter({ hasText: 'Pacific Freight' })), 2600);
    await hover(first(tid('payee-row').filter({ hasText: 'Brightline' })), 1500);
  },

  's07-payee-invalid': async () => {
    await click(tid('new-payee-button'));
    await sleep(500);
    const dlg = page.getByRole('dialog');
    await type(dlg.getByLabel('Name', { exact: false }).first(), 'Quito Bakery');
    await type(dlg.getByLabel('Email', { exact: false }).first(), 'pagos@quitobakery.example', 25);
    await hover(tid('token-picker'), 1200);
    // Native USDC on Base (Circle), from the recommended group.
    await click(page.locator('[data-testid="token-option"]:has(input[value="nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near"])'));
    await sleep(500);
    await type(tid('payee-recipient'), '0x12345');
    await hover(tid('payee-allowlisted'), 900);
    await click(tid('payee-form-submit'));
    await sleep(2500);
  },

  's08-payee-valid': async () => {
    const rec = tid('payee-recipient');
    await click(rec);
    await rec.fill('');
    await rec.pressSequentially('0x4b8f2a91c3d7e6f05a1b9c8d7e6f5a4b3c2d1e0f', { delay: 22 });
    await sleep(500);
    await click(tid('payee-form-submit'));
    await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => note('payee dialog did not close'));
    await sleep(800);
    await hover(first(tid('payee-row').filter({ hasText: 'Quito Bakery' })), 1800);
  },

  's09-import-normal': async () => {
    await nav('bills');
    await click(tid('import-bill-button'));
    await sleep(500);
    await click(tid('sample-menu'));
    await sleep(400);
    await click(tid('sample-normal'));
    await sleep(1200);
    await click(tid('bill-import-extract'));
  },

  's10-extraction-clean': async () => {
    await tid('extraction-review').waitFor({ timeout: 90_000 });
    await sleep(600);
    await hover(tid('extraction-clean'), 1500);
    await hover(tid('matched-payee'), 1500);
    await click(tid('extraction-confirm'));
    await toast();
  },

  's11-import-malicious': async () => {
    await click(tid('import-bill-button'));
    await sleep(500);
    await click(tid('sample-menu'));
    await sleep(400);
    await click(tid('sample-malicious'));
    await sleep(800);
    await scroll(250, 900);
    await sleep(1200);
    await click(tid('bill-import-extract'));
  },

  's12-warnings': async () => {
    await tid('extraction-warnings').waitFor({ timeout: 90_000 });
    await hover(tid('extraction-flag-SuspiciousInstructions'), 2600);
    await hover(tid('extraction-flag-PaymentDetailsMismatch'), 2600);
    await click(tid('extraction-ack'));
    await sleep(500);
    await click(tid('extraction-confirm'));
    await toast();
  },

  's13-policies': async () => {
    await nav('policies');
    const inputs = tid('policy-form').locator('input[type="number"], input[inputmode="decimal"], input[inputmode="numeric"]');
    const n = Math.min(await inputs.count(), 7);
    for (let i = 0; i < n; i++) await hover(inputs.nth(i), 900);
    await scroll(500, 1400);
    await sleep(1200);
    await scroll(-500, 1000);
  },

  's14-agent-run': async (ctx) => {
    await nav('agent');
    await click(tid('run-agent-button'));
    await tid('agent-run-detail').filter({ hasText: /Completed/ }).waitFor({ timeout: 150_000 }).catch(() => note('agent run did not complete'));
    trimWait(ctx, Date.now());
  },

  's15-agent-results': async () => {
    await sleep(600);
    await hover(first(tid('agent-run-detail')), 1200);
    for (let i = 0; i < 6; i++) {
      await scroll(380, 1300);
      await sleep(1500);
    }
    await scroll(-2300, 1500);
  },

  's16-payments': async () => {
    await nav('payments');
    await sleep(800);
    await hover(first(tid('payment-row').filter({ hasText: 'Settled' })), 1400);
    await click(first(tid('payment-row').filter({ hasText: 'ACR-2041' })).or(first(tid('payment-row').filter({ hasText: 'Settled' }))).first());
    await tid('payment-detail').waitFor({ timeout: 15_000 }).catch(() => note('payment detail did not open'));
  },

  's17-payment-detail': async () => {
    await sleep(500);
    await hover(tid('quote-out'), 2200);
    await hover(tid('decision-info'), 2000);
    await scroll(300, 800);
    await sleep(1500);
    await page.keyboard.press('Escape');
    await sleep(500);
  },

  's18-drill': async () => {
    await nav('agent');
    await click(tid('run-drill'));
    await tid('drill-notice').waitFor({ timeout: 60_000 }).catch(() => note('drill notice missing'));
  },

  's19-drill-results': async () => {
    await sleep(500);
    await hover(tid('drill-notice'), 1500);
    for (let i = 0; i < 4; i++) {
      await scroll(380, 1200);
      await sleep(1400);
    }
    await scroll(-1600, 1200);
  },

  's20-approver': async () => {
    await logout();
    await loginAs('approver');
    await nav('approvals');
    await hover(first(tid('approval-item')), 1500);
    await hover(first(tid('policy-reason')), 1500);
  },

  's21-approve': async () => {
    const item = tid('approval-item').filter({ hasText: 'MLS-007' });
    const target = (await item.count()) > 0 ? item.first() : first(tid('approval-item'));
    if ((await item.count()) === 0) note('MLS-007 was not in the approvals inbox');
    await hover(target, 1200);
    await click(target.getByTestId('approve-button'));
    await toast();
    await sleep(800);
  },

  's22-reject': async () => {
    const item = tid('approval-item').filter({ hasText: 'PFC-889' });
    const target = (await item.count()) > 0 ? item.first() : first(tid('approval-item'));
    if ((await item.count()) === 0) note('PFC-889 was not in the approvals inbox');
    await click(target.getByTestId('reject-button'));
    await sleep(500);
    await type(tid('reject-note'), 'New address not confirmed by phone yet.', 30);
    await sleep(400);
    await click(tid('reject-confirm'));
    await toast();
  },

  's23-approver-limits': async () => {
    await nav('payees');
    await hover(tid('new-payee-button'), 2600);
    await nav('agent');
    await hover(tid('run-agent-button'), 2600);
  },

  's24-auditor': async () => {
    await logout();
    await loginAs('auditor');
    await nav('payments');
    await hover(first(tid('payment-row')), 1100);
    await hover(tid('payment-row').nth(1), 1000);
    const dl = page.waitForEvent('download', { timeout: 15_000 }).catch(() => note('no CSV download'));
    await click(tid('export-csv-button'));
    await dl;
    await sleep(800);
  },

  's25-audit-log': async () => {
    await nav('audit');
    await hover(first(tid('audit-entry')), 1200);
    for (let i = 0; i < 4; i++) {
      await scroll(420, 1300);
      await sleep(1100);
    }
  },

  's26-demo-protected': async () => {
    await scroll(-3000, 600);
    await click(tid('user-menu-trigger'));
    await sleep(400);
    await click(tid('change-password-button'));
    await sleep(500);
    await type(tid('change-password-current'), 'Demo!2026', 40);
    await type(tid('change-password-new'), 'Lucia-new-pass-2026', 30);
    await type(tid('change-password-confirm'), 'Lucia-new-pass-2026', 30);
    await click(tid('change-password-submit'));
    await tid('change-password-error').waitFor({ timeout: 10_000 }).catch(() => note('demo password protection message missing'));
    await hover(tid('change-password-error'), 1600);
    await page.keyboard.press('Escape');
  },

  's27-users': async () => {
    await logout();
    await loginAs('owner');
    await nav('users');
    await sleep(500);
    await click(tid('invite-user-button'));
    await sleep(500);
    await type(tid('user-email'), 'tomas@laceiba.example', 16);
    await type(tid('user-name'), 'Tomás Vega', 24);
    await click(tid('user-role-select'));
    await tid('user-role-select').selectOption('Auditor');
    await click(tid('user-password-generate'));
    await sleep(900);
    await click(tid('user-form-submit'));
    await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => note('invite dialog did not close'));
    await hover(first(tid('users-row').filter({ hasText: 'tomas@laceiba.example' })), 1200);
  },

  's28-deactivate': async () => {
    const row = first(tid('users-row').filter({ hasText: 'tomas@laceiba.example' }));
    await click(row.getByTestId('edit-user-button'));
    await sleep(500);
    await click(tid('user-active-toggle'));
    await sleep(400);
    await click(tid('user-form-submit'));
    await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => note('edit dialog did not close'));
    await hover(row, 1800);
  },

  's29-kill-switch': async () => {
    await nav('overview');
    await sleep(500);
    await click(first(tid('stop-payments-button')));
    await tid('stop-payments-dialog').waitFor({ timeout: 10_000 }).catch(() => note('no stop confirmation'));
    await sleep(1400);
    await click(tid('stop-payments-dialog-confirm'));
    await tid('payments-stopped-banner').waitFor({ timeout: 10_000 }).catch(() => note('no stopped banner'));
    await hover(tid('payments-stopped-banner'), 2200);
    await click(tid('banner-resume-button'));
    await tid('resume-payments-dialog').waitFor({ timeout: 10_000 }).catch(() => {});
    await sleep(800);
    await click(tid('resume-payments-dialog-confirm')).catch(() => note('no resume confirmation'));
    await sleep(800);
  },

  's30-settings': async () => {
    await nav('settings');
    await hover(tid('instance-card'), 1800);
    await hover(tid('mode-live-locked'), 2200);
    await moveTo(tid('danger-zone'));
    await sleep(1000);
    await click(tid('reset-demo-button'));
    await sleep(700);
    await click(tid('reset-demo-confirm'));
    await toast();
  },

  's31-language-theme': async () => {
    await nav('overview');
    await click(tid('language-toggle'));
    await sleep(2200);
    await click(tid('theme-toggle'));
    await sleep(2200);
    await click(tid('language-toggle'));
    await sleep(900);
    await click(tid('theme-toggle'));
  },

  's32-mobile': async () => {
    await page.goto(`${DEMO}/__phone`);
    const app = page.frameLocator('#app');
    await app.getByTestId('tab-overview').waitFor({ timeout: 20_000 }).catch(() => note('phone frame did not load the app'));
    await sleep(1200);
    for (const tab of ['approvals', 'payments', 'bills', 'overview']) {
      await click(app.getByTestId(`tab-${tab}`));
      await sleep(1700);
    }
  },
  's33-signup': async () => {
    await page.goto(`${LANDING}/#signup`);
    await tid('signup-form').waitFor();
    await sleep(600);
    await moveTo(tid('signup-form'));
    await type(tid('signup-org'), 'Panadería Sol', 70);
    await tid('signup-slug-status').filter({ hasText: /available/i }).waitFor({ timeout: 15_000 }).catch(() => note('slug not shown as available'));
    await hover(tid('signup-slug'), 1300);
    await hover(tid('signup-slug-status'), 1300);
    await type(tid('signup-name'), 'Ana Sol', 60);
    await type(tid('signup-email'), ORG_EMAIL, 40);
  },
  's34-signup-near': async () => {
    const near = tid('signup-near');
    await type(near, 'panaderiasol.near', 55);
    await tid('signup-near-status').filter({ hasText: /not|no existe/i }).waitFor({ timeout: 20_000 }).catch(() => note('missing NEAR account not reported'));
    await hover(tid('signup-near-status'), 1500);
    await click(near);
    await near.fill('');
    await near.pressSequentially('test.near', { delay: 55 });
    await tid('signup-near-status').filter({ hasText: /exists/i }).waitFor({ timeout: 20_000 }).catch(() => note('existing NEAR account not confirmed'));
    await hover(tid('signup-near-status'), 1400);
    await click(tid('signup-terms'));
    await sleep(400);
    await click(tid('signup-submit'));
    await tid('signup-success').waitFor({ timeout: 20_000 }).catch(() => note('signup did not succeed'));
    await hover(tid('signup-success'), 1500);
  },
  's35-verify-email': async () => {
    await page.goto(`${LANDING}/__mail/verify`);
    await page.locator('[data-testid="mail-body"]').waitFor();
    await sleep(900);
    await hover(page.locator('[data-testid="mail-body"] p').first(), 1600);
    await click(page.locator('[data-testid="mail-body"] a[href*="/verify?token="]').first());
    await page.waitForURL(/\/verify\?token=/);
  },
  's36-verified': async () => {
    await tid('verify-success').waitFor({ timeout: 30_000 }).catch(() => note('verification failed'));
    await sleep(800);
    await hover(tid('verify-success').locator('h1'), 1600);
    await hover(tid('verify-tenant-link'), 2600);
  },
  's37-setup': async () => {
    await page.goto(`${LANDING}/__mail/setup`);
    await page.locator('[data-testid="mail-body"]').waitFor();
    await sleep(900);
    await hover(page.locator('[data-testid="mail-body"] p').nth(1), 1400);
    await click(page.locator('[data-testid="mail-body"] a[href*="/setup?token="]').first());
    await page.waitForURL(/\/setup\?token=/);
    await tid('setup-form').waitFor();
    await sleep(700);
    await hover(tid('setup-org'), 1100);
    await type(tid('setup-name'), 'Ana Sol', 50);
    const email = tid('setup-email');
    if (!(await email.inputValue())) await type(email, ORG_EMAIL, 30);
    else await hover(email, 900);
    await type(tid('setup-password'), 'Panaderia-Sol-2026!', 30);
    await type(tid('setup-confirm'), 'Panaderia-Sol-2026!', 30);
    await click(tid('setup-submit'));
    await page.waitForURL((u) => !u.pathname.startsWith('/setup'), { timeout: 20_000 }).catch(() => note('setup did not finish'));
    await page.waitForLoadState('networkidle').catch(() => {});
  },
  's38-real-created': async () => {
    await sleep(800);
    await hover(first(page.getByText('Spent today')), 1500);
    await nav('payees');
    await sleep(900);
    await nav('policies');
    const inputs = tid('policy-form').locator('input[type="number"], input[inputmode="decimal"], input[inputmode="numeric"]');
    const n = Math.min(await inputs.count(), 4);
    for (let i = 0; i < n; i++) await hover(inputs.nth(i), 1000);
  },
  's39-real-settings': async () => {
    await nav('settings');
    await hover(tid('instance-card'), 1600);
    await hover(tid('agent-account'), 3000);
    await hover(tid('mode-live-description'), 2600);
  },
  's40-treasury-accounts': async () => {
    await nav('treasury');
    await tid('treasury-accounts').waitFor();
    await sleep(600);
    await hover(tid('treasury-accounts'), 1500);
    await scroll(420, 1400);
    await sleep(1800);
    await scroll(420, 1400);
    await sleep(1800);
    await scroll(-840, 1000);
  },
  's41-treasury-prepare': async () => {
    await tid('setup-form').scrollIntoViewIfNeeded().catch(() => {});
    await hover(tid('setup-owner'), 1500);
    const max = tid('setup-max');
    await click(max);
    await max.fill('');
    await max.pressSequentially('50', { delay: 120 });
    const daily = tid('setup-daily');
    await click(daily);
    await daily.fill('');
    await daily.pressSequentially('100', { delay: 120 });
    await sleep(500);
    await click(tid('setup-submit'));
    await tid('setup-fund').waitFor({ timeout: 30_000 }).catch(() => note('treasury address not shown'));
    await sleep(800);
    await hover(tid('setup-fund-address'), 2200);
    await hover(tid('setup-fund-qr'), 1500);
  },
  's42-treasury-create': async () => {
    // Off camera, Ana sends 2.5 NEAR from her wallet to the address on screen (local NEAR network).
    const address = ((await tid('setup-fund-address').innerText()).match(/[0-9a-f]{64}/) ?? [])[0];
    if (!address) throw new Error('no treasury address on screen');
    wallet('send-near', address, '2.5');
    await click(tid('setup-check')).catch(() => {});
    await tid('setup-deploy').waitFor({ timeout: 30_000 });
    await hover(tid('setup-deploy'), 1200);
    await click(tid('setup-deploy'));
    await tid('setup-done').waitFor({ timeout: 120_000 }).catch(() => note('treasury not created'));
    await sleep(800);
    await hover(tid('setup-done'), 1500);
    await hover(tid('setup-locked'), 1500);
    await hover(tid('setup-code-hash'), 1200);
  },
  's43-treasury-fund': async () => {
    await page.reload();
    await tid('fund-button').waitFor({ timeout: 30_000 });
    await click(tid('fund-button'));
    await sleep(700);
    await click(tid('fund-option-cross'));
    await sleep(900);
    await hover(tid('fund-asset'), 1400);
    await type(tid('fund-amount'), '20', 120);
    await type(tid('fund-refund'), '0x4b8f2a91c3d7e6f05a1b9c8d7e6f5a4b3c2d1e0f', 15);
    await sleep(900);
    await click(tid('fund-option-near'));
    await sleep(900);
    await hover(page.getByRole('dialog').getByText(/[0-9a-f]{20,}/).first(), 1500);
    // Off camera: 30 USDC from her wallet (USDC on NEAR) to the treasury.
    const treasury = (await page.evaluate(async () => (await (await fetch('/api/treasury', { headers: { Authorization: 'Bearer ' + localStorage.getItem('tesorero.token') } })).json()).treasuryAccountId).catch(() => null))
      ?? ((await page.getByRole('dialog').innerText()).match(/[0-9a-f]{64}/) ?? [])[0];
    if (treasury) wallet('send-usdc', treasury, '30');
    else note('no treasury account for the USDC funding');
    await page.keyboard.press('Escape');
    await sleep(2500);
    await page.reload();
    await tid('treasury-status').waitFor().catch(() => {});
    await hover(tid('treasury-status'), 2000);
  },
  's44-go-live': async () => {
    // The treasury overview is cached for 15 s: reload until the funds show up and every check is green.
    for (let i = 0; i < 20 && !(await tid('treasury-live-link').isVisible().catch(() => false)); i++) {
      await sleep(2000);
      await page.reload();
      await tid('treasury-status').waitFor().catch(() => {});
    }
    await hover(tid('treasury-checks'), 2200);
    await click(tid('treasury-live-link').or(tid('treasury-live-cta')).first());
    await page.waitForURL(/\/settings/, { timeout: 15_000 }).catch(async () => { await nav('settings'); });
    await sleep(600);
    await click(tid('mode-live'));
    await sleep(400);
    await click(tid('settings-save'));
    await tid('live-confirm-dialog').waitFor({ timeout: 15_000 }).catch(() => note('no live confirmation'));
    await hover(tid('live-confirm-limits'), 2200);
    await click(tid('live-confirm-dialog-confirm'));
    await toast();
  },
  's45-real-payment': async () => {
    await nav('payees');
    await click(tid('new-payee-button'));
    await sleep(500);
    const dlg = page.getByRole('dialog');
    await type(dlg.getByLabel('Name', { exact: false }).first(), 'Molino Andino', 35);
    await click(page.locator('[data-testid="token-option"]:has(input[value="nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near"])'));
    await type(tid('payee-recipient'), '0x4b8f2a91c3d7e6f05a1b9c8d7e6f5a4b3c2d1e0f', 12);
    await click(tid('payee-form-submit'));
    await dlg.waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => note('payee dialog did not close'));
    await nav('bills');
    await click(tid('new-bill-button'));
    await sleep(500);
    const bill = page.getByRole('dialog');
    const payeeSelect = bill.getByLabel('Payee').first();
    await click(payeeSelect);
    const option = await payeeSelect.locator('option', { hasText: 'Molino Andino' }).first().getAttribute('value');
    if (option) await payeeSelect.selectOption(option);
    else note('Molino Andino not in the payee list');
    await sleep(400);
    await type(bill.getByLabel('Amount (USD)').first(), '12', 120);
    await bill.getByLabel('Due date').first().fill(new Date().toISOString().slice(0, 10));
    await type(bill.getByLabel('Reference').first(), 'MA-1101', 40);
    await type(bill.getByLabel('Description').first(), 'Flour, 25 kg', 30);
    await click(tid('bill-form-submit'));
    await bill.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => note('bill dialog did not close'));
    await nav('agent');
    await click(tid('run-agent-button'));
    await tid('agent-run-detail').filter({ hasText: /Completed|Completad/ }).waitFor({ timeout: 150_000 }).catch(() => note('agent run did not complete'));
    await nav('approvals');
    const item = first(tid('approval-item').filter({ hasText: 'Molino Andino' }));
    await hover(item, 1500);
    await click(item.getByTestId('approve-button'));
    await tid('approve-live-dialog').waitFor({ timeout: 10_000 }).catch(() => note('no live approval confirmation'));
    await hover(tid('approve-live-details'), 2200);
    await click(tid('approve-live-dialog-confirm'));
    await toast();
    await nav('payments');
    const row = first(tid('payment-row').filter({ hasText: 'Molino Andino' }));
    // Wait until the agent's on-chain payment is confirmed (quote + pay take ~15 s), not just quoted.
    for (let i = 0; i < 40; i++) {
      if (/Processing|Procesando|Settled|Liquidado/i.test(await row.innerText().catch(() => ''))) break;
      await sleep(2000);
      await page.reload();
    }
    await click(row);
    await tid('payment-detail').waitFor({ timeout: 15_000 }).catch(() => note('payment detail did not open'));
    await sleep(800);
    await scroll(320, 900);
    await sleep(1800);
    await page.keyboard.press('Escape');
  },
  's46-owner-wallet': async () => {
    await nav('treasury');
    await tid('owner-actions').scrollIntoViewIfNeeded().catch(() => {});
    await sleep(600);
    await hover(tid('wallet-panel'), 1500);
    await hover(tid('wallet-withdraw'), 1200);
    await hover(tid('wallet-unpause'), 1000);
    await hover(tid('wallet-limits'), 1000);
    await click(tid('wallet-connect'));
    await sleep(3500);
    await page.keyboard.press('Escape');
    await sleep(800);
  },
  's47-contract': async () => {
    await page.goto(`${ORG}/__card/contract`);
    await moveToXY(1750, 920, 700);
  },
  's48-closing': async () => {
    await page.goto(`${LANDING}/__card/closing`);
  },
};

const startAt = process.argv[2];
const stopAfter = process.env.STOP_AFTER;
let started = !startAt;
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: VW, maxHeight: VH, everyNthFrame: 1 });
t0 = Date.now() / 1000;
for (const s of scenes) {
  if (!started && s.id === startAt) started = true;
  if (!started) continue;
  const d = durations[s.id];
  const minMs = Math.max(d.en, d.es) * 1000 + 700;
  const start = Date.now() / 1000;
  console.log(`▶ ${s.id} (${(minMs / 1000).toFixed(1)}s)`);
  let failed = null;
  await Promise.all([
    actions[s.id]({ start: start * 1000, minMs }).catch((e) => { failed = e; }),
    sleep(minMs),
  ]);
  if (failed) note(`${s.id} failed: ${String(failed.message).split('\n')[0]}`);
  timeline.push({ id: s.id, start: start - t0, end: Date.now() / 1000 - t0 });
  if (stopAfter && s.id === stopAfter) break;
}
await sleep(1200);
await cdp.send('Page.stopScreencast');
await sleep(300);
const end = Date.now() / 1000;
fs.writeFileSync(path.join(WORK, 'timeline.json'), JSON.stringify({ t0, end: end - t0, scenes: timeline, idles, frames: frames.map((f) => ({ file: f.file, t: f.t - t0 })), issues }, null, 1));
console.log(`done: ${frames.length} frames, ${(end - t0).toFixed(1)}s, ${issues.length} issue(s)`);
await browser.close();
