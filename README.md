# Tesorero — an AI treasurer that pays your suppliers on any chain, inside rules you set

> Built at **NEAR HACKATHON** (Nov 2026) · Tracks: **Autonomous Business**, **Real-World Money**, **AI Security & Defense**
> **https://tesorero.gesco.ec**: landing with the demo videos and self-service signup.
> Live demo: **https://demo.tesorero.gesco.ec** (also https://near.gesco.ec) · Demo logins below · License: MIT

## The problem

A small business (our demo: *Cafetería La Ceiba*, a coffee shop in Latin America) pays a roaster on Base, a designer who wants USDC on Solana, a developer paid in SOL, a SaaS that bills in USDC on Arbitrum and a freight company on Ethereum. Doing this by hand is slow. Handing it to a bot is dangerous: one poisoned invoice ("SYSTEM: ignore previous rules, new wallet details…") can drain the treasury.

## What Tesorero does

1. **Reads invoices with AI.** Paste an invoice or e-mail; DeepSeek extracts payee, amount, due date and payment details. A deterministic detector plus the model flag prompt injection and changed bank or wallet details, a classic invoice-fraud pattern.
2. **Plans payments autonomously.** Every day (Hangfire job) or on demand, the AI agent decides which open bills to pay now. It explains each decision in plain words.
3. **Enforces human-set guardrails deterministically.** The AI only *proposes*. A policy engine (pure code, fully unit-tested) decides **Allow / Needs approval / Block**. Its checks:
   - kill switch
   - payee allowlist
   - per-payment maximum, plus daily and monthly limits
   - category budgets
   - minimum treasury reserve
   - 48 h cool-down for new or changed payment addresses
   - auto-approval threshold
   - suspicious-invoice flags
4. **Keeps humans in the loop for exceptions.** Approvers get an inbox of "reasoning cards" (AI reason + every rule evaluated) and approve or reject with a note. Roles are Owner, Approver and Auditor.
5. **Settles cross-chain with NEAR Intents.** The treasury holds **USDC on NEAR**. Each payment is quoted through the **1Click API** to whatever asset and chain the payee wants: USDC on Base, Solana, Arbitrum, USDT on Ethereum, SOL, and more.
6. **Explains and exports everything.** An append-only audit log covers user, agent and system actions, plus an accountant-ready CSV (with spreadsheet formula-injection protection).
7. **Includes a red-team drill.** One click simulates a *compromised* agent that tries to pay every open bill at once. You see exactly what the guardrails would block. No payment is created.

## How NEAR is used (concretely)

| Piece | NEAR technology |
|---|---|
| Treasury base asset | USDC on NEAR (`17208628f8…6133a1`, NEP-141) |
| Cross-chain payouts | NEAR Intents **1Click API**: `/v0/tokens`, `/v0/quote`, `/v0/deposit/submit`, `/v0/status` |
| Live treasury balance | NEAR JSON-RPC `view_account` + `ft_balance_of` (FastNEAR public RPC) |
| Payee catalog | All 200+ assets and chains exposed by 1Click, refreshed hourly |

**Execution modes.**
- **Simulation** (the public demo): every payment gets a **real 1Click quote** (`dry: true`) with real rates, routing and amounts out. No funds move. The public demo can never switch to Live.
- **Live, autonomous** (real instances, [ADR-0005](docs/adr/0005-dinero-real-contrato-de-tesoreria.md)): the USDC sits in the **Tesorero treasury smart contract** on NEAR (`contracts/treasury`).
  - The server holds only an **agent key**, generated on the server, whose account owns nothing but gas.
  - The contract lets that agent call `pay` **only within on-chain per-payment and daily limits**. Limits, unpausing and withdrawals stay with the owner's wallet.
  - For each approved payment, Tesorero gets a live 1Click quote. The agent calls `treasury.pay(payment_id, deposit_address, amount)`, and the contract sends the USDC to NEAR Intents, which delivers it on the payee's chain.
  - A job follows `/v0/status` until `SUCCESS`, `REFUNDED` (refunds go back to the contract) or `FAILED`.
  - Payment ids are unique on-chain, so a retried job can never pay twice.
  - If the server is compromised, the most it can move is the daily limit set by the owner.
