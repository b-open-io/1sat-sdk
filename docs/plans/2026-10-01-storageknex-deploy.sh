#!/usr/bin/env bash
# Switch wallet storage on ovh-n0001 from StoragePg + the hand-written RPC in wallet-host to
# wallet-toolbox StorageKnex (Postgres) served by the toolbox StorageServer in its own PM2 app
# (wallet-storage, `1sat serve storage`), and convert the account_wallet schema.
# Runbook: 2026-10-01-storageknex-deploy.md (same directory).
#
# Runs ON THE SERVER. Copy it and the SQL files over first (runbook, "Before you start"), then:
#   ssh -t ovh-n0001 '~/pm2/deploy-storageknex.sh preflight'
#   ssh -t ovh-n0001 '~/pm2/deploy-storageknex.sh prepare'
#   ssh -t ovh-n0001 '~/pm2/deploy-storageknex.sh window'
#   ssh -t ovh-n0001 '~/pm2/deploy-storageknex.sh rollback'
#
#   preflight  read-only checks, before-counts, staged install of the new CLI (scratch dir)
#   prepare    save the current install and config.json, set server.trustProxy (services keep running)
#   window     DOWNTIME: stop, dump, install, convert schema, start monitor (migrate), verify,
#              start wallet-storage and wallet-host, pm2 save, nginx switch (operator), checks
#   rollback   stop, restore the pre-conversion dump (if converted), old install + config, start
#
# Every step stops at the first failure. Nothing prints the database password.
set -euo pipefail

VERSION="${VERSION:-}"            # new @1sat/cli version; set here or in the environment
OLD_VERSION="${OLD_VERSION:-0.0.125}"
TOOLBOX_VERSION="2.14.5"  # @bsv/wallet-toolbox -> npm:@bopen-io/wallet-toolbox
TRUST_PROXY="loopback"            # nginx on this host connects from 127.0.0.1
HOST_PORT=8100                    # wallet-host (server.port)
STORAGE_PORT=8110                 # wallet-storage (ONESAT_PORT in its ecosystem entry)

CLI_DIR="$HOME/Code/1sat-cli"
CLI_JS="$CLI_DIR/node_modules/@1sat/cli/dist/cli.js"
ECOSYSTEM="$HOME/pm2/wallet.config.js"
CONFIG="$HOME/.1sat/cli/config.json"
SQL_DIR="$HOME/pm2/storageknex"
CONVERT_SQL="$SQL_DIR/2026-10-01-storagepg-to-storageknex.sql"
DESCRIBE_SQL="$SQL_DIR/storageknex-schema-describe.sql"
EXPECTED_SCHEMA="$SQL_DIR/2026-10-01-storageknex-schema.expected.txt"
BACKUP_DIR="$HOME/predeploy-backups/storageknex"
DUMP="$BACKUP_DIR/account_wallet.pre-storageknex.dump"
CONFIG_BAK="$BACKUP_DIR/config.json.pre-storageknex"
OLD_INSTALL="$BACKUP_DIR/1sat-cli-$OLD_VERSION"
MONITOR_CWD="$HOME"        # wallet-monitor runs from ~
HOST_CWD="$HOME/pm2"       # wallet-host and wallet-storage run from ~/pm2

STORAGEPG_MIGRATIONS=22
CONVERTED_MIGRATIONS=18
EXPECTED_MIGRATIONS=26
LAST_MIGRATION="2026-09-16-001 add auth message replay claims"
REMOVED_MIGRATIONS="'2026-04-20-001 add transactions userId index',
	'2026-04-20-002 add outputs userId index',
	'2026-09-30-001 unique sync state per storage identity',
	'2026-09-30-002 re-file legacy p 1sat baskets'"
NEW_MIGRATIONS="'2026-07-14-001 add shared auth sessions',
	'2026-07-15-001 add action batch reservations and blobs',
	'2026-07-26-001 retain prepared action batch manifests',
	'2026-08-04-001 add payment replay claims',
	'2026-08-10-001 upgrade managed change liquidity defaults',
	'2026-08-31-001 add prepared beef artifacts',
	'2026-09-09-001 add bounded sync transfers',
	'2026-09-16-001 add auth message replay claims'"

