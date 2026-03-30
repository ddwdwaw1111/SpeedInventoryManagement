#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

PLATFORM="${PLATFORM:-linux/amd64}"
TAG_PREFIX="${TAG_PREFIX:-sim}"
MARIADB_IMAGE="${MARIADB_IMAGE:-mariadb:11}"
OUTPUT_DIR="${OUTPUT_DIR:-$ROOT_DIR/dist/deploy}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
ARCH_SUFFIX="${PLATFORM//\//-}"
ARCHIVE_NAME="${ARCHIVE_NAME:-${TAG_PREFIX}-images-${ARCH_SUFFIX}-${TIMESTAMP}.tar}"
ARCHIVE_PATH="$OUTPUT_DIR/$ARCHIVE_NAME"
BACKEND_IMAGE="${BACKEND_IMAGE:-${TAG_PREFIX}-backend:prod}"
FRONTEND_IMAGE="${FRONTEND_IMAGE:-${TAG_PREFIX}-frontend:prod}"
LOAD_FLAG="${LOAD_FLAG:---load}"
DEPLOY_AFTER_BUILD="${DEPLOY_AFTER_BUILD:-true}"
SERVER_USER="${SERVER_USER:-ubuntu}"
SERVER_HOST="${SERVER_HOST:-129.213.52.3}"
SERVER_PATH="${SERVER_PATH:-~/SpeedInventoryManagement}"
SSH_KEY_PATH="${SSH_KEY_PATH:-$HOME/.ssh/oracle-prod.key}"
ENV_FILE_PATH="${ENV_FILE_PATH:-$ROOT_DIR/.env.prod}"
DEPLOY_STACK="${DEPLOY_STACK:-https}"
ARCHIVE_RETENTION="${ARCHIVE_RETENTION:-4}"
REMOTE_ARCHIVE_NAME=""

ssh_args=()

sha256_file() {
  sha256sum "$1" | awk '{print $1}'
}

upload_if_changed() {
  local source_path="$1"
  local remote_relative_path="$2"
  local local_hash remote_hash remote_dir

  local_hash="$(sha256_file "$source_path")"
  remote_hash="$(ssh "${ssh_args[@]}" "${SERVER_USER}@${SERVER_HOST}" "cd ${SERVER_PATH} && if [ -f '${remote_relative_path}' ]; then sha256sum '${remote_relative_path}' | awk '{print \$1}'; fi" 2>/dev/null || true)"

  if [[ -n "$remote_hash" && "$local_hash" == "$remote_hash" ]]; then
    echo "==> Skipping unchanged $(basename "$source_path")"
    return
  fi

  remote_dir="$(dirname "$remote_relative_path")"
  ssh "${ssh_args[@]}" "${SERVER_USER}@${SERVER_HOST}" "mkdir -p ${SERVER_PATH}/${remote_dir}"
  scp "${ssh_args[@]}" "$source_path" "${SERVER_USER}@${SERVER_HOST}:${SERVER_PATH}/${remote_relative_path}"
}

