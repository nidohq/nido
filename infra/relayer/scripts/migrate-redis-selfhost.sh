#!/usr/bin/env bash
#
# One-time migration: cut the live `nido` relayer off managed Upstash Redis and
# onto a self-hosted `nido-redis` Fly app (stock redis image + volume, reached
# over private 6PN). See ../../relayer-redis/fly.toml and ../fly.toml.
#
# Idempotent and re-runnable. The destructive Upstash teardown is OPT-IN
# (--destroy-upstash) and still asks before running.
#
# Usage:
#   ./migrate-redis-selfhost.sh [--env-file FILE]... [--local]
#                               [--destroy-upstash] [--skip-activate]
#
#   --env-file FILE    source FILE before running (repeatable). Use it to load
#                      the 1Password service-account token, e.g.
#                      --env-file ~/c/theahaco/iac/.env  (sets OP_SERVICE_ACCOUNT_TOKEN).
#   --local            build the image locally with docker (flyctl --local-only)
#                      instead of the remote builder. Requires docker.
#   --destroy-upstash  after a healthy cutover, destroy the Upstash DB to stop
#                      billing (prompts for confirmation).
#   --skip-activate    don't attempt channel-pool re-activation.
#
# Channel re-activation needs the relayer secrets API_KEY + PLUGIN_ADMIN_SECRET.
# Pass them as literals OR as `op://` references (resolved via `op read`):
#
#   # 1Password (token from the iac .env), secrets as op refs:
#   API_KEY='op://theahaco/<item>/<field>' \
#   PLUGIN_ADMIN_SECRET='op://theahaco/<item>/<field>' \
#     ./migrate-redis-selfhost.sh --env-file ~/c/theahaco/iac/.env
#
#   # or wrap the whole thing in `op run` with an env file of op refs:
#   op run --env-file=relayer-secrets.env -- ./migrate-redis-selfhost.sh
#
# Find the item/field names with: op item list --vault theahaco
# If the secrets are unset, the script still does the cutover and just prints
# the activation command for you to run by hand.
set -euo pipefail

LOCAL_BUILD=false
DESTROY_UPSTASH=false
SKIP_ACTIVATE=false
ENV_FILES=()
while [ $# -gt 0 ]; do
  case "$1" in
    --env-file) ENV_FILES+=("${2:?--env-file needs a path}"); shift 2 ;;
    --local) LOCAL_BUILD=true; shift ;;
    --destroy-upstash) DESTROY_UPSTASH=true; shift ;;
    --skip-activate) SKIP_ACTIVATE=true; shift ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

# Source any --env-file (e.g. the iac .env carrying OP_SERVICE_ACCOUNT_TOKEN),
# auto-exporting their vars so child processes (op, flyctl) see them.
for f in "${ENV_FILES[@]:-}"; do
  [ -n "$f" ] || continue
  [ -f "$f" ] || { echo "env-file not found: $f" >&2; exit 2; }
  set -a
  # shellcheck disable=SC1090  # path is user-supplied by design
  . "$f"
  set +a
done

# Resolve op:// references for the activation secrets. Leaves literals/empties
# untouched, so the script also works with no 1Password at all.
resolve_op() {
  eval "val=\${$1:-}"
  case "${val:-}" in
    op://*)
      command -v op >/dev/null 2>&1 || { echo "$1 is an op:// ref but 'op' (1Password CLI) is not installed" >&2; exit 2; }
      printf -v "$1" '%s' "$(op read "$val")" \
        || { echo "failed to resolve $1 from 1Password ($val)" >&2; exit 2; }
      ;;
  esac
}
resolve_op API_KEY
resolve_op PLUGIN_ADMIN_SECRET

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
RELAYER_DIR=$(dirname "$SCRIPT_DIR")
REDIS_DIR="$(dirname "$RELAYER_DIR")/relayer-redis"

# Pull app/region straight from fly.toml so this can't drift from the deploy config.
APP=$(sed -n 's/^app *= *"\(.*\)"/\1/p' "$RELAYER_DIR/fly.toml")
REGION=$(sed -n 's/^primary_region *= *"\(.*\)"/\1/p' "$RELAYER_DIR/fly.toml")
REDIS_APP=$(sed -n 's/^app *= *"\(.*\)"/\1/p' "$REDIS_DIR/fly.toml")
REDIS_VOLUME="nido_redis_data"
HEALTH_URL="https://${APP}.fly.dev/api/v1/health"
RELAY_URL="https://${APP}.fly.dev/relay"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

DEPLOY_MODE=$([ "$LOCAL_BUILD" = true ] && echo --local-only || echo --remote-only)

