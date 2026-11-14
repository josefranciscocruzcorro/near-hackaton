#!/usr/bin/env bash
# Deploys Tesorero to the shared VPS without touching other stacks (ADR-0002).
#   scripts/deploy.sh                 → public demo   (/root/nearhk,     stack nearhk,     127.0.0.1:32080)
#   TARGET=live scripts/deploy.sh     → real money    (/root/nearhklive, stack nearhklive, 127.0.0.1:32081)
#   SKIP_FRONTEND=1 …                 → reuse the existing frontend/dist
# Requirements: an SSH key for the server (DEPLOY_SSH_KEY, default ~/.ssh/id_ed25519); SECRETS file with ip= and deep_seek_token=.
# Optional: SMTP_SOURCE_ENV=/path/on/server/.env to copy EMAIL_* settings from (values are never printed).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="root@$(grep '^ip=' "$ROOT/SECRETS" | cut -d= -f2-)"
KEY="${DEPLOY_SSH_KEY:-$HOME/.ssh/id_ed25519}"
SMTP_SOURCE_ENV="${SMTP_SOURCE_ENV:-}"
SSH=(ssh -i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes "$HOST")
VERSION="$(date -u +%Y.%m.%d-%H%M)"
TARGET="${TARGET:-demo}"

case "$TARGET" in
  demo) REMOTE=/root/nearhk;     STACK=nearhk;     PORT=32080; SUBNET=10.88.0.0/24; SEED_DEMO=true ;;
  live) REMOTE=/root/nearhklive; STACK=nearhklive; PORT=32081; SUBNET=10.88.1.0/24; SEED_DEMO=true ;;
  *) echo "TARGET must be demo or live"; exit 2 ;;
esac

if [ "${SKIP_FRONTEND:-0}" != "1" ]; then
  echo "▶ Building frontend ($VERSION)"
  # Reinstall only when needed: on Windows, native modules in node_modules can be locked by other processes.
  (cd "$ROOT/frontend" && { [ -d node_modules ] || npm ci --no-audit --no-fund; } && VITE_APP_VERSION="$VERSION" npm run build)
fi

echo "▶ Snapshot of running containers (before)"
"${SSH[@]}" "docker ps --format '{{.Names}} {{.Status}}' | sort" > "${TMPDIR:-/tmp}/nearhk-before.txt"

