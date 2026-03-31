#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TARGET="db"
COMPOSE_FILE="docker-compose.yml"
DB_SERVICE="mariadb"
DB_CONTAINER="speed-inventory-db"
APP_ENV="development"
BACKEND_PORT="8080"
FRONTEND_ORIGIN="http://localhost:5173"
FRONTEND_API_BASE_URL="http://localhost:8080/api"
DB_HOST="127.0.0.1"
DB_PORT="3306"
DB_NAME="speed_inventory_management"
DB_USER="inventory_user"
DB_PASSWORD="inventory_pass"
DB_WAIT_TIMEOUT_SECONDS="90"
SKIP_DATABASE="0"
LAUNCH="0"

require_command() {
  local command_name="$1"
  local missing_message="$2"

  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "$missing_message" >&2
    exit 1
  fi
}

usage() {
  cat <<EOF
Usage: bash scripts/dev_local.sh [options]

Run local development services without rebuilding the full Docker stack.

Targets:
  db         Start only the MariaDB Docker service
  backend    Run the backend locally
  frontend   Run the frontend locally
  all        Start MariaDB, then print the backend/frontend commands

Options:
  --target <name>               Target to run. Default: ${TARGET}
  --compose-file <path>         Compose file. Default: ${COMPOSE_FILE}
  --db-service <name>           Compose DB service. Default: ${DB_SERVICE}
  --db-container <name>         DB container name. Default: ${DB_CONTAINER}
  --backend-port <port>         Backend port. Default: ${BACKEND_PORT}
  --frontend-origin <url>       Frontend origin for backend CORS. Default: ${FRONTEND_ORIGIN}
  --frontend-api-base-url <u>   Frontend API base URL. Default: ${FRONTEND_API_BASE_URL}
  --db-host <host>              DB host for local backend. Default: ${DB_HOST}
  --db-port <port>              DB port for local backend. Default: ${DB_PORT}
  --db-name <name>              DB name. Default: ${DB_NAME}
  --db-user <name>              DB user. Default: ${DB_USER}
  --db-password <pwd>           DB password. Default: ${DB_PASSWORD}
  --skip-database               Skip starting Docker MariaDB for backend
  --launch                      For "all", start backend and frontend in the background
  -h, --help                    Show this help

Examples:
  bash scripts/dev_local.sh --target db
  bash scripts/dev_local.sh --target backend
  bash scripts/dev_local.sh --target frontend
  bash scripts/dev_local.sh --target all
  bash scripts/dev_local.sh --target all --launch
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      TARGET="$2"
      shift 2
      ;;
    --compose-file)
      COMPOSE_FILE="$2"
      shift 2
      ;;
    --db-service)
      DB_SERVICE="$2"
      shift 2
      ;;
    --db-container)
      DB_CONTAINER="$2"
      shift 2
      ;;
    --backend-port)
      BACKEND_PORT="$2"
      shift 2
      ;;
    --frontend-origin)
      FRONTEND_ORIGIN="$2"
      shift 2
      ;;
    --frontend-api-base-url)
      FRONTEND_API_BASE_URL="$2"
      shift 2
      ;;
    --db-host)
      DB_HOST="$2"
      shift 2
      ;;
    --db-port)
      DB_PORT="$2"
      shift 2
      ;;
    --db-name)
      DB_NAME="$2"
      shift 2
      ;;
    --db-user)
      DB_USER="$2"
      shift 2
      ;;
    --db-password)
      DB_PASSWORD="$2"
      shift 2
      ;;
    --skip-database)
      SKIP_DATABASE="1"
      shift
      ;;
    --launch)
      LAUNCH="1"
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

wait_for_database() {
  local start_ts current_ts status
  start_ts="$(date +%s)"

  while true; do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$DB_CONTAINER" 2>/dev/null || true)"
    if [[ "$status" == "healthy" || "$status" == "running" ]]; then
      echo "==> Database is $status"
      return
    fi

    current_ts="$(date +%s)"
    if (( current_ts - start_ts >= DB_WAIT_TIMEOUT_SECONDS )); then
      echo "Database container '$DB_CONTAINER' did not become healthy within ${DB_WAIT_TIMEOUT_SECONDS}s." >&2
      exit 1
    fi

    sleep 2
  done
}

start_database() {
  require_command "docker" "Docker is required for local DB mode. Install Docker Desktop or Docker Engine first."
  echo "==> Starting local MariaDB container"
  docker compose -f "$COMPOSE_FILE" up -d "$DB_SERVICE"
  wait_for_database
}

run_backend() {
  require_command "go" "Go 1.22+ is required to run the backend locally. Install Go and reopen your shell, or keep using the Docker backend workflow."

  if [[ "$SKIP_DATABASE" != "1" ]]; then
    start_database
  fi

  echo "==> Starting backend locally on port $BACKEND_PORT"
  cd "$ROOT_DIR/backend"
  APP_ENV="$APP_ENV" \
  SERVER_PORT="$BACKEND_PORT" \
  FRONTEND_ORIGIN="$FRONTEND_ORIGIN" \
  DB_HOST="$DB_HOST" \
  DB_PORT="$DB_PORT" \
  DB_NAME="$DB_NAME" \
  DB_USER="$DB_USER" \
  DB_PASSWORD="$DB_PASSWORD" \
  go run ./cmd/server
}

run_frontend() {
  require_command "npm" "npm is required to run the frontend locally. Install Node.js 24 and reopen your shell."
  echo "==> Starting frontend locally"
  cd "$ROOT_DIR/frontend"
  VITE_API_BASE_URL="$FRONTEND_API_BASE_URL" npm run dev
}

show_all_instructions() {
  cat <<EOF

==> Local DB is ready. Run these in two separate terminals:

Bash terminal 1:
  bash scripts/dev_local.sh --target backend

Bash terminal 2:
  bash scripts/dev_local.sh --target frontend

Tip: add --skip-database when the DB container is already running.
EOF
}

launch_all() {
  local backend_pid frontend_pid
  require_command "go" "Go 1.22+ is required to run the backend locally. Install Go and reopen your shell, or omit --launch."
  require_command "npm" "npm is required to run the frontend locally. Install Node.js 24 and reopen your shell."

  echo "==> Launching backend and frontend in the background"
  (
    cd "$ROOT_DIR/backend"
    APP_ENV="$APP_ENV" \
    SERVER_PORT="$BACKEND_PORT" \
    FRONTEND_ORIGIN="$FRONTEND_ORIGIN" \
    DB_HOST="$DB_HOST" \
    DB_PORT="$DB_PORT" \
    DB_NAME="$DB_NAME" \
    DB_USER="$DB_USER" \
    DB_PASSWORD="$DB_PASSWORD" \
    go run ./cmd/server
  ) &
  backend_pid=$!

  (
    cd "$ROOT_DIR/frontend"
    VITE_API_BASE_URL="$FRONTEND_API_BASE_URL" npm run dev
  ) &
  frontend_pid=$!

  echo "==> Backend PID: $backend_pid"
  echo "==> Frontend PID: $frontend_pid"
  echo "Press Ctrl+C to stop both processes."

  trap 'kill "$backend_pid" "$frontend_pid" 2>/dev/null || true' EXIT INT TERM
  wait
}

case "$TARGET" in
  db)
    start_database
    ;;
  backend)
    run_backend
    ;;
  frontend)
    run_frontend
    ;;
  all)
    start_database
    if [[ "$LAUNCH" == "1" ]]; then
      launch_all
    else
      show_all_instructions
    fi
    ;;
  *)
    echo "Invalid target: $TARGET" >&2
    usage
    exit 1
    ;;
esac
