# ADR-0005 — Dinero real: contrato de tesorería en NEAR + agente con permisos acotados

- Estado: Aceptado · Fecha: 2026-11-14 · Sustituye la parte "Live" de ADR-0003

## Contexto
Tesorero debe poder usarse con dinero real, no sólo en una demo. Hasta ahora, el modo Live dependía de que un humano firmara cada depósito fuera de la app. Además, las reglas sólo vivían en el servidor: un servidor comprometido podía, en teoría, saltárselas.

## Decisión

### Dos capas de protección
1. **Off-chain (servidor):** el motor de políticas actual (ADR-0004) y las aprobaciones humanas por rol.
2. **On-chain (contrato `tesorero-treasury`):** el USDC vive en un contrato NEAR que sólo deja pagar a la cuenta **agente** y dentro de **límites por pago y diarios**, con pausa de emergencia. Aunque roben la clave del servidor, la pérdida máxima es el límite diario. Ese tope lo fija el owner con su propia wallet.

### Flujo Live autónomo
1. El pago queda `Approved` (por política o por un humano).
2. Job → cotización real 1Click (`dry: false`, `refundTo` = contrato) → `depositAddress`.
3. Job → el backend firma con la clave del agente una llamada a `treasury.pay(payment_id, deposit_address, amount)`.
4. El contrato registra el pago (idempotente por `payment_id`) y llama a `usdc.storage_deposit` (registration_only) + `usdc.ft_transfer(deposit_address, amount)`. Un callback marca `Done` o `Failed` y, si falla, devuelve el cupo diario.
5. El backend notifica `deposit/submit` a 1Click con el hash de la transacción → `Processing` → el job de polling sigue `/v0/status` hasta `SUCCESS | REFUNDED | FAILED`.
6. **Idempotencia:** antes de llamar a `pay`, el backend consulta `get_payment(payment_id)`. Si ya existe, reconcilia en lugar de volver a pagar. El contrato rechaza ids duplicados.

Si no hay clave de agente configurada, Live cae al flujo manual (el humano firma y pega el hash). Ese flujo se mantiene.

### Interfaz del contrato (fuente de verdad)
- `#[init] new(owner_id: AccountId, usdc_contract_id: AccountId, agent_id: Option<AccountId>, max_per_payment: U128, daily_limit: U128)`
- `pay(payment_id: String, deposit_address: AccountId, amount: U128) -> Promise`. Sólo el agente; no pausado; `payment_id` de 1 a 64 caracteres `[A-Za-z0-9_-]`, único; `0 < amount <= max_per_payment`; `spent_today + amount <= daily_limit` (día UTC por `block_timestamp`); el contrato debe tener NEAR suficiente para el storage deposit (0.00125 NEAR).
- `on_pay_complete(payment_id: String) -> bool` (`#[private]` callback)
- Owner, todos `#[payable]` con **exactamente 1 yoctoNEAR** (enmienda 2026-11-14): `set_agent(agent_id: Option<AccountId>)`, `set_limits(max_per_payment: U128, daily_limit: U128)` (`max <= daily`), `unpause()`, `set_owner(new_owner_id)`, `withdraw(receiver_id, amount) -> Promise`. El yocto obligatorio impide usarlos con una function-call key: cambiar privilegios o reanudar tras una pausa exige una clave de acceso completo (la wallet del owner).
- `pause()`: sin depósito; lo puede llamar el owner **o el agente** (el kill switch de la app pausa también on-chain). Sólo el owner puede reanudar (con 1 yocto).
- `ft_on_transfer(sender_id, amount, msg) -> PromiseOrValue<U128>`: acepta depósitos sólo del token USDC configurado (devuelve `0`); cualquier otro token se rechaza (devuelve `amount`).
- Vistas:
  - `get_config() -> { owner_id, agent_id, usdc_contract_id, max_per_payment, daily_limit, paused, spent_today, remaining_today, day }`
  - `get_payment(payment_id) -> Option<{ payment_id, deposit_address, amount, status: "Pending"|"Done"|"Failed", created_at_ns }>`
  - `get_payments(from_index: u64, limit: u64) -> Vec<…>`
- Eventos NEP-297 `{"standard":"tesorero","version":"1.0.0","event":…}`: `payment_requested`, `payment_completed`, `payment_failed`, `limits_updated`, `agent_updated`, `paused`, `unpaused`, `withdrawn`, `owner_updated`.

### Claves y cuentas
- **Contrato:** subcuenta del usuario, por ejemplo `tesorero.cruzespejose.near`. Guarda el USDC y algo de NEAR para storage.
- **Agente:** cuenta implícita cuya clave privada vive sólo en el `.env` del servidor (`NEAR_AGENT_ACCOUNT_ID`, `NEAR_AGENT_PRIVATE_KEY`). Sólo tiene NEAR para gas.
- La clave del agente **se genera en el servidor**: nunca pasa por el chat, el repo ni el portátil.
- **El owner firma con su wallet** el despliegue, los límites y los retiros. El agente nunca puede cambiar límites ni retirar.

### Firma en .NET
Implementación propia y mínima de borsh para `Transaction`/`SignedTransaction` con la acción `FunctionCall`. Ed25519 con BouncyCastle. RPC: `view_access_key` (nonce), `block` (hash final) y `send_tx` (`wait_until: EXECUTED_OPTIMISTIC`). La serialización se valida en las pruebas contra vectores generados con `near-api-js`.

### Instancias
- **Demo pública** (`Seed:Demo=true`): el modo Live está **prohibido**. Tiene un botón para reiniciar los datos y un banner de "demo pública".
- **Instancia real** (`Seed:Demo=false`): sin datos sembrados. El primer acceso crea el owner (alta inicial) y el owner gestiona usuarios.

## Consecuencias
- El radio de daño ante un compromiso del servidor queda acotado on-chain.
- Requiere acciones del usuario con su wallet: crear la subcuenta, desplegar, fondear y fijar límites. Están documentadas en `docs/guides/MAINNET.md`.
- Los destinos finales (otra cadena) no se pueden verificar on-chain con depósitos `ORIGIN_CHAIN`. El contrato acota *cuánto*; el servidor (lista blanca más cotización) controla *a quién*.

## Enmienda 2026-11-14 — verificación del contrato
- Implementado en `contracts/treasury` (near-sdk 5.30.2, rustc 1.100.0, cargo-near 0.23.0, build reproducible).
- 74 pruebas unitarias + 8 pruebas en sandbox (nearcore 2.14.1 vía near-workspaces) con el wasm real.
- Métricas medidas: `pay` ≈ 8–9 Tgas; 197 bytes por pago (≤ 0.0032 NEAR, permanentes) + 0.00125 NEAR por dirección de depósito nueva; ~1.61 NEAR bloqueados tras desplegar.
- Wasm de referencia: 161,162 bytes, sha256 `24710670636342b3cc617e9c66d1a39f260350c38ff36c3ee7d8d08dc07b0a19`.
