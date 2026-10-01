#!/usr/bin/env bash
# Deploy @1sat/cli 0.0.124 (wallet storage server) on ovh-n0001.
# Runbook: 2026-09-30-wallet-server-0.0.124-deploy.md (same directory).
#
#   ./deploy.sh preflight   read-only checks + before-counts (safe any time)
#   ./deploy.sh prepare     ecosystem file -> 5G cap, pre-fetch package (services keep running)
#   ./deploy.sh window      DOWNTIME: stop, backup, install, migrate (monitor), start hosts, verify, pm2 save
#   ./deploy.sh rollback    back to 0.0.104 and the original ecosystem file (data untouched)
#
# Every step stops at the first failure. Nothing prints the database password.
set -euo pipefail

VERSION="0.0.124"
OLD_VERSION="0.0.104"
CLI_DIR="$HOME/Code/1sat-cli"
CLI_JS="$CLI_DIR/node_modules/@1sat/cli/dist/cli.js"
ECOSYSTEM="$HOME/pm2/wallet.config.js"
ECOSYSTEM_BAK="$HOME/pm2/wallet.config.js.bak.$OLD_VERSION"
BACKUP_DIR="$HOME/predeploy-backups/20260930"
LAST_MIGRATION="2026-09-30-002 re-file legacy p 1sat baskets"
EXPECTED_MIGRATIONS=22
MONITOR_CWD="$HOME"        # wallet-monitor was started from ~
HOST_CWD="$HOME/pm2"       # wallet-host was started from ~/pm2

say() { printf '\n==> %s\n' "$*"; }
die() { printf '\n!! %s\n' "$*" >&2; exit 1; }
confirm() { read -r -p "$1 [type yes] " a; [ "$a" = "yes" ] || die "aborted"; }

# PG* env from ~/.1sat/cli/config.json server.storage.dbUrl (password never echoed).
load_db_env() {
	eval "$(node -e '
		const c = require(process.env.HOME + "/.1sat/cli/config.json")
		const u = new URL(c.server.storage.dbUrl)
		const q = (v) => "\x27" + String(v).replace(/\x27/g, "\x27\\\x27\x27") + "\x27"
		console.log(`export PGHOST=${q(u.hostname)} PGPORT=${q(u.port || 5432)}`)
		console.log(`export PGDATABASE=${q(u.pathname.slice(1))} PGUSER=${q(decodeURIComponent(u.username))}`)
		console.log(`export PGPASSWORD=${q(decodeURIComponent(u.password))}`)
		console.log(`export PGSSLMODE=${q(u.searchParams.get("sslmode") || "prefer")}`)
	')"
}

sql() { psql -X -A -t -v ON_ERROR_STOP=1 -c "$1"; }

counts() {
	echo "migrations:        $(sql 'SELECT count(*) FROM knex_migrations')"
	echo "sync_states:       $(sql 'SELECT count(*) FROM sync_states')"
	echo "duplicate pairs:   $(sql 'SELECT count(*) FROM (SELECT 1 FROM sync_states GROUP BY "userId","storageIdentityKey" HAVING count(*)>1) d')"
	echo "legacy outputs:    $(sql "SELECT count(*) FROM outputs o JOIN output_baskets b ON b.\"basketId\"=o.\"basketId\" WHERE b.name LIKE 'p 1sat %' OR b.name='ordinals'")"
}

installed_version() { node "$CLI_JS" --version 2>/dev/null | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -1; }

pm2_app_status() {
	pm2 jlist | node -e '
		let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
			const apps = JSON.parse(s).filter(p => p.name === process.argv[1])
			console.log(apps.map(p => `${p.pm2_env.status}:${p.pm2_env.restart_time}`).join(" ") || "absent")
		})' "$1"
}

wait_for_migrations() {
	local deadline=$((SECONDS + 900)) start_restarts
	start_restarts=$(pm2_app_status wallet-monitor | cut -d: -f2)
	while [ $SECONDS -lt $deadline ]; do
		if [ "$(sql "SELECT count(*) FROM knex_migrations WHERE name = '$LAST_MIGRATION'")" = "1" ]; then
			return 0
		fi
		local st; st=$(pm2_app_status wallet-monitor)
		case "$st" in
			online:"$start_restarts") ;;
			*) pm2 logs wallet-monitor --nostream --lines 80 || true
			   die "wallet-monitor is not staying up ($st) while migrating; hosts NOT started. See logs above, then: ./deploy.sh rollback" ;;
		esac
		sleep 5
	done
	pm2 logs wallet-monitor --nostream --lines 80 || true
	die "migrations did not finish within 15 minutes; hosts NOT started"
}

wait_for_http() {
	local deadline=$((SECONDS + 120)) code
	while [ $SECONDS -lt $deadline ]; do
		code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8100/ || true)
		[ "$code" = "401" ] && return 0
		sleep 2
	done
	pm2 logs wallet-host --nostream --lines 80 || true
	die "wallet-host did not answer 401 on 127.0.0.1:8100 within 2 minutes"
}

