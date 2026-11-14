# Contrato de API v1 — Tesorero

Fuente única de verdad entre `/backend` y `/frontend`. Cualquier cambio se hace **aquí primero**.

- Base: `/api`. JSON camelCase. Enums como **string**. Fechas-hora ISO 8601 UTC (`2026-11-14T10:00:00Z`); fechas sin hora `yyyy-MM-dd`.
- Montos en USD como número con 2 decimales (`amountUsd: 1250.5`).
- Auth: `Authorization: Bearer <jwt>`. Errores: RFC 7807 `ProblemDetails` `{ type, title, status, detail, errors? }`. 401 sin sesión, 403 sin permiso por rol.
- Roles: `Owner` (todo) · `Approver` (crea facturas, aprueba o rechaza pagos, lee todo) · `Auditor` (sólo lectura + export + auditoría).

## Usuarios demo (seed, sólo instancia demo)
| Email | Rol |
|---|---|
| owner@tesorero.demo | Owner |
| approver@tesorero.demo | Approver |
| auditor@tesorero.demo | Auditor |
Contraseña demo de los tres: `Demo!2026`.

## Instancia, tenants y alta inicial (públicos, sin auth) — ADR-0006
- `GET /api/instance` →
  ```ts
  Instance = {
    kind: "landing" | "tenant",        // landing = tesorero.gesco.ec (apex); tenant = <slug>.tesorero.gesco.ec
    demo: boolean,                     // tenant demo
    needsSetup: boolean,               // tenant sin usuarios: mostrar /setup
    setupTokenRequired: boolean,
    organizationName: string|null,     // nombre del tenant (también antes del alta)
    tenantSlug: string|null,
    baseDomain: string,                // "tesorero.gesco.ec"
    demoUrl: string,                   // "https://demo.tesorero.gesco.ec"
    landingUrl: string                 // "https://tesorero.gesco.ec"
  }
  ```
  - `kind: "landing"`: el frontend muestra la landing (`/`) y la verificación (`/verify`); no hay login de app.
  - `demo: true`: banner "Public demo", botones de cuentas demo en el login, Live prohibido.
  - `needsSetup: true`: pantalla de alta inicial (`/setup`).
- `POST /api/setup` `{ organizationName, ownerName, email, password, setupToken: string|null }` → `201 LoginResponse`. 409 si ya hay usuarios. 403 si el código no coincide. 400 `errors.email` si el email no es el verificado en el registro. Contraseña: mínimo 12 caracteres.

## Registro (sólo en la landing; 404 desde un tenant)
- `GET /api/signup/slug?value=<slug>` → `{ slug: string, available: boolean, reason: "taken"|"reserved"|"invalid"|null }`. `slug` vuelve normalizado (minúsculas).
- `GET /api/signup/near?accountId=<id>` → `{ accountId: string, exists: boolean, valid: boolean }`. `valid: false` si el formato no es de cuenta NEAR. Consulta mainnet.
- `POST /api/signup` `SignupRequest` → `202 { email }` (se envió el email de verificación). 400 con `errors` por campo: `slug` ocupado o reservado, `nearAccountId` inexistente, email inválido, términos no aceptados. 429 si se excede el límite.
  ```ts
  SignupRequest = { organizationName: string, slug: string, ownerName: string, email: string,
                    nearAccountId: string, language: "en"|"es", acceptTerms: boolean,
                    website: string }   // campo trampa: debe ir vacío (oculto en la UI)
  ```
- `POST /api/signup/verify` `{ token }` → `200 { organizationName, slug, tenantUrl, email }`: tenant creado y email de alta enviado. 400 si el token es inválido o expiró. 409 si ya se verificó (detail explica que revise su correo) o si el subdominio se ocupó mientras tanto.
- Reglas de `slug`: 3–30 caracteres `[a-z0-9-]`, sin guion al inicio ni al final. Reservados: `www, demo, api, app, admin, mail, smtp, static, media, assets, near, tesorero, status, docs, help, support, billing, auth, login, signup, setup`.
- Videos de la landing: `/media/tesorero-demo-en.mp4` y `/media/tesorero-demo-es.mp4`, con pósters `/media/poster-en.jpg` y `/media/poster-es.jpg` (servidos por nginx; pueden faltar en desarrollo).

