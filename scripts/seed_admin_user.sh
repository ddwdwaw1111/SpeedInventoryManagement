#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

MODE="${MODE:-remote}"
SERVER_USER="${SERVER_USER:-ubuntu}"
SERVER_HOST="${SERVER_HOST:-129.213.52.3}"
SERVER_PATH="${SERVER_PATH:-~/SpeedInventoryManagement}"
SSH_KEY_PATH="${SSH_KEY_PATH:-$HOME/.ssh/oracle-prod.key}"
ENV_FILE_PATH="${ENV_FILE_PATH:-$ROOT_DIR/.env.prod}"
DB_CONTAINER="${DB_CONTAINER:-speed-inventory-db}"

ADMIN_EMAIL="${ADMIN_EMAIL:-admin@gmail.com}"
ADMIN_NAME="${ADMIN_NAME:-Admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-password}"

ssh_args=()

usage() {
  cat <<EOF
Usage: bash scripts/seed_admin_user.sh [options]

Seeds or updates the default admin user:
  email:    ${ADMIN_EMAIL}
  password: ${ADMIN_PASSWORD}

Modes:
  remote (default)  Connect to the production server over SSH and seed the remote DB
  local             Seed the local Docker DB container on this machine

Options:
  --local                   Run against local Docker instead of the remote server
  --remote                  Run against the remote server (default)
  --server-host <host>      Remote server host. Default: ${SERVER_HOST}
  --server-user <user>      Remote SSH user. Default: ${SERVER_USER}
  --server-path <path>      Remote project path. Default: ${SERVER_PATH}
  --ssh-key <path>          SSH key path. Default: ${SSH_KEY_PATH}
  --env-file <path>         Local env file for local mode. Default: ${ENV_FILE_PATH}
  --db-container <name>     DB container name. Default: ${DB_CONTAINER}
  --admin-email <email>     Admin email. Default: ${ADMIN_EMAIL}
  --admin-name <name>       Admin full name. Default: ${ADMIN_NAME}
  --admin-password <pwd>    Admin password. Default: ${ADMIN_PASSWORD}
  -h, --help                Show this help

Examples:
  bash scripts/seed_admin_user.sh
  bash scripts/seed_admin_user.sh --local
  bash scripts/seed_admin_user.sh --admin-password "password"
EOF
}

sql_escape() {
  printf "%s" "$1" | sed "s/'/''/g"
}

shell_escape() {
  printf "%q" "$1"
}

generate_password_hash_local() {
  if command -v go >/dev/null 2>&1; then
    (
      cd "$ROOT_DIR/backend"
      ADMIN_PASSWORD="$ADMIN_PASSWORD" go run ./cmd/hash_password
    )
    return
  fi

  if command -v docker >/dev/null 2>&1; then
    docker run --rm \
      -e ADMIN_PASSWORD="$ADMIN_PASSWORD" \
      -v "$ROOT_DIR/backend:/app" \
      -w /app \
      golang:1.22-alpine sh -c 'go run ./cmd/hash_password'
    return
  fi

  return 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --local)
      MODE="local"
      shift
      ;;
    --remote)
      MODE="remote"
      shift
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
    --env-file)
      ENV_FILE_PATH="$2"
      shift 2
      ;;
    --db-container)
      DB_CONTAINER="$2"
      shift 2
      ;;
    --admin-email)
      ADMIN_EMAIL="$2"
      shift 2
      ;;
    --admin-name)
      ADMIN_NAME="$2"
      shift 2
      ;;
    --admin-password)
      ADMIN_PASSWORD="$2"
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

if [[ -n "$SSH_KEY_PATH" && -f "$SSH_KEY_PATH" ]]; then
  ssh_args=(-i "$SSH_KEY_PATH")
fi

ADMIN_EMAIL_SQL="$(sql_escape "$ADMIN_EMAIL")"
ADMIN_NAME_SQL="$(sql_escape "$ADMIN_NAME")"
PASSWORD_HASH=""