COUNTS_SQL="
select 'proven_txs', count(*) from proven_txs union all select 'proven_tx_reqs', count(*) from proven_tx_reqs
union all select 'users', count(*) from users union all select 'certificates', count(*) from certificates
union all select 'certificate_fields', count(*) from certificate_fields
union all select 'output_baskets', count(*) from output_baskets union all select 'transactions', count(*) from transactions
union all select 'commissions', count(*) from commissions union all select 'outputs', count(*) from outputs
union all select 'output_tags', count(*) from output_tags union all select 'output_tags_map', count(*) from output_tags_map
union all select 'tx_labels', count(*) from tx_labels union all select 'tx_labels_map', count(*) from tx_labels_map
union all select 'monitor_events', count(*) from monitor_events union all select 'settings', count(*) from settings
union all select 'sync_states', count(*) from sync_states
order by 1"

# Sequences behind their column's maximum (must be 0).
BEHIND_SEQUENCES_SQL="
select count(*) from (
  select pg_sequence_last_value(c.oid) as last_value,
    (xpath('/row/m/text()', query_to_xml(format('select max(%I) as m from %I', a.attname, t.relname),
      false, true, '')))[1]::text::bigint as max_id
  from pg_class c
  join pg_depend d on d.objid = c.oid and d.classid = 'pg_class'::regclass and d.deptype = 'a'
  join pg_class t on t.oid = d.refobjid
  join pg_attribute a on a.attrelid = t.oid and a.attnum = d.refobjsubid
  where c.relkind = 'S' and c.relnamespace = current_schema()::regnamespace
) s where s.max_id is not null and (s.last_value is null or s.last_value < s.max_id)"

say() { printf '\n==> %s\n' "$*"; }
die() { printf '\n!! %s\n' "$*" >&2; exit 1; }
confirm() {
	local a
	read -r -p "$1 Type yes to continue: " a
	[ "$a" = "yes" ] || die "stopped (you typed '$a', not 'yes')"
}
# Hides the password part of any URL in the input.
mask() { sed -E 's#(://[^:/@[:space:]]*:)[^@[:space:]]+@#\1***@#g'; }

require_version() {
	[ -n "$VERSION" ] || die "set VERSION (new @1sat/cli version) at the top of this script or in the environment"
	[ "$VERSION" != "$OLD_VERSION" ] || die "VERSION equals OLD_VERSION ($OLD_VERSION)"
}

# PG* env from config.json server.storage.dbUrl (password never echoed).
load_db_env() {
	eval "$(node -e '
		const c = require(process.argv[1])
		const u = new URL(c.server.storage.dbUrl)
		const q = (v) => "\x27" + String(v).replace(/\x27/g, "\x27\\\x27\x27") + "\x27"
		console.log(`export PGHOST=${q(u.hostname)} PGPORT=${q(u.port || 5432)}`)
		console.log(`export PGDATABASE=${q(u.pathname.slice(1))} PGUSER=${q(decodeURIComponent(u.username))}`)
		console.log(`export PGPASSWORD=${q(decodeURIComponent(u.password))}`)
		console.log(`export PGSSLMODE=${q(u.searchParams.get("sslmode") || "prefer")}`)
	' "$CONFIG")"
}

sql() { psql -X -A -t -v ON_ERROR_STOP=1 -c "$1"; }

# storagepg: unconverted. storageknex: the conversion script has committed.
db_state() {
	sql "SELECT CASE WHEN EXISTS (SELECT 1 FROM knex_migrations WHERE name = '2026-09-30-002 re-file legacy p 1sat baskets')
		THEN 'storagepg' ELSE 'storageknex' END"
}

other_connections() {
	sql "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()"
}

show_connections() {
	psql -X -v ON_ERROR_STOP=1 -c "SELECT usename, application_name, client_addr, state, count(*)
		FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()
		GROUP BY 1, 2, 3, 4 ORDER BY 5 DESC"
}

wait_for_idle_db() {
	local deadline=$((SECONDS + 60))
	while [ $SECONDS -lt $deadline ]; do
		[ "$(other_connections)" = "0" ] && { echo "no other connections to $PGDATABASE"; return 0; }
		sleep 2
	done
	show_connections
	confirm "Connections above are still open to $PGDATABASE (the conversion/restore will fail on their locks after 10 s). Continue anyway?"
}

