#!/usr/bin/env bash
# Full local E2E: fresh database → API (:5080) → built PWA via `vite preview` (:4173) → Playwright.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
LOGS="${TMPDIR:-/tmp}"

stop_stack() {
  # `dotnet run` and `npx` spawn children that outlive their wrappers: stop them by image name (only ours).
  if command -v taskkill >/dev/null 2>&1; then
    taskkill //F //IM Tesorero.Api.exe >/dev/null 2>&1 || true
  else
    pkill -f Tesorero.Api >/dev/null 2>&1 || true
  fi
  pkill -f "vite preview --port 4173" >/dev/null 2>&1 || true
  for pid in $(netstat -ano 2>/dev/null | awk '/:4173 .*LISTENING/ {print $NF}' | sort -u); do taskkill //F //PID "$pid" >/dev/null 2>&1 || true; done
}
stop_stack

echo "▶ Fresh dev database"
docker rm -f tesorero-dev-pg >/dev/null 2>&1 || true
docker run -d --name tesorero-dev-pg -e POSTGRES_USER=tesorero -e POSTGRES_PASSWORD=tesorero_dev -e POSTGRES_DB=tesorero -p 55432:5432 postgres:17-alpine >/dev/null
for _ in $(seq 1 30); do docker exec tesorero-dev-pg pg_isready -U tesorero >/dev/null 2>&1 && break; sleep 1; done
sleep 2

echo "▶ API"
bash "$ROOT/scripts/dev-api.sh" > "$LOGS/tesorero-e2e-api.log" 2>&1 &
API_PID=$!
echo "▶ PWA preview"
(cd "$ROOT/frontend" && npm run build >/dev/null && npx vite preview --port 4173 --strictPort > "$LOGS/tesorero-e2e-web.log" 2>&1) &
WEB_PID=$!
cleanup() { kill "$API_PID" "$WEB_PID" 2>/dev/null || true; stop_stack; }
trap cleanup EXIT

for _ in $(seq 1 60); do curl -fsS http://localhost:5080/health >/dev/null 2>&1 && break; sleep 2; done
for _ in $(seq 1 60); do curl -fsS http://localhost:4173/ >/dev/null 2>&1 && break; sleep 2; done
export E2E_API_LOG="$LOGS/tesorero-e2e-api.log"

mkdir -p "$HERE/screenshots"
cd "$HERE" && npx playwright test "$@"