usage() {
  cat <<EOF
Usage: bash deploy_prod.sh [options]

Builds production Docker images locally and exports them into a single tar archive
that can be copied to the server and loaded with 'docker load'. It can also
upload and deploy to a server if you pass --deploy.

Options:
  --platform <platform>      Target platform. Default: ${PLATFORM}
  --tag-prefix <prefix>      Image name prefix. Default: ${TAG_PREFIX}
  --output-dir <dir>         Output directory for tar archive. Default: ${OUTPUT_DIR}
  --archive-name <name>      Override archive filename.
  --backend-image <name>     Backend image tag. Default: ${BACKEND_IMAGE}
  --frontend-image <name>    Frontend image tag. Default: ${FRONTEND_IMAGE}
  --mariadb-image <name>     MariaDB base image. Default: ${MARIADB_IMAGE}
  --deploy                   Upload archive and deploy to the server after build.
  --server-host <host>       Target server IP or hostname.
  --server-user <user>       SSH user. Default: ${SERVER_USER}
  --server-path <path>       Remote app path. Default: ${SERVER_PATH}
  --ssh-key <path>           SSH private key path for scp/ssh.
  --env-file <path>          Local env file to upload. Default: ${ENV_FILE_PATH}
  --stack <auto|http|https>  Deploy stack selection. Default: ${DEPLOY_STACK}
  --keep-archives <count>    Remote tar archives to keep. Default: ${ARCHIVE_RETENTION}
  --push                     Use buildx --push instead of --load. Not recommended for this workflow.
  -h, --help                 Show this help.

Examples:
  bash deploy_prod.sh
  bash deploy_prod.sh --platform linux/amd64
  bash deploy_prod.sh --platform linux/arm64 --tag-prefix sim
  bash deploy_prod.sh --deploy --stack https --server-host 129.213.52.3 --ssh-key ~/oracle.key
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform)
      PLATFORM="$2"
      shift 2
      ;;
    --tag-prefix)
      TAG_PREFIX="$2"
      BACKEND_IMAGE="${TAG_PREFIX}-backend:prod"
      FRONTEND_IMAGE="${TAG_PREFIX}-frontend:prod"
      shift 2
      ;;
    --output-dir)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --archive-name)
      ARCHIVE_NAME="$2"
      shift 2
      ;;
    --backend-image)
      BACKEND_IMAGE="$2"
      shift 2
      ;;
    --frontend-image)
      FRONTEND_IMAGE="$2"
      shift 2
      ;;
    --mariadb-image)
      MARIADB_IMAGE="$2"
      shift 2
      ;;
    --deploy)
      DEPLOY_AFTER_BUILD="true"
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
    --stack)
      DEPLOY_STACK="$2"
      shift 2
      ;;
    --keep-archives)
      ARCHIVE_RETENTION="$2"
      shift 2
      ;;
    --push)
      LOAD_FLAG="--push"
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

case "$DEPLOY_STACK" in
  auto|http|https)
    ;;
  *)
    echo "Invalid --stack value: $DEPLOY_STACK" >&2
    usage
    exit 1
    ;;
esac

if ! [[ "$ARCHIVE_RETENTION" =~ ^[0-9]+$ ]] || (( ARCHIVE_RETENTION < 1 )); then
  echo "Invalid --keep-archives value: ${ARCHIVE_RETENTION}" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
ARCHIVE_PATH="$OUTPUT_DIR/$ARCHIVE_NAME"

echo "==> Target platform: $PLATFORM"
echo "==> Backend image:   $BACKEND_IMAGE"
echo "==> Frontend image:  $FRONTEND_IMAGE"
echo "==> Archive output:  $ARCHIVE_PATH"
if [[ "$DEPLOY_AFTER_BUILD" == "true" ]]; then
  echo "==> Deploy target:   ${SERVER_USER}@${SERVER_HOST}:${SERVER_PATH}"
  echo "==> SSH key:         ${SSH_KEY_PATH}"
  echo "==> Deploy stack:    ${DEPLOY_STACK}"
  echo "==> Keep archives:   ${ARCHIVE_RETENTION}"
fi
echo

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required but was not found in PATH." >&2
  exit 1
fi

if ! docker buildx version >/dev/null 2>&1; then
  echo "Docker buildx is required but not available." >&2
  exit 1
fi

if [[ -n "$SSH_KEY_PATH" ]]; then
  ssh_args=(-i "$SSH_KEY_PATH")
fi

echo "==> Building backend image"
docker buildx build \
  --platform "$PLATFORM" \
  -t "$BACKEND_IMAGE" \
  ./backend \
  "$LOAD_FLAG"

echo
echo "==> Building frontend image"
docker buildx build \
  --platform "$PLATFORM" \
  -t "$FRONTEND_IMAGE" \
  -f ./frontend/Dockerfile.prod \
  ./frontend \
  "$LOAD_FLAG"

if [[ "$LOAD_FLAG" == "--push" ]]; then
  echo
  echo "Images were pushed remotely. No local tar archive was created."
  exit 0
fi

