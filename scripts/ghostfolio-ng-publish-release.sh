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

get_release() {
  local matches
  local error_file
  local status
  local count

  error_file="$(mktemp "$TEMP_DIR/gh-api.XXXXXXXX")"

  # The tag-specific endpoint does not expose unpublished Draft Releases.
  # Retrieve all release pages and select the exact tag locally.
  if matches="$(
    gh api --paginate \
      "repos/$REPOSITORY/releases?per_page=100" \
      2>"$error_file" |
      jq -s --arg tag "$TAG" \
        '[.[][] | select(.tag_name == $tag)]' \
        2>>"$error_file"
  )"; then
    rm -f -- "$error_file"
  else
    status=$?
    cat "$error_file" >&2
    rm -f -- "$error_file"
    return "$status"
  fi

  count="$(jq 'length' <<< "$matches")" || {
    echo "ERROR: Cannot count matching GitHub Releases" >&2
    return 1
  }

  if [[ "$count" -eq 0 ]]; then
    return 10
  fi

  if [[ "$count" -ne 1 ]]; then
    echo "ERROR: Multiple GitHub Releases found for tag $TAG" >&2
    return 1
  fi

  jq -c '.[0]' <<< "$matches"
}


get_release_by_id() {
  local release_id="$1"

  if [[ ! "$release_id" =~ ^[1-9][0-9]*$ ]]; then
    echo "ERROR: Invalid GitHub Release ID" >&2
    return 2
  fi

  gh api "repos/$REPOSITORY/releases/$release_id"
}


get_release_assets() {
  local release_id="$1"

  if [[ ! "$release_id" =~ ^[1-9][0-9]*$ ]]; then
    echo "ERROR: Invalid GitHub Release ID" >&2
    return 2
  fi

  gh api --paginate \
    "repos/$REPOSITORY/releases/$release_id/assets?per_page=100" |
    jq -s 'add // []'
}


validate_release_asset_listing() {
  local listing="$1"

  printf '%s' "$listing" |
    jq -e \
      --argjson expected "$(
        printf '%s\n' "${EXPECTED_ASSETS[@]}" | jq -R . | jq -s .
      )" '
        type == "array" and
        all(.[];
          (.id | type == "number" and . > 0 and floor == .) and
          (.name | type == "string" and IN($expected[])) and
          (.size | type == "number" and . >= 0 and floor == .) and
          .state == "uploaded"
        ) and
        ([.[].id] | length == (unique | length)) and
        ([.[].name] | length == (unique | length))
      ' >/dev/null
}



verify_existing_release_asset() {
  local asset_name="$1"
  local asset_id="$2"
  local local_path="$ASSETS_DIR/$asset_name"
  local remote_path

  if [[ ! "$asset_id" =~ ^[1-9][0-9]*$ ]] ||
     [[ ! -f "$local_path" || -L "$local_path" ]]; then
    echo "ERROR: Invalid existing release asset" >&2
    return 1
  fi

  remote_path="$(mktemp "$TEMP_DIR/existing-asset.XXXXXXXX")"

  if ! gh api \
    -H "Accept: application/octet-stream" \
    "repos/$REPOSITORY/releases/assets/$asset_id" \
    > "$remote_path"; then
    echo "ERROR: Cannot retrieve existing release asset: $asset_name" >&2
    return 1
  fi

  if ! cmp -s "$local_path" "$remote_path"; then
    echo "ERROR: Existing release asset differs from local file: $asset_name" >&2
    return 1
  fi

  rm -f -- "$remote_path"

  echo "Existing release asset verified: $asset_name"
}

