# contracts/

Contratos NEAR de Tesorero (ADR-0005). Todo se compila y prueba **dentro de Docker**: no hace falta Rust en el host.

| Crate | Qué es |
|---|---|
| `treasury/` (`tesorero-treasury`) | Contrato de tesorería: custodia USDC, sólo el agente paga, límites por pago y diarios, pausa. **Es el que va a mainnet.** |
| `mock-ft/` | Token NEP-141 mínimo (near-contract-standards). **Sólo pruebas.** |
| `integration-tests/` | Pruebas de sandbox con `near-workspaces` (nearcore local). |

## Comandos (Git Bash / Linux)

```bash
./contracts/build.sh   # → contracts/res/tesorero_treasury.wasm (+ ABI) y mock_ft.wasm, imprime sha256
./contracts/test.sh    # fmt --check, clippy -D warnings, unit tests, build y pruebas de sandbox
./contracts/test.sh unit   # sin sandbox
```

Recursos Docker (prefijo `nearhk`, ADR-0002): imagen `nearhk-contracts-builder:local` (`docker/Dockerfile`), volúmenes de caché `nearhk-cargo-registry`, `nearhk-cargo-git`, `nearhk-cargo-target`, `nearhk-near-sandbox`. Contenedores efímeros (`--rm`).

## Toolchain

- Rust `1.100.0` (fijado en `rust-toolchain.toml` y en la imagen), `near-sdk = 5.30.2`, `near-workspaces = 0.24.0`.
- Build con `cargo-near 0.23.0` (`cargo near build non-reproducible-wasm`): añade `--cfg near` (requerido por near-sdk ≥ 5.27), incrusta el ABI y pasa `wasm-opt`, que es lo que deja el wasm aceptable para la VM de nearcore con rustc ≥ 1.82. cargo-near comprueba además el techo de rustc frente al protocolo objetivo (85).
- La imagen es `rust:1.100.0-trixie`: el binario `near-sandbox` 2.14.1 que descarga near-workspaces necesita glibc ≥ 2.39 (bookworm no sirve).
- Build de referencia: `tesorero_treasury.wasm` 161 162 bytes, sha256 `24710670636342b3cc617e9c66d1a39f260350c38ff36c3ee7d8d08dc07b0a19` (reproducible con la misma imagen; cambia si cambias el código).
- No compiles el wasm con `cargo build --target wasm32-unknown-unknown` a mano: sin `--cfg near` y sin `wasm-opt` el resultado no es el que se probó.

## Interfaz

Exactamente la de [ADR-0005](../docs/adr/0005-dinero-real-contrato-de-tesoreria.md) (enmienda incluida: `unpause`, `set_limits`, `set_agent`, `set_owner` y `withdraw` exigen exactamente 1 yoctoNEAR → `ERR_REQUIRES_ONE_YOCTO`; `pause` va sin depósito). Además hay un callback privado `on_withdraw_complete` (emite `withdrawn` sólo si la transferencia salió bien) y el método NEP-330 `contract_source_metadata` que añade near-sdk.

Despliegue en mainnet: [docs/guides/MAINNET.md](../docs/guides/MAINNET.md).
