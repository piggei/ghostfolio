#!/usr/bin/env bash

set -euo pipefail

usage() {
  echo "Usage:"
  echo "  $0 prepare REPOSITORY TAG COMMIT ASSETS_DIR"
  echo "  $0 publish REPOSITORY TAG COMMIT ASSETS_DIR IMAGE SOURCE_DIGEST"
  exit 2
}

MODE="${1:-}"
REPOSITORY="${2:-}"
TAG="${3:-}"
COMMIT="${4:-}"
ASSETS_DIR="${5:-}"

if [[ "$MODE" != "prepare" && "$MODE" != "publish" ]]; then
  usage
fi

if [[ ! "$REPOSITORY" =~ ^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$ ]]; then
  echo "ERROR: Invalid repository" >&2
  exit 2
fi

if [[ ! "$TAG" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$ ]]; then
  echo "ERROR: Invalid release tag" >&2
  exit 2
fi

if [[ ! "$COMMIT" =~ ^[a-f0-9]{40}$ ]]; then
  echo "ERROR: Invalid commit SHA" >&2
  exit 2
fi

if [[ ! -d "$ASSETS_DIR" ]]; then
  echo "ERROR: Release assets directory not found" >&2
  exit 2
fi

ASSETS_DIR="$(realpath "$ASSETS_DIR")"
RELEASE_ID=""
SHA_TAG="sha-$COMMIT"

EXPECTED_ASSETS=(
  "ghostfolio-ng-$TAG-linux-amd64.tar.gz"
  "ghostfolio-ng-$TAG-linux-arm64.tar.gz"
  "docker-compose.yml"
  "ghostfolio.env.example"
  "SHA256SUMS"
)

if [[ "$MODE" == "publish" ]]; then
  IMAGE="${6:-}"
  SOURCE_DIGEST="${7:-}"

  if [[ ! "$IMAGE" =~ ^ghcr\.io/[a-z0-9._/-]+$ ]] ||
     [[ ! "$SOURCE_DIGEST" =~ ^sha256:[a-f0-9]{64}$ ]]; then
    usage
  fi

  if [[ "$#" -ne 7 ]]; then
    usage
  fi
elif [[ "$#" -ne 5 ]]; then
  usage
fi

# Keep all temporary data private and clean it up on every exit path.
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ghostfolio-ng-publish.XXXXXXXX")"

cleanup_temp_dir() {
  local status=$?
  trap - EXIT

  if ! rm -rf -- "$TEMP_DIR"; then
    echo "WARNING: Failed to remove temporary directory: $TEMP_DIR" >&2
    if [ "$status" -eq 0 ]; then
      status=1
    fi
  fi

  exit "$status"
}

trap cleanup_temp_dir EXIT

api_release() {
  gh api "repos/$REPOSITORY/releases/tags/$TAG" "$@"
}

get_release() {
  local output
  local error_file
  local status

  error_file="$(mktemp "$TEMP_DIR/gh-api.XXXXXXXX")"

  if output="$(api_release 2>"$error_file")"; then
    rm -f "$error_file"
    printf '%s' "$output"
    return 0
  else
    status=$?
  fi

  if grep -q 'HTTP 404' "$error_file"; then
    rm -f "$error_file"
    return 10
  fi

  cat "$error_file" >&2
  rm -f "$error_file"
  return "$status"
}

validate_assets() {
  local actual
  local expected

  cd "$ASSETS_DIR"

  for asset in "${EXPECTED_ASSETS[@]}" notes.md; do
    if [[ ! -f "$asset" || -L "$asset" ]]; then
      echo "ERROR: Missing or invalid release file: $asset" >&2
      return 1
    fi
  done

  actual="$(awk '{print $2}' SHA256SUMS | sort)"
  expected="$(
    printf '%s\n' \
      "docker-compose.yml" \
      "ghostfolio.env.example" \
      "ghostfolio-ng-$TAG-linux-amd64.tar.gz" \
      "ghostfolio-ng-$TAG-linux-arm64.tar.gz" |
      sort
  )"

  if [[ "$actual" != "$expected" ]]; then
    echo "ERROR: SHA256SUMS contains unexpected entries" >&2
    return 1
  fi

  sha256sum --check SHA256SUMS
}

validate_release() {
  local release="$1"
  local allow_published="${2:-false}"

  local draft
  local prerelease
  local target

  draft="$(jq -r '.draft' <<< "$release")"
  prerelease="$(jq -r '.prerelease' <<< "$release")"
  target="$(jq -r '.target_commitish' <<< "$release")"

  if [[ "$draft" != "true" && "$draft" != "false" ]]; then
    echo "ERROR: Invalid GitHub Release draft state" >&2
    return 1
  fi

  if [[ "$draft" == "false" && "$allow_published" != "true" ]]; then
    echo "ERROR: Release is already published" >&2
    return 1
  fi

  if [[ "$prerelease" != "true" || "$target" != "$COMMIT" ]]; then
    echo "ERROR: Existing release belongs to a different release context" >&2
    return 1
  fi

  RELEASE_ID="$(jq -r '.id' <<< "$release")"
}

