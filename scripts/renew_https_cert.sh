#!/usr/bin/env bash

set -euo pipefail

SERVER_USER="${SERVER_USER:-ubuntu}"
SERVER_HOST="${SERVER_HOST:-129.213.52.3}"
SERVER_PATH="${SERVER_PATH:-/home/ubuntu/SpeedInventoryManagement}"
SSH_KEY_PATH="${SSH_KEY_PATH:-$HOME/.ssh/oracle-prod.key}"
ENV_FILE="${ENV_FILE:-.env.prod}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.https.yml}"
ACME_EMAIL="${ACME_EMAIL:-}"
DOMAIN_OVERRIDE="${DOMAIN_OVERRIDE:-}"
DOMAIN_ALIASES_OVERRIDE="${DOMAIN_ALIASES_OVERRIDE:-}"
CERTBOT_TIMEOUT_SECONDS="${CERTBOT_TIMEOUT_SECONDS:-300}"
FORCE_REISSUE="false"
DRY_RUN="false"

usage() {
  printf "%s\n" \
    "Usage: bash scripts/renew_https_cert.sh [options]" \
    "" \
    "Renews or issues the Let's Encrypt certificate on the production Docker Compose" \
    "HTTPS stack, then restarts the Nginx reverse proxy and verifies HTTPS." \
    "" \
    "Options:" \
    "  --email <email>          Let's Encrypt account email. Required for first issue" \
    "                           and force reissue." \
    "  --domain <domain>        Certificate primary domain. Overrides SITE_DOMAIN" \
    "                           from the remote env file." \
    "  --aliases <domains>      Optional comma- or space-separated alias domains." \
    "  --certbot-timeout <sec>  Max seconds for each Certbot/Docker check." \
    "                           Default: ${CERTBOT_TIMEOUT_SECONDS}" \
    "  --server-host <host>     Target server IP or hostname. Default: ${SERVER_HOST}" \
    "  --server-user <user>     SSH user. Default: ${SERVER_USER}" \
    "  --server-path <path>     Remote app path. Default: ${SERVER_PATH}" \
    "  --ssh-key <path>         SSH private key path. Default: ${SSH_KEY_PATH}" \
    "  --no-ssh-key             Use the default SSH agent/config instead of -i." \
    "  --env-file <path>        Remote env file path relative to server path." \
    "                           Default: ${ENV_FILE}" \
    "  --compose-file <path>    Remote compose file path relative to server path." \
    "                           Default: ${COMPOSE_FILE}" \
    "  --force                  Force reissue even if the certificate is not due." \
    "  --dry-run                Ask Let's Encrypt staging to test the renewal flow." \
    "  -h, --help               Show this help." \
    "" \
    "Examples:" \
    "  bash scripts/renew_https_cert.sh --email you@example.com" \
    "  bash scripts/renew_https_cert.sh --email you@example.com --force" \
    "  bash scripts/renew_https_cert.sh --email you@example.com --domain www.corgi4ever.com" \
    "  bash scripts/renew_https_cert.sh --server-host 129.213.52.3 --ssh-key ~/.ssh/oracle-prod.key --email you@example.com"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --email)
      ACME_EMAIL="$2"
      shift 2
      ;;
    --domain)
      DOMAIN_OVERRIDE="$2"
      shift 2
      ;;
    --aliases|--domain-aliases)
      DOMAIN_ALIASES_OVERRIDE="$2"
      shift 2
      ;;
    --certbot-timeout)
      CERTBOT_TIMEOUT_SECONDS="$2"
      shift 2
      ;;
    --server-host)
      SERVER_HOST="$2"
      shift 2
      ;;
    --server-user)
      SERVER_USER="$2"
      shift 2
      ;;
    --server-path)
      SERVER_PATH="$2"
      shift 2
      ;;
    --ssh-key)
      SSH_KEY_PATH="$2"
      shift 2
      ;;
    --no-ssh-key)
      SSH_KEY_PATH=""
      shift
      ;;
    --env-file)
      ENV_FILE="$2"
      shift 2
      ;;
    --compose-file)
      COMPOSE_FILE="$2"
      shift 2
      ;;
    --force)
      FORCE_REISSUE="true"
      shift
      ;;
    --dry-run)
      DRY_RUN="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$SERVER_HOST" ]]; then
  echo "--server-host is required." >&2
  exit 1
fi

ssh_args=()
if [[ -n "$SSH_KEY_PATH" ]]; then
  ssh_args=(-i "$SSH_KEY_PATH")
fi