## Auth
- `POST /api/auth/login` `{ email, password }` → `200 { token, expiresAt, user: User }` | 401 (también si el usuario está desactivado)
- `GET /api/auth/me` → `User`
- `POST /api/auth/change-password` `{ currentPassword, newPassword }` → 204 | 400 (contraseña actual incorrecta o nueva < 12 caracteres)
- `User = { id, email, name, role }`
- Un token de un usuario desactivado o cuyo rol cambió deja de ser válido en la siguiente petición (401).

## Usuarios (Owner)
- `GET /api/users` → `UserAdmin[]`
- `POST /api/users` `{ email, name, role, password }` → `201 UserAdmin` (409 si el email existe)
- `PUT /api/users/{id}` `{ name, role, isActive }` → `UserAdmin`. 409 si dejaría la organización sin ningún Owner activo o si el Owner se desactiva o se degrada a sí mismo.
- `PUT /api/users/{id}/password` `{ newPassword }` → 204 (el Owner restablece la contraseña de otro usuario)
- `UserAdmin = { id, email, name, role: Role, isActive: boolean, createdAt }`

## Panel
`GET /api/dashboard` →
```ts
{
  treasury: { configured: boolean, accountId: string|null, network: "mainnet",
              usdcBalance: number|null, nearBalance: number|null, updatedAt: string|null,
              onChain: OnChainGuard|null },   // null si la tesorería no es un contrato Tesorero o no se pudo leer
  spend: { today: number, dailyLimit: number, month: number, monthlyLimit: number },
  categoryBudgets: { category: Category, spent: number, budget: number }[],
  pendingApprovals: number,
  upcomingBills: Bill[],          // hasta 5, abiertas, por vencimiento
  recentPayments: Payment[],      // hasta 5
  lastAgentRun: AgentRunSummary|null,
  executionMode: "Simulation"|"Live",
  agentEnabled: boolean
}
```

```ts
// Límites aplicados por el contrato de tesorería en NEAR (ADR-0005). Montos en USD (USDC, 6 decimales ya convertidos).
OnChainGuard = { contractId: string, agentId: string|null, maxPerPayment: number, dailyLimit: number,
                 spentToday: number, remainingToday: number, paused: boolean }
```

## Catálogo de tokens (1Click)
`GET /api/tokens` → `Token[]`, con `Token = { assetId, symbol, blockchain, decimals, priceUsd }`

## Beneficiarios
- `GET /api/payees` → `Payee[]`
- `POST /api/payees` (Owner) `PayeeInput` → `201 Payee`. El servidor valida la dirección con una cotización `dry` de NEAR Intents; si 1Click la rechaza → 400 con `errors.recipientAddress`.
- `PUT /api/payees/{id}` (Owner) `PayeeInput` → `Payee`. Un cambio de `recipientAddress` o `destinationAssetId` actualiza `addressChangedAt`.
- `DELETE /api/payees/{id}` (Owner) → 204 (archiva)
```ts
Category = "Supplier"|"Contractor"|"Payroll"|"Software"|"Operations"|"Marketing"
PayeeInput = { name, email?: string|null, category: Category, destinationAssetId, recipientAddress,
               isAllowlisted: boolean, notes?: string|null }
Payee = PayeeInput & { id, destinationSymbol, destinationChain, createdAt, addressChangedAt }
```