echo
echo "==> Saving images to archive"
docker save \
  "$BACKEND_IMAGE" \
  "$FRONTEND_IMAGE" \
  -o "$ARCHIVE_PATH"

cat > "$OUTPUT_DIR/README-$(basename "${ARCHIVE_NAME%.tar}").txt" <<EOF
Archive created: $ARCHIVE_PATH

Images included:
  - $BACKEND_IMAGE
  - $FRONTEND_IMAGE

Server steps:
  scp "$(basename "$ARCHIVE_PATH")" ubuntu@<server-ip>:~/SpeedInventoryManagement/archives/
  ssh ubuntu@<server-ip>
  cd ~/SpeedInventoryManagement
  docker load -i ./archives/"$(basename "$ARCHIVE_PATH")"

Deploy stack selection:
  auto  -> uses docker-compose.https.yml when .env.prod contains SITE_DOMAIN
           or SESSION_COOKIE_SECURE=true, otherwise docker-compose.prod.yml
  http  -> always uses docker-compose.prod.yml
  https -> always uses docker-compose.https.yml (default)
EOF

if [[ "$DEPLOY_AFTER_BUILD" == "true" ]]; then
  if [[ -z "$SERVER_HOST" ]]; then
    echo "--deploy requires --server-host." >&2
    exit 1
  fi

  if [[ ! -f "$ENV_FILE_PATH" ]]; then
    echo "Env file not found: $ENV_FILE_PATH" >&2
    exit 1
  fi

  if ! command -v ssh >/dev/null 2>&1; then
    echo "ssh is required for --deploy but was not found in PATH." >&2
    exit 1
  fi

  if ! command -v scp >/dev/null 2>&1; then
    echo "scp is required for --deploy but was not found in PATH." >&2
    exit 1
  fi

  echo
  echo "==> Ready to deploy"
  echo "This will upload:"
  echo "    - $(basename "$ARCHIVE_PATH")"
  echo "    - deployment files only when changed"
  echo "    - stack mode: ${DEPLOY_STACK}"
  echo
  read -r -p "Type 'yes' to continue deploy: " confirmation
  if [[ "$confirmation" != "yes" ]]; then
    echo "Deploy cancelled."
    exit 0
  fi

  echo
  echo "==> Creating remote directories"
  ssh "${ssh_args[@]}" "${SERVER_USER}@${SERVER_HOST}" "mkdir -p ${SERVER_PATH}/database ${SERVER_PATH}/deploy/nginx/templates ${SERVER_PATH}/deploy/nginx ${SERVER_PATH}/archives"

  echo
  echo "==> Uploading archive and deployment files"
  scp "${ssh_args[@]}" "$ARCHIVE_PATH" "${SERVER_USER}@${SERVER_HOST}:${SERVER_PATH}/archives/"
  upload_if_changed "$ROOT_DIR/docker-compose.prod.yml" "docker-compose.prod.yml"
  upload_if_changed "$ROOT_DIR/docker-compose.https.yml" "docker-compose.https.yml"
  upload_if_changed "$ROOT_DIR/database/schema.sql" "database/schema.sql"
  upload_if_changed "$ROOT_DIR/database/seed.sql" "database/seed.sql"
  upload_if_changed "$ROOT_DIR/deploy/nginx/start-proxy.sh" "deploy/nginx/start-proxy.sh"
  upload_if_changed "$ROOT_DIR/deploy/nginx/templates/http.conf.template" "deploy/nginx/templates/http.conf.template"
  upload_if_changed "$ROOT_DIR/deploy/nginx/templates/https.conf.template" "deploy/nginx/templates/https.conf.template"
  upload_if_changed "$ENV_FILE_PATH" ".env.prod"

  REMOTE_ARCHIVE_NAME="$(basename "$ARCHIVE_PATH")"

  echo
  echo "==> Loading images and starting services on remote server"
  ssh "${ssh_args[@]}" "${SERVER_USER}@${SERVER_HOST}" "cd ${SERVER_PATH} && REMOTE_ARCHIVE_NAME='${REMOTE_ARCHIVE_NAME}' DEPLOY_STACK='${DEPLOY_STACK}' ARCHIVE_RETENTION='${ARCHIVE_RETENTION}' MARIADB_IMAGE='${MARIADB_IMAGE}' bash -s" <<'EOF'
