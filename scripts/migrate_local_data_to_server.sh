#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SERVER_USER="${SERVER_USER:-ubuntu}"
SERVER_HOST="${SERVER_HOST:-129.213.52.3}"
SERVER_PATH="${SERVER_PATH:-~/SpeedInventoryManagement}"
SSH_KEY_PATH="${SSH_KEY_PATH:-$HOME/.ssh/oracle-prod.key}"
ENV_FILE_PATH="${ENV_FILE_PATH:-$ROOT_DIR/.env.prod}"
LOCAL_DB_CONTAINER="${LOCAL_DB_CONTAINER:-speed-inventory-db}"
LOCAL_DB_NAME="${LOCAL_DB_NAME:-speed_inventory_management}"
LOCAL_DB_USER="${LOCAL_DB_USER:-inventory_user}"
LOCAL_DB_PASSWORD="${LOCAL_DB_PASSWORD:-inventory_pass}"
OUTPUT_DIR="${OUTPUT_DIR:-$ROOT_DIR/dist/deploy}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
DUMP_FILE_NAME="${DUMP_FILE_NAME:-${LOCAL_DB_NAME}-dump-${TIMESTAMP}.sql}"
DUMP_FILE_PATH="$OUTPUT_DIR/$DUMP_FILE_NAME"

ssh_args=()

usage() {
  cat <<EOF
Usage: bash scripts/migrate_local_data_to_server.sh [options]

Exports local MariaDB data from Docker, uploads it to the server, backs up the
server database, then imports the local dump into the remote database.

Options:
  --server-host <host>         Target server IP or hostname. Default: ${SERVER_HOST}
  --server-user <user>         SSH user. Default: ${SERVER_USER}
  --server-path <path>         Remote app path. Default: ${SERVER_PATH}
  --ssh-key <path>             SSH private key path. Default: ${SSH_KEY_PATH}
  --env-file <path>            Local env file with remote DB password. Default: ${ENV_FILE_PATH}
  --local-db-container <name>  Local MariaDB container. Default: ${LOCAL_DB_CONTAINER}
  --local-db-name <name>       Local DB name. Default: ${LOCAL_DB_NAME}
  --local-db-user <user>       Local DB user. Default: ${LOCAL_DB_USER}
  --local-db-password <pass>   Local DB password. Default: ${LOCAL_DB_PASSWORD}
  --output-dir <dir>           Dump output directory. Default: ${OUTPUT_DIR}
  --dump-file <name>           Override dump filename.
  -h, --help                   Show this help.
EOF
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
    --env-file)
      ENV_FILE_PATH="$2"
      shift 2
      ;;
    --local-db-container)
      LOCAL_DB_CONTAINER="$2"
      shift 2
      ;;
    --local-db-name)
      LOCAL_DB_NAME="$2"
      shift 2
      ;;
    --local-db-user)
      LOCAL_DB_USER="$2"
      shift 2
      ;;
    --local-db-password)
      LOCAL_DB_PASSWORD="$2"
      shift 2
      ;;
    --output-dir)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --dump-file)
      DUMP_FILE_NAME="$2"
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

mkdir -p "$OUTPUT_DIR"
DUMP_FILE_PATH="$OUTPUT_DIR/$DUMP_FILE_NAME"

if [[ -n "$SSH_KEY_PATH" ]]; then
  ssh_args=(-i "$SSH_KEY_PATH")
fi

if [[ ! -f "$ENV_FILE_PATH" ]]; then
  echo "Env file not found: $ENV_FILE_PATH" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required but was not found in PATH." >&2
  exit 1
fi

if ! command -v ssh >/dev/null 2>&1; then
  echo "ssh is required but was not found in PATH." >&2
  exit 1
fi

if ! command -v scp >/dev/null 2>&1; then
  echo "scp is required but was not found in PATH." >&2
  exit 1
fi

REMOTE_DB_PASSWORD="$(grep '^MARIADB_PASSWORD=' "$ENV_FILE_PATH" | cut -d= -f2-)"
if [[ -z "$REMOTE_DB_PASSWORD" ]]; then
  echo "Could not read MARIADB_PASSWORD from $ENV_FILE_PATH" >&2
  exit 1
fi