run_seed_sql() {
  local exec_prefix="$1"
  if [[ -z "$PASSWORD_HASH" ]]; then
    echo "Missing PASSWORD_HASH" >&2
    exit 1
  fi

  local password_hash_sql
  password_hash_sql="$(sql_escape "$PASSWORD_HASH")"
  eval "$exec_prefix" <<SQL
INSERT INTO users (email, full_name, role, is_active, password_salt, password_hash)
VALUES ('${ADMIN_EMAIL_SQL}', '${ADMIN_NAME_SQL}', 'admin', TRUE, '', '${password_hash_sql}')
ON DUPLICATE KEY UPDATE
  full_name = VALUES(full_name),
  role = VALUES(role),
  is_active = VALUES(is_active),
  password_salt = VALUES(password_salt),
  password_hash = VALUES(password_hash);
SQL
}

if [[ "$MODE" == "local" ]]; then
  if [[ ! -f "$ENV_FILE_PATH" ]]; then
    echo "Missing env file: $ENV_FILE_PATH" >&2
    exit 1
  fi

  if ! PASSWORD_HASH="$(generate_password_hash_local)"; then
    echo "Could not generate a bcrypt password hash. Install Go or Docker to run this script." >&2
    exit 1
  fi

  set -a
  source "$ENV_FILE_PATH"
  set +a

  echo "==> Seeding local DB container: $DB_CONTAINER"
  echo "==> Email: $ADMIN_EMAIL"

  run_seed_sql "docker exec -i \"$DB_CONTAINER\" sh -lc 'exec mariadb -uroot -p\"\$MARIADB_ROOT_PASSWORD\" \"\$MARIADB_DATABASE\"'"
  echo "==> Done"
  exit 0
fi

echo "==> Seeding remote DB container: $DB_CONTAINER"
echo "==> Server: ${SERVER_USER}@${SERVER_HOST}"
echo "==> Email: $ADMIN_EMAIL"

if ! PASSWORD_HASH="$(generate_password_hash_local 2>/dev/null)"; then
  PASSWORD_HASH=""
fi

ssh "${ssh_args[@]}" "${SERVER_USER}@${SERVER_HOST}" \
  "cd $(shell_escape "$SERVER_PATH") && DB_CONTAINER=$(shell_escape "$DB_CONTAINER") ADMIN_EMAIL=$(shell_escape "$ADMIN_EMAIL_SQL") ADMIN_NAME=$(shell_escape "$ADMIN_NAME_SQL") ADMIN_PASSWORD=$(shell_escape "$ADMIN_PASSWORD") PASSWORD_HASH=$(shell_escape "$PASSWORD_HASH") bash -s" <<'EOF'
set -euo pipefail

if [[ ! -f ".env.prod" ]]; then
  echo "Missing .env.prod in $(pwd)" >&2
  exit 1
fi

sql_escape() {
  printf "%s" "$1" | sed "s/'/''/g"
}

if [[ -z "${PASSWORD_HASH:-}" ]]; then
  if command -v go >/dev/null 2>&1; then
    PASSWORD_HASH="$(cd backend && ADMIN_PASSWORD="$ADMIN_PASSWORD" go run ./cmd/hash_password)"
  elif command -v docker >/dev/null 2>&1; then
    PASSWORD_HASH="$(docker run --rm -e ADMIN_PASSWORD="$ADMIN_PASSWORD" -v "$PWD/backend:/app" -w /app golang:1.22-alpine sh -c 'go run ./cmd/hash_password')"
  else
    echo "Could not generate a bcrypt password hash on the remote host." >&2
    exit 1
  fi
fi

PASSWORD_HASH_SQL="$(sql_escape "$PASSWORD_HASH")"

set -a
source ".env.prod"
set +a

docker exec -i "$DB_CONTAINER" sh -lc 'exec mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" "$MARIADB_DATABASE"' <<SQL
INSERT INTO users (email, full_name, role, is_active, password_salt, password_hash)
VALUES ('${ADMIN_EMAIL}', '${ADMIN_NAME}', 'admin', TRUE, '', '${PASSWORD_HASH_SQL}')
ON DUPLICATE KEY UPDATE
  full_name = VALUES(full_name),
  role = VALUES(role),
  is_active = VALUES(is_active),
  password_salt = VALUES(password_salt),
  password_hash = VALUES(password_hash);
SQL
EOF

echo "==> Done"
