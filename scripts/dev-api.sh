#!/usr/bin/env bash
# Runs the API locally on http://localhost:5080 against the dev Postgres (port 55432).
# Requires: .NET 11 SDK. DEEPSEEK_API_KEY may be exported, or is read from ./SECRETS if present.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOTNET="${DOTNET:-dotnet}"
if [ -x "${LOCALAPPDATA:-}/dotnet11/dotnet.exe" ]; then DOTNET="$LOCALAPPDATA/dotnet11/dotnet.exe"; export DOTNET_ROOT="$LOCALAPPDATA/dotnet11"; fi
if [ -z "${DEEPSEEK_API_KEY:-}" ] && [ -f "$ROOT/SECRETS" ]; then
  DEEPSEEK_API_KEY="$(grep '^deep_seek_token=' "$ROOT/SECRETS" | cut -d= -f2-)"
fi
export Ai__ApiKey="${DEEPSEEK_API_KEY:-}" ASPNETCORE_ENVIRONMENT=Development DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
cd "$ROOT/backend/src/Tesorero.Api"
exec "$DOTNET" run --launch-profile http
