#!/usr/bin/env bash
# A pretend NEAR wallet for tests on the local sandbox (owner account test.near, which also holds mock USDC).
# Usage:
#   bash wallet.sh balance <account>              → NEAR / USDC of any account
#   bash wallet.sh send-near <address> <amount>   → like "Send NEAR" in a wallet app or a Binance withdrawal on the NEAR network
#   bash wallet.sh send-usdc <address> <amount>   → like sending USDC on NEAR from a wallet
# Needs: the sandbox container (nearhk-sandbox) and $SANDBOX_ENV (file written by setup.sh with the mock USDC keys).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${SANDBOX_ENV:-${TMPDIR:-/tmp}/usdc.env}"
DOTNET="dotnet"
if [ -x "${LOCALAPPDATA:-}/dotnet11/dotnet.exe" ]; then DOTNET="$LOCALAPPDATA/dotnet11/dotnet.exe"; fi
RPC=http://127.0.0.1:3030
USDC_ID=$(grep '^USDC_ID=' "$ENV_FILE" | cut -d= -f2)
USDC_SECRET=$(grep '^USDC_SECRET=' "$ENV_FILE" | cut -d= -f2)
GENESIS=$(docker exec nearhk-sandbox sh -c 'cat /tmp/s/validator_key.json' | python -c "import sys,json;print(json.load(sys.stdin)['secret_key'])")
run() { "$DOTNET" run "$HERE/tool.cs" -- "$RPC" "$@" 2>/dev/null | grep -v '^USDC_SECRET'; }

case "${1:-}" in
  balance)
    run inspect "$2" "$USDC_ID"
    python - "$USDC_ID" "$2" <<'PY'
import base64, json, sys, urllib.request
usdc, acct = sys.argv[1:3]
body = {'jsonrpc': '2.0', 'id': 1, 'method': 'query', 'params': {'request_type': 'call_function', 'finality': 'final', 'account_id': usdc,
        'method_name': 'ft_balance_of', 'args_base64': base64.b64encode(json.dumps({'account_id': acct}).encode()).decode()}}
r = json.load(urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:3030', data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'})))
print('USDC:', int(json.loads(bytes(r['result']['result']).decode())) / 1e6)
PY
    ;;
  send-near) run send-near test.near "$GENESIS" "$2" "$3" ;;
  send-usdc)
    units=$(python -c "print(int(round(float('$3')*1_000_000)))")
    run ft-transfer "$USDC_ID" "$USDC_SECRET" "$2" "$units" ;;
  *) echo "usage: wallet.sh balance|send-near|send-usdc ..."; exit 1 ;;
esac
