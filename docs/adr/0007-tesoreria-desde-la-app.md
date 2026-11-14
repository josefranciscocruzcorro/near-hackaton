# ADR-0007 — Crear, fondear y vigilar la tesorería desde la app

- Estado: aceptado (2026-11-14)
- Relacionado: ADR-0005 (contrato de tesorería), ADR-0006 (multiempresa)

## Contexto

Pasar a dinero real exigía la CLI de NEAR (crear subcuenta, desplegar el wasm, registrar USDC, fondear, dar gas al agente). Un dueño de negocio no sabe qué hacer con esas cuentas y claves. Además Tesorero sólo veía su propio saldo: no detectaba entradas ni salidas hechas por fuera.

Restricciones: Tesorero nunca tiene la clave de la wallet del dueño ni puede mover sus fondos; los límites on-chain sólo los cambia el dueño (1 yoctoNEAR, firma de su wallet).

## Decisión

### 1. Tesorería creada por la app con una clave de un solo uso que se autodestruye

1. El Owner elige su **wallet dueña** (cualquier cuenta NEAR existente) y los **límites on-chain** (máx. por pago y diario, en USDC).
2. El servidor genera un par de claves de despliegue (cifrado con `Tenancy:KeyEncryptionKey`) y muestra su **cuenta implícita** (64 hex): esa será la cuenta del contrato.
3. El dueño envía **2.5 NEAR** a esa dirección desde su wallet o desde un exchange (red NEAR). La app vigila el saldo.
4. Con el saldo recibido (mín. 2.2 NEAR), el servidor ejecuta, firmando con la clave de despliegue, pasos idempotentes y reanudables:
   1. `DeployContract(wasm auditado)` + `new(owner, usdc, agent = agente de la organización, límites)`;
   2. `storage_deposit` en USDC para la cuenta del contrato (0.00125 NEAR);
   3. `Transfer` de 0.3 NEAR al agente para gas (si tiene menos de 0.2);
   4. verificación: hash del código = sha256 del wasm publicado, `get_config` coincide;
   5. `DeleteKey` de su propia clave → el contrato queda **bloqueado**: nadie puede redesplegarlo ni vaciarlo; sólo el dueño administra (límites, pausa, retiros) y sólo el agente paga, dentro de los límites.
5. La cuenta se guarda como cuenta de tesorería (sigue en Simulación hasta que el Owner elija Real).

El wasm se embebe en la API con su sha256 (`24710670…0b19`); la app muestra el hash y la verificación es pública (`view_account.code_hash`).

### 2. Fondeo desde cualquier red (NEAR Intents)

- **USDC en NEAR**: se envía directo a la cuenta del contrato (está registrado en USDC).
- **USDT/USDC en otra red o exchange** (BSC, Ethereum, Solana, Arbitrum, Base, Tron…): cotización real 1Click `EXACT_INPUT` con destino USDC en NEAR y receptor = contrato. La app muestra dirección de depósito, red, monto exacto, memo si lo hay, plazo y QR, y sigue el estado hasta `SUCCESS`. Reembolso: a la dirección que indique el dueño en la red de origen (p. ej. su dirección de depósito del exchange). Los mínimos de 1Click (p. ej. Tron ≥ 100 USD temporalmente) se muestran tal cual.

### 3. Movimientos y alertas

`GET /api/treasury/movements` lee del indexador público NearBlocks las transferencias NEAR y FT de la cuenta del contrato, cacheadas 60 s, y las concilia:
- salida de USDC con hash = `onChainTxHash` de un pago de Tesorero → **pago conciliado**;
- entrada de USDC → **fondeo** (con su origen si coincide con un fondeo 1Click);
- salidas hechas por la clave de despliegue durante la creación → **creación**;
- **cualquier otra salida de USDC → alerta** (movimiento no iniciado por Tesorero).

### 4. Modo Real exige una tesorería verificada

Al guardar modo Real: la cuenta debe ser un contrato Tesorero (`get_config`) cuyo `agent_id` sea el agente de la organización; si no, 400 con explicación. (Las organizaciones sin agente siguen con Real manual.)

### 5. Acciones del dueño

Pausar: desde la app (lo firma el agente). Reanudar, cambiar límites, retirar, cambiar agente: requieren la wallet dueña (1 yoctoNEAR); la app muestra el comando exacto prellenado y explica por qué Tesorero no puede hacerlo.

## Consecuencias

- Un solo depósito de NEAR deja todo listo; no hace falta la CLI.
- La clave de despliegue existe sólo mientras la cuenta tiene el NEAR del depósito; tras el paso 5 deja de existir (en el servidor y on-chain).
- Riesgo residual: si el servidor fuese comprometido **antes** del bloqueo, podría usar el NEAR del depósito (≤ 2.5 NEAR), nunca USDC: el fondeo en USDC sólo es posible después del bloqueo (la app no lo ofrece antes).
- Dependencia nueva de NearBlocks (sólo lectura); si falla, la página muestra el error y el resto sigue funcionando.
