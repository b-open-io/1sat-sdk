#!/usr/bin/env bash
# Serve accounts.1sat.app from wallet-host (wallet_backend, 127.0.0.1:8100) on ovh-n0001.
# DNS: proxied A record accounts.1sat.app -> 15.204.215.48. The certificate comes from certbot
# dns-cloudflare, like every other site on this host.
#
#   sudo ~/pm2/storageknex/accounts-nginx.sh            cert (if missing), site, test, reload
#   sudo ~/pm2/storageknex/accounts-nginx.sh rollback   remove the site, test, reload (cert kept)
set -euo pipefail

DOMAIN=accounts.1sat.app
SITE=/etc/nginx/sites-available/$DOMAIN
ENABLED=/etc/nginx/sites-enabled/$DOMAIN
CERT_DIR=/etc/letsencrypt/live/$DOMAIN

say() { printf '\n==> %s\n' "$*"; }
die() { printf '\n!! %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "run with sudo"

apply() {
	if [ -f "$CERT_DIR/fullchain.pem" ]; then
		say "Certificate for $DOMAIN already exists"
	else
		say "Issue certificate for $DOMAIN (certbot dns-cloudflare)"
		certbot certonly --non-interactive \
			--dns-cloudflare --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini \
			--dns-cloudflare-propagation-seconds 30 \
			-d "$DOMAIN"
	fi

	[ -e "$SITE" ] && die "$SITE already exists; not overwriting it"
	grep -rq 'upstream wallet_backend' /etc/nginx/sites-enabled/ || die "no wallet_backend upstream in sites-enabled"

	say "Write $SITE"
	cat > "$SITE" <<EOF
server {
    listen 443 ssl;
    server_name $DOMAIN;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_certificate     $CERT_DIR/fullchain.pem;
    ssl_certificate_key $CERT_DIR/privkey.pem;

    location / {
        client_max_body_size 100m;
        proxy_pass http://wallet_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}

server {
    listen 80;
    server_name $DOMAIN;
    return 301 https://\$server_name\$request_uri;
}
EOF
	ln -s "$SITE" "$ENABLED"

	if ! nginx -t; then
		rm -f "$ENABLED" "$SITE"
		die "nginx -t failed; removed $SITE (nginx not reloaded)"
	fi
	systemctl reload nginx
	say "nginx reloaded: https://$DOMAIN -> wallet_backend"
}

rollback() {
	say "Remove $SITE"
	rm -f "$ENABLED" "$SITE"
	nginx -t
	systemctl reload nginx
	say "nginx reloaded without $DOMAIN (certificate kept in $CERT_DIR)"
}

case "${1:-apply}" in
	apply) apply ;;
	rollback) rollback ;;
	*) die "usage: $0 [apply|rollback]" ;;
esac