installed_version() { node "$CLI_JS" --version 2>/dev/null | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | tail -1; }

pm2_app_status() {
	pm2 jlist | node -e '
		let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
			const apps = JSON.parse(s).filter(p => p.name === process.argv[1])
			console.log(apps.map(p => `${p.pm2_env.status}:${p.pm2_env.restart_time}`).join(" ") || "absent")
		})' "$1"
}

trust_proxy_value() { node -e 'console.log(JSON.stringify(require(process.argv[1]).server?.trustProxy ?? null))' "$CONFIG"; }

# Atomic write (tmp + rename), mode 0600, same formatting the CLI's saveConfig uses.
set_trust_proxy() {
	node -e '
		const fs = require("node:fs")
		const [file, value] = process.argv.slice(1)
		const c = JSON.parse(fs.readFileSync(file, "utf8"))
		c.server.trustProxy = value
		fs.writeFileSync(file + ".tmp", JSON.stringify(c, null, 2), { mode: 0o600 })
		fs.renameSync(file + ".tmp", file)
	' "$CONFIG" "$TRUST_PROXY"
}

# Every installed copy of package dir $2 (wallet-toolbox or wallet-toolbox-client) under
# $1/node_modules: "<path> <name>@<version>".
toolbox_copies() {
	node -e '
		const fs = require("node:fs"), path = require("node:path")
		const root = process.argv[1], want = process.argv[2], found = []
		const dirs = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter(e => e.isDirectory()) } catch { return [] } }
		const visit = (dir, name) => {
			if (name.endsWith("/" + want)) {
				const j = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"))
				found.push(`${path.relative(root, dir)} ${j.name}@${j.version}`)
			}
			walk(path.join(dir, "node_modules"))
		}
		const walk = (nm) => {
			for (const e of dirs(nm)) {
				const p = path.join(nm, e.name)
				if (e.name.startsWith("@")) for (const s of dirs(p)) visit(path.join(p, s.name), `${e.name}/${s.name}`)
				else if (e.name !== ".bin") visit(p, e.name)
			}
		}
		walk(path.join(root, "node_modules"))
		console.log(found.join("\n"))
	' "$1" "$2"
}

# The install in $1 is @1sat/cli $VERSION with one wallet-toolbox and one wallet-toolbox-client
# ($TOOLBOX_VERSION) and the
# StorageKnex wallet-node build.
check_install() {
	local dir=$1 v copies n wn knexpg
	v=$(node "$dir/node_modules/@1sat/cli/dist/cli.js" --version 2>/dev/null | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | tail -1)
	echo "@1sat/cli: $v"
	[ "$v" = "$VERSION" ] || die "installed @1sat/cli is '$v', expected $VERSION"
	(cd "$dir" && npm ls @bsv/wallet-toolbox @bsv/wallet-toolbox-client) || true
	for pkg in wallet-toolbox wallet-toolbox-client; do
		copies=$(toolbox_copies "$dir" "$pkg")
		n=$(printf '%s\n' "$copies" | grep -c . || true)
		echo "$pkg copies ($n):"
		printf '%s\n' "$copies" | sed 's/^/  /'
		[ "$n" = "1" ] || die "expected exactly one $pkg in the tree, found $n"
		[ "${copies##* }" = "@bopen-io/$pkg@$TOOLBOX_VERSION" ] \
			|| die "$pkg is '${copies##* }', expected @bopen-io/$pkg@$TOOLBOX_VERSION"
	done
	wn=$(find "$dir/node_modules" -path '*/@1sat/wallet-node/dist/index.js' | wc -l | tr -d ' ')
	knexpg=$(find "$dir/node_modules" -path '*/@1sat/wallet-node/dist/storage-knex-pg.js' | wc -l | tr -d ' ')
	echo "@1sat/wallet-node copies: $wn, with storage-knex-pg.js: $knexpg"
	[ "$wn" -ge 1 ] && [ "$wn" = "$knexpg" ] || die "@1sat/wallet-node in this install is not the StorageKnex build"
}