## Facturas por pagar
- `GET /api/bills?status=Open|Scheduled|Paid|Cancelled` → `Bill[]`
- `GET /api/bills/{id}` → `Bill`
- `POST /api/bills/extract` (Owner, Approver) `{ text }` → `Extraction` (IA; no guarda la factura, sí el borrador)
- `POST /api/bills` (Owner, Approver) `BillInput` → `201 Bill`
- `PUT /api/bills/{id}` (Owner, Approver; sólo `Open`) `BillInput` → `Bill`
- `POST /api/bills/{id}/cancel` (Owner) → `Bill`
```ts
BillInput = { payeeId, reference, description, amountUsd, dueDate /* yyyy-MM-dd */, category: Category,
              extractionId?: string|null }   // si viene de la IA, el servidor hereda las banderas
BillFlag = "PaymentDetailsMismatch"|"SuspiciousInstructions"
Bill = { id, payeeId, payeeName, reference, description, amountUsd, dueDate, category,
         status: "Open"|"Scheduled"|"Paid"|"Cancelled", source: "Manual"|"AiExtracted",
         flags: BillFlag[], createdAt, createdBy }
Extraction = {
  extractionId,
  fields: { payeeName: string|null, amountUsd: number|null, currency: string|null, dueDate: string|null,
            reference: string|null, description: string|null, category: Category|null,
            paymentInstructions: { chain: string|null, token: string|null, address: string|null } | null },
  matchedPayeeId: string|null,
  flags: BillFlag[],
  warnings: { code: string, message: string }[]
}
```

## Política (guardarraíles)
- `GET /api/policy` → `Policy`
- `PUT /api/policy` (Owner) `PolicyInput` → `Policy` (incrementa `version`)
```ts
PolicyInput = { agentEnabled, maxPerPaymentUsd, approvalThresholdUsd, dailyLimitUsd, monthlyLimitUsd,
                minReserveUsd, requireAllowlistedPayee, newPayeeCooldownHours, planningHorizonDays,
                categoryBudgets: Record<Category, number> }
Policy = PolicyInput & { version: number, updatedAt, updatedBy }
```

## Agente
- `POST /api/agent/runs` (Owner) body opcional `{ mode?: "Plan" | "RedTeamDrill" }` → `202 AgentRunSummary` (se encola; el cliente consulta hasta que `status != "Running"`).
  `RedTeamDrill` simula un agente comprometido que intenta pagar TODAS las facturas abiertas: sólo evalúa políticas, **no crea pagos ni mueve dinero** (las decisiones traen `paymentId: null`). Sirve para demostrar el motor de políticas.
- `GET /api/agent/runs` → `AgentRunSummary[]` (recientes primero, máx. 50)
- `GET /api/agent/runs/{id}` → `AgentRun`
```ts
AgentRunSummary = { id, trigger: "Scheduled"|"Manual"|"RedTeamDrill", status: "Running"|"Completed"|"Failed",
                    startedAt, finishedAt: string|null, model: string|null, summary: string|null,
                    proposed: number, allowed: number, needsApproval: number, blocked: number }
AgentRun = AgentRunSummary & { promptTokens: number, completionTokens: number, error: string|null,
  decisions: { billId, billReference, payeeName, amountUsd, payNow: boolean, aiReason: string,
               paymentId: string|null, policyOutcome: PolicyOutcome|null, policyReasons: PolicyReason[] }[] }
PolicyOutcome = "Allow"|"RequireApproval"|"Block"
PolicyReason = { code: string, message: string, severity: "info"|"warn"|"block" }
```
Códigos de `PolicyReason`: `AgentDisabled`, `PayeeNotAllowlisted`, `PayeeArchived`, `ExceedsMaxPerPayment`, `ExceedsDailyLimit`, `ExceedsMonthlyLimit`, `ExceedsCategoryBudget`, `BelowReserve`, `TreasuryBalanceUnknown`, `NewPayeeCooldown`, `AboveApprovalThreshold`, `PaymentDetailsMismatch`, `SuspiciousInstructions`, `InvalidAmount`, `WithinPolicy`.

