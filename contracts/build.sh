#!/usr/bin/env bash
# Compila los contratos dentro de Docker (no hace falta Rust en el host).
# Salida: contracts/res/tesorero_treasury.wasm (+ ABI) y contracts/res/mock_ft.wasm (sólo pruebas).
#
#   ./contracts/build.sh            # treasury + mock-ft
#   ./contracts/build.sh treasury   # sólo treasury
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=docker/env.sh
source "$HERE/docker/env.sh"

WHAT="${1:-all}"

nearhk_ensure_image

nearhk_run bash -euo pipefail -c '
  build() {
    local crate="$1"
    echo ">> cargo near build ${crate}"
    cargo near build non-reproducible-wasm --locked \
      --manifest-path "/work/${crate}/Cargo.toml" --out-dir /work/res
  }
  mkdir -p /work/res
  if [ "'"$WHAT"'" = "all" ] || [ "'"$WHAT"'" = "treasury" ]; then build treasury; fi
  if [ "'"$WHAT"'" = "all" ] || [ "'"$WHAT"'" = "mock-ft" ]; then build mock-ft; fi
  echo
  echo ">> artefactos"
  cd /work/res
  for f in *.wasm; do
    printf "%-28s %8s bytes  sha256 %s\n" "$f" "$(stat -c %s "$f")" "$(sha256sum "$f" | cut -d" " -f1)"
  done
'
