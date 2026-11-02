#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

if [ "$#" -ne 1 ] && [ "$#" -ne 3 ]; then
  echo "Usage: $0 IMAGE:TAG [COMPOSE_FILE SOURCE_IMAGE]" >&2
  exit 2
fi

IMAGE_REF="$1"
COMPOSE_TEMPLATE="${2:-}"
SOURCE_IMAGE="${3:-}"

if [ -n "$COMPOSE_TEMPLATE" ] && [ ! -f "$COMPOSE_TEMPLATE" ]; then
  echo "ERROR: Compose template not found" >&2
  exit 2
fi

if [ -n "$COMPOSE_TEMPLATE" ]; then
  COMPOSE_TEMPLATE="$(realpath -- "$COMPOSE_TEMPLATE")"
fi

if [ -n "$COMPOSE_TEMPLATE" ] && [ -z "$SOURCE_IMAGE" ]; then
  echo "ERROR: Source image reference is required" >&2
  exit 2
fi

if [[ "$IMAGE_REF" != *:* ]] || [[ "$IMAGE_REF" == *@* ]]; then
  echo "ERROR: Expected a tagged Docker image reference" >&2
  exit 2
fi

IMAGE="${IMAGE_REF%:*}"
TAG="${IMAGE_REF##*:}"

if [ -z "$IMAGE" ] || [ -z "$TAG" ]; then
  echo "ERROR: Invalid Docker image reference" >&2
  exit 2
fi

BASE_DIR="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
TEST_DIR="$(mktemp -d "${BASE_DIR%/}/ghostfolio-ng-smoke-XXXXXXXX")"
PROJECT="ghostfolio-ng-smoke-$(basename "$TEST_DIR" | tr '[:upper:]' '[:lower:]')"

compose=(
  docker compose
  -p "$PROJECT"
  -f "$TEST_DIR/docker-compose.yml"
  -f "$TEST_DIR/override.yml"
)

cleanup() {
  local status=$?

  trap - EXIT

  if [ -f "$TEST_DIR/docker-compose.yml" ] &&
     [ -f "$TEST_DIR/override.yml" ]; then

    if [ "$status" -ne 0 ]; then
      echo "=== Smoke test diagnostics ==="
      "${compose[@]}" ps || true
      "${compose[@]}" logs --tail 100 || true
    fi

    "${compose[@]}" down --volumes --remove-orphans || {
      echo "WARNING: Docker Compose cleanup failed" >&2
      if [ "$status" -eq 0 ]; then
        status=1
      fi
    }
  fi

  # Never retain generated credentials, including after failures.
  if ! rm -f -- "$TEST_DIR/.env"; then
    echo "WARNING: Failed to remove temporary credentials" >&2
    if [ "$status" -eq 0 ]; then
      status=1
    fi
  fi

  if [ "$status" -eq 0 ]; then
    if rm -rf -- "$TEST_DIR"; then
      echo "Ghostfolio-NG smoke test: PASS"
    else
      status=1
      echo "WARNING: Failed to remove temporary directory" >&2
    fi
  fi

  if [ "$status" -ne 0 ]; then
    echo "Smoke test failed; temporary directory: $TEST_DIR" >&2
  fi

  exit "$status"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "=== Prepare Ghostfolio-NG smoke test ==="

cd "$REPO_ROOT"

SMOKE_DIR="$TEST_DIR" \
SMOKE_IMAGE="$IMAGE" \
SMOKE_TAG="$TAG" \
SMOKE_COMPOSE_TEMPLATE="$COMPOSE_TEMPLATE" \
SMOKE_SOURCE_IMAGE="$SOURCE_IMAGE" \
node --input-type=module <<'JS'
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  generateReleaseCompose,
  retagReleaseCompose
} from './scripts/integration-release.mjs';

const directory = process.env.SMOKE_DIR;
const templatePath = process.env.SMOKE_COMPOSE_TEMPLATE;

const compose = templatePath
  ? retagReleaseCompose(
      readFileSync(templatePath, 'utf8'),
      process.env.SMOKE_SOURCE_IMAGE,
      `${process.env.SMOKE_IMAGE}:${process.env.SMOKE_TAG}`
    )
  : generateReleaseCompose(
      readFileSync('docker/docker-compose.yml', 'utf8'),
      process.env.SMOKE_IMAGE,
      process.env.SMOKE_TAG
    );

writeFileSync(join(directory, 'docker-compose.yml'), compose);

const environment = readFileSync('.env.example', 'utf8')
  .replace(/<INSERT_[A-Z_]+>/g, () => randomBytes(32).toString('hex'));

writeFileSync(join(directory, '.env'), environment, { mode: 0o600 });
JS

cat > "$TEST_DIR/override.yml" <<'YAML'
services:
  ghostfolio:
    container_name: !reset null
    ports: !reset []
  postgres:
    container_name: !reset null
  redis:
    container_name: !reset null
YAML

echo "=== Validate isolated Compose ==="

"${compose[@]}" config --quiet

"${compose[@]}" config --format json |
  jq -e --arg image "$IMAGE_REF" '
    (.services.ghostfolio | has("container_name") | not) and
    (.services.postgres | has("container_name") | not) and
    (.services.redis | has("container_name") | not) and
    ((.services.ghostfolio.ports // []) | length == 0) and
    (.services.ghostfolio.image == $image)
  ' >/dev/null

echo "=== Pull PostgreSQL and Redis ==="

"${compose[@]}" pull postgres redis

if [ -n "$COMPOSE_TEMPLATE" ]; then
  echo "=== Pull temporary multiarch Ghostfolio image ==="
  "${compose[@]}" pull ghostfolio
fi

echo "=== Start Ghostfolio-NG ==="

"${compose[@]}" up -d --pull never --wait --wait-timeout 240

echo "=== Check API health ==="

"${compose[@]}" exec -T ghostfolio \
  curl --fail --silent --show-error \
  http://127.0.0.1:3333/api/v1/health