REMOTE_DB_NAME="$(grep '^MARIADB_DATABASE=' "$ENV_FILE_PATH" | cut -d= -f2-)"
REMOTE_DB_NAME="${REMOTE_DB_NAME:-$LOCAL_DB_NAME}"
REMOTE_DB_USER="$(grep '^MARIADB_USER=' "$ENV_FILE_PATH" | cut -d= -f2-)"
REMOTE_DB_USER="${REMOTE_DB_USER:-$LOCAL_DB_USER}"

echo "==> Local DB container: ${LOCAL_DB_CONTAINER}"
echo "==> Local DB name:      ${LOCAL_DB_NAME}"
echo "==> Server target:      ${SERVER_USER}@${SERVER_HOST}:${SERVER_PATH}"
echo "==> Dump output:        ${DUMP_FILE_PATH}"
echo

echo "==> Exporting local database"
docker exec "$LOCAL_DB_CONTAINER" mysqldump \
  -u"$LOCAL_DB_USER" \
  -p"$LOCAL_DB_PASSWORD" \
  --default-character-set=utf8mb4 \
  --single-transaction \
  --skip-lock-tables \
  "$LOCAL_DB_NAME" > "$DUMP_FILE_PATH"

echo
echo "==> Ready to migrate data"
echo "This will:"
echo "    - upload $(basename "$DUMP_FILE_PATH")"
echo "    - create a backup of the current remote database"
echo "    - drop current remote tables"
echo "    - import your local data into the remote database"
echo
read -r -p "Type 'yes' to continue migration: " confirmation
if [[ "$confirmation" != "yes" ]]; then
  echo "Migration cancelled."
  exit 0
fi

echo
echo "==> Uploading dump to remote server"
scp "${ssh_args[@]}" "$DUMP_FILE_PATH" "${SERVER_USER}@${SERVER_HOST}:${SERVER_PATH}/"

REMOTE_DUMP_PATH="${SERVER_PATH}/$(basename "$DUMP_FILE_PATH")"
REMOTE_BACKUP_PATH="${SERVER_PATH}/server-backup-before-import-${TIMESTAMP}.sql"

echo
echo "==> Backing up remote database"
ssh "${ssh_args[@]}" "${SERVER_USER}@${SERVER_HOST}" \
  "docker exec speed-inventory-db mysqldump -u${REMOTE_DB_USER} -p${REMOTE_DB_PASSWORD} --default-character-set=utf8mb4 --single-transaction --skip-lock-tables ${REMOTE_DB_NAME} > ${REMOTE_BACKUP_PATH}"

echo
echo "==> Dropping remote tables"
ssh "${ssh_args[@]}" "${SERVER_USER}@${SERVER_HOST}" \
  "docker exec -i speed-inventory-db mariadb -u${REMOTE_DB_USER} -p${REMOTE_DB_PASSWORD} ${REMOTE_DB_NAME} <<'EOF'
SET FOREIGN_KEY_CHECKS=0;
DROP TABLE IF EXISTS stock_movements;
DROP TABLE IF EXISTS inventory_items;
DROP TABLE IF EXISTS sku_master;
DROP TABLE IF EXISTS storage_locations;
SET FOREIGN_KEY_CHECKS=1;
EOF"

echo
echo "==> Importing local dump into remote database"
ssh "${ssh_args[@]}" "${SERVER_USER}@${SERVER_HOST}" \
  "docker exec -i speed-inventory-db mariadb -u${REMOTE_DB_USER} -p${REMOTE_DB_PASSWORD} ${REMOTE_DB_NAME} < ${REMOTE_DUMP_PATH}"

echo
echo "==> Verifying remote row counts"
ssh "${ssh_args[@]}" "${SERVER_USER}@${SERVER_HOST}" \
  "docker exec -i speed-inventory-db mariadb -u${REMOTE_DB_USER} -p${REMOTE_DB_PASSWORD} -e \"USE ${REMOTE_DB_NAME}; SELECT COUNT(*) AS inventory_rows FROM inventory_items; SELECT COUNT(*) AS movement_rows FROM stock_movements;\""

echo
echo "==> Migration complete"
echo "Remote backup saved at: ${REMOTE_BACKUP_PATH}"