## Pagos
- `GET /api/payments?status=...` → `Payment[]`
- `GET /api/payments/{id}` → `Payment`
- `POST /api/payments/{id}/approve` (Owner, Approver) `{ note?: string }` → `Payment`
- `POST /api/payments/{id}/reject` (Owner, Approver) `{ note: string }` → `Payment`
- `POST /api/payments/{id}/deposit` (Owner; modo Live **manual**, cuando no hay agente on-chain) `{ txHash }` → `Payment`
- `GET /api/payments/export.csv` → `text/csv` (todos los roles)
```ts
PaymentStatus = "PendingApproval"|"Approved"|"Blocked"|"Rejected"|"AwaitingDeposit"|"Processing"|"Settled"|"Refunded"|"Failed"
Payment = { id, billId, billReference, payeeId, payeeName, category: Category, amountUsd,
  originAssetId, destinationAssetId, destinationSymbol, destinationChain, recipient,
  status: PaymentStatus, policyOutcome: PolicyOutcome, policyReasons: PolicyReason[], aiReason: string|null,
  simulation: boolean,
  quote: { amountIn: string, amountOut: string, amountOutFormatted: string, amountOutUsd: number|null,
           depositAddress: string|null, deadline: string|null, quotedAt: string } | null,
  depositTxHash: string|null, intentStatus: string|null,
  decidedBy: string|null, decidedAt: string|null, decisionNote: string|null,
  createdAt, settledAt: string|null, explorerUrl: string|null,
  onChainTxHash: string|null,      // tx NEAR de treasury.pay firmada por el agente
  onChainTxUrl: string|null,       // https://nearblocks.io/txns/<hash>
  lastError: string|null }
```
Transiciones: Agente → `PendingApproval | Approved | Blocked`. `Approved` → (job) cotización →
- Simulation: `Settled` (simulado).
- Live con agente on-chain: el agente firma `treasury.pay` → `Processing` → `Settled | Refunded | Failed` (sin intervención humana).
- Live manual (sin agente): `AwaitingDeposit` → el Owner pega el hash → `Processing` → `Settled | Refunded | Failed`.

## Tesorería on-chain (ADR-0007)

Todos los importes en USDC/NEAR son `number` en unidades humanas (no base units). Roles: lectura para todos; escritura sólo Owner. En la demo: lectura sí; `POST`/`DELETE` → 403 (`"The public demo never moves real money."`).

- `GET /api/treasury` → `TreasuryOverview`
```ts
TreasuryOverview = {
  treasuryAccountId: string|null,          // cuenta del contrato guardada en Ajustes
  ownerAccountId: string|null,             // wallet dueña (de get_config, o del asistente si aún no hay contrato)
  agentAccountId: string|null,             // cuenta del agente de la organización (64 hex)
  usdcContractId: string,                  // 17208628…133a1
  executionMode: "Simulation"|"Live",
  demo: boolean,
  setup: TreasurySetup|null,               // último asistente de creación (null si nunca se usó)
  balances: { treasuryUsdc: number|null, treasuryNear: number|null, agentNear: number|null, readAt: string }|null, // leído en vivo (caché 15 s)
  onChain: OnChainGuard|null,              // igual que en /api/dashboard
  checks: TreasuryCheck[],                 // vacío si no hay cuenta de tesorería
  readyForLive: boolean                    // todos los checks ok
}
TreasuryCheck = { id: "contract"|"agent"|"locked"|"usdcRegistered"|"agentGas"|"funded"|"notPaused", ok: boolean }
  // contract: es un contrato Tesorero (get_config) · agent: su agent_id = agente de esta organización
  // locked: la cuenta no tiene claves de acceso (nadie puede redesplegarla) · usdcRegistered: storage en USDC
  // agentGas: agente con ≥ 0.05 NEAR · funded: USDC > 0 · notPaused: contrato no pausado
TreasurySetup = {
  id: string,
  status: "AwaitingFunds"|"Deploying"|"Ready"|"Failed",
  ownerAccountId: string, maxPerPayment: number, dailyLimit: number,   // límites on-chain en USDC
  accountId: string,                       // cuenta implícita (64 hex) que será el contrato: aquí se envía el NEAR
  requiredNear: number,                    // 2.5 recomendado
  minimumNear: number,                     // 2.2 mínimo para crear
  receivedNear: number|null,               // saldo actual de accountId (null si no se pudo leer / aún no existe → 0)
  codeHash: string,                        // sha256 hex del wasm que se desplegará
  steps: { id: "deploy"|"register"|"agentGas"|"lock", status: "pending"|"done"|"failed", txHash: string|null }[],
  lastError: string|null,
  createdAt: string, completedAt: string|null
}
```
- `POST /api/treasury/setup` (Owner) `{ ownerAccountId, maxPerPayment, dailyLimit }` → `201 TreasurySetup` (o `200` si actualiza uno `AwaitingFunds`, conservando la misma `accountId`).
  - 400 `errors.ownerAccountId` (inválida o "does not exist on NEAR mainnet"), `errors.maxPerPayment` / `errors.dailyLimit` (> 0, máx ≤ diario, ≤ 1 000 000).
  - 409 si ya hay una tesorería `Ready` o una creación `Deploying`.
