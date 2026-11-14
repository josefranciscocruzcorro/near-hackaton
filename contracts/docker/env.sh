#!/usr/bin/env bash
# Utilidades compartidas por build.sh y test.sh. Todos los recursos Docker llevan el
# prefijo nearhk (ADR-0002): imagen, volúmenes de caché y contenedores efímeros (--rm).

NEARHK_IMAGE="${NEARHK_IMAGE:-nearhk-contracts-builder:local}"
NEARHK_CONTRACTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Git Bash en Windows reescribe rutas tipo /work; lo desactivamos.
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL="*"

nearhk_host_path() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else echo "$1"; fi
}

nearhk_ensure_image() {
  if ! docker image inspect "$NEARHK_IMAGE" >/dev/null 2>&1; then
    echo ">> construyendo imagen $NEARHK_IMAGE"
    docker build -t "$NEARHK_IMAGE" "$(nearhk_host_path "$NEARHK_CONTRACTS_DIR/docker")"
  fi
}

nearhk_run() {
  docker run --rm --name "nearhk-contracts-$$" \
    -v "$(nearhk_host_path "$NEARHK_CONTRACTS_DIR"):/work" \
    -v nearhk-cargo-registry:/usr/local/cargo/registry \
    -v nearhk-cargo-git:/usr/local/cargo/git \
    -v nearhk-cargo-target:/target \
    -v nearhk-near-sandbox:/root/.near \
    -e CARGO_TARGET_DIR=/target \
    -e CARGO_TERM_COLOR=never \
    -w /work \
    "$NEARHK_IMAGE" "$@"
}
