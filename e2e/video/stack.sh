#!/usr/bin/env bash
# Starts a fresh local stack for the demo video (multitenancy, ADR-0006):
#   API :5080 on a fresh database, with the demo tenant seeded and the production base domain, so every
#   address the app shows or e-mails reads tesorero.gesco.ec. record.mjs serves frontend/dist itself and
#   maps https://tesorero.gesco.ec and https://<slug>.tesorero.gesco.ec to this API (Host header kept).
#   Without SMTP, e-mails are saved as JSON in <work>/mail (Email:PickupDirectory) for the mail scenes.
# Usage: bash stack.sh start <work> | bash stack.sh stop
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
LOGS="${TMPDIR:-/tmp}"
DOTNET="dotnet"
if [ -x "${LOCALAPPDATA:-}/dotnet11/dotnet.exe" ]; then DOTNET="$LOCALAPPDATA/dotnet11/dotnet.exe"; export DOTNET_ROOT="$LOCALAPPDATA/dotnet11"; fi
export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1

stop() {
  # `dotnet x.dll` runs as dotnet.exe: stop only the processes running our API dll.
  powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='dotnet.exe'\" | Where-Object { \$_.CommandLine -like '*Tesorero.Api.dll*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }" >/dev/null 2>&1 || true
  taskkill //F //IM Tesorero.Api.exe >/dev/null 2>&1 || true
  for pid in $(netstat -ano 2>/dev/null | awk '$0 ~ /:5080 / && /LISTENING/ {print $NF}' | sort -u); do taskkill //F //PID "$pid" >/dev/null 2>&1 || true; done
}

if [ "${1:-start}" = "stop" ]; then stop; exit 0; fi
WORK="${2:?usage: stack.sh start <work>}"
mkdir -p "$WORK"
MAIL="$(cd "$WORK" && (pwd -W 2>/dev/null || pwd))/mail"
rm -rf "$WORK/mail"
stop

echo "▶ Fresh database"
docker rm -f tesorero-dev-pg >/dev/null 2>&1 || true
docker run -d --name tesorero-dev-pg -e POSTGRES_USER=tesorero -e POSTGRES_PASSWORD=tesorero_dev -e POSTGRES_DB=tesorero -p 55432:5432 postgres:17-alpine >/dev/null
for _ in $(seq 1 30); do docker exec tesorero-dev-pg pg_isready -U tesorero >/dev/null 2>&1 && break; sleep 1; done
sleep 2

echo "▶ Local NEAR node + mock USDC (the real treasury scenes run on it; nothing touches mainnet)"
docker rm -f nearhk-sandbox >/dev/null 2>&1 || true
SANDBOX_BIN=$(MSYS_NO_PATHCONV=1 docker run --rm -v nearhk-cargo-target:/target:ro nearhk-contracts-builder:local sh -c 'ls /target/debug/build/near-sandbox/*/out/.near/near-sandbox-*/near-sandbox | head -1')
MSYS_NO_PATHCONV=1 docker run -d --name nearhk-sandbox -p 127.0.0.1:3030:3030 -v nearhk-cargo-target:/target:ro nearhk-contracts-builder:local \
  sh -c "$SANDBOX_BIN --home /tmp/s init >/dev/null 2>&1; $SANDBOX_BIN --home /tmp/s run" >/dev/null
for _ in $(seq 1 40); do curl -s -m 2 -X POST http://127.0.0.1:3030 -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"status","params":[]}' | grep -q chain_id && break; sleep 1; done
GENESIS=$(docker exec nearhk-sandbox sh -c 'cat /tmp/s/validator_key.json' | python -c "import sys,json;print(json.load(sys.stdin)['secret_key'])")
"$DOTNET" run "$(cygpath -w "$ROOT/e2e/sandbox/tool.cs")" -- http://127.0.0.1:3030 deploy-usdc test.near "$GENESIS" "$(cygpath -w "$ROOT/contracts/res/mock_ft.wasm")" 2>"$WORK/tool.log" | grep -E '^USDC_' > "$WORK/usdc.env" || true
USDC=$(grep '^USDC_ID=' "$WORK/usdc.env" | cut -d= -f2)
[ -n "$USDC" ] || { echo "mock USDC deploy failed"; tail -5 "$WORK/tool.log"; exit 1; }

echo "▶ Build"
(cd "$ROOT/backend/src/Tesorero.Api" && "$DOTNET" build -nologo -v q >/dev/null)
(cd "$ROOT/frontend" && npm run build >/dev/null)

API_DIR="$ROOT/backend/src/Tesorero.Api"
DLL="bin/Debug/net11.0/Tesorero.Api.dll"
AI_KEY="$(grep '^deep_seek_token=' "$ROOT/SECRETS" | cut -d= -f2-)"

echo "▶ API :5080 (mail → $MAIL)"
(cd "$API_DIR" && ASPNETCORE_ENVIRONMENT=Development Ai__ApiKey="$AI_KEY" \
  Tenancy__BaseDomain=tesorero.gesco.ec Tenancy__Scheme=https Tenancy__PublicPort= \
  Email__PickupDirectory="$MAIL" Near__RpcUrl=http://127.0.0.1:3030 Near__UsdcContract="$USDC" \
  "$DOTNET" "$DLL" --urls http://localhost:5080 > "$LOGS/video-api.log" 2>&1 &) >/dev/null 2>&1

for _ in $(seq 1 60); do curl -fsS http://localhost:5080/health >/dev/null 2>&1 && break; sleep 2; done
curl -fsS http://localhost:5080/health >/dev/null && echo "  ok API"
curl -s -H "Host: demo.tesorero.gesco.ec" http://localhost:5080/api/instance; echo