- `POST /api/treasury/setup/deploy` (Owner) → `TreasurySetup` (`Ready`, o `Failed` con `lastError`; reintentable: retoma desde el último paso hecho). Tarda ~10–30 s.
  - 400 `errors.funds` si `receivedNear < minimumNear` ("Send at least 2.2 NEAR to … first.").
  - Al terminar: `treasuryAccountId` de Ajustes = `accountId` (el modo no cambia).
- `DELETE /api/treasury/setup` (Owner) → 204. Sólo si `AwaitingFunds` y sin fondos (para empezar de nuevo); si no, 409.

- `GET /api/treasury/funding-options` → `{ assets: FundingAsset[] }` — USDT y USDC en otras redes (de 1Click), ordenadas por popularidad (bsc, eth, tron, sol, arb, base, pol, op, avax…).
```ts
FundingAsset = { assetId: string, symbol: "USDT"|"USDC", chain: string, chainName: string, decimals: number }
```
- `POST /api/treasury/fundings` (Owner) `{ originAssetId, amount, refundAddress }` → `201 Funding` (cotización real 1Click EXACT_INPUT → USDC en NEAR al contrato).
  - 400 `errors.amount` (≤ 0, o el mensaje de 1Click, p. ej. "Temporary swap limits: minimum swap amount is $100"), `errors.refundAddress` (vacía), `errors.originAssetId`.
  - 409 si la tesorería no está lista (`setup.status != Ready` o no hay contrato verificado).
- `GET /api/treasury/fundings` → `Funding[]` (últimos 20, recientes primero; los pendientes se actualizan con 1Click al consultar, como mucho cada 15 s).
```ts
Funding = {
  id: string, originAssetId: string, symbol: string, chain: string, chainName: string,
  amountIn: number, expectedUsdc: number,
  depositAddress: string, depositMemo: string|null, deadline: string,
  refundAddress: string,
  status: "PendingDeposit"|"Processing"|"Success"|"Refunded"|"Failed"|"Expired",
  createdAt: string, updatedAt: string
}
```

- `GET /api/treasury/movements` → `{ accountId: string|null, items: Movement[], alerts: number, error: string|null }` (NearBlocks, caché 60 s; `error` si el indexador no respondió; `items` vacío si no hay cuenta)
```ts
Movement = {
  txHash: string, at: string, direction: "in"|"out",
  asset: string,                 // "NEAR" | "USDC" | símbolo/contrato de otro token
  amount: number,
  counterparty: string|null,
  kind: "payment"|"funding"|"setup"|"other",
  paymentId: string|null, reference: string|null,   // si es un pago de Tesorero (referencia de la factura)
  flagged: boolean               // salida de USDC que Tesorero no inició → alerta
}
```

