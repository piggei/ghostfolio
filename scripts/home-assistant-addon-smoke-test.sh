#!/usr/bin/env bash
set -euo pipefail
CI_IMAGE="${1:?Usage: smoke-test IMAGE OCI_ARCH}"
CI_ARCH="${2:?Expected amd64 or arm64}"
case "$CI_ARCH" in
  amd64) test "$(uname -m)" = x86_64 ;;
  arm64) test "$(uname -m)" = aarch64 ;;
  *) exit 2 ;;
esac
suffix="ha-ci-${CI_ARCH}-$$"
CI_NETWORK="$suffix-net"
CI_PG_VOLUME="$suffix-postgres"
CI_DATA_VOLUME="$suffix-data"
CI_POSTGRES="$suffix-pg"
CI_MOCK="$suffix-supervisor"
CI_APP="$suffix-app"
CI_MOCK_IMAGE="$suffix-mock:ci"
cleanup() {
  status=$?
  trap - EXIT
  if [ "$status" -ne 0 ]; then
    docker inspect "$CI_APP" --format 'App state={{.State.Status}} exit={{.State.ExitCode}}' 2>/dev/null || true
    docker logs "$CI_MOCK" 2>/dev/null || true
  fi
  docker rm -f "$CI_APP" "$CI_POSTGRES" "$CI_MOCK" 2>/dev/null || true
  docker network rm "$CI_NETWORK" 2>/dev/null || true
  docker volume rm "$CI_DATA_VOLUME" "$CI_PG_VOLUME" 2>/dev/null || true
  docker image rm "$CI_MOCK_IMAGE" 2>/dev/null || true
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Build Supervisor mock
set -euo pipefail
docker build \
  -t "$CI_MOCK_IMAGE" \
  tests/home-assistant-addon/supervisor-mock

# Verify image architecture and Nginx configuration
set -euo pipefail

arch=$(docker image inspect "$CI_IMAGE" --format '{{.Architecture}}')
test "$arch" = "$CI_ARCH"

docker run --rm --network none --user node \
  --entrypoint /usr/sbin/nginx "$CI_IMAGE" -t

# Prepare isolated credentials and network
set -euo pipefail

docker network create --internal "$CI_NETWORK"
docker volume create "$CI_PG_VOLUME"
docker volume create "$CI_DATA_VOLUME"

token=$(openssl rand -hex 32)
password="$(openssl rand -hex 16):Pass@2026/#?&"

if [ "${GITHUB_ACTIONS:-false}" = true ]; then
  echo "::add-mask::$token"
  echo "::add-mask::$password"
fi

MOCK_TOKEN="$token"
POSTGRES_PASSWORD="$password"

# Start isolated PostgreSQL
set -euo pipefail

docker run -d \
  --name "$CI_POSTGRES" \
  --network "$CI_NETWORK" \
  --mount "type=volume,source=$CI_PG_VOLUME,target=/var/lib/postgresql/data" \
  -e POSTGRES_DB=ghostfolio_test \
  -e POSTGRES_USER=ghostfolio_test \
  -e "POSTGRES_PASSWORD=$POSTGRES_PASSWORD" \
  --health-cmd='pg_isready -U ghostfolio_test -d ghostfolio_test' \
  --health-interval=3s \
  --health-retries=30 \
  postgres:15-alpine

# Start authenticated Supervisor mock
set -euo pipefail

docker run -d \
  --name "$CI_MOCK" \
  --network "$CI_NETWORK" \
  --network-alias supervisor \
  -e "MOCK_TOKEN=$MOCK_TOKEN" \
  -e "MOCK_DATABASE_HOST=$CI_POSTGRES" \
  -e MOCK_DATABASE_PORT=5432 \
  -e MOCK_DATABASE_NAME=ghostfolio_test \
  -e MOCK_DATABASE_USER=ghostfolio_test \
  -e "MOCK_DATABASE_PASS=$POSTGRES_PASSWORD" \
  --health-cmd='python -c "import urllib.request; urllib.request.urlopen(\"http://127.0.0.1/health\", timeout=2)"' \
  --health-interval=3s \
  --health-retries=20 \
  "$CI_MOCK_IMAGE"

# Wait for PostgreSQL and Supervisor mock
set -euo pipefail

for container in "$CI_POSTGRES" "$CI_MOCK"; do
  ready=false

  for _attempt in $(seq 1 40); do
    health=$(docker inspect "$container" \
      --format '{{.State.Health.Status}}')

    if [ "$health" = 'healthy' ]; then
      ready=true
      break
    fi

    running=$(docker inspect "$container" \
      --format '{{.State.Running}}')

    if [ "$running" != 'true' ]; then
      break
    fi

    sleep 3
  done

  if [ "$ready" != 'true' ]; then
    echo "::error::Container did not become healthy: $container"
    docker inspect "$container" \
      --format 'Status={{.State.Status}} Exit={{.State.ExitCode}}'
    false
  fi
done

echo 'PostgreSQL and Supervisor mock are healthy'

# Verify Supervisor API authentication
set -euo pipefail

response=$(docker run --rm \
  --network "$CI_NETWORK" \
  -e "MOCK_TOKEN=$MOCK_TOKEN" \
  --entrypoint /bin/sh "$CI_IMAGE" \
  -c 'curl -fsS \
    -H "Authorization: Bearer $MOCK_TOKEN" \
    http://supervisor/addons/self/options/config' \
  2>/dev/null)

printf '%s' "$response" | jq -e '
  .result == "ok" and
  (.data | keys | sort) ==
  ["database_host","database_name","database_pass","database_port","database_user"]
' >/dev/null

echo 'Authenticated Supervisor API response verified'

status=$(docker run --rm \
  --network "$CI_NETWORK" \
  --entrypoint /bin/sh "$CI_IMAGE" \
  -c 'curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer invalid-token" \
    http://supervisor/addons/self/options/config')

test "$status" = '401'
echo 'Invalid Supervisor token correctly rejected'

# Start Ghostfolio
set -euo pipefail

docker run -d \
  --name "$CI_APP" \
  --network "$CI_NETWORK" \
  --mount "type=volume,source=$CI_DATA_VOLUME,target=/data" \
  -e "SUPERVISOR_TOKEN=$MOCK_TOKEN" \
  -e SUPERVISOR_API=http://supervisor \
  -e S6_CMD_WAIT_FOR_SERVICES=0 \
  "$CI_IMAGE"

ready=false

for _attempt in $(seq 1 90); do
  health=$(docker inspect "$CI_APP" \
    --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}')

  if [ "$health" = 'healthy' ]; then
    ready=true
    break
  fi

  running=$(docker inspect "$CI_APP" \
    --format '{{.State.Running}}')

  if [ "$running" != 'true' ]; then
    break
  fi

  sleep 3
done

if [ "$ready" != 'true' ]; then
  echo 'ERROR: Ghostfolio did not become healthy'
  false
fi

echo 'Ghostfolio container is healthy'

# Verify runtime user and Supervisor configuration
set -euo pipefail

docker exec "$CI_APP" sh -c \
  'test ! -e /data/options.json'

node_uid=$(docker exec "$CI_APP" id -u node)

app_uid=$(docker top "$CI_APP" -eo uid,pid,args |
  awk '$3 == "node" && $4 == "main" && !found {print $1; found=1}')

test -n "$app_uid"
test "$app_uid" = "$node_uid"

echo "Ghostfolio UID verified: $app_uid"
echo 'Supervisor configuration used without options.json'

requests=$(docker logs "$CI_MOCK" 2>&1 |
  grep -c 'Authenticated Supervisor options request' || true)

test "$requests" -ge 1
echo "Authenticated Supervisor requests: $requests"

# Verify Redis authentication and persistent secrets
set -euo pipefail

docker exec "$CI_APP" sh -c '
  file=/data/secrets/ghostfolio.env

  test -r "$file"

  mode=$(stat -c "%a" "$file")
  test "$mode" = "600"

  for name in REDIS_PASSWORD ACCESS_TOKEN_SALT JWT_SECRET_KEY; do
    value=$(sed -n "s/^${name}=//p" "$file")
    printf "%s" "$value" | grep -Eq "^[0-9a-f]{64}$"
  done

  password=$(sed -n "s/^REDIS_PASSWORD=//p" "$file")
  result=$(REDISCLI_AUTH="$password" redis-cli -h 127.0.0.1 ping)

  test "$result" = "PONG"
'

echo 'Persistent secrets and authenticated Redis verified'

# Verify PostgreSQL application connection
set -euo pipefail

docker exec "$CI_APP" \
  curl --fail --silent --show-error \
  http://127.0.0.1:3333/api/v1/health >/dev/null

sessions=0

for _attempt in $(seq 1 30); do
  sessions=$(docker run --rm \
    --network "$CI_NETWORK" \
    -e "PGPASSWORD=$POSTGRES_PASSWORD" \
    postgres:15-alpine \
    psql -h "$CI_POSTGRES" \
      -U ghostfolio_test \
      -d ghostfolio_test \
      -Atc "
        SELECT count(*)
        FROM pg_stat_activity
        WHERE datname = 'ghostfolio_test'
          AND usename = 'ghostfolio_test'
          AND application_name IS DISTINCT FROM 'psql'
          AND state IN ('idle', 'active');
      ")

  if [ "$sessions" -ge 1 ]; then
    break
  fi

  sleep 2
done

test "$sessions" -ge 1
echo "Ghostfolio PostgreSQL sessions: $sessions"

# Verify application, proxy and simulated Ingress
set -euo pipefail

INGRESS_PATH='/api/hassio_ingress/test-token'
INGRESS_HEADER="X-Ingress-Path: $INGRESS_PATH"

echo '=== Direct application health ==='

docker exec "$CI_APP" curl --fail --silent --show-error \
  http://127.0.0.1:3333/api/v1/health >/dev/null

echo '=== Nginx health ==='

docker exec "$CI_APP" curl --fail --silent --show-error \
  http://127.0.0.1:8099/api/v1/health >/dev/null

echo '=== Ingress redirect ==='

headers=$(docker exec "$CI_APP" \
  curl --silent --show-error -D - -o /dev/null \
  -H "$INGRESS_HEADER" \
  -H 'X-Forwarded-Proto: https' \
  -H 'Host: homeassistant.local:8123' \
  http://127.0.0.1:8099/)

location=$(printf '%s\n' "$headers" |
  tr -d '\r' |
  sed -n '/^[Ll]ocation:/s/^[Ll]ocation:[[:space:]]*//p')

test "$location" = "$INGRESS_PATH/en"

echo '=== Angular HTML ==='

html=$(docker exec "$CI_APP" curl --fail --silent --show-error \
  -H "$INGRESS_HEADER" \
  http://127.0.0.1:8099/it/)

grep -Fq "<base href=\"$INGRESS_PATH/it/\"" <<< "$html"

main_bundle=$(printf '%s\n' "$html" |
  grep -oE 'src="[^"]*main-[^"]+\.js"' |
  head -n 1 |
  cut -d '"' -f 2)

test -n "$main_bundle"

bundle=$(docker exec "$CI_APP" curl --fail --silent --show-error \
  -H "$INGRESS_HEADER" \
  "http://127.0.0.1:8099/it/$main_bundle")

grep -Fq "$INGRESS_PATH/api/v1/info" <<< "$bundle"

echo 'HTML and main bundle: PASS'

echo '=== Ingress image assets ==='

for asset in \
  images/button-buy-me-a-coffee.png \
  images/sponsors/logo-testmu-dark.svg \
  images/sponsors/logo-testmu-light.svg \
  images/ghostfolio-ng-team.webp
do
  headers=$(docker exec "$CI_APP" \
    curl --fail --silent --show-error \
    -D - -o /dev/null \
    -H "$INGRESS_HEADER" \
    "http://127.0.0.1:8099/assets/$asset")

  content_type=$(printf '%s\n' "$headers" |
    tr -d '\r' |
    sed -n '/^[Cc]ontent-[Tt]ype:/s/^[^:]*:[[:space:]]*//p')

  case "$asset" in
    *.png) expected_type='image/png' ;;
    *.svg) expected_type='image/svg+xml' ;;
    *.webp) expected_type='image/webp' ;;
  esac

  test "$content_type" = "$expected_type"

  echo "PASS: $asset ($content_type)"
done

echo 'Ingress image assets: PASS'


echo '=== Angular chunks ==='

chunk_count=0
api_chunk_count=0

while IFS= read -r asset; do
  [ -n "$asset" ] || continue

  chunk_count=$((chunk_count + 1))

  direct=$(docker exec "$CI_APP" curl --fail --silent --show-error \
    "http://127.0.0.1:3333/it/$asset")

  original=$( { grep -oF '/api/' <<< "$direct" || true; } | wc -l)

  if [ "$original" -eq 0 ]; then
    continue
  fi

  chunk=$(docker exec "$CI_APP" curl --fail --silent --show-error \
    -H "$INGRESS_HEADER" \
    "http://127.0.0.1:8099/it/$asset")

  rewritten=$( { grep -oF "$INGRESS_PATH/api/" <<< "$chunk" || true; } | wc -l)

  without_prefix=${chunk//"$INGRESS_PATH/api/"/}
  remaining=$(printf '%s\n' "$without_prefix" |
    grep -oF '/api/' | wc -l || true)

  if [ "$rewritten" -ne "$original" ]; then
    echo "::error::Incomplete API path rewriting in $asset"
    echo "Expected: $original; rewritten: $rewritten"
    exit 1
  fi

  if [ "$remaining" -ne 0 ]; then
    echo "::error::Unrewritten API references in $asset"
    exit 1
  fi

  api_chunk_count=$((api_chunk_count + 1))

  echo "PASS: $asset ($rewritten API references)"
done < <(
  grep -oE 'href="chunk-[^"]+\.js"' <<< "$html" |
    cut -d '"' -f 2
)

test "$chunk_count" -gt 0
test "$api_chunk_count" -gt 0

echo "Angular chunks inspected: $chunk_count"
echo "Angular chunks with API references: $api_chunk_count"

echo '=== Angular relative image references ==='

image_chunk_count=0
image_reference_count=0

while IFS= read -r asset; do
  [ -n "$asset" ] || continue

  direct=$(docker exec "$CI_APP" curl --fail --silent --show-error \
    "http://127.0.0.1:3333/it/$asset")

  relative=$( { grep -oF '../assets/images/' <<< "$direct" || true; } | wc -l)
  original=$( { grep -oF '/assets/images/' <<< "$direct" || true; } | wc -l)

  if [ "$relative" -eq 0 ]; then
    continue
  fi

  rewritten_chunk=$(docker exec "$CI_APP" curl --fail --silent --show-error \
    -H "$INGRESS_HEADER" \
    "http://127.0.0.1:8099/it/$asset")

  expected=$( { grep -oF "$INGRESS_PATH/assets/images/" <<< "$rewritten_chunk" || true; } | wc -l)

  if [ "$expected" -ne "$original" ]; then
    echo "::error::Incomplete relative image rewriting in $asset"
    echo "Expected: $original; rewritten: $expected"
    exit 1
  fi

  if grep -Fq '../assets/images/' <<< "$rewritten_chunk"; then
    echo "::error::Unrewritten relative image reference in $asset"
    exit 1
  fi

  if grep -Fq "../${INGRESS_PATH#/}/assets/images/" <<< "$rewritten_chunk"; then
    echo "::error::Duplicated Ingress prefix in $asset"
    exit 1
  fi

  image_chunk_count=$((image_chunk_count + 1))
  image_reference_count=$((image_reference_count + original))

  echo "PASS: $asset ($relative relative, $original total image references)"
done < <(
  docker exec "$CI_APP" sh -c '
    find /ghostfolio/apps/client/it \
      -maxdepth 1 \
      -type f \
      -name "chunk-*.js" \
      -exec grep -lF "../assets/images/" {} +
  ' | sed 's|.*/||'
)

test "$image_chunk_count" -gt 0
test "$image_reference_count" -gt 0

echo "Angular image chunks inspected: $image_chunk_count"
echo "Angular image references rewritten: $image_reference_count"
echo 'Angular relative image references: PASS'

echo '=== PWA manifest with Ingress ==='

manifest=$(docker exec "$CI_APP" curl --fail --silent --show-error \
  -H "$INGRESS_HEADER" \
  http://127.0.0.1:8099/api/assets/it/site.webmanifest)

printf '%s\n' "$manifest" | jq -e \
  --arg prefix "$INGRESS_PATH" '
    .start_url == ($prefix + "/it/") and
    (.icons | length == 3) and
    all(.icons[]; .src | startswith($prefix + "/assets/"))
  ' >/dev/null

echo 'Ingress PWA manifest: PASS'

echo '=== PWA icons ==='

for asset in \
  android-chrome-192x192.png \
  android-chrome-512x512.png
do
  docker exec "$CI_APP" curl --fail --silent --show-error \
    -H "$INGRESS_HEADER" \
    "http://127.0.0.1:8099/assets/$asset" \
    -o /dev/null
done

echo 'PWA icons: PASS'

echo '=== Manifest without Ingress ==='

direct_manifest=$(docker exec "$CI_APP" curl --fail --silent --show-error \
  http://127.0.0.1:8099/api/assets/it/site.webmanifest)

printf '%s\n' "$direct_manifest" | jq -e '
  .start_url == "/it/" and
  all(.icons[]; .src | startswith("/assets/"))
' >/dev/null

echo 'Original PWA manifest preserved: PASS'

echo '=== Financial API integrity ==='

docker exec "$CI_APP" curl --fail --silent --show-error \
  -H "$INGRESS_HEADER" \
  http://127.0.0.1:8099/api/v1/info |
  jq -e 'type == "object"' >/dev/null

docker exec "$CI_APP" curl --fail --silent --show-error \
  http://127.0.0.1:3333/api/v1/info |
  jq -e 'type == "object"' >/dev/null

echo 'Ingress and direct API JSON: PASS'
echo 'Application, proxy, Ingress and PWA tests passed'

# Persistence across restart and recreation of the tested artifact.
secrets_before=$(docker exec "$CI_APP" sha256sum /data/secrets/ghostfolio.env)
docker exec "$CI_APP" sh -c '
  REDISCLI_AUTH=$(sed -n "s/^REDIS_PASSWORD=//p" /data/secrets/ghostfolio.env)
  export REDISCLI_AUTH
  redis-cli SET ha_release_persistence preserved | grep -Fx OK
'
unauthenticated=$(docker exec "$CI_APP" redis-cli ping)
grep -Fq NOAUTH <<< "$unauthenticated"
docker exec "$CI_POSTGRES" psql -U ghostfolio_test -d ghostfolio_test -v ON_ERROR_STOP=1 \
  -c "CREATE TABLE ha_release_persistence (value text); INSERT INTO ha_release_persistence VALUES ('preserved');"
for lifecycle in restart recreate; do
  if [ "$lifecycle" = restart ]; then
    docker restart "$CI_APP" >/dev/null
  else
    docker stop "$CI_APP" >/dev/null
    docker rm "$CI_APP" >/dev/null
    docker run -d --name "$CI_APP" --network "$CI_NETWORK" \
      --mount "type=volume,source=$CI_DATA_VOLUME,target=/data" \
      -e "SUPERVISOR_TOKEN=$MOCK_TOKEN" -e SUPERVISOR_API=http://supervisor \
      -e S6_CMD_WAIT_FOR_SERVICES=0 "$CI_IMAGE" >/dev/null
  fi
  ready=false
  for _attempt in $(seq 1 90); do
    if [ "$(docker inspect "$CI_APP" --format '{{.State.Health.Status}}')" = healthy ]; then
      ready=true
      break
    fi
    sleep 3
  done
  test "$ready" = true
  test "$(docker exec "$CI_APP" sha256sum /data/secrets/ghostfolio.env)" = "$secrets_before"
  docker exec "$CI_APP" sh -c '
    REDISCLI_AUTH=$(sed -n "s/^REDIS_PASSWORD=//p" /data/secrets/ghostfolio.env)
    export REDISCLI_AUTH
    test "$(redis-cli GET ha_release_persistence)" = preserved
  '
  test "$(docker exec "$CI_POSTGRES" psql -U ghostfolio_test -d ghostfolio_test -Atc 'SELECT value FROM ha_release_persistence')" = preserved
  docker exec "$CI_APP" curl --fail --silent --show-error http://127.0.0.1:8099/api/v1/health >/dev/null
  echo "Persistence after $lifecycle: PASS"
done