echo "▶ Shipping code to $REMOTE ($TARGET)"
"${SSH[@]}" "mkdir -p $REMOTE"
tar -C "$ROOT" -czf - \
  --exclude=bin --exclude=obj --exclude=node_modules --exclude=backend/tests --exclude=.vs \
  backend docker-compose.yml nginx.conf .env.example \
  $( ls "$ROOT"/media/*.mp4 >/dev/null 2>&1 && echo media ) \
  $( [ -d "$ROOT/frontend/dist" ] && echo frontend/dist ) \
  | "${SSH[@]}" "tar -C $REMOTE -xzf -"

echo "▶ Ensuring server .env (secrets generated on the server, AI key sent via stdin)"
grep '^deep_seek_token=' "$ROOT/SECRETS" | cut -d= -f2- | "${SSH[@]}" "set -e; cd $REMOTE; KEY=\$(cat);
  if [ ! -f .env ]; then
    cp .env.example .env
    sed -i \"s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=\$(openssl rand -hex 24)|\" .env
    sed -i \"s|^JWT_SIGNING_KEY=.*|JWT_SIGNING_KEY=\$(openssl rand -base64 48 | tr -d '\n')|\" .env
  fi
  grep -q '^STACK=' .env || echo 'STACK=' >> .env
  grep -q '^STACK_SUBNET=' .env || echo 'STACK_SUBNET=' >> .env
  sed -i \"s|^STACK=.*|STACK=$STACK|; s|^STACK_SUBNET=.*|STACK_SUBNET=$SUBNET|; s|^PUBLIC_HTTP_PORT=.*|PUBLIC_HTTP_PORT=$PORT|; s|^SEED_DEMO=.*|SEED_DEMO=$SEED_DEMO|\" .env
  sed -i \"s|^DEEPSEEK_API_KEY=.*|DEEPSEEK_API_KEY=\$KEY|\" .env
  sed -i \"s|^APP_VERSION=.*|APP_VERSION=$VERSION|; s|^APP_BUILT_AT=.*|APP_BUILT_AT=$(date -u +%FT%TZ)|\" .env
  chmod 600 .env"

echo "▶ Building and starting the $STACK stack"
"${SSH[@]}" "cd $REMOTE && docker compose -p $STACK up -d --build --remove-orphans 2>&1 | tail -20"
# nginx.conf is a bind-mounted file replaced by tar (new inode): restart so nginx reads the new one.
"${SSH[@]}" "cd $REMOTE && docker compose -p $STACK restart nginx 2>&1 | tail -2"

if [ "$TARGET" = "live" ]; then
  echo "▶ Tenancy key (generated on the server once) and SMTP (copied from SMTP_SOURCE_ENV if set; values never printed)"
  "${SSH[@]}" 'bash -s' <<REMOTE
set -e
cd $REMOTE
for v in TENANCY_KEY_ENCRYPTION_KEY EMAIL_HOST EMAIL_PORT EMAIL_USE_TLS EMAIL_HOST_USER EMAIL_HOST_PASSWORD DEFAULT_FROM_EMAIL; do
  grep -q "^\$v=" .env || echo "\$v=" >> .env
done
grep -q '^TENANCY_KEY_ENCRYPTION_KEY=.' .env || sed -i "s|^TENANCY_KEY_ENCRYPTION_KEY=.*|TENANCY_KEY_ENCRYPTION_KEY=\$(openssl rand -base64 32)|" .env
if ! grep -q '^EMAIL_HOST=.' .env && [ -n "$SMTP_SOURCE_ENV" ] && [ -f "$SMTP_SOURCE_ENV" ]; then
  for v in EMAIL_HOST EMAIL_PORT EMAIL_USE_TLS EMAIL_HOST_USER EMAIL_HOST_PASSWORD DEFAULT_FROM_EMAIL; do
    line=\$(grep "^\$v=" "$SMTP_SOURCE_ENV" | head -1 || true)
    if [ -n "\$line" ]; then sed -i "/^\$v=/d" .env; printf '%s\n' "\$line" >> .env; fi
  done
fi
chmod 600 .env
docker compose -p $STACK up -d api 2>&1 | tail -1
REMOTE

  echo "▶ Agent key (generated on the server once; the private key never leaves it)"
  "${SSH[@]}" "set -e; cd $REMOTE
    if ! grep -q '^NEAR_AGENT_PRIVATE_KEY=ed25519:' .env; then
      umask 077; docker compose -p $STACK run --rm --no-deps api generate-agent-key > .agent-key.tmp
      sed -i '/^NEAR_AGENT_ACCOUNT_ID=/d; /^NEAR_AGENT_PRIVATE_KEY=/d' .env
      cat .agent-key.tmp >> .env && shred -u .agent-key.tmp
      docker compose -p $STACK up -d api 2>&1 | tail -2
    fi
    grep '^NEAR_AGENT_ACCOUNT_ID=' .env"
fi

echo "▶ Waiting for health"
"${SSH[@]}" "for i in \$(seq 1 40); do curl -fsS http://127.0.0.1:$PORT/health >/dev/null 2>&1 && echo healthy && exit 0; sleep 3; done; docker logs --tail 50 ${STACK}_api; exit 1"

echo "▶ Checking that no other stack changed state"
"${SSH[@]}" "docker ps --format '{{.Names}} {{.Status}}' | sort" > "${TMPDIR:-/tmp}/nearhk-after.txt"
diff <(grep -v '^nearhk' "${TMPDIR:-/tmp}/nearhk-before.txt" | awk '{print $1}') \
     <(grep -v '^nearhk' "${TMPDIR:-/tmp}/nearhk-after.txt" | awk '{print $1}') \
  && echo "✔ other stacks untouched" || { echo "✖ other containers changed!"; exit 1; }

echo "✔ Deployed $VERSION to $TARGET"
