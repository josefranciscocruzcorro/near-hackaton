# ADR-0003 — Integración NEAR: tesorería en USDC sobre NEAR + pagos cross-chain con NEAR Intents (1Click)

- Estado: Aceptado · Fecha: 2026-11-13

## Contexto
Tesorero paga a proveedores y contratistas en la cadena y el token que cada uno prefiera. NEAR Intents **no tiene testnet** (HACKATHON.md Q-007). Los jueces deben poder reproducir la demo sin gastar dinero.

## Decisión
- **Activo base de tesorería:** USDC nativo en NEAR — `nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` (6 decimales).
- **Catálogo de destinos:** `GET https://1click.chaindefuser.com/v0/tokens` (cacheado por un job de Hangfire cada hora).
- **Cotización:** `POST /v0/quote` con `swapType: EXACT_INPUT`, `depositType: ORIGIN_CHAIN`, `recipientType: DESTINATION_CHAIN`, `refundType: ORIGIN_CHAIN`, `refundTo = cuenta de tesorería`, `slippageTolerance: 100`, `deadline = ahora + 30 min`.
- **Dos modos de ejecución** (ajuste de la organización, por defecto `Simulation`):
  - `Simulation`: cotización `dry: true` real (tasas y montos reales de 1Click) — no mueve fondos. Así se reproduce en la demo para los jueces.
  - `Live`: cotización `dry: false` → dirección de depósito → el Owner firma el `ft_transfer` del USDC con su wallet NEAR → el backend notifica `POST /v0/deposit/submit` → Hangfire consulta `GET /v0/status` hasta `SUCCESS | REFUNDED | FAILED`.
- **Saldo de tesorería:** RPC público de NEAR (FastNEAR) — `view_account` + `ft_balance_of` sobre el contrato USDC.
- JWT de 1Click opcional (`INTENTS_JWT`); sin él, 1Click cobra una comisión adicional, documentada.

## Consecuencias
- El backend nunca guarda claves privadas: en modo Live la firma es humana. La autonomía del agente se limita a planear, verificar políticas, cotizar y dar seguimiento. Es el modelo de "el humano fija las reglas y firma lo excepcional".
- `ft_transfer` requiere un depósito de 1 yoctoNEAR, así que una function-call key no puede hacerlo. Una futura versión con contrato de tesorería on-chain que aplique límites permitiría que el agente ejecute sin firma humana (fuera de alcance; anotado en el backlog).
