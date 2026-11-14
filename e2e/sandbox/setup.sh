#!/usr/bin/env bash
# A realistic local Tesorero for end-to-end tests of the real-money flow, without mainnet (ADR-0007):
#   - a local NEAR node (container nearhk-sandbox, RPC 127.0.0.1:3030) with a mock USDC token;
#   - the API on :5080 pointed at that node (fresh database, real DeepSeek, e-mails saved in <work>/mail);
#   - the built PWA on :4173 (landing http://localhost:4173, organizations http://<slug>.localhost:4173).
# The owner wallet is test.near; `bash wallet.sh` plays the wallet/exchange (send NEAR or USDC to any address).
# NEAR Intents quotes still come from the real 1Click API, but deposits only ever happen on the local node.
# Usage: bash setup.sh <work>   ·   bash setup.sh stop
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
DOTNET="dotnet"
if [ -x "${LOCALAPPDATA:-}/dotnet11/dotnet.exe" ]; then DOTNET="$LOCALAPPDATA/dotnet11/dotnet.exe"; export DOTNET_ROOT="$LOCALAPPDATA/dotnet11"; fi
export MSYS_NO_PATHCONV=1
TOOL="$(cygpath -w "$HERE/tool.cs" 2>/dev/null || echo "$HERE/tool.cs")"

stop() {
  # `dotnet x.dll` runs as dotnet.exe: stop only the processes running our API dll.
  powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='dotnet.exe'\" | Where-Object { \$_.CommandLine -like '*Tesorero.Api.dll*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }" >/dev/null 2>&1 || true
  for port in 5080 4173; do
    for pid in $(netstat -ano 2>/dev/null | awk -v p=":$port " '$0 ~ p && /LISTENING/ {print $NF}' | sort -u); do taskkill //F //PID "$pid" >/dev/null 2>&1 || true; done
  done
}
if [ "${1:-}" = "stop" ]; then stop; docker rm -f nearhk-sandbox >/dev/null 2>&1 || true; exit 0; fi
WORK="${1:?usage: setup.sh <work>}"
mkdir -p "$WORK"
WORK_W="$(cd "$WORK" && (pwd -W 2>/dev/null || pwd))"
stop

echo "▶ Local NEAR node"
docker rm -f nearhk-sandbox >/dev/null 2>&1 || true
SANDBOX_BIN=$(docker run --rm -v nearhk-cargo-target:/target:ro nearhk-contracts-builder:local sh -c 'ls /target/debug/build/near-sandbox/*/out/.near/near-sandbox-*/near-sandbox | head -1')
docker run -d --name nearhk-sandbox -p 127.0.0.1:3030:3030 -v nearhk-cargo-target:/target:ro nearhk-contracts-builder:local \
  sh -c "$SANDBOX_BIN --home /tmp/s init >/dev/null 2>&1; $SANDBOX_BIN --home /tmp/s run" >/dev/null
for _ in $(seq 1 40); do curl -s -m 2 -X POST http://127.0.0.1:3030 -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"status","params":[]}' | grep -q chain_id && break; sleep 1; done
GENESIS=$(docker exec nearhk-sandbox sh -c 'cat /tmp/s/validator_key.json' | python -c "import sys,json;print(json.load(sys.stdin)['secret_key'])")

echo "▶ Mock USDC"
"$DOTNET" run "$TOOL" -- http://127.0.0.1:3030 deploy-usdc test.near "$GENESIS" "$(cygpath -w "$ROOT/contracts/res/mock_ft.wasm" 2>/dev/null || echo "$ROOT/contracts/res/mock_ft.wasm")" 2>"$WORK/tool.log" | grep -E "^USDC_" > "$WORK/usdc.env" || { echo "mock USDC deploy failed:"; tail -20 "$WORK/tool.log"; exit 1; }
USDC=$(grep '^USDC_ID=' "$WORK/usdc.env" | cut -d= -f2)

echo "▶ Fresh database + API :5080"
docker rm -f tesorero-dev-pg >/dev/null 2>&1 || true
docker run -d --name tesorero-dev-pg -e POSTGRES_USER=tesorero -e POSTGRES_PASSWORD=tesorero_dev -e POSTGRES_DB=tesorero -p 55432:5432 postgres:17-alpine >/dev/null
for _ in $(seq 1 30); do docker exec tesorero-dev-pg pg_isready -U tesorero >/dev/null 2>&1 && break; sleep 1; done
sleep 2
(cd "$ROOT/backend/src/Tesorero.Api" && "$DOTNET" build -nologo -v q >/dev/null)
AI_KEY="$(grep '^deep_seek_token=' "$ROOT/SECRETS" | cut -d= -f2-)"
rm -rf "$WORK/mail"
(cd "$ROOT/backend/src/Tesorero.Api" && ASPNETCORE_ENVIRONMENT=Development Ai__ApiKey="$AI_KEY" \
  Near__RpcUrl=http://127.0.0.1:3030 Near__UsdcContract="$USDC" Email__PickupDirectory="$WORK_W\\mail" \
  "$DOTNET" bin/Debug/net11.0/Tesorero.Api.dll --urls http://localhost:5080 > "$WORK/api.log" 2>&1 &)

echo "▶ PWA :4173"
(cd "$ROOT/frontend" && npm run build >/dev/null && npx vite preview --port 4173 --strictPort > "$WORK/web.log" 2>&1 &) >/dev/null 2>&1
for url in http://localhost:5080/health http://localhost:4173/; do
  for _ in $(seq 1 60); do curl -fsS "$url" >/dev/null 2>&1 && break; sleep 2; done
  curl -fsS "$url" >/dev/null && echo "  ok $url"
done
echo "SANDBOX_ENV=$WORK/usdc.env  MAIL=$WORK/mail  wallet: SANDBOX_ENV=$WORK/usdc.env bash $HERE/wallet.sh"
