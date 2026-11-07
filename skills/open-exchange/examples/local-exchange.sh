#!/usr/bin/env bash
# Run a local Open Exchange on testnet and wait until it serves.
#   ./local-exchange.sh [SKEIN_HOME dir]   (default ./.skein-openex)
#   ./local-exchange.sh status [origin]    the admin-facing reads
# Requires Node 24+. Port 8100 must be free. First start syncs headers: a few minutes.
set -euo pipefail
VERSION=0.17.2

status() {
  local o="${1:-http://localhost:8100}"
  for p in /.well-known/skein /amm/admin /amm/defaults /amm/discovery /amm/tokens /amm/stats; do
    printf '%-18s ' "$p"; curl -fsS "$o$p" | head -c 400 || printf '(no answer)'; echo
  done
}

if [[ "${1:-}" == "status" ]]; then status "${2:-}"; exit 0; fi

HOME_DIR="${1:-$PWD/.skein-openex}"
mkdir -p "$HOME_DIR"
LOG="$HOME_DIR/open-exchange.log"
echo "SKEIN_HOME=$HOME_DIR  log: $LOG"
SKEIN_HOME="$HOME_DIR" SKEIN_NETWORK=test nohup npx -y "open-exchange@$VERSION" run >"$LOG" 2>&1 &
echo "pid $!"

for i in $(seq 1 120); do   # up to 10 minutes
  if curl -fsS http://localhost:8100/.well-known/skein >/dev/null 2>&1; then
    echo "serving after ~$((i * 5)) s: http://localhost:8100  (reference: /api/)"
    # /amm/* can answer empty for a moment after start: re-read before trusting an empty list.
    status http://localhost:8100
    cat <<NEXT
Next (the host key in $HOME_DIR is root; the first claimant becomes admin):
  OPENEX_ORIGIN=http://localhost:8100 WIF=<wif> bun admin-setup.ts [<tokenId> | --price <sats>]
  or open http://localhost:8100, connect a wallet, Settings -> Claim this exchange.
Stop: kill the pid above. Fresh start: a new SKEIN_HOME.
NEXT
    exit 0
  fi
  sleep 5
done
echo "not serving after 10 minutes; see $LOG" >&2
exit 1
