#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if [ "$#" -lt 5 ]; then
  echo "Usage: $0 IMAGE SOURCE_TAG AMD64_DIGEST ARM64_DIGEST FINAL_TAG..." >&2
  exit 2
fi

IMAGE="$1"
SOURCE_TAG="$2"
AMD64_DIGEST="$3"
ARM64_DIGEST="$4"
shift 4

DIGEST_PATTERN='^sha256:[a-f0-9]{64}$'

if [[ ! "$IMAGE" =~ ^ghcr\.io/[a-z0-9._/-]+$ ]]; then
  echo "ERROR: Invalid GHCR image reference" >&2
  exit 2
fi

for tag in "$SOURCE_TAG" "$@"; do
  if [[ ! "$tag" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$ ]]; then
    echo "ERROR: Invalid image tag: $tag" >&2
    exit 2
  fi
done

if [[ ! "$AMD64_DIGEST" =~ $DIGEST_PATTERN ]] ||
   [[ ! "$ARM64_DIGEST" =~ $DIGEST_PATTERN ]] ||
   [ "$AMD64_DIGEST" = "$ARM64_DIGEST" ]; then
  echo "ERROR: Invalid or duplicate architecture digests" >&2
  exit 2
fi

# Keep registry inspection errors private and clean temporary data on exit.
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ghostfolio-ng-promote.XXXXXXXX")"

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

SOURCE_REFERENCE="$IMAGE:$SOURCE_TAG"

inspect_digest() {
  local reference="$1"
  local output
  local error_file
  local status
  local error
  local digest

  error_file="$(mktemp "$TEMP_DIR/registry.XXXXXXXX")"

  if output=$(docker buildx imagetools inspect "$reference" 2>"$error_file"); then
    rm -f -- "$error_file"
  else
    status=$?
    error="$(cat "$error_file")"
    rm -f -- "$error_file"

    if [ "$error" = "ERROR: $reference: not found" ]; then
      return 10
    fi

    echo "ERROR: Cannot inspect registry reference: $reference" >&2
    echo "Registry error: $error" >&2
    return "$status"
  fi

  digest="$(printf '%s\n' "$output" |
    awk '$1 == "Digest:" { print $2; count++ }
      END { if (count != 1) exit 1 }')" || {
    echo "ERROR: Cannot extract unique manifest digest: $reference" >&2
    return 1
  }

  if [[ ! "$digest" =~ $DIGEST_PATTERN ]]; then
    echo "ERROR: Invalid manifest digest: $reference" >&2
    return 1
  fi

  printf '%s\n' "$digest"
}

inspect_manifest() {
  local reference="$1"

  docker buildx imagetools inspect --raw "$reference"
}

validate_manifest() {
  local reference="$1"
  local manifest

  if ! manifest="$(inspect_manifest "$reference")"; then
    echo "ERROR: Cannot retrieve manifest: $reference" >&2
    return 1
  fi

  printf '%s\n' "$manifest" |
    node "$SCRIPT_DIR/ghostfolio-ng-validate-manifest.mjs" \
      "$AMD64_DIGEST" "$ARM64_DIGEST"
}

validate_destination() {
  local reference="$1"
  local digest="$2"

  if [ "$digest" != "$SOURCE_DIGEST" ]; then
    echo "ERROR: Destination manifest digest differs from qualified source" >&2
    echo "Expected: $SOURCE_DIGEST" >&2
    echo "Actual:   $digest" >&2
    return 1
  fi

  validate_manifest "$IMAGE@$digest"
}

echo "=== Resolve qualified multiarch source ==="

if ! SOURCE_DIGEST="$(inspect_digest "$SOURCE_REFERENCE")"; then
  echo "ERROR: Temporary multiarch source is unavailable" >&2
  exit 1
fi

echo "Qualified manifest digest: $SOURCE_DIGEST"

SOURCE_PINNED_REFERENCE="$IMAGE@$SOURCE_DIGEST"

validate_manifest "$SOURCE_PINNED_REFERENCE"

echo "Temporary source manifest: PASS"

for tag in "$@"; do
  reference="$IMAGE:$tag"

  echo
  echo "=== Promote $reference ==="

  if existing_digest="$(inspect_digest "$reference")"; then
    echo "Tag already exists; verifying immutable content"

    validate_destination "$reference" "$existing_digest"

    echo "Tag already contains the qualified manifest: $reference"
    continue
  else
    status=$?
  fi

  if [ "$status" -ne 10 ]; then
    echo "ERROR: Cannot determine destination tag availability" >&2
    exit 1
  fi

  echo "Publishing pinned manifest: $SOURCE_PINNED_REFERENCE"

  if ! docker buildx imagetools create \
    --tag "$reference" \
    "$SOURCE_PINNED_REFERENCE"; then

    echo "WARNING: Publication command failed; checking destination state" >&2

    if recovered_digest="$(inspect_digest "$reference")"; then
      validate_destination "$reference" "$recovered_digest"
      echo "Recovered matching destination after publication interruption"
      continue
    fi

    echo "ERROR: Release promotion failed: $reference" >&2
    exit 1
  fi

  echo "=== Verify promoted manifest ==="

  if ! promoted_digest="$(inspect_digest "$reference")"; then
    echo "ERROR: Promoted tag cannot be inspected: $reference" >&2
    exit 1
  fi

  validate_destination "$reference" "$promoted_digest"

  echo "Promotion verified: $reference"
done

echo
echo "Ghostfolio-NG release promotion: PASS"
