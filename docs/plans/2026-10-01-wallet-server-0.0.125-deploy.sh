#!/usr/bin/env bash
# Deploy @1sat/cli 0.0.125 (wallet-server 0.0.59: binary sync chunks, upstream auth
# middleware) on ovh-n0001. No migrations and no database change.
#
#   ./deploy-0.0.125.sh preflight   read-only checks
#   ./deploy-0.0.125.sh window      stop, install, start monitor, start hosts, verify, pm2 save
#   ./deploy-0.0.125.sh rollback    back to the saved 0.0.124 install
set -euo pipefail

VERSION="0.0.125"
OLD_VERSION="0.0.124"
CLI_DIR="$HOME/Code/1sat-cli"
CLI_JS="$CLI_DIR/node_modules/@1sat/cli/dist/cli.js"
ECOSYSTEM="$HOME/pm2/wallet.config.js"
BACKUP_DIR="$HOME/predeploy-backups/20261001"
MONITOR_CWD="$HOME"        # wallet-monitor runs from ~
HOST_CWD="$HOME/pm2"       # wallet-host runs from ~/pm2

say() { printf '\n==> %s\n' "$*"; }
die() { printf '\n!! %s\n' "$*" >&2; exit 1; }
confirm() {
	local a
	read -r -p "$1 Type yes to continue: " a
	[ "$a" = "yes" ] || die "stopped (you typed '$a', not 'yes')"
}

installed_version() { node "$CLI_JS" --version 2>/dev/null | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | tail -1; }

pm2_app_status() {
	pm2 jlist | node -e '
		let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
			const apps = JSON.parse(s).filter(p => p.name === process.argv[1])
			console.log(apps.map(p => `${p.pm2_env.status}:${p.pm2_env.restart_time}`).join(" ") || "absent")
		})' "$1"
}

# Any HTTP answer from 127.0.0.1:8100 means the cluster is listening (GET / is 200 docs).
wait_for_http() {
	local deadline=$((SECONDS + 120)) code
	while [ $SECONDS -lt $deadline ]; do
		code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8100/ || true)
		case "$code" in 2??|401) echo "127.0.0.1:8100 answered $code"; return 0 ;; esac
		sleep 2
	done
	pm2 logs wallet-host --nostream --lines 80 || true
	die "wallet-host did not answer on 127.0.0.1:8100 within 2 minutes"
}

wait_monitor_stable() {
	sleep 15
	local st; st=$(pm2_app_status wallet-monitor)
	case "$st" in
		online:0) echo "wallet-monitor online, no restarts" ;;
		*) pm2 logs wallet-monitor --nostream --lines 80 || true; die "wallet-monitor not stable ($st); hosts NOT started" ;;
	esac
}

preflight() {
	say "Installed @1sat/cli: $(installed_version) (expect $OLD_VERSION)"
	echo "wallet-monitor: $(pm2_app_status wallet-monitor)"
	echo "wallet-host:    $(pm2_app_status wallet-host)"
	grep -n 'max_memory_restart' "$ECOSYSTEM"
	say "Pre-fetch @1sat/cli@$VERSION"
	npm cache add "@1sat/cli@$VERSION"
}

window() {
	confirm "Stop wallet-host and wallet-monitor (wallet.1sat.app + messagebox.1sat.app go down)?"

	say "1/5 Stop"
	pm2 stop wallet-host wallet-monitor

	say "2/5 Save current install -> $BACKUP_DIR/1sat-cli-$OLD_VERSION"
	mkdir -p "$BACKUP_DIR"
	[ -d "$BACKUP_DIR/1sat-cli-$OLD_VERSION" ] || cp -a "$CLI_DIR" "$BACKUP_DIR/1sat-cli-$OLD_VERSION"

	say "3/5 Install @1sat/cli@$VERSION"
	(cd "$CLI_DIR" && npm install "@1sat/cli@$VERSION")
	[ "$(installed_version)" = "$VERSION" ] || die "installed version is $(installed_version), expected $VERSION"

	say "4/5 Start wallet-monitor, then wallet-host"
	pm2 delete wallet-monitor
	(cd "$MONITOR_CWD" && pm2 start "$ECOSYSTEM" --only wallet-monitor)
	wait_monitor_stable
	pm2 delete wallet-host
	(cd "$HOST_CWD" && pm2 start "$ECOSYSTEM" --only wallet-host)
	wait_for_http

	say "5/5 Verify and save"
	pm2 ls
	echo "public: $(curl -s -o /dev/null -w '%{http_code}' https://wallet.1sat.app/)"
	pm2 save
	ls -l "$HOME/.pm2/dump.pm2"
	say "Done: @1sat/cli $(installed_version) running and saved."
}

rollback() {
	confirm "Roll back to @1sat/cli $OLD_VERSION?"
	[ -d "$BACKUP_DIR/1sat-cli-$OLD_VERSION" ] || die "no saved install at $BACKUP_DIR/1sat-cli-$OLD_VERSION"
	pm2 stop wallet-host wallet-monitor || true
	rm -rf "$CLI_DIR" && cp -a "$BACKUP_DIR/1sat-cli-$OLD_VERSION" "$CLI_DIR"
	pm2 delete wallet-monitor wallet-host || true
	(cd "$MONITOR_CWD" && pm2 start "$ECOSYSTEM" --only wallet-monitor)
	(cd "$HOST_CWD" && pm2 start "$ECOSYSTEM" --only wallet-host)
	wait_for_http
	pm2 save
	say "Rolled back to $(installed_version)."
}

case "${1:-}" in
	preflight) preflight ;;
	window) window ;;
	rollback) rollback ;;
	*) sed -n '2,8p' "$0"; exit 1 ;;
esac