wait_for_migrations() {
	local deadline=$((SECONDS + 300)) start_restarts st
	start_restarts=$(pm2_app_status wallet-monitor | cut -d: -f2)
	while [ $SECONDS -lt $deadline ]; do
		if [ "$(sql "SELECT count(*) FROM knex_migrations WHERE name = '$LAST_MIGRATION'")" = "1" ]; then
			sleep 5
			st=$(pm2_app_status wallet-monitor)
			[ "$st" = "online:$start_restarts" ] || { pm2 logs wallet-monitor --nostream --lines 80 || true; die "wallet-monitor not stable after migrating ($st); hosts NOT started"; }
			return 0
		fi
		st=$(pm2_app_status wallet-monitor)
		case "$st" in
			online:"$start_restarts") ;;
			*) pm2 logs wallet-monitor --nostream --lines 80 || true
			   die "wallet-monitor is not staying up ($st) while migrating; hosts NOT started. See logs above." ;;
		esac
		sleep 2
	done
	pm2 logs wallet-monitor --nostream --lines 80 || true
	die "StorageKnex migrations did not finish within 5 minutes; hosts NOT started"
}

wait_monitor_stable() {
	sleep 15
	local st; st=$(pm2_app_status wallet-monitor)
	case "$st" in
		online:0) echo "wallet-monitor online, no restarts" ;;
		*) pm2 logs wallet-monitor --nostream --lines 80 || true; die "wallet-monitor not stable ($st); hosts NOT started" ;;
	esac
}

# wait_for_http <app> <port>: a 2xx/401 on GET / means the cluster is listening
# (wallet-host: docs page; wallet-storage: StorageServer banner).
wait_for_http() {
	local app=$1 port=$2 deadline=$((SECONDS + 120)) code
	while [ $SECONDS -lt $deadline ]; do
		code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/" || true)
		case "$code" in 2??|401) echo "$app: 127.0.0.1:$port answered $code"; return 0 ;; esac
		sleep 2
	done
	pm2 logs "$app" --nostream --lines 80 || true
	die "$app did not answer on 127.0.0.1:$port within 2 minutes"
}

# The ecosystem has the wallet-storage app (added by hand, runbook "Before you start").
check_storage_app() {
	node -e '
		const a = require(process.argv[1]).apps.find((x) => x.name === "wallet-storage")
		if (!a) { console.error("no wallet-storage app in the ecosystem"); process.exit(1) }
		const port = String(a.env?.ONESAT_PORT ?? "")
		console.log(`wallet-storage: args "${a.args}", ${a.exec_mode} x${a.instances}, ONESAT_PORT ${port}, max_memory_restart ${a.max_memory_restart}`)
		if (a.args !== "serve storage" || port !== process.argv[2]) process.exit(1)
	' "$ECOSYSTEM" "$STORAGE_PORT" || die "wallet-storage must run 'serve storage' with ONESAT_PORT=$STORAGE_PORT"
}

# wallet-storage (x4) and wallet-host share BRC-104 sessions through Redis.
redis_url_set() { node -e 'process.exit(require(process.argv[1]).server?.sessionStore?.redisUrl ? 0 : 1)' "$CONFIG"; }

# Error lines in the apps' current log files (pm2's own path headers excluded).
log_errors() {
	pm2 logs "$1" --nostream --lines 400 2>&1 | grep -v '\.pm2/logs/' | grep -E 'rpc_error|[Ee]rror' || true
}

