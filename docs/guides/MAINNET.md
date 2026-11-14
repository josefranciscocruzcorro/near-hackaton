# Guía MAINNET — contrato de tesorería `tesorero-treasury`

> **Lo normal es hacerlo desde la app** (ADR-0007): Tesorería → Crear mi tesorería, con un solo envío de 2.5 NEAR; la guía para dueños está en [TESORERIA.md](TESORERIA.md). Esta guía es la vía manual con la CLI `near` (cuenta con nombre `tesorero.<OWNER>.near`, Ledger, auditorías), y la referencia de las acciones que sólo firma la wallet dueña (paso 9).

Pasos que hace **el dueño (owner) con su propia wallet** para pasar su organización de Tesorero a dinero real (ADR-0005). Ningún paso lo ejecuta el agente ni el servidor, salvo generar la clave del agente (automático al crear la organización).

- CLI: [`near` (near-cli-rs)](https://github.com/near/near-cli-rs) ≥ 0.20. Comprueba con `near --version`.
- Los comandos usan `sign-with-keychain` (la clave que guardó `near account import-account`). Con Ledger, cámbialo por `sign-with-ledger`.
- **[GASTA]** = el paso **gasta dinero real** (NEAR o USDC). [lectura] = sólo lectura, gratis.
- USDC en NEAR: `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` (6 decimales: `1 USDC = 1000000`).

## 0. Variables

Copia y ajusta. Ejemplo rellenado para `cruzespejose.near`:

```bash
export OWNER=cruzespejose.near                    # tu cuenta principal (<OWNER>.near)
export TREASURY=tesorero.$OWNER                    # tesorero.<OWNER>.near
export USDC=17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1
export AGENT=<CUENTA_DEL_AGENTE>                  # 64 hex, en Ajustes de tu organización (paso 1)
export WASM=contracts/res/tesorero_treasury.wasm
```

## 1. La cuenta del agente de tu organización (ya existe)

Con multiempresa (ADR-0006), al verificar el registro el servidor genera **una cuenta de agente por organización**: la clave privada se guarda cifrada (AES-256-GCM) en la base de datos y nunca sale del servidor. La cuenta pública (64 hex) aparece en **Ajustes → Tipo de organización → Cuenta NEAR del agente** (botón de copiar): ese valor es `$AGENT`.

Esa cuenta implícita no existe en NEAR hasta que le envías NEAR (paso 7). No la copies a ningún otro sitio que no sea el `init` del contrato.

## 2. Compilar y verificar el wasm [lectura]

```bash
./contracts/build.sh     # imprime tamaño y sha256 de contracts/res/tesorero_treasury.wasm
./contracts/test.sh      # opcional: fmt, clippy, unit tests y sandbox
```

Build de referencia (imagen `nearhk-contracts-builder`: rustc 1.100.0, near-sdk 5.30.2, cargo-near 0.23.0): `tesorero_treasury.wasm` 161 162 bytes, sha256 `24710670636342b3cc617e9c66d1a39f260350c38ff36c3ee7d8d08dc07b0a19`. Si cambias el código el hash cambia: anota el tuyo, lo comprobarás en el paso 4.

## 3. Crear la subcuenta del contrato **[GASTA]**

Coste (medido en sandbox): el wasm ocupa 161 162 bytes y tras `new` la cuenta usa 161 498 bytes → **~1.61 NEAR bloqueados** por storage (1 NEAR por 100 KB). Cada pago añade 197–315 bytes según la longitud del `payment_id` (≤ 0.0032 NEAR, bloqueados para siempre: el historial no se borra) y además paga el registro de la deposit address en USDC (0.00125 NEAR; las direcciones de 1Click son nuevas en cada pago). Es decir, **≤ 0.0045 NEAR por pago**. Con **3 NEAR** quedan ~1.39 NEAR libres ≈ 300 pagos; recarga cuando haga falta (paso 10). Antes de cada pago el contrato exige saldo para su storage + 400 bytes + 0.00125 NEAR, o falla con `ERR_INSUFFICIENT_NEAR_FOR_STORAGE` sin mover nada.

```bash
near account create-account fund-myself $TREASURY '3 NEAR' \
  autogenerate-new-keypair save-to-keychain \
  sign-as $OWNER network-config mainnet sign-with-keychain send
```

## 4. Desplegar e inicializar **[GASTA]** (sólo gas)

Límites conservadores para empezar: **máx. 50 USDC por pago, 100 USDC al día**.

```bash
near contract deploy $TREASURY use-file $WASM \
  with-init-call new json-args "{\"owner_id\":\"$OWNER\",\"usdc_contract_id\":\"$USDC\",\"agent_id\":\"$AGENT\",\"max_per_payment\":\"50000000\",\"daily_limit\":\"100000000\"}" \
  prepaid-gas '30 Tgas' attached-deposit '0 NEAR' \
  network-config mainnet sign-with-keychain send
```

Comprueba que el código desplegado es el que compilaste (el sha256 debe coincidir con el del paso 2) y la configuración:

```bash
near account view-account-summary $TREASURY network-config mainnet now     # [lectura] "Contract (SHA-256 checksum hex)"
near contract call-function as-read-only $TREASURY get_config json-args '{}' network-config mainnet now   # [lectura]
```

## 5. Registrar el contrato en USDC **[GASTA]** (0.00125 NEAR)

```bash
near contract call-function as-transaction $USDC storage_deposit \
  json-args "{\"account_id\":\"$TREASURY\",\"registration_only\":true}" \
  prepaid-gas '30 Tgas' attached-deposit '0.00125 NEAR' \
  sign-as $OWNER network-config mainnet sign-with-keychain send
```

## 6. Fondear el contrato con USDC **[GASTA]** (USDC real)

Mira tu saldo y envía, por ejemplo, 100 USDC con `ft_transfer_call` (`msg` vacío). El contrato sólo acepta USDC: cualquier otro token se devuelve solo.

```bash
near tokens $OWNER view-ft-balance $USDC network-config mainnet now        # [lectura]
near contract call-function as-transaction $USDC ft_transfer_call \
  json-args "{\"receiver_id\":\"$TREASURY\",\"amount\":\"100000000\",\"msg\":\"\"}" \
  prepaid-gas '100 Tgas' attached-deposit '1 yoctoNEAR' \
  sign-as $OWNER network-config mainnet sign-with-keychain send
near tokens $TREASURY view-ft-balance $USDC network-config mainnet now     # [lectura] debe mostrar 100 USDC
```

> Un `ft_transfer` simple al contrato también deja el saldo, pero usa `ft_transfer_call`: pasa por `ft_on_transfer`, que deja constancia en el log y rechaza tokens que no son USDC.

## 7. Dar gas al agente **[GASTA]** (~0.5 NEAR)

El agente sólo necesita NEAR para gas. Cada `pay` quema ~9 Tgas en total (~0.001 NEAR; medido en sandbox). El servidor adjunta 100 Tgas (el contrato exige ≥ 60) y el sobrante se devuelve. 0.5 NEAR dan para cientos de pagos.

```bash
near tokens $OWNER send-near $AGENT '0.5 NEAR' network-config mainnet sign-with-keychain send
```

## 8. Conectar la app

En **Ajustes** de tu organización (`https://<tu-subdominio>.tesorero.gesco.ec/settings`), pon `tesorero.<OWNER>.near` (el **contrato**, no tu cuenta personal) como cuenta NEAR de tesorería y elige modo **Live**. La app leerá `get_config` y el saldo USDC del contrato, y el agente pagará llamando a `pay` dentro de los límites on-chain.

## 9. Operación diaria

Ver estado [lectura]

```bash
near contract call-function as-read-only $TREASURY get_config json-args '{}' network-config mainnet now
near contract call-function as-read-only $TREASURY get_payment json-args '{"payment_id":"<ID>"}' network-config mainnet now
near contract call-function as-read-only $TREASURY get_payments json-args '{"from_index":0,"limit":20}' network-config mainnet now
```

`spent_today`/`remaining_today` se reinician a las 00:00 UTC. Un pago fallido (`Failed`) devuelve su cupo si falla el mismo día.

**Pausar** (kill switch; también lo puede hacer el agente desde la app) **[GASTA]** gas

```bash
near contract call-function as-transaction $TREASURY pause json-args '{}' \
  prepaid-gas '30 Tgas' attached-deposit '0 NEAR' \
  sign-as $OWNER network-config mainnet sign-with-keychain send
```

**Reanudar** (sólo el owner, 1 yoctoNEAR) **[GASTA]** gas

```bash
near contract call-function as-transaction $TREASURY unpause json-args '{}' \
  prepaid-gas '30 Tgas' attached-deposit '1 yoctoNEAR' \
  sign-as $OWNER network-config mainnet sign-with-keychain send
```

**Cambiar límites** (`max_per_payment <= daily_limit`, ambos > 0; ejemplo 100 / 500 USDC) **[GASTA]** gas

```bash
near contract call-function as-transaction $TREASURY set_limits \
  json-args '{"max_per_payment":"100000000","daily_limit":"500000000"}' \
  prepaid-gas '30 Tgas' attached-deposit '1 yoctoNEAR' \
  sign-as $OWNER network-config mainnet sign-with-keychain send
```

**Retirar USDC** (sólo owner, exactamente 1 yoctoNEAR; funciona aunque esté pausado) **[GASTA]** mueve USDC real

```bash
near contract call-function as-transaction $TREASURY withdraw \
  json-args "{\"receiver_id\":\"$OWNER\",\"amount\":\"50000000\"}" \
  prepaid-gas '100 Tgas' attached-deposit '1 yoctoNEAR' \
  sign-as $OWNER network-config mainnet sign-with-keychain send
```

El receptor debe estar registrado en USDC. Si la transferencia falla, el USDC se queda en el contrato y el log dice `ERR_WITHDRAW_FAILED`; si sale bien, se emite el evento `withdrawn`.

**Rotar el agente** (p. ej. si sospechas que robaron la clave del servidor) **[GASTA]** gas

1. Pausa (arriba). 2. Pide al operador del servidor una cuenta de agente nueva para tu organización y fondéala (paso 7). 3. Cambia el agente y reanuda:

```bash
near contract call-function as-transaction $TREASURY set_agent \
  json-args '{"agent_id":"<NUEVO_AGENTE_IMPLICITO>"}' \
  prepaid-gas '30 Tgas' attached-deposit '1 yoctoNEAR' \
  sign-as $OWNER network-config mainnet sign-with-keychain send
```

Con `'{"agent_id":null}'` desactivas el agente (nadie puede pagar; vuelves al flujo manual).

**Cambiar de owner** **[GASTA]** gas — irreversible desde la cuenta vieja; revisa el id dos veces.

```bash
near contract call-function as-transaction $TREASURY set_owner \
  json-args '{"new_owner_id":"<NUEVO_OWNER>.near"}' \
  prepaid-gas '30 Tgas' attached-deposit '1 yoctoNEAR' \
  sign-as $OWNER network-config mainnet sign-with-keychain send
```

## 10. Recargar NEAR del contrato **[GASTA]**

Si `pay` falla con `ERR_INSUFFICIENT_NEAR_FOR_STORAGE`:

```bash
near account view-account-summary $TREASURY network-config mainnet now     # [lectura] saldo y storage usado
near tokens $OWNER send-near $TREASURY '1 NEAR' network-config mainnet sign-with-keychain send
```

## Seguridad: qué protege y qué no

- Aunque roben la clave del servidor, el atacante sólo puede llamar a `pay` (o `pause`): pérdida máxima = `daily_limit` por día UTC. No puede cambiar límites, agente ni retirar.
- El contrato acota **cuánto**; **a quién** lo controla el servidor (lista blanca + cotización 1Click).
- **Crítico:** la clave full-access de `tesorero.<OWNER>.near` (creada en el paso 3, en tu keychain) **puede redesplegar código distinto y vaciar la tesorería**, saltándose todos los límites. Trátala exactamente como la de tu cuenta principal (Ledger o keychain del sistema, nunca en un servidor).
  - Opción más segura, una vez verificado el despliegue: **bloquear el contrato** borrando esa clave. El código ya no se puede cambiar; tú sigues controlando límites, pausa y retiros desde `$OWNER` con el método `withdraw`.
    ```bash
    near account list-keys $TREASURY network-config mainnet now                 # [lectura] copia la public key
    near account delete-keys $TREASURY public-keys <ed25519:...> network-config mainnet sign-with-keychain send   # [GASTA] gas · IRREVERSIBLE
    ```
    Consecuencia: para actualizar el contrato tendrías que desplegar uno nuevo y mover los fondos con `withdraw`.
- `unpause`, `set_limits`, `set_agent`, `set_owner` y `withdraw` exigen **exactamente 1 yoctoNEAR** (`attached-deposit '1 yoctoNEAR'`; con 0 o 2 fallan con `ERR_REQUIRES_ONE_YOCTO`). Así sólo una clave full-access (confirmación en tu wallet) puede cambiar privilegios, mover fondos o reanudar tras una pausa. `pause` no lleva depósito (y no lo acepta), para que el agente o tú podáis frenar todo con una transacción normal.