shell_quote() {
  printf "%q" "$1"
}

remote_command="SERVER_PATH=$(shell_quote "$SERVER_PATH") ENV_FILE=$(shell_quote "$ENV_FILE") COMPOSE_FILE=$(shell_quote "$COMPOSE_FILE") ACME_EMAIL=$(shell_quote "$ACME_EMAIL") DOMAIN_OVERRIDE=$(shell_quote "$DOMAIN_OVERRIDE") DOMAIN_ALIASES_OVERRIDE=$(shell_quote "$DOMAIN_ALIASES_OVERRIDE") CERTBOT_TIMEOUT_SECONDS=$(shell_quote "$CERTBOT_TIMEOUT_SECONDS") FORCE_REISSUE=$(shell_quote "$FORCE_REISSUE") DRY_RUN=$(shell_quote "$DRY_RUN") bash -s"

echo "==> Connecting to ${SERVER_USER}@${SERVER_HOST}"
echo "==> Remote path: ${SERVER_PATH}"
echo

ssh "${ssh_args[@]}" "${SERVER_USER}@${SERVER_HOST}" "$remote_command" <<'REMOTE_SCRIPT'
set -euo pipefail

if [[ "$SERVER_PATH" == "~" ]]; then
  SERVER_PATH="$HOME"
elif [[ "$SERVER_PATH" == "~/"* ]]; then
  SERVER_PATH="$HOME/${SERVER_PATH#~/}"
elif [[ "$SERVER_PATH" == "$HOME/~/"* ]]; then
  SERVER_PATH="$HOME/${SERVER_PATH#"$HOME/~/"}"
fi

cd "$SERVER_PATH"

compose=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf "%s" "$value"
}