verify_release_assets() {
  local release="$1"
  local actual
  local expected
  local download_dir

  actual="$(
    jq -r '.assets[].name' <<< "$release" | sort
  )"

  expected="$(
    printf '%s\n' "${EXPECTED_ASSETS[@]}" | sort
  )"

  if [[ "$actual" != "$expected" ]]; then
    echo "ERROR: Release assets do not match the expected set" >&2
    return 1
  fi

  download_dir="$(mktemp -d "$TEMP_DIR/assets.XXXXXXXX")"

  if ! gh release download "$TAG" \
    --repo "$REPOSITORY" \
    --dir "$download_dir"; then

    rm -rf -- "$download_dir"
    echo "ERROR: Cannot download remote release assets" >&2
    return 1
  fi

  actual="$(
    find "$download_dir" -mindepth 1 -maxdepth 1 -type f \
      -printf '%f\n' | sort
  )"

  if [[ "$actual" != "$expected" ]]; then
    rm -rf -- "$download_dir"
    echo "ERROR: Downloaded asset set is incomplete or unexpected" >&2
    return 1
  fi

  if ! cmp -s "$ASSETS_DIR/SHA256SUMS" "$download_dir/SHA256SUMS"; then
    rm -rf -- "$download_dir"
    echo "ERROR: Remote SHA256SUMS differs from local release" >&2
    return 1
  fi

  if ! (
    cd "$download_dir"
    sha256sum --check SHA256SUMS
  ); then
    rm -rf -- "$download_dir"
    echo "ERROR: Remote release asset checksum verification failed" >&2
    return 1
  fi

  rm -rf -- "$download_dir"

  echo "Remote release assets and checksums verified"
}

check_ghcr_digest() {
  local tag="$1"
  local output
  local digest

  output="$(docker buildx imagetools inspect "$IMAGE:$tag")"

  digest="$(
    awk '$1 == "Digest:" { print $2; count++ }
      END { if (count != 1) exit 1 }' <<< "$output"
  )"

  if [[ "$digest" != "$SOURCE_DIGEST" ]]; then
    echo "ERROR: GHCR digest mismatch for $tag" >&2
    echo "Expected: $SOURCE_DIGEST" >&2
    echo "Actual: $digest" >&2
    return 1
  fi

  echo "Verified GHCR digest: $tag"
}

prepare_release() {
  echo "=== Validate release assets ==="
  validate_assets

  echo
  echo "=== Retrieve GitHub Release ==="

  local release
  local status

  if release="$(get_release)"; then
    validate_release "$release"
    echo "Existing draft recovered: $RELEASE_ID"
  else
    status=$?

    if [[ "$status" -ne 10 ]]; then
      echo "ERROR: Cannot retrieve GitHub Release" >&2
      return 1
    fi

    echo "Creating GitHub Draft Release"

    gh release create "$TAG" \
      --repo "$REPOSITORY" \
      --target "$COMMIT" \
      --title "Ghostfolio-NG $TAG" \
      --notes-file "$ASSETS_DIR/notes.md" \
      --draft \
      --prerelease

    release="$(get_release)"
    validate_release "$release"
  fi

  echo
  echo "=== Upload release assets ==="

  local asset
  for asset in "${EXPECTED_ASSETS[@]}"; do
    gh release upload "$TAG" "$ASSETS_DIR/$asset" \
      --repo "$REPOSITORY" --clobber
  done

  release="$(get_release)"
  validate_release "$release"
  verify_release_assets "$release"

  echo
  echo "Draft Release prepared: $TAG"
}

publish_release() {
  echo "=== Validate release assets ==="
  validate_assets

  echo
  echo "=== Verify GHCR promotion ==="

  check_ghcr_digest "$TAG"
  check_ghcr_digest "$SHA_TAG"

  echo
  echo "=== Retrieve Draft Release ==="

  local release
  release="$(get_release)"
  validate_release "$release" true
  verify_release_assets "$release"

  if [[ "$(jq -r '.draft' <<< "$release")" == "false" ]]; then
    echo "GitHub Release was already published and verified: $TAG"
    return 0
  fi

  echo
  echo "=== Publish GitHub Release ==="

  gh api \
    --method PATCH \
    "repos/$REPOSITORY/releases/$RELEASE_ID" \
    -F draft=false \
    -F prerelease=true >/dev/null

  release="$(get_release)"

  if [[ "$(jq -r '.draft' <<< "$release")" != "false" ]] ||
     [[ "$(jq -r '.prerelease' <<< "$release")" != "true" ]] ||
     [[ "$(jq -r '.target_commitish' <<< "$release")" != "$COMMIT" ]]; then
    echo "ERROR: Published release verification failed" >&2
    return 1
  fi

  verify_release_assets "$release"

  echo
  echo "Ghostfolio-NG release published: $TAG"
}

case "$MODE" in
  prepare)
    prepare_release
    ;;
  publish)
    publish_release
    ;;
esac
