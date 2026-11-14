#!/usr/bin/env bash
# Calidad + pruebas dentro de Docker:
#   fmt --check, clippy -D warnings, unit tests, build wasm, pruebas de sandbox (near-workspaces).
#
#   ./contracts/test.sh          # todo
#   ./contracts/test.sh unit     # sin sandbox
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=docker/env.sh
source "$HERE/docker/env.sh"

MODE="${1:-all}"

nearhk_ensure_image

nearhk_run bash -euo pipefail -c '
  echo ">> cargo fmt --check"
  cargo fmt --all -- --check
  echo ">> cargo clippy (-D warnings)"
  cargo clippy --locked --workspace --all-targets -- -D warnings
  echo ">> unit tests"
  cargo test --locked -p tesorero-treasury
'

if [ "$MODE" = "unit" ]; then exit 0; fi

"$HERE/build.sh"

nearhk_run bash -euo pipefail -c '
  echo ">> sandbox tests (near-workspaces)"
  cargo test --locked -p integration-tests -- --nocapture --test-threads 4
'