# --- 0 · pre-flight -----------------------------------------------------------
say "Pre-flight"
command -v flyctl >/dev/null 2>&1 || die "flyctl not found on PATH"
flyctl auth whoami >/dev/null 2>&1 || die "not logged in — run: flyctl auth login"
flyctl status -a "$APP" >/dev/null 2>&1 || die "app '$APP' not reachable (wrong org? run: flyctl apps list)"
$LOCAL_BUILD && { command -v docker >/dev/null 2>&1 || die "--local needs docker on PATH"; }
# Org for creating the sibling Redis app (inherit the relayer's org).
ORG=${FLY_ORG:-$(flyctl status -a "$APP" --json 2>/dev/null \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('Organization',{}).get('Slug',''))" 2>/dev/null)}
[ -n "$ORG" ] || ORG=aha-684
echo "relayer=$APP  redis=$REDIS_APP  org=$ORG  region=$REGION  build=${DEPLOY_MODE#--}"

# --- 1 · self-hosted Redis app (idempotent) ----------------------------------
say "Ensuring the '$REDIS_APP' app exists"
if flyctl apps list 2>/dev/null | grep -q "^${REDIS_APP}[[:space:]]"; then
  echo "app already exists — skipping create"
else
  flyctl apps create "$REDIS_APP" --org "$ORG"
fi

say "Ensuring volume '$REDIS_VOLUME' on '$REDIS_APP'"
if flyctl volumes list -a "$REDIS_APP" 2>/dev/null | grep -q "[[:space:]]${REDIS_VOLUME}[[:space:]]"; then
  echo "volume already present — skipping create"
else
  flyctl volumes create "$REDIS_VOLUME" -a "$REDIS_APP" -r "$REGION" -n 1 -s 1 --yes
fi

say "Deploying $REDIS_APP"
flyctl deploy "$REDIS_DIR" -a "$REDIS_APP" "$DEPLOY_MODE" --ha=false

# --- 2 · drop the Upstash REDIS_URL secret on the relayer --------------------
# A Fly secret OVERRIDES the fly.toml [env] value, so the in-app
# redis://nido-redis.internal:6379 URL only wins once the Upstash secret is gone.
# --stage defers it to the relayer deploy below.
say "Staging removal of the Upstash REDIS_URL secret on '$APP'"
# `flyctl secrets list` renders a box table (leading space + │ separators), so
# match REDIS_URL as a whole word anywhere on the line rather than anchoring.
if flyctl secrets list -a "$APP" 2>/dev/null | grep -qw REDIS_URL; then
  flyctl secrets unset REDIS_URL -a "$APP" --stage
  echo "REDIS_URL staged for removal (applies on the deploy below)"
else
  echo "no REDIS_URL secret set — fly.toml's internal URL already governs"
fi

# --- 3 · deploy the relayer (now pointing at the sibling Redis) --------------
say "Deploying $APP"
flyctl deploy "$RELAYER_DIR" -a "$APP" "$DEPLOY_MODE" --ha=false

# --- 4 · health gate ----------------------------------------------------------
say "Waiting for health at $HEALTH_URL"
ok=false
for _ in $(seq 1 30); do
  if curl -fsS -m 5 "$HEALTH_URL" >/dev/null 2>&1; then ok=true; break; fi
  sleep 3
done
$ok || die "health check never went green — inspect: flyctl logs -a $APP"
echo "health: OK"

# Boot-log assertions: channels synced, and the Upstash 'broken pipe' storm is gone.
say "Checking boot logs"
LOGS=$(flyctl logs -a "$APP" --no-tail 2>/dev/null || true)
if printf '%s' "$LOGS" | grep -q "broken pipe"; then
  die "still seeing 'broken pipe' in logs — Redis cutover did not take. Check that REDIS_URL is unset: flyctl secrets list -a $APP"
fi
printf '%s' "$LOGS" | grep -q "Syncing sequence" \
  && echo "relayer synced its channel sequences" \
  || echo "note: no 'Syncing sequence' line yet — may still be booting"

# --- 5 · re-register the channel pool (new Redis starts empty) ----------------
if $SKIP_ACTIVATE; then
  say "Skipping channel activation (--skip-activate)"
elif [ -n "${API_KEY:-}" ] && [ -n "${PLUGIN_ADMIN_SECRET:-}" ]; then
  say "Re-activating the channel pool through a local tunnel"
  flyctl proxy 8090:8090 -a "$APP" >/dev/null 2>&1 &
  PROXY_PID=$!
  trap 'kill "$PROXY_PID" 2>/dev/null || true' EXIT
  for _ in $(seq 1 20); do
    curl -fsS -m 3 http://localhost:8090/api/v1/health >/dev/null 2>&1 && break
    sleep 1
  done
  API_KEY="$API_KEY" PLUGIN_ADMIN_SECRET="$PLUGIN_ADMIN_SECRET" \
    "$SCRIPT_DIR/activate-channels.sh" http://localhost:8090
  kill "$PROXY_PID" 2>/dev/null || true
  trap - EXIT
  echo "channel pool registered"
else
  say "Channel activation needs secrets — run this once (pull values from 1Password):"
  cat <<EOF
  # terminal 1:
  flyctl proxy 8090:8090 -a $APP
  # terminal 2:
  API_KEY=<value> PLUGIN_ADMIN_SECRET=<value> \\
    $SCRIPT_DIR/activate-channels.sh http://localhost:8090
EOF
fi

# --- 6 · verify the relay route answers (no opaque error) --------------------
say "Probing $RELAY_URL"
PROBE=$(curl -sS -m 10 -X POST "$RELAY_URL" -H 'Content-Type: application/json' \
  -d '{"params":{"getTransaction":{"transactionId":"migration-probe"}}}' 2>/dev/null || true)
echo "relay response: $PROBE"
case "$PROBE" in
  *"An unknown error occurred"*)
    echo "still opaque — if you skipped activation, run it then re-probe" ;;
  *) echo "relay route responding" ;;
esac

# --- 7 · stop the Upstash bill (opt-in, destructive) -------------------------
if $DESTROY_UPSTASH; then
  say "Destroy the Upstash DB 'nido-relayer-redis'? This is irreversible."
  read -r -p "type 'destroy' to confirm: " confirm
  if [ "$confirm" = "destroy" ]; then
    flyctl redis destroy nido-relayer-redis
    echo "Upstash DB destroyed. Remove the stale REDIS_URL from 1Password (vault theahaco)."
  else
    echo "skipped."
  fi
else
  say "When confirmed healthy, stop the Upstash bill:"
  echo "  flyctl redis destroy nido-relayer-redis"
  echo "  (then drop the stale REDIS_URL entry from 1Password, vault theahaco)"
fi

say "Done."
