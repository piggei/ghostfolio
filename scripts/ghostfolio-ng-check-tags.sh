#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "Usage: $0 IMAGE TAG..." >&2
  exit 2
fi

image="$1"
shift

if [[ ! "$image" =~ ^ghcr\.io/[a-z0-9._/-]+$ ]]; then
  echo "ERROR: Invalid GHCR image reference" >&2
  exit 2
fi

# Keep registry inspection errors private and clean temporary data on exit.
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ghostfolio-ng-tags.XXXXXXXX")"

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

for tag in "$@"; do
  if [[ ! "$tag" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$ ]]; then
    echo "ERROR: Invalid image tag" >&2
    exit 2
  fi

  reference="$image:$tag"
  error_file="$(mktemp "$TEMP_DIR/registry.XXXXXXXX")"

  if docker buildx imagetools inspect "$reference" \
    >/dev/null 2>"$error_file"; then

    rm -f -- "$error_file"
    echo "ERROR: Release tag already exists: $reference" >&2
    exit 1
  fi

  error="$(cat "$error_file")"
  rm -f -- "$error_file"

  if [ "$error" = "ERROR: $reference: not found" ]; then
    echo "Release tag available: $reference"
  else
    echo "ERROR: Cannot establish tag availability: $reference" >&2
    echo "Registry inspection failed or returned an unexpected response" >&2
    exit 1
  fi
done
