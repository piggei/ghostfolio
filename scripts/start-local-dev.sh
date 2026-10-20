#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

cd "${REPO_ROOT}"

echo "=== Ghostfolio local development launcher ==="
echo "Repository: ${REPO_ROOT}"
echo

# ---------------------------------------------------------------------------
# Node / NVM
# ---------------------------------------------------------------------------

export NVM_DIR="${NVM_DIR:-${HOME}/.nvm}"

if [ ! -s "${NVM_DIR}/nvm.sh" ]; then
  echo "ERROR: NVM not found at ${NVM_DIR}/nvm.sh"
  exit 1
fi

# shellcheck source=/dev/null
source "${NVM_DIR}/nvm.sh"

if [ ! -f .nvmrc ]; then
  echo "ERROR: .nvmrc not found"
  exit 1
fi

echo "=== Node environment ==="
nvm use

echo "Node: $(node -v)"
echo "npm:  $(npm -v)"
echo

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------

if [ ! -f .env ]; then
  echo "ERROR: .env not found in ${REPO_ROOT}"
  echo "Create the local Ghostfolio environment before starting."
  exit 1
fi

echo "=== Environment ==="
echo ".env present"
echo

# ---------------------------------------------------------------------------
# Docker
# ---------------------------------------------------------------------------

echo "=== Docker ==="

if ! docker version >/dev/null 2>&1; then
  if getent group docker >/dev/null 2>&1 \
    && id -nG "${USER}" 2>/dev/null | tr ' ' '\n' | grep -qx docker \
    && ! id -nG | tr ' ' '\n' | grep -qx docker; then
    echo "ERROR: user ${USER} belongs to the docker group, but this shell does not."
    echo "Open a new terminal and run the launcher again."
  else
    echo "ERROR: Docker daemon is not reachable by user ${USER}."
    echo "Check Docker service status and user permissions."
  fi

  exit 1
fi

echo "Docker daemon reachable"
echo

COMPOSE_FILE="docker/docker-compose.dev.yml"

echo "=== Starting PostgreSQL and Redis ==="
docker compose -f "${COMPOSE_FILE}" up -d

echo
echo "=== Waiting for infrastructure ==="

wait_for_container()
{
  local container="$1"
  local timeout=60
  local elapsed=0
  local status=""

  while [ "${elapsed}" -lt "${timeout}" ]; do
    status="$(
      docker inspect \
        --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
        "${container}" 2>/dev/null || true
    )"

    if [ "${status}" = "healthy" ] || [ "${status}" = "running" ]; then
      printf '%-20s %s\n' "${container}" "${status}"
      return 0
    fi

    if [ "${status}" = "unhealthy" ] || [ "${status}" = "exited" ]; then
      echo "ERROR: ${container} status is ${status}"
      return 1
    fi

    sleep 1
    elapsed=$((elapsed + 1))
  done

  echo "ERROR: timeout waiting for ${container} (last status: ${status:-unknown})"
  return 1
}

wait_for_container "gf-postgres-dev"
wait_for_container "gf-redis-dev"

echo
docker compose -f "${COMPOSE_FILE}" ps

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

echo
echo "=== Applying database migrations ==="
npm run database:migrate

# ---------------------------------------------------------------------------
# Runtime ports
# ---------------------------------------------------------------------------

echo
echo "=== Runtime ports ==="

if ss -ltnH | awk '$4 ~ /:3333$/ { found=1 } END { exit(found ? 0 : 1) }'; then
  echo "ERROR: TCP port 3333 is already in use."
  echo
  echo "Docker containers publishing port 3333:"
  docker ps \
    --filter publish=3333 \
    --format '  {{.Names}}  {{.Image}}  {{.Ports}}'

  echo
  echo "Socket information:"
  ss -ltnp | awk 'NR == 1 || $4 ~ /:3333$/'

  echo
  echo "Stop the existing service before starting Ghostfolio."
  exit 1
fi

echo "Port 3333 available"

# ---------------------------------------------------------------------------
# API + Client
# ---------------------------------------------------------------------------

API_PID=""
CLIENT_PID=""

cleanup()
{
  trap - EXIT INT TERM

  echo
  echo "=== Stopping Ghostfolio development processes ==="

  if [ -n "${API_PID}" ]; then
    kill "${API_PID}" 2>/dev/null || true
  fi

  if [ -n "${CLIENT_PID}" ]; then
    kill "${CLIENT_PID}" 2>/dev/null || true
  fi

  wait "${API_PID}" 2>/dev/null || true
  wait "${CLIENT_PID}" 2>/dev/null || true

  echo "API and client stopped."
  echo "PostgreSQL and Redis have been left running."
}

trap cleanup EXIT INT TERM

echo
echo "=== Starting Ghostfolio API ==="
npm run start:server &
API_PID=$!

echo "API PID: ${API_PID}"

echo
echo "=== Starting Ghostfolio client ==="
npm run start:client &
CLIENT_PID=$!

echo "Client PID: ${CLIENT_PID}"

echo
echo "=== Ghostfolio development environment running ==="
echo "Press Ctrl+C to stop API and client."
echo

wait -n "${API_PID}" "${CLIENT_PID}"