preflight() {
	say "Tools"
	for t in node npm pm2 psql pg_dump pg_restore curl; do command -v "$t" >/dev/null || die "missing $t"; done
	pg_dump --version
	say "PM2 apps"
	echo "wallet-monitor: $(pm2_app_status wallet-monitor)"
	echo "wallet-host:    $(pm2_app_status wallet-host)"
	say "Installed @1sat/cli: $(installed_version)"
	say "Ecosystem caps"
	grep -n 'max_memory_restart' "$ECOSYSTEM"
	say "Disk"
	df -h "$HOME" | tail -1
	say "Database"
	load_db_env
	echo "size: $(sql "SELECT pg_size_pretty(pg_database_size(current_database()))")"
	counts
}

prepare() {
	say "Ecosystem: keep $ECOSYSTEM_BAK, raise max_memory_restart 1G -> 5G"
	[ -f "$ECOSYSTEM_BAK" ] || cp -p "$ECOSYSTEM" "$ECOSYSTEM_BAK"
	sed -i 's/max_memory_restart: "1G"/max_memory_restart: "5G"/' "$ECOSYSTEM"
	diff "$ECOSYSTEM_BAK" "$ECOSYSTEM" || true
	[ "$(grep -c 'max_memory_restart: "5G"' "$ECOSYSTEM")" = "2" ] || die "expected both apps at 5G"
	node -e "require('$ECOSYSTEM')" || die "ecosystem file no longer loads"
	say "Pre-fetch @1sat/cli@$VERSION into the npm cache"
	npm cache add "@1sat/cli@$VERSION"
	echo "Running apps are unaffected until they are started from the file."
}

window() {
	[ "$(grep -c 'max_memory_restart: "5G"' "$ECOSYSTEM")" = "2" ] || die "run ./deploy.sh prepare first"
	load_db_env
	say "Before"
	counts
	confirm "Stop wallet-host and wallet-monitor (wallet.1sat.app + messagebox.1sat.app go down)?"

	say "1/6 Stop"
	pm2 stop wallet-host wallet-monitor

	say "2/6 Backup database and current install -> $BACKUP_DIR"
	mkdir -p "$BACKUP_DIR"
	pg_dump -Fc -f "$BACKUP_DIR/account_wallet.dump"
	pg_restore -l "$BACKUP_DIR/account_wallet.dump" >/dev/null || die "dump is not readable"
	ls -lh "$BACKUP_DIR/account_wallet.dump"
	[ -d "$BACKUP_DIR/1sat-cli-$OLD_VERSION" ] || cp -a "$CLI_DIR" "$BACKUP_DIR/1sat-cli-$OLD_VERSION"

	say "3/6 Install @1sat/cli@$VERSION"
	(cd "$CLI_DIR" && npm install "@1sat/cli@$VERSION")
	[ "$(installed_version)" = "$VERSION" ] || die "installed version is $(installed_version), expected $VERSION"

	say "4/6 Start wallet-monitor alone (runs migrations)"
	pm2 delete wallet-monitor
	(cd "$MONITOR_CWD" && pm2 start "$ECOSYSTEM" --only wallet-monitor)
	wait_for_migrations
	echo "migrations: $(sql 'SELECT count(*) FROM knex_migrations') (expected $EXPECTED_MIGRATIONS)"

	say "5/6 Start wallet-host"
	pm2 delete wallet-host
	(cd "$HOST_CWD" && pm2 start "$ECOSYSTEM" --only wallet-host)
	wait_for_http

	say "6/6 Verify"
	counts
	echo "public: $(curl -s -o /dev/null -w '%{http_code}' https://wallet.1sat.app/) (expect 401)"
	pm2 ls
	pm2 logs wallet-host --nostream --lines 100 | grep -iE 'rpc_error|error' || echo "no errors in last 100 host log lines"
	confirm "Everything looks right? Save the PM2 process list"
	pm2 save
	say "Done. Test the yours-wallet build now."
}

rollback() {
	confirm "Roll back to @1sat/cli $OLD_VERSION and the original ecosystem file (database is not restored)?"
	[ -d "$BACKUP_DIR/1sat-cli-$OLD_VERSION" ] || die "no saved install at $BACKUP_DIR/1sat-cli-$OLD_VERSION"
	pm2 stop wallet-host wallet-monitor || true
	rm -rf "$CLI_DIR" && cp -a "$BACKUP_DIR/1sat-cli-$OLD_VERSION" "$CLI_DIR"
	cp -p "$ECOSYSTEM_BAK" "$ECOSYSTEM"
	pm2 delete wallet-monitor wallet-host || true
	(cd "$MONITOR_CWD" && pm2 start "$ECOSYSTEM" --only wallet-monitor)
	(cd "$HOST_CWD" && pm2 start "$ECOSYSTEM" --only wallet-host)
	wait_for_http
	pm2 save
	say "Rolled back to $(installed_version). To also restore data: stop both apps, then"
	echo "  pg_restore --clean --if-exists -d \"\$PGDATABASE\" $BACKUP_DIR/account_wallet.dump   (with PG* env loaded)"
}

case "${1:-}" in
	preflight) preflight ;;
	prepare) prepare ;;
	window) window ;;
	rollback) rollback ;;
	*) sed -n '2,10p' "$0"; exit 1 ;;
esac
