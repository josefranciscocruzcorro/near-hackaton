# Imagen de build/test para los contratos NEAR de Tesorero.
# Rust oficial + target wasm32 + clippy/rustfmt + cargo-near (binario oficial verificado por sha256).
# trixie (glibc 2.41): el binario near-sandbox 2.14 que usa near-workspaces exige glibc >= 2.39.
ARG RUST_VERSION=1.100.0
FROM rust:${RUST_VERSION}-trixie

ARG CARGO_NEAR_VERSION=0.23.0

RUN rustup component add clippy rustfmt \
 && rustup target add wasm32-unknown-unknown

RUN set -eux; \
    base="https://github.com/near/cargo-near/releases/download/cargo-near-v${CARGO_NEAR_VERSION}"; \
    file="cargo-near-x86_64-unknown-linux-gnu.tar.gz"; \
    cd /tmp; \
    curl -fsSLO "${base}/${file}"; \
    curl -fsSLO "${base}/${file}.sha256"; \
    sha256sum -c "${file}.sha256"; \
    tar -xzf "${file}"; \
    install -m 0755 "$(find /tmp -type f -name cargo-near | head -n1)" /usr/local/cargo/bin/cargo-near; \
    rm -rf /tmp/cargo-near*; \
    cargo near --version

WORKDIR /work
