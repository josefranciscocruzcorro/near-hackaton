# Tesorero — frontend

React 19 + TypeScript + Vite 8 PWA for Tesorero, the AI treasury agent. It implements
[`docs/api/CONTRACT.md`](../docs/api/CONTRACT.md) and the design system in
[`docs/design/DESIGN.md`](../docs/design/DESIGN.md).

## Run

```bash
npm install
npm run dev        # http://localhost:5173 — proxies /api and /health to http://localhost:5080
```

Start the backend first (see the root README). On a demo instance (`GET /api/instance` → `demo: true`) sign in
with a one-click demo account (Owner / Approver / Auditor, password `Demo!2026`). On a fresh real instance
(`needsSetup: true`) the app opens the first-run wizard at `/setup` to create the first Owner.
To proxy to a different API: `API_PROXY_TARGET=http://host:port npm run dev`.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server on port 5173 with the API proxy |
| `npm run build` | Type-check (`tsc -b`) and build to `dist/` with the service worker and manifest |
| `npm run preview` | Serve the production build on port 4173 (same proxy) |
| `npm run lint` | ESLint (typescript-eslint strict-type-checked, react-hooks, jsx-a11y), zero warnings allowed |
| `npm run typecheck` | `tsc -b` (no emit) |
| `npm test` / `npm run test:watch` | Vitest + Testing Library + MSW (jsdom) |
| `npm run icons` | Regenerate the PWA PNG icons from `public/favicon.svg` (sharp) |

## Structure

```
src/
  api/          types.ts (1:1 with CONTRACT.md), client.ts (fetch + 401 handling), endpoints.ts, queries.ts (TanStack Query)
  auth/         AuthContext (JWT in localStorage), permissions.ts (`can(role, permission)`)
  i18n/         en.ts (source of keys), es.ts, provider + `t()`
  lib/          format.ts (money, dates, addresses), status.ts (status → tone/icon), theme, hooks
  components/   ui/ primitives (Dialog on native <dialog>, Field, Toast, Chip…), layout/ (shell, sidebar,
                bottom tabs, command palette), ReasoningCard, StatusChips, GuardedButton, PwaUpdater
  pages/        Landing + landing/ (apex: hero, video, signup), Verify, Setup (first run), Login, Overview, Bills (+ AI import), Approvals, Payments, Agent, Payees, Policies,
                Audit, Users (Owner), Settings
```

## Notes

- **Roles:** actions a role cannot perform stay visible but `aria-disabled`, with a tooltip naming the required
  role — coherent with the API's 403 rules. A 401 on any authenticated call signs the user out.
- **PWA:** `registerType: 'autoUpdate'`; the app checks for a new build every 60 s and shows
  "New version installed" after it reloads. `/api` and `/health` are `NetworkOnly` (never cached).
- **Test ids** for E2E: `demo-login-{owner|approver|auditor}`, `nav-*` / `tab-*`, `run-agent-button`, `run-drill`,
  `approve-button`, `reject-button`, `bill-import-textarea`, `sample-normal`, `sample-malicious`,
  `extraction-warnings`, `payment-status-chip`, `export-csv-button`, `command-palette-trigger`, `setup-form` /
  `setup-submit`, `demo-banner`, `nav-users`, `users-row` / `users-card`, `invite-user-button`, `user-form-submit`,
  `user-active-toggle`, `reset-password-button`, `change-password-button` / `change-password-submit`, `onchain-guard`,
  `reset-demo-button` / `reset-demo-confirm`, `onchain-tx-link`, `payment-last-error`.
  Landing (apex): `landing-hero`, `landing-demo-link`, `landing-cta-signup`, `landing-nav-demo`, `landing-nav-signup`,
  `landing-video`, `video-tab-en` / `video-tab-es`, `signup-form`, `signup-org`, `signup-slug`, `signup-slug-status`,
  `signup-name`, `signup-email`, `signup-near`, `signup-near-status`, `signup-language`, `signup-terms`, `signup-submit`,
  `signup-success`, `signup-error`, `verify-success`, `verify-error`, `verify-tenant-link`; tenant login: `login-tenant`.
- **Multi-tenant (ADR-0006):** `GET /api/instance` → `kind: "landing"` renders only the public landing (`/`) and
  `/verify`; `kind: "tenant"` renders setup / login / app. Landing videos are served from `/media/` by nginx and may be
  missing in development (the page shows a fallback).
