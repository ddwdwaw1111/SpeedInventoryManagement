#!/bin/sh

set -eu

template="/templates/http.conf.template"

if [ -n "${SITE_DOMAIN:-}" ] && [ -f "/etc/letsencrypt/live/${SITE_DOMAIN}/fullchain.pem" ] && [ -f "/etc/letsencrypt/live/${SITE_DOMAIN}/privkey.pem" ]; then
  template="/templates/https.conf.template"
fi

envsubst '${SITE_DOMAIN} ${SITE_DOMAIN_ALIASES}' < "$template" > /etc/nginx/conf.d/default.conf
exec nginx -g 'daemon off;'
