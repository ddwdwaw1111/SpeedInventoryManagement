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
REMOTE_ARCHIVE_NAME=""

ssh_args=()

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
echo "==> Pulling database image"
docker pull --platform "$PLATFORM" "$MARIADB_IMAGE"

echo
echo "==> Saving images to archive"
docker save \
  "$BACKEND_IMAGE" \
  "$FRONTEND_IMAGE" \
  "$MARIADB_IMAGE" \
  -o "$ARCHIVE_PATH"

cat > "$OUTPUT_DIR/README-$(basename "${ARCHIVE_NAME%.tar}").txt" <<EOF
Archive created: $ARCHIVE_PATH

Images included:
  - $BACKEND_IMAGE
  - $FRONTEND_IMAGE
  - $MARIADB_IMAGE

Server steps:
  scp "$(basename "$ARCHIVE_PATH")" ubuntu@<server-ip>:~/
  ssh ubuntu@<server-ip>
  docker load -i ~/"$(basename "$ARCHIVE_PATH")"

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
  echo "    - docker-compose.prod.yml"
  echo "    - docker-compose.https.yml"
  echo "    - database/schema.sql"
  echo "    - database/seed.sql"
  echo "    - deploy/nginx/start-proxy.sh"
  echo "    - deploy/nginx/templates/*"
  echo "    - $(basename "$ENV_FILE_PATH") as .env.prod"
  echo "    - stack mode: ${DEPLOY_STACK}"
  echo
  read -r -p "Type 'yes' to continue deploy: " confirmation
  if [[ "$confirmation" != "yes" ]]; then
    echo "Deploy cancelled."
    exit 0
  fi

  echo
  echo "==> Creating remote directories"
  ssh "${ssh_args[@]}" "${SERVER_USER}@${SERVER_HOST}" "mkdir -p ${SERVER_PATH}/database ${SERVER_PATH}/deploy/nginx/templates ${SERVER_PATH}/deploy/nginx"

  echo
  echo "==> Uploading archive and deployment files"
  scp "${ssh_args[@]}" "$ARCHIVE_PATH" "${SERVER_USER}@${SERVER_HOST}:${SERVER_PATH}/"
  scp "${ssh_args[@]}" "$ROOT_DIR/docker-compose.prod.yml" "${SERVER_USER}@${SERVER_HOST}:${SERVER_PATH}/"
  scp "${ssh_args[@]}" "$ROOT_DIR/docker-compose.https.yml" "${SERVER_USER}@${SERVER_HOST}:${SERVER_PATH}/"
  scp "${ssh_args[@]}" "$ROOT_DIR/database/schema.sql" "${SERVER_USER}@${SERVER_HOST}:${SERVER_PATH}/database/"
  scp "${ssh_args[@]}" "$ROOT_DIR/database/seed.sql" "${SERVER_USER}@${SERVER_HOST}:${SERVER_PATH}/database/"
  scp "${ssh_args[@]}" "$ROOT_DIR/deploy/nginx/start-proxy.sh" "${SERVER_USER}@${SERVER_HOST}:${SERVER_PATH}/deploy/nginx/"
  scp "${ssh_args[@]}" "$ROOT_DIR/deploy/nginx/templates/http.conf.template" "${SERVER_USER}@${SERVER_HOST}:${SERVER_PATH}/deploy/nginx/templates/"
  scp "${ssh_args[@]}" "$ROOT_DIR/deploy/nginx/templates/https.conf.template" "${SERVER_USER}@${SERVER_HOST}:${SERVER_PATH}/deploy/nginx/templates/"
  scp "${ssh_args[@]}" "$ENV_FILE_PATH" "${SERVER_USER}@${SERVER_HOST}:${SERVER_PATH}/.env.prod"

  REMOTE_ARCHIVE_NAME="$(basename "$ARCHIVE_PATH")"

  echo
  echo "==> Loading images and starting services on remote server"
  ssh "${ssh_args[@]}" "${SERVER_USER}@${SERVER_HOST}" "cd ${SERVER_PATH} && REMOTE_ARCHIVE_NAME='${REMOTE_ARCHIVE_NAME}' DEPLOY_STACK='${DEPLOY_STACK}' bash -s" <<'EOF'
set -euo pipefail

docker load -i "./$REMOTE_ARCHIVE_NAME"

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
  docker compose --env-file .env.prod -f docker-compose.prod.yml down || true
  docker compose --env-file .env.prod -f docker-compose.https.yml up -d
  echo "==> Check status with: docker compose --env-file .env.prod -f docker-compose.https.yml ps"
else
  echo "==> Remote stack: http"
  docker compose --env-file .env.prod -f docker-compose.https.yml down || true
  docker compose --env-file .env.prod -f docker-compose.prod.yml up -d
  echo "==> Check status with: docker compose --env-file .env.prod -f docker-compose.prod.yml ps"
fi
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