# Gate before the hosts start. Dies on the first mismatch.
verify_db() {
	local n diff_unexpected
	n=$(sql "SELECT count(*) FROM knex_migrations"); echo "knex_migrations:          $n (expect $EXPECTED_MIGRATIONS)"
	[ "$n" = "$EXPECTED_MIGRATIONS" ] || die "knex_migrations has $n rows"
	n=$(sql "SELECT count(*) FROM knex_migrations WHERE name IN ($REMOVED_MIGRATIONS)"); echo "StoragePg-only rows:      $n (expect 0)"
	[ "$n" = "0" ] || die "StoragePg-only migration rows are present"
	n=$(sql "SELECT count(*) FROM knex_migrations WHERE name IN ($NEW_MIGRATIONS)"); echo "toolbox migrations added: $n (expect 8)"
	[ "$n" = "8" ] || die "expected the 8 toolbox migrations StoragePg never had"
	n=$(sql "SELECT count(*) FROM knex_migrations_lock WHERE is_locked <> 0"); echo "migration lock held:      $n (expect 0)"
	[ "$n" = "0" ] || die "knex_migrations_lock is held"
	n=$(sql "SELECT string_agg(coalesce(dbtype, 'NULL'), ',') FROM settings"); echo "settings.dbtype:          $n (expect Postgres)"
	[ "$n" = "Postgres" ] || die "settings.dbtype is $n"
	n=$(sql "SELECT count(*) FROM information_schema.columns WHERE table_schema = current_schema()
		AND (data_type = 'smallint' OR is_identity = 'YES')"); echo "smallint/identity cols:   $n (expect 0)"
	[ "$n" = "0" ] || die "smallint or identity columns are left"
	n=$(sql "SELECT count(*) FROM pg_indexes WHERE schemaname = current_schema()
		AND indexname = 'sync_states_user_storage_identity' AND indexdef LIKE 'CREATE UNIQUE INDEX%'"); echo "sync_states unique index: $n (expect 1)"
	[ "$n" = "1" ] || die "sync_states_user_storage_identity unique index is missing"
	n=$(sql "$BEHIND_SEQUENCES_SQL"); echo "sequences behind max(id): $n (expect 0)"
	[ "$n" = "0" ] || die "$n sequences are behind their column maximum"

	sql "$COUNTS_SQL" > "$BACKUP_DIR/counts.after"
	if diff "$BACKUP_DIR/counts.before" "$BACKUP_DIR/counts.after"; then
		echo "row counts:               unchanged ($(wc -l < "$BACKUP_DIR/counts.after") tables)"
	else
		die "row counts changed (diff above: before < > after)"
	fi

	psql -X -A -t -v ON_ERROR_STOP=1 -f "$DESCRIBE_SQL" > "$BACKUP_DIR/schema.after.txt"
	diff "$BACKUP_DIR/schema.after.txt" "$EXPECTED_SCHEMA" > "$BACKUP_DIR/schema.diff" || true
	diff_unexpected=$(grep -E '^[<>]' "$BACKUP_DIR/schema.diff" | grep -v 'sync_states_user_storage_identity' || true)
	if [ -n "$diff_unexpected" ]; then
		printf '%s\n' "$diff_unexpected"
		die "schema differs from $EXPECTED_SCHEMA beyond the kept sync_states index (full diff: $BACKUP_DIR/schema.diff)"
	fi
	echo "schema:                   matches StorageKnex (only the kept sync_states index differs)"
}

# Drops every table and sequence in the schema and restores the dump, in one transaction.
# (pg_restore --clean cannot do this on the converted schema: renamed foreign keys and the new
# toolbox tables keep users/outputs from being dropped.)
restore_dump() {
	local tables
	tables=$(sql "SELECT string_agg(format('%I.%I', schemaname, tablename), ', ') FROM pg_tables WHERE schemaname = current_schema()")
	[ -n "$tables" ] || die "no tables found in the current schema"
	echo "dropping: $tables"
	{
		echo 'BEGIN;'
		echo "DROP TABLE $tables;"
		echo "DO \$\$ DECLARE s record; BEGIN
			FOR s IN SELECT format('%I.%I', sequence_schema, sequence_name) AS n
				FROM information_schema.sequences WHERE sequence_schema = current_schema() LOOP
				EXECUTE 'DROP SEQUENCE ' || s.n;
			END LOOP; END \$\$;"
		pg_restore -f - "$DUMP" || exit 1
		echo 'COMMIT;'
	} | psql -X -q -v ON_ERROR_STOP=1 >/dev/null
}

preflight() {
	require_version
	say "Tools"
	for t in node npm pm2 psql pg_dump pg_restore curl diff sha256sum; do command -v "$t" >/dev/null || die "missing $t"; done
	pg_dump --version
	say "PM2 apps"
	echo "wallet-monitor: $(pm2_app_status wallet-monitor)"
	echo "wallet-host:    $(pm2_app_status wallet-host)"
	echo "wallet-storage: $(pm2_app_status wallet-storage) (expect absent; the window starts it)"
	say "Installed @1sat/cli: $(installed_version) (expect $OLD_VERSION)"
	[ "$(installed_version)" = "$OLD_VERSION" ] || die "installed version is not $OLD_VERSION; set OLD_VERSION"
	say "Ecosystem"
	grep -n 'max_memory_restart' "$ECOSYSTEM"
	[ "$(grep -c 'max_memory_restart: "5G"' "$ECOSYSTEM")" = "3" ] || die "expected wallet-monitor, wallet-host and wallet-storage at 5G"
	check_storage_app
	say "Disk"
	df -h "$HOME" | tail -1
	say "SQL files in $SQL_DIR (compare with the laptop: shasum -a 256 <file>)"
	for f in "$CONVERT_SQL" "$DESCRIBE_SQL" "$EXPECTED_SCHEMA"; do
		[ -f "$f" ] || die "missing $f"
		sha256sum "$f"
	done
	say "Config"
	node -e '
		const c = require(process.argv[1]).server
		const u = new URL(c.storage.dbUrl)
		console.log(`storage: ${c.storage.provider} ${u.username}@${u.host}${u.pathname}`)
		console.log(`trustProxy: ${JSON.stringify(c.trustProxy ?? null)} (prepare sets "${process.argv[2]}")`)
		console.log(`sessionStore.redisUrl: ${c.sessionStore?.redisUrl ? "set" : "NOT SET"}`)
	' "$CONFIG" "$TRUST_PROXY"
	redis_url_set || die "server.sessionStore.redisUrl must be set"
	say "Database"
	load_db_env
	echo "size:            $(sql "SELECT pg_size_pretty(pg_database_size(current_database()))")"
	echo "state:           $(db_state) (expect storagepg)"
	echo "knex_migrations: $(sql 'SELECT count(*) FROM knex_migrations') (expect $STORAGEPG_MIGRATIONS)"
	[ "$(db_state)" = "storagepg" ] || die "database is already converted"
	show_connections
	sql "$COUNTS_SQL"
	say "Pre-fetch @1sat/cli@$VERSION and check its tree in a scratch install"
	npm cache add "@1sat/cli@$VERSION"
	STAGE=$(mktemp -d)
	trap 'rm -rf "$STAGE"' EXIT
	cp "$CLI_DIR/package.json" "$CLI_DIR/package-lock.json" "$STAGE/"
	(cd "$STAGE" && npm install --no-audit --no-fund "@1sat/cli@$VERSION")
	check_install "$STAGE"
	say "Preflight OK"
}

prepare() {
	require_version
	[ "$(installed_version)" = "$OLD_VERSION" ] || die "installed version is $(installed_version), expected $OLD_VERSION"
	mkdir -p "$BACKUP_DIR"
	say "Save current install -> $OLD_INSTALL"
	[ -d "$OLD_INSTALL" ] || cp -a "$CLI_DIR" "$OLD_INSTALL"
	ls -d "$OLD_INSTALL"
	say "Config: keep $CONFIG_BAK, set server.trustProxy = \"$TRUST_PROXY\""
	[ -f "$CONFIG_BAK" ] || cp -p "$CONFIG" "$CONFIG_BAK"
	set_trust_proxy
	diff "$CONFIG_BAK" "$CONFIG" | mask || true
	[ "$(trust_proxy_value)" = "\"$TRUST_PROXY\"" ] || die "trustProxy did not stick"
	echo "The running $OLD_VERSION ignores trustProxy. The window re-checks it after the apps stop."
}

window() {
	require_version
	[ "$(installed_version)" = "$OLD_VERSION" ] || die "installed version is $(installed_version), expected $OLD_VERSION"
	[ -f "$CONFIG_BAK" ] && [ -d "$OLD_INSTALL" ] || die "run prepare first"
	check_storage_app
	redis_url_set || die "server.sessionStore.redisUrl must be set"
	for f in "$CONVERT_SQL" "$DESCRIBE_SQL" "$EXPECTED_SCHEMA"; do [ -f "$f" ] || die "missing $f"; done
	load_db_env
	[ "$(db_state)" = "storagepg" ] || die "database is already converted"
	say "Before"
	echo "knex_migrations: $(sql 'SELECT count(*) FROM knex_migrations') (expect $STORAGEPG_MIGRATIONS)"
	confirm "Stop wallet-host and wallet-monitor (wallet.1sat.app, messagebox.1sat.app and 1sat.app paymail go down)?"

	say "1/9 Stop"
	pm2 stop wallet-host wallet-monitor
	wait_for_idle_db
	[ "$(trust_proxy_value)" = "\"$TRUST_PROXY\"" ] || { echo "trustProxy was overwritten; setting it again"; set_trust_proxy; }
	echo "trustProxy: $(trust_proxy_value)"

	say "2/9 Counts and backup -> $DUMP"
	sql "$COUNTS_SQL" > "$BACKUP_DIR/counts.before"
	cat "$BACKUP_DIR/counts.before"
	local t0=$SECONDS
	pg_dump -Fc -f "$DUMP.partial"
	mv "$DUMP.partial" "$DUMP"
	[ "$(pg_restore -l "$DUMP" | awk '$4 == "TABLE" && $5 == "public"' | wc -l | tr -d ' ')" = "18" ] || die "dump does not list the 18 tables"
	ls -lh "$DUMP"
	echo "pg_dump took $((SECONDS - t0)) s"

	say "3/9 Install @1sat/cli@$VERSION"
	(cd "$CLI_DIR" && npm install --no-audit --no-fund --prefer-offline "@1sat/cli@$VERSION")
	check_install "$CLI_DIR"

	say "4/9 Convert schema (budget 2 minutes)"
	t0=$SECONDS
	if ! psql -X -v ON_ERROR_STOP=1 -f "$CONVERT_SQL"; then
		die "conversion failed; database state is now '$(db_state)' (storagepg = unchanged). Run: ~/pm2/deploy-storageknex.sh rollback"
	fi
	echo "conversion took $((SECONDS - t0)) s"
	[ "$(db_state)" = "storageknex" ] || die "conversion did not commit"
	echo "knex_migrations: $(sql 'SELECT count(*) FROM knex_migrations') (expect $CONVERTED_MIGRATIONS)"

	say "5/9 Start wallet-monitor alone (StorageKnex.migrate)"
	pm2 delete wallet-monitor
	(cd "$MONITOR_CWD" && pm2 start "$ECOSYSTEM" --only wallet-monitor)
	wait_for_migrations

	say "6/9 Verify database (hosts not started yet)"
	verify_db

	say "7/9 Start wallet-storage and wallet-host, save the process list"
	pm2 delete wallet-storage 2>/dev/null || true
	(cd "$HOST_CWD" && pm2 start "$ECOSYSTEM" --only wallet-storage)
	wait_for_http wallet-storage "$STORAGE_PORT"
	echo "GET  127.0.0.1:$STORAGE_PORT/: $(curl -s "http://127.0.0.1:$STORAGE_PORT/") (expect: BRC-100 mainNet Storage Provider.)"
	pm2 delete wallet-host
	(cd "$HOST_CWD" && pm2 start "$ECOSYSTEM" --only wallet-host)
	wait_for_http wallet-host "$HOST_PORT"
	pm2 save
	ls -l "$HOME/.pm2/dump.pm2"

	say "8/9 nginx: wallet.1sat.app -> wallet-storage, /account/ -> wallet-host (operator)"
	echo "Until this is done wallet.1sat.app storage calls reach wallet-host, which no longer serves them."
	echo "Apply the change from the runbook (\"nginx\" section) in another shell, then:"
	echo "  sudo nginx -t && sudo systemctl reload nginx"
	confirm "nginx reloaded with the change?"

	say "9/9 Checks"
	pm2 ls
	echo "GET  https://wallet.1sat.app/: $(curl -s https://wallet.1sat.app/) (expect: BRC-100 mainNet Storage Provider.)"
	echo "GET  https://wallet.1sat.app/healthz: $(curl -s -o /dev/null -w '%{http_code}' https://wallet.1sat.app/healthz) (expect 200)"
	echo "POST https://wallet.1sat.app/ unauthenticated: $(curl -s -o /dev/null -w '%{http_code}' -X POST \
		-H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","method":"getSettings","params":[],"id":1}' \
		https://wallet.1sat.app/) (expect 401)"
	curl -s -o /dev/null -D - -X POST -H 'Content-Type: application/json' -d '{}' https://wallet.1sat.app/ \
		| grep -i '^ratelimit' || echo "no RateLimit headers on POST / (expected from the toolbox StorageServer)"
	echo "GET  https://wallet.1sat.app/account/status unauthenticated: $(curl -s -o /dev/null -w '%{http_code}' \
		https://wallet.1sat.app/account/status) (expect 401, from wallet-host)"
	echo "GET  https://messagebox.1sat.app/: $(curl -s -o /dev/null -w '%{http_code}' https://messagebox.1sat.app/)"
	echo "GET  https://1sat.app/.well-known/bsvalias: $(curl -s -o /dev/null -w '%{http_code}' https://1sat.app/.well-known/bsvalias) (expect 200)"
	echo "trustProxy: $(trust_proxy_value)"
	sleep 30
	local app errs n
	for app in wallet-storage wallet-host wallet-monitor; do
		errs=$(log_errors "$app")
		n=$(printf '%s\n' "$errs" | grep -c . || true)
		echo "$app error lines since start: $n"
		[ "$n" = "0" ] || printf '%s\n' "$errs" | tail -20
	done
	say "Done: @1sat/cli $(installed_version) on StorageKnex, saved. Backup: $DUMP"
}

rollback() {
	[ -d "$OLD_INSTALL" ] || die "no saved install at $OLD_INSTALL"
	[ -f "$CONFIG_BAK" ] || die "no saved config at $CONFIG_BAK"
	load_db_env
	local state; state=$(db_state)
	if [ "$state" = "storageknex" ]; then
		[ -f "$DUMP" ] && [ -f "$BACKUP_DIR/counts.before" ] || die "database is converted but $DUMP or counts.before is missing"
		confirm "Database is converted. Stop both apps, restore $DUMP (writes since the window are lost), and start @1sat/cli $OLD_VERSION?"
	else
		confirm "Database is unchanged (StoragePg schema). Stop both apps and start @1sat/cli $OLD_VERSION with the saved config?"
	fi

	say "nginx (operator)"
	echo "$OLD_VERSION serves storage RPC from wallet-host. If wallet.1sat.app was switched, put back its"
	echo "pre-deploy server block (every path -> wallet_backend), then: sudo nginx -t && sudo systemctl reload nginx"
	confirm "wallet.1sat.app sends every path to wallet_backend?"

	say "Stop"
	pm2 delete wallet-storage 2>/dev/null || true
	pm2 stop wallet-host wallet-monitor || true
	wait_for_idle_db

	if [ "$state" = "storageknex" ]; then
		say "Restore $DUMP (one transaction; budget 10 minutes)"
		pg_restore -l "$DUMP" >/dev/null || die "dump is not readable"
		local t0=$SECONDS
		restore_dump
		echo "restore took $((SECONDS - t0)) s"
		psql -X -q -c 'ANALYZE'
		[ "$(db_state)" = "storagepg" ] || die "restore did not bring back the StoragePg schema"
		echo "knex_migrations: $(sql 'SELECT count(*) FROM knex_migrations') (expect $STORAGEPG_MIGRATIONS)"
		sql "$COUNTS_SQL" > "$BACKUP_DIR/counts.restored"
		diff "$BACKUP_DIR/counts.before" "$BACKUP_DIR/counts.restored" || die "restored row counts differ from counts.before"
		echo "row counts match counts.before"
	fi

	say "Old install and config"
	rm -rf "$CLI_DIR" && cp -a "$OLD_INSTALL" "$CLI_DIR"
	cp -p "$CONFIG_BAK" "$CONFIG"
	echo "installed: $(installed_version); trustProxy: $(trust_proxy_value)"

	say "Start"
	pm2 delete wallet-monitor wallet-host || true
	(cd "$MONITOR_CWD" && pm2 start "$ECOSYSTEM" --only wallet-monitor)
	wait_monitor_stable
	(cd "$HOST_CWD" && pm2 start "$ECOSYSTEM" --only wallet-host)
	wait_for_http wallet-host "$HOST_PORT"
	pm2 save
	pm2 ls
	say "Rolled back to $(installed_version). Remove the wallet-storage entry from $ECOSYSTEM."
}

case "${1:-}" in
	preflight) preflight ;;
	prepare) prepare ;;
	window) window ;;
	rollback) rollback ;;
	*) sed -n '2,18p' "$0"; exit 1 ;;
esac
