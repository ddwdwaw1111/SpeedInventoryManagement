#!/usr/bin/env bash

set -euo pipefail

SERVER_USER="${SERVER_USER:-ubuntu}"
SERVER_HOST="${SERVER_HOST:-129.213.52.3}"
SERVER_PATH="${SERVER_PATH:-/home/ubuntu/SpeedInventoryManagement}"
SSH_KEY_PATH="${SSH_KEY_PATH:-$HOME/.ssh/oracle-prod.key}"
ENV_FILE="${ENV_FILE:-.env.prod}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.https.yml}"
CRON_SCHEDULE="${CRON_SCHEDULE:-17 3 * * *}"
REMOTE_SCRIPT_RELATIVE_PATH="${REMOTE_SCRIPT_RELATIVE_PATH:-scripts/renew_https_cert_on_server.sh}"
LOG_FILE_RELATIVE_PATH="${LOG_FILE_RELATIVE_PATH:-logs/cert-renew.log}"

usage() {
  printf "%s\n" \
    "Usage: bash scripts/install_https_cert_renewal_cron.sh [options]" \
    "" \
    "Installs a server-side cron job that renews Let's Encrypt certificates" \
    "for the Docker Compose HTTPS stack and reloads the Nginx reverse proxy." \
    "" \
    "Options:" \
    "  --server-host <host>     Target server IP or hostname. Default: ${SERVER_HOST}" \
    "  --server-user <user>     SSH user. Default: ${SERVER_USER}" \
    "  --server-path <path>     Remote app path. Default: ${SERVER_PATH}" \
    "  --ssh-key <path>         SSH private key path. Default: ${SSH_KEY_PATH}" \
    "  --no-ssh-key             Use the default SSH agent/config instead of -i." \
    "  --env-file <path>        Remote env file path relative to server path." \
    "                           Default: ${ENV_FILE}" \
    "  --compose-file <path>    Remote compose file path relative to server path." \
    "                           Default: ${COMPOSE_FILE}" \
    "  --schedule <cron>        Cron schedule. Default: ${CRON_SCHEDULE}" \
    "  -h, --help               Show this help." \
    "" \
    "Examples:" \
    "  bash scripts/install_https_cert_renewal_cron.sh" \
    "  bash scripts/install_https_cert_renewal_cron.sh --schedule \"17 3 * * *\""
}

while [[ $# -gt 0 ]]; do
  case "$1" in
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
    --schedule)
      CRON_SCHEDULE="$2"
      shift 2
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

remote_command="SERVER_PATH=$(shell_quote "$SERVER_PATH") ENV_FILE=$(shell_quote "$ENV_FILE") COMPOSE_FILE=$(shell_quote "$COMPOSE_FILE") CRON_SCHEDULE=$(shell_quote "$CRON_SCHEDULE") REMOTE_SCRIPT_RELATIVE_PATH=$(shell_quote "$REMOTE_SCRIPT_RELATIVE_PATH") LOG_FILE_RELATIVE_PATH=$(shell_quote "$LOG_FILE_RELATIVE_PATH") bash -s"

echo "==> Connecting to ${SERVER_USER}@${SERVER_HOST}"
echo "==> Remote path: ${SERVER_PATH}"
echo "==> Cron schedule: ${CRON_SCHEDULE}"
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

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Remote env file not found: ${SERVER_PATH}/${ENV_FILE}" >&2
  exit 1
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Remote compose file not found: ${SERVER_PATH}/${COMPOSE_FILE}" >&2
  exit 1
fi

mkdir -p "$(dirname "$REMOTE_SCRIPT_RELATIVE_PATH")" "$(dirname "$LOG_FILE_RELATIVE_PATH")"

cat > "$REMOTE_SCRIPT_RELATIVE_PATH" <<SERVER_RENEW_SCRIPT
#!/usr/bin/env bash

set -euo pipefail

cd "$SERVER_PATH"

compose=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

echo "==> \$(date -Is) starting certificate renewal"

if command -v timeout >/dev/null 2>&1; then
  timeout 900 "\${compose[@]}" run --rm certbot renew --webroot -w /var/www/certbot --quiet
else
  "\${compose[@]}" run --rm certbot renew --webroot -w /var/www/certbot --quiet
fi

echo "==> \$(date -Is) reloading reverse proxy"
"\${compose[@]}" exec -T reverse-proxy nginx -s reload || "\${compose[@]}" restart reverse-proxy

echo "==> \$(date -Is) renewal check finished"
SERVER_RENEW_SCRIPT

chmod +x "$REMOTE_SCRIPT_RELATIVE_PATH"

absolute_script_path="${SERVER_PATH}/${REMOTE_SCRIPT_RELATIVE_PATH}"
absolute_log_path="${SERVER_PATH}/${LOG_FILE_RELATIVE_PATH}"
cron_marker="# speed-inventory cert renewal"
cron_line="${CRON_SCHEDULE} ${absolute_script_path} >> ${absolute_log_path} 2>&1 ${cron_marker}"

existing_cron="$(mktemp)"
new_cron="$(mktemp)"
trap 'rm -f "$existing_cron" "$new_cron"' EXIT

crontab -l > "$existing_cron" 2>/dev/null || true
grep -vF "$cron_marker" "$existing_cron" > "$new_cron" || true
printf "%s\n" "$cron_line" >> "$new_cron"
crontab "$new_cron"

echo "==> Installed server renewal script: ${absolute_script_path}"
echo "==> Installed cron entry:"
echo "$cron_line"
echo
echo "==> Current matching crontab entry:"
crontab -l | grep -F "$cron_marker" || true
REMOTE_SCRIPT

echo
echo "==> Done"