upload_release_asset() {
  local release_id="$1"
  local asset_name="$2"
  local asset_path="$ASSETS_DIR/$asset_name"
  local response_file
  local http_status

  if [[ ! "$release_id" =~ ^[1-9][0-9]*$ ]] ||
     [[ ! "$asset_name" =~ ^[a-zA-Z0-9_.-]+$ ]] ||
     [[ ! -f "$asset_path" || -L "$asset_path" ]]; then
    echo "ERROR: Invalid release asset upload arguments" >&2
    return 2
  fi

  if [[ -z "${GH_TOKEN:-}" ]]; then
    echo "ERROR: GH_TOKEN is required for release asset upload" >&2
    return 1
  fi

  if [[ ! "$GH_TOKEN" =~ ^[a-zA-Z0-9_]+$ ]]; then
    echo "ERROR: GH_TOKEN contains unsupported characters" >&2
    return 1
  fi

  response_file="$(mktemp "$TEMP_DIR/upload.XXXXXXXX")"

  if http_status="$(
    {
      printf 'header = "Authorization: Bearer %s"\n' "$GH_TOKEN"
      printf 'header = "Accept: application/vnd.github+json"\n'
    } |
    curl --disable \
      --silent --show-error \
      --config - \
      --request POST \
      --connect-timeout 15 \
      --max-time 1800 \
      --header "Content-Type: application/octet-stream" \
      --data-binary "@$asset_path" \
      --output "$response_file" \
      --write-out '%{http_code}' \
      --url "https://uploads.github.com/repos/$REPOSITORY/releases/$release_id/assets?name=$asset_name"
  )"; then
    :
  else
    echo "ERROR: GitHub asset upload transport failed" >&2
    return 1
  fi

  if [[ "$http_status" != "201" ]]; then
    echo "ERROR: GitHub asset upload returned HTTP $http_status" >&2
    return 1
  fi

  local expected_size
  expected_size="$(stat -c '%s' "$asset_path")"

  if ! jq -e \
    --arg name "$asset_name" \
    --argjson expected_size "$expected_size" \
    '
      .name == $name and
      .state == "uploaded" and
      (.id | type == "number" and . > 0 and floor == .) and
      (.size == $expected_size)
    ' \
    "$response_file" >/dev/null; then
    echo "ERROR: Invalid GitHub asset upload response" >&2
    return 1
  fi

  echo "Uploaded release asset: $asset_name"
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
  local release_tag
  local release_id

  draft="$(jq -r '.draft' <<< "$release")"
  prerelease="$(jq -r '.prerelease' <<< "$release")"
  target="$(jq -r '.target_commitish' <<< "$release")"
  release_tag="$(jq -r '.tag_name' <<< "$release")"
  release_id="$(jq -r '.id' <<< "$release")"

  if [[ "$release_tag" != "$TAG" ]]; then
    echo "ERROR: GitHub Release tag does not match requested tag" >&2
    return 1
  fi

  if [[ ! "$release_id" =~ ^[1-9][0-9]*$ ]]; then
    echo "ERROR: Invalid GitHub Release ID" >&2
    return 1
  fi

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

  RELEASE_ID="$release_id"
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

  local asset_name
  local asset_id

  for asset_name in "${EXPECTED_ASSETS[@]}"; do
    asset_id="$(
      jq -r --arg name "$asset_name" '
        [.assets[] | select(.name == $name) | .id] |
        if length == 1 then .[0] else empty end
      ' <<< "$release"
    )"

    if [[ ! "$asset_id" =~ ^[1-9][0-9]*$ ]]; then
      echo "ERROR: Missing or invalid GitHub asset ID: $asset_name" >&2
      return 1
    fi

    if ! gh api \
      -H "Accept: application/octet-stream" \
      "repos/$REPOSITORY/releases/assets/$asset_id" \
      > "$download_dir/$asset_name"; then

      echo "ERROR: Cannot download remote release asset: $asset_name" >&2
      return 1
    fi
  done

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

    release="$(
      jq -n \
        --arg tag "$TAG" \
        --arg commit "$COMMIT" \
        --arg title "Ghostfolio-NG $TAG" \
        --rawfile notes "$ASSETS_DIR/notes.md" \
        '{
          tag_name: $tag,
          target_commitish: $commit,
          name: $title,
          body: $notes,
          draft: true,
          prerelease: true
        }' |
      gh api --method POST \
        "repos/$REPOSITORY/releases" \
        --input -
    )"

    validate_release "$release"
  fi

  echo
  echo "=== Inspect release assets by ID ==="

  local remote_assets
  remote_assets="$(get_release_assets "$RELEASE_ID")"

  if ! validate_release_asset_listing "$remote_assets"; then
    echo "ERROR: Invalid GitHub Release asset listing" >&2
    return 1
  fi

  echo
  echo "=== Verify existing release assets ==="

  local asset
  local asset_id

  for asset in "${EXPECTED_ASSETS[@]}"; do
    asset_id="$(
      jq -r --arg name "$asset" '
        [.[] | select(.name == $name) | .id] |
        if length == 1 then .[0] else empty end
      ' <<< "$remote_assets"
    )"

    if [[ -n "$asset_id" ]]; then
      verify_existing_release_asset "$asset" "$asset_id"
    fi
  done

  echo
  echo "=== Upload missing release assets ==="

  for asset in "${EXPECTED_ASSETS[@]}"; do
    asset_id="$(
      jq -r --arg name "$asset" '
        [.[] | select(.name == $name) | .id] |
        if length == 1 then .[0] else empty end
      ' <<< "$remote_assets"
    )"

    if [[ -z "$asset_id" ]]; then
      upload_release_asset "$RELEASE_ID" "$asset"
    fi
  done

  release="$(get_release_by_id "$RELEASE_ID")"
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

  release="$(get_release_by_id "$RELEASE_ID")"
  validate_release "$release" true

  if [[ "$(jq -r '.draft' <<< "$release")" != "false" ]]; then
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