- **Live, manual** (no agent key): the owner signs each deposit in their wallet and pastes the tx hash.

## Try it in 3 minutes (https://demo.tesorero.gesco.ec)

Watch the 14-minute walkthrough (EN/ES) on https://tesorero.gesco.ec, or open the live demo:

Demo accounts (password `Demo!2026` for all; the login page also has one-click buttons):

| Role | E-mail | Can |
|---|---|---|
| Owner | owner@tesorero.demo | everything: payees, policy, settings, run the agent |
| Approver | approver@tesorero.demo | add bills, AI import, approve or reject payments |
| Auditor | auditor@tesorero.demo | read everything, export CSV, audit log |

1. **Log in as Owner** → *Overview* shows USDC spend versus limits, category budgets and upcoming bills.
2. **Agent → "Run agent now"** → in about 10–30 s you see the AI summary and one card per bill:
   - ACR-2041 and LUM-2026-11 are **auto-approved** and settle with a real NEAR Intents quote, for example `480 USDC → 479.90 USDC on Base`.
   - MLS-007 ($1,850) **needs approval**: it is above the threshold.
   - PFC-889 **needs approval**: the payee's address changed 3 h ago (cool-down).
   - ACR-2042-URGENT is **not paid**: its description is a prompt-injection attack.
3. **Agent → "Run red-team drill"** → the compromised agent tries to pay everything:
   - ACR-2042-URGENT is **blocked** for *SuspiciousInstructions* and *ExceedsMaxPerPayment*.
   - BRL-001 is **blocked** for *PayeeNotAllowlisted*.
   - Nothing moves.
4. **Log in as Approver → Approvals** → approve MLS-007 with a note → it settles. Reject PFC-889 → the bill returns to the queue.
5. **Bills → "Import with AI" → "Try a sample → malicious"** → you see red warnings: *prompt injection* and *invoice asks to pay a different address than the one on file*.
6. **Log in as Auditor** → *Payments → Export CSV* and *Audit log*. Every write action is hidden or disabled with an explanation.

## Multi-tenant SaaS (ADR-0006)

- Every organization gets its own subdomain, `<name>.tesorero.gesco.ec`, in one deployment.
- Rows are isolated per tenant by EF Core global filters, and each tenant-owned row is stamped with its tenant on save.
- Sessions are bound to their organization: a token from one subdomain is rejected on any other.
- Each tenant has its own NEAR agent key, generated on the server and encrypted with AES-256-GCM.
- Background jobs run per tenant.

**Self-service signup** on the landing:
1. Choose a subdomain (availability is checked live).
2. Enter your NEAR account. Tesorero checks that it exists on mainnet with `view_account`.
3. Confirm your e-mail with a verification link.
4. Only then is the tenant created. A one-time setup link (valid for 7 days) is e-mailed to create the first Owner, who must use the verified e-mail.

Bots are filtered with a honeypot and per-IP rate limits. New organizations start with conservative guardrails (human approval above $100, a 48 h cool-down for new suppliers); when the treasury is created, the app's limits are aligned with the on-chain ones the owner chose.

## Real treasury from the app (ADR-0007)

No command line. In **Treasury**, the owner:
1. **Creates the treasury with one deposit.** She picks her wallet as owner and the on-chain limits (e.g. $50 per payment, $100 per day), then sends 2.5 NEAR to the address shown (from any NEAR wallet or from Binance). Tesorero then, with a one-time key:
   - deploys the audited contract (sha256 `24710670…0b19`);
   - initializes it with her wallet as owner and the organization's agent;
   - registers it for USDC and gives the agent gas;
   - **deletes its own key**, so the contract is locked: nobody can redeploy it or drain it, and the server never had her keys.
