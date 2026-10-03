#!/usr/bin/env bash
# Point wallet.1sat.app at wallet-storage (127.0.0.1:8110). Run with sudo on ovh-n0001 when step 8
# of the storageknex window asks for the nginx change.
#
#   sudo ~/pm2/storageknex/nginx-wallet-storage.sh            apply, test, reload
#   sudo ~/pm2/storageknex/nginx-wallet-storage.sh rollback   restore the saved file, test, reload
#
# messagebox.1sat.app and 1sat.app keep using the wallet_backend upstream (wallet-host, 8100).
set -euo pipefail

SITE=/etc/nginx/sites-available/wallet.1sat.app
BACKUP=/home/gorillapool/predeploy-backups/storageknex/wallet.1sat.app.nginx.pre-storageknex

say() { printf '\n==> %s\n' "$*"; }
die() { printf '\n!! %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "run with sudo"

reload() {
	nginx -t
	systemctl reload nginx
	say "nginx reloaded"
}

apply() {
	if grep -q 'upstream wallet_storage' "$SITE"; then
		say "$SITE already points at wallet_storage"
		grep -n 'upstream wallet_\|proxy_pass' "$SITE"
		return 0
	fi
	[ "$(grep -c 'proxy_pass http://wallet_backend;' "$SITE")" = "1" ] \
		|| die "expected exactly one 'proxy_pass http://wallet_backend;' in $SITE"

	say "Save $SITE -> $BACKUP"
	mkdir -p "$(dirname "$BACKUP")"
	[ -f "$BACKUP" ] || cp -p "$SITE" "$BACKUP"

	say "Add upstream wallet_storage, send location / to it"
	perl -0pi -e 's/(upstream wallet_backend \{[^}]*\}\n)/$1\nupstream wallet_storage {\n    server 127.0.0.1:8110;\n    keepalive 32;\n}\n/' "$SITE"
	perl -pi -e 's#proxy_pass http://wallet_backend;#proxy_pass http://wallet_storage;#' "$SITE"
	grep -q 'upstream wallet_storage' "$SITE" || { cp -p "$BACKUP" "$SITE"; die "upstream not added; restored $SITE"; }
	diff "$BACKUP" "$SITE" || true

	if ! nginx -t; then
		cp -p "$BACKUP" "$SITE"
		die "nginx -t failed; restored $SITE (nginx not reloaded)"
	fi
	systemctl reload nginx
	say "nginx reloaded: wallet.1sat.app -> wallet_storage (127.0.0.1:8110)"
}

rollback() {
	[ -f "$BACKUP" ] || die "no backup at $BACKUP"
	say "Restore $BACKUP -> $SITE"
	cp -p "$BACKUP" "$SITE"
	reload
}

case "${1:-apply}" in
	apply) apply ;;
	rollback) rollback ;;
	*) die "usage: $0 [apply|rollback]" ;;
esac