read_env_value() {
  local key="$1"
  local line value

  line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${key}=" "$ENV_FILE" | tail -n 1 || true)"
  value="${line#*=}"
  value="$(trim "$value")"

  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value:1:${#value}-2}"
  fi

  printf "%s" "$value"
}

domain_from_origin() {
  local origin="$1"
  origin="${origin#http://}"
  origin="${origin#https://}"
  origin="${origin%%/*}"
  origin="${origin%%:*}"
  printf "%s" "$origin"
}

validate_domain() {
  local domain="$1"
  if [[ ! "$domain" =~ ^[A-Za-z0-9.-]+$ ]]; then
    echo "Invalid domain in ${ENV_FILE}: ${domain}" >&2
    exit 1
  fi
}

wait_for_container() {
  local container_name="$1"
  local target_state="$2"
  local timeout_seconds="${3:-180}"
  local elapsed=0
  local status=""

  while (( elapsed < timeout_seconds )); do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_name" 2>/dev/null || true)"
    if [[ "$status" == "$target_state" ]]; then
      echo "==> ${container_name} is ${target_state}"
      return 0
    fi
    if [[ "$status" == "unhealthy" || "$status" == "exited" || "$status" == "dead" ]]; then
      echo "Container ${container_name} entered bad state: ${status}" >&2
      docker logs --tail 120 "$container_name" || true
      return 1
    fi
    sleep 5
    elapsed=$((elapsed + 5))
  done

  echo "Timed out waiting for ${container_name} to become ${target_state} (last status: ${status:-unknown})" >&2
  docker logs --tail 120 "$container_name" || true
  return 1
}

run_with_timeout() {
  local timeout_seconds="$1"
  shift

  if command -v timeout >/dev/null 2>&1; then
    timeout "$timeout_seconds" "$@"
  else
    "$@"
  fi
}

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required on the server but was not found in PATH." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required on the server." >&2
  exit 1
fi

if ! [[ "$CERTBOT_TIMEOUT_SECONDS" =~ ^[0-9]+$ ]] || (( CERTBOT_TIMEOUT_SECONDS < 1 )); then
  echo "Invalid certbot timeout: ${CERTBOT_TIMEOUT_SECONDS}" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Remote env file not found: ${SERVER_PATH}/${ENV_FILE}" >&2
  exit 1
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Remote compose file not found: ${SERVER_PATH}/${COMPOSE_FILE}" >&2
  exit 1
fi

site_domain="$DOMAIN_OVERRIDE"
site_aliases="$DOMAIN_ALIASES_OVERRIDE"

if [[ -z "$site_domain" ]]; then
  site_domain="$(read_env_value SITE_DOMAIN)"
fi

if [[ -z "$site_aliases" ]]; then
  site_aliases="$(read_env_value SITE_DOMAIN_ALIASES)"
fi

if [[ -z "$site_domain" ]]; then
  frontend_origin="$(read_env_value FRONTEND_ORIGIN)"
  site_domain="$(domain_from_origin "$frontend_origin")"
fi

if [[ -z "$site_domain" ]]; then
  echo "Could not determine the certificate domain." >&2
  echo "Set SITE_DOMAIN in ${ENV_FILE}, set FRONTEND_ORIGIN to an https URL, or pass --domain." >&2
  exit 1
fi

export SITE_DOMAIN="$site_domain"
export SITE_DOMAIN_ALIASES="$site_aliases"

domains=()
domains+=("$site_domain")
if [[ -n "$site_aliases" ]]; then
  normalized_aliases="${site_aliases//,/ }"
  read -r -a alias_parts <<< "$normalized_aliases"
  for alias in "${alias_parts[@]}"; do
    [[ -n "$alias" ]] && domains+=("$alias")
  done
fi

declare -A seen_domains=()
domain_args=()
for domain in "${domains[@]}"; do
  validate_domain "$domain"
  if [[ -z "${seen_domains[$domain]:-}" ]]; then
    seen_domains["$domain"]=1
    domain_args+=("-d" "$domain")
  fi
done

echo "==> Domains: ${domains[*]}"
echo "==> Ensuring HTTPS stack is running"
"${compose[@]}" up -d mariadb backend frontend reverse-proxy

wait_for_container speed-inventory-api healthy 240
wait_for_container speed-inventory-web healthy 180
wait_for_container speed-inventory-proxy running 120

if ! docker image inspect certbot/certbot:latest >/dev/null 2>&1; then
  echo "==> Pulling certbot/certbot:latest"
  run_with_timeout "$CERTBOT_TIMEOUT_SECONDS" "${compose[@]}" pull certbot
fi

cert_exists=0
echo "==> Checking existing certificate files"
if run_with_timeout "$CERTBOT_TIMEOUT_SECONDS" docker exec speed-inventory-proxy sh -c "test -f '/etc/letsencrypt/live/${site_domain}/fullchain.pem' && test -f '/etc/letsencrypt/live/${site_domain}/privkey.pem'" >/dev/null 2>&1; then
  cert_exists=1
fi
echo "==> Existing certificate: $([[ "$cert_exists" == "1" ]] && echo yes || echo no)"

certbot_extra_args=(--non-interactive)
if [[ "$DRY_RUN" == "true" ]]; then
  certbot_extra_args+=(--dry-run)
fi

if [[ "$cert_exists" == "0" || "$FORCE_REISSUE" == "true" ]]; then
  if [[ -z "$ACME_EMAIL" ]]; then
    echo "--email is required when issuing or force reissuing a certificate." >&2
    exit 1
  fi

  certbot_cmd=(certonly --webroot -w /var/www/certbot "${domain_args[@]}" --email "$ACME_EMAIL" --agree-tos --no-eff-email "${certbot_extra_args[@]}")
  if [[ "$FORCE_REISSUE" == "true" ]]; then
    certbot_cmd+=(--force-renewal)
  fi

  echo "==> Issuing certificate with Certbot"
  run_with_timeout "$CERTBOT_TIMEOUT_SECONDS" "${compose[@]}" run --rm certbot "${certbot_cmd[@]}"
else
  certbot_cmd=(renew --webroot -w /var/www/certbot "${certbot_extra_args[@]}")

  echo "==> Renewing certificate with Certbot"
  run_with_timeout "$CERTBOT_TIMEOUT_SECONDS" "${compose[@]}" run --rm certbot "${certbot_cmd[@]}"
fi

if [[ "$DRY_RUN" == "true" ]]; then
  echo "==> Dry run completed; leaving running proxy unchanged"
  exit 0
fi

echo "==> Restarting Nginx reverse proxy"
"${compose[@]}" restart reverse-proxy
wait_for_container speed-inventory-proxy running 120

echo "==> Verifying HTTPS through the proxy container"
"${compose[@]}" exec -T reverse-proxy wget --no-check-certificate -q -O /dev/null https://localhost/api/health

if command -v curl >/dev/null 2>&1; then
  echo "==> Verifying public HTTPS certificate"
  curl --fail --silent --show-error --max-time 20 "https://${site_domain}/api/health" >/dev/null
else
  echo "==> curl is not installed on the server; skipped public HTTPS verification"
fi

echo
echo "==> Certificate status"
"${compose[@]}" run --rm certbot certificates || true

echo
echo "==> HTTPS certificate workflow finished"
REMOTE_SCRIPT