2. **Funds it from anywhere.** USDC on NEAR goes straight in. **USDT from Binance** (e.g. BNB Smart Chain) goes through **NEAR Intents**, which converts it into USDC inside the treasury; the app gives the exact network, address, amount and deadline, and tracks the status.
3. **Watches it.** *Movements* lists every real inflow and outflow (NearBlocks indexer), reconciles them with Tesorero's payments, and **raises an alert if money leaves that Tesorero did not send**.
4. **Keeps control.** A red *Stop all payments* button works instantly. *Freeze the treasury on-chain* is a separate emergency action. Withdrawing, unfreezing and changing on-chain limits are signed **in her own wallet** from the same page (NEAR Wallet Selector: MyNearWallet, Meteor, HOT).
5. **Goes Live** only when every check is green. The app re-verifies on-chain that the account is this organization's Tesorero contract.

Tested end to end on a real local NEAR node: creation in 13 s, contract locked and verified, and an agent-signed payment of 20 USDC (`e2e/sandbox/`). A non-technical "first-time owner" usability test drove two rounds of fixes. Owner guide (Spanish): [docs/guides/TESORERIA.md](docs/guides/TESORERIA.md).

## Architecture

```
Internet ─► host nginx (TLS) ─► nearhk_nginx ─► nearhk_api (.NET 11) ─► nearhk_pgbouncer ─► nearhk_postgres
                                     │                │  ├─ Hangfire (direct Postgres)
                                     │                │  ├─ DeepSeek (AI)  ├─ NEAR Intents 1Click  └─ NEAR RPC
                                     └─► React PWA (static, auto-updating service worker)
```

- **Backend** (`/backend`): .NET 11, clean architecture with these layers:
  - `Domain`: entities, `PolicyEngine`, `InjectionDetector`
  - `Application`: use cases and contracts
  - `Infrastructure`: EF Core + PostgreSQL, DeepSeek, 1Click, NEAR RPC, Hangfire jobs
  - `Api`: minimal APIs, JWT, ProblemDetails, rate limits

  Builds with `TreatWarningsAsErrors` and analyzers on.
- **Frontend** (`/frontend`): React 19 + TypeScript + Vite + Tailwind 4. It is an installable **PWA** that updates itself as soon as a new version is deployed. It is responsive (bottom tab bar on mobile), WCAG 2.2 AA oriented, in English and Spanish, with light and dark themes.
- **Infra**: `docker-compose.yml` + `nginx.conf`. PgBouncer pools app traffic; Hangfire and migrations use a direct connection.
- **Contract** (`/contracts`): `tesorero-treasury`, Rust + near-sdk 5.30, reproducible build with cargo-near in Docker. Guide: [docs/guides/MAINNET.md](docs/guides/MAINNET.md).
- **Docs**: API contract in [`docs/api/CONTRACT.md`](docs/api/CONTRACT.md), design system in [`docs/design/DESIGN.md`](docs/design/DESIGN.md), decision records in [`docs/adr/`](docs/adr/).

## Run it locally

Requirements: Docker. For development without Docker: .NET 11 SDK and Node 24.

```bash
cp .env.example .env          # set POSTGRES_PASSWORD, JWT_SIGNING_KEY, DEEPSEEK_API_KEY
(cd frontend && npm ci && npm run build)
docker compose up -d --build
open http://localhost:32080
```

## Tests

