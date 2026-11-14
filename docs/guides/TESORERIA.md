# Guía para dueños: tu tesorería real en Tesorero

Todo se hace desde la app, en **Tesorería** (`https://<tu-organización>.tesorero.gesco.ec/treasury`). No necesitas la terminal.

## Las 3 cuentas (léelo una vez)

| Cuenta | Ejemplo | Para qué sirve | Quién la controla |
|---|---|---|---|
| **Tu wallet** (dueña) | `tunombre.near` | Es tuya. Desde ella cambias límites, reanudas tras una pausa y retiras dinero. | Sólo tú. Tesorero nunca la toca. |
| **Tesorería** (contrato) | `3fe9…` (64 caracteres) | La caja: aquí vive el USDC con el que se pagan las facturas. | Nadie puede cambiar su código (está bloqueada). El agente sólo puede pagar dentro de tus límites; tú administras. |
| **Agente** | `a1b2…` (64 caracteres) | La "mano" de Tesorero que firma los pagos. Sólo tiene NEAR para comisiones. | El servidor. **Nunca le envíes USDC.** |

## Paso 1 — Crear la tesorería (una sola vez, ~2.5 NEAR)

1. En **Tesorería → Crear mi tesorería**, escribe tu wallet NEAR (la dueña) y los **límites on-chain**: máximo por pago y máximo por día, en USDC. Empieza bajo (por ejemplo 50 / 100); los podrás subir desde tu wallet. Estos límites protegen tu dinero **aunque alguien robara el servidor**.
2. La app te muestra una **dirección de 64 caracteres** y un QR. Envía **2.5 NEAR** a esa dirección:
   - **Desde una wallet NEAR** (MyNearWallet, Meteor, HERE…): Enviar → NEAR → pega la dirección → 2.5.
   - **Desde Binance**: Retirar → NEAR → red **NEAR** → pega la dirección → 2.5 (Binance cobra su comisión aparte; envía un poco más si la descuenta del monto).
3. La app detecta el depósito sola. Pulsa **Crear mi tesorería**. En ~15 segundos:
   - despliega el contrato auditado (huella sha256 `24710670…0b19`) con tu wallet como dueña;
   - lo registra en USDC;
   - da 0.3 NEAR de comisiones al agente;
   - **borra su propia clave**: el contrato queda bloqueado para siempre.

   Cada paso tiene su enlace a NearBlocks para que lo verifiques.

¿En qué se van los 2.5 NEAR? ~1.62 quedan reservados por el espacio del contrato (regla de NEAR), 0.3 van al agente y el resto (~0.55) cubre el espacio de unos 120 pagos. No es un cobro de Tesorero.

## Paso 2 — Fondear con USDT desde Binance

En **Tesorería → Agregar fondos**:

- **Si ya tienes USDC en NEAR**: envíalo directamente a la dirección de la tesorería (red NEAR).
- **Desde Binance u otra red** (recomendado: **USDT en BNB Smart Chain (BEP20)**, comisión baja):
  1. Elige USDT · BNB Smart Chain y el monto (NEAR Intents tiene mínimos que la app te muestra; p. ej. Tron pide hoy ≥ 100 USD).
  2. **Dirección de reembolso**: tu dirección de depósito de Binance para USDT en BEP20 (Binance → Depositar → USDT → BSC). Si la conversión fallara, el dinero vuelve ahí.
  3. La app te da una **dirección de depósito, la red y el monto exacto**, con un plazo. En Binance: Retirar → USDT → red **BSC (BEP20)** → pega esa dirección → ese monto. Si tu retiro descuenta la comisión del monto, súmala para que llegue el monto exacto.
  4. La app sigue el estado. En 1–5 minutos verás **Completado** y el saldo USDC de la tesorería subirá.

## Paso 3 — Pasar a modo Real

Cuando todas las comprobaciones de **Tesorería** estén en verde (contrato, agente, bloqueada, USDC registrado, gas del agente, fondos, no pausada), ve a **Ajustes → Modo de ejecución → Real**. La app vuelve a verificar el contrato antes de aceptarlo.

Desde ese momento el agente paga solo las facturas que las políticas aprueban, y las excepciones esperan a un humano. Cada pago queda en **Pagos** con su transacción, y en **Tesorería → Movimientos** con su conciliación.

## Vigilancia

**Movimientos** lista todas las entradas y salidas reales de la tesorería (leídas de NEAR) y las concilia con lo que Tesorero hizo. **Si sale dinero que Tesorero no envió, aparece una alerta**: pausa la tesorería (Políticas → interruptor del agente) y revisa. Si fuiste tú (un retiro desde tu wallet), ignórala.

## Lo que sólo tu wallet puede hacer

Reanudar tras una pausa, cambiar límites on-chain, retirar USDC y cambiar el agente exigen la firma de **tu** wallet (1 yoctoNEAR): así nadie más, ni siquiera Tesorero, puede hacerlo. La app te da el comando exacto, ya relleno, para la CLI `near`. Pausar sí puede hacerlo la app (lo firma el agente) porque detener es siempre seguro.

## Seguridad en una frase

Aunque el servidor de Tesorero fuera comprometido, lo máximo que podría salir es tu **límite diario on-chain** (y como mucho el máximo por pago en cada transacción); la alerta de Movimientos te avisaría y tú puedes pausar desde tu wallet en cualquier momento.