- `PUT /api/settings` con `executionMode: "Live"`: si la organización tiene agente, la cuenta de tesorería debe ser un contrato Tesorero cuyo `agent_id` sea ese agente; si no → 400 `errors.executionMode` ("This account is not a Tesorero treasury for this organization. Create it in Treasury." / "Could not verify the treasury on NEAR right now. Try again.").

### Ajustes tras la prueba con un usuario novato (ADR-0007)
- Todas las peticiones de la app envían `Accept-Language: es|en` (idioma de la interfaz). El agente redacta su resumen y sus razones en ese idioma (las ejecuciones programadas usan el idioma de la organización).
- `GET /api/instance` (tenant) añade `language: "en"|"es"|null` — idioma elegido al registrarse; la app lo usa si el usuario aún no eligió otro.
- `TreasuryOverview` añade `suggestedOwnerAccountId: string|null` (la cuenta NEAR verificada en el registro) y el check `"reserveCovered"`: el saldo USDC de la tesorería supera la reserva mínima de la política (si no, ningún pago puede salir).
- Al quedar la tesorería `Ready`, la política se alinea con los límites on-chain: `maxPerPayment` y `dailyLimit` iguales a los del contrato, `approvalThreshold ≤ maxPerPayment`, `monthlyLimit ≥ dailyLimit` (nueva versión, auditada). Política inicial de organizaciones nuevas: reserva mínima 0.
- `POST /api/payments/stop` / `POST /api/payments/resume` (Owner) → `PolicyDto`: detener / reanudar todos los pagos al instante (es el interruptor `agentEnabled`; con él apagado tampoco se ejecutan pagos ya aprobados). **Ya no pausa el contrato on-chain.**
- `POST /api/treasury/freeze` (Owner) → `TreasuryOverview`: congela el contrato on-chain (`pause`, firmado por el agente). Sólo la wallet dueña puede descongelarlo (`unpause`). 409 si no hay tesorería verificada.
- `POST /api/treasury/fundings`: si 1Click rechaza por algo que no es el monto, el error va en `errors.funding` (mensaje del proveedor); los mínimos siguen en `errors.amount`.
- `GET /api/treasury/funding-options`: sin duplicados por (símbolo, red) y sólo redes con nombre conocido.

## Auditoría
`GET /api/audit?take=100` → `{ id, at, actor, actorType: "User"|"Agent"|"System", action, entityType, entityId: string|null, summary }[]`

## Ajustes
- `GET /api/settings` → `{ organizationName, treasuryAccountId: string|null, executionMode: "Simulation"|"Live", network: "mainnet", demo: boolean, agentAccountId: string|null, treasuryBalance: { usdc: number|null, near: number|null, capturedAt: string }|null }`
  - `treasuryBalance`: últimos saldos leídos de NEAR mainnet para la cuenta de tesorería (al guardar y cada 10 minutos).
  - `agentAccountId`: cuenta NEAR del agente configurada en el servidor (null = Live manual). Sólo informativo; se configura por variables de entorno.
- `PUT /api/settings` (Owner) `{ organizationName, treasuryAccountId, executionMode }` → `Settings`. En una instancia demo, `executionMode: "Live"` → 400. Si la cuenta de tesorería cambia, se comprueba en mainnet: si no existe → 400 `errors.treasuryAccountId` (si el RPC no responde, se guarda igual). Al guardar se leen los saldos al momento y se devuelven en `treasuryBalance`.

## Demo (sólo instancia demo)
- `POST /api/demo/reset` (Owner) → 204. Borra todos los datos de negocio y vuelve a sembrar la demo con fechas relativas a hoy. Los usuarios se conservan (las sesiones abiertas siguen siendo válidas); la política y los ajustes vuelven a sus valores por defecto. 404 en instancias reales.

## Sistema
- `GET /health` → 200 `Healthy`
- `GET /api/version` → `{ version, commit, builtAt }`
- `/hangfire` → panel de Hangfire, sólo localhost (acceso por túnel SSH)