set -euo pipefail

mkdir -p ./archives

if [[ -f "./$REMOTE_ARCHIVE_NAME" ]]; then
  mv -f "./$REMOTE_ARCHIVE_NAME" "./archives/$REMOTE_ARCHIVE_NAME"
fi

docker load -i "./archives/$REMOTE_ARCHIVE_NAME"

if ! docker image inspect "$MARIADB_IMAGE" >/dev/null 2>&1; then
  echo "==> Pulling database image $MARIADB_IMAGE on remote host"
  docker pull "$MARIADB_IMAGE"
fi

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

run_smoke_test() {
  local selected_stack="$1"

  echo "==> Running smoke tests"
  docker exec speed-inventory-api wget -q -O /dev/null http://127.0.0.1:8080/api/health
  docker exec speed-inventory-web wget -q -O /dev/null http://127.0.0.1/

  if [[ "$selected_stack" == "https" ]]; then
    docker exec speed-inventory-proxy wget --no-check-certificate -q -O /dev/null https://localhost/api/health
    docker exec speed-inventory-proxy wget --no-check-certificate -q -O /dev/null https://localhost/
  else
    docker exec speed-inventory-web wget -q -O /dev/null http://127.0.0.1/api/health
    docker exec speed-inventory-web wget -q -O /dev/null http://127.0.0.1/
  fi
}

selected_stack="$DEPLOY_STACK"
if [[ "$selected_stack" == "auto" ]]; then
  if grep -Eq '^SITE_DOMAIN=[^[:space:]]+' .env.prod || grep -Eq '^SESSION_COOKIE_SECURE=true$' .env.prod; then
    selected_stack="https"
  else
    selected_stack="http"
  fi
fi

if [[ "$selected_stack" == "https" ]]; then
  echo "==> Remote stack: https"
  docker compose --env-file .env.prod -f docker-compose.https.yml up -d --remove-orphans backend frontend reverse-proxy
  wait_for_container speed-inventory-api healthy 240
  wait_for_container speed-inventory-web healthy 180
  docker compose --env-file .env.prod -f docker-compose.https.yml restart reverse-proxy
  wait_for_container speed-inventory-proxy running 120
  run_smoke_test "https"
  echo "==> Check status with: docker compose --env-file .env.prod -f docker-compose.https.yml ps"
else
  echo "==> Remote stack: http"
  docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --remove-orphans backend frontend
  wait_for_container speed-inventory-api healthy 240
  wait_for_container speed-inventory-web healthy 180
  run_smoke_test "http"
  echo "==> Check status with: docker compose --env-file .env.prod -f docker-compose.prod.yml ps"
fi

find . -maxdepth 1 -type f -name '*-images-*.tar' -exec mv -f {} ./archives/ \;

mapfile -t archive_files < <(find ./archives -maxdepth 1 -type f -name '*.tar' -printf '%T@ %p\n' | sort -nr | awk '{print $2}')
if (( ${#archive_files[@]} > ARCHIVE_RETENTION )); then
  echo "==> Pruning old archives (keeping latest ${ARCHIVE_RETENTION})"
  printf '%s\n' "${archive_files[@]:ARCHIVE_RETENTION}" | while IFS= read -r archive_path; do
    [[ -n "$archive_path" ]] || continue
    rm -f -- "$archive_path"
  done
fi

docker image prune -f >/dev/null 2>&1 || true
EOF

  echo
  echo "==> Remote deployment finished"
  echo "Check status with:"
  echo "ssh ${SERVER_USER}@${SERVER_HOST}"
  echo "cd ${SERVER_PATH} && docker compose --env-file .env.prod -f docker-compose.<prod-or-https>.yml ps"
fi

echo
echo "==> Done"
echo "Archive: $ARCHIVE_PATH"
echo "Helper notes: $OUTPUT_DIR/README-$(basename "${ARCHIVE_NAME%.tar}").txt"