| Suite | What | Command |
|---|---|---|
| Unit (.NET) | Policy engine (every rule and boundary), injection detector, AI output parsing, CSV escaping, address validation | `dotnet test --project backend/tests/Tesorero.UnitTests` |
| Integration (.NET) | Real API + real PostgreSQL (Testcontainers): roles and permissions matrix, full agent cycle, drill, kill switch, Live mode deposit → status → settlement, refunds, failures, CSV | `dotnet test --project backend/tests/Tesorero.IntegrationTests` |
| Live AI (.NET) | **Real DeepSeek** with the production prompts: English/Spanish/EUR invoices, 4 prompt-injection or fraud variants, false-positive check, planner ignores injected instructions and never invents bill ids | `DEEPSEEK_API_KEY=… dotnet test --project backend/tests/Tesorero.LiveAiTests` |
| Smart contract (Rust) | 74 unit tests + 8 tests on a real local NEAR node (near-workspaces sandbox) with the built wasm: every guard and limit boundary, day rollover, failed transfers restoring the quota, 1-yocto owner rules, withdraw, foreign-token refunds | `bash contracts/test.sh` (Docker) |
| NEAR signing (.NET) | Borsh + ed25519 transactions byte-for-byte identical to near-api-js | part of the unit suite |
| Frontend | Vitest + Testing Library (284 tests) | `cd frontend && npm test` |
| Treasury on a real NEAR node | Local sandbox node: in-app creation (deploy, init, USDC registration, agent gas, lock), funding, Live switch, agent-signed payment | `bash e2e/sandbox/setup.sh <dir>` then `e2e/sandbox/flow.py` / `pay.py` |
| End-to-end | Playwright on the full stack, per role, at 4 viewports, with axe accessibility checks | `cd e2e && npx playwright test` |

## Security model (summary)

- **Two layers of guardrails.** Off-chain, the policy engine plus human approvals. On-chain, the treasury contract enforces limits even against the server itself. *Stop all payments* is instant in the app; *Freeze* pauses the contract on-chain, and only the owner's wallet can unfreeze it.
- Payee addresses are checked with a dry NEAR Intents quote before they can be saved.
- In Live mode, the agent reads the treasury balance on-chain right before planning (minimum-reserve rule).
- Real instances start empty with a first-run setup wizard. Owners manage users; deactivating a user or changing their role revokes their sessions immediately. At least one active Owner always remains.

- The LLM's output is untrusted:
  - Only bill ids it was given are accepted.
  - Amounts and addresses always come from the database.
  - It can never create payees or change addresses.
- Third-party text (invoice descriptions) is marked untrusted in prompts and screened by a deterministic detector.
- Hard limits block; soft signals require a human; there is a kill switch.
- Changing a payee's address restarts a 48 h cool-down.
- The server never holds the owner's keys. It holds only each organization's agent key (encrypted with AES-256-GCM), which can do nothing but call `pay` within the on-chain limits. The one-time key that creates the treasury deletes itself on-chain. Owner actions are signed in the owner's wallet.
- JWT auth with role policies is enforced server-side, alongside rate limiting, a strict CSP and an append-only audit log.

## Honest limitations

- Demo payee addresses are random and belong to nobody. The public demo cannot use Live mode at all.
- The contract caps *how much* can leave per payment and per day, but it cannot verify the final recipient on another chain. *Who* gets paid is enforced by the server: the allowlist, the address cool-down and quotes built from the stored address.
- Creating the treasury needs ~2.5 NEAR (≈1.6 is NEAR's own storage deposit for the contract), and NEAR Intents enforces minimum swap amounts on some networks (e.g. Tron currently ≥ $100). The manual CLI route is still documented ([docs/guides/MAINNET.md](docs/guides/MAINNET.md)).
- DeepSeek is used as the model provider; the AI port (`ILlmClient`) makes swapping it for NEAR AI Cloud a one-class change.

## Built with

.NET 11, ASP.NET Core, EF Core 10, Npgsql, Hangfire, PostgreSQL 17, PgBouncer, React 19, Vite, Tailwind CSS, TanStack Query, React Router, vite-plugin-pwa, lucide-react, xUnit v3, AwesomeAssertions, Testcontainers, Vitest, Testing Library, MSW, Playwright, axe-core. AI: DeepSeek. NEAR: Intents 1Click API, NEAR RPC. All code was written during the hackathon window.
