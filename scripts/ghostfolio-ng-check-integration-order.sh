#!/usr/bin/env bash

set -euo pipefail

usage() {
  echo "Usage: $0 REPOSITORY CURRENT_TAG CURRENT_RUN_ID" >&2
  exit 2
}

if [ "$#" -ne 3 ]; then
  usage
fi

REPOSITORY="$1"
CURRENT_TAG="$2"
CURRENT_RUN_ID="$3"

if [[ ! "$REPOSITORY" =~ ^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$ ]]; then
  echo "ERROR: Invalid repository" >&2
  exit 2
fi

TAG_PATTERN='^integration-[0-9]+\.[0-9]+\.[0-9]+-([0-9]+)(\.([0-9]+))?$'

if [[ ! "$CURRENT_TAG" =~ $TAG_PATTERN ]]; then
  echo "ERROR: Invalid integration release tag: $CURRENT_TAG" >&2
  exit 2
fi

# Save the captured run number before another regex overwrites BASH_REMATCH.
CURRENT_RUN="${BASH_REMATCH[1]}"

if [[ ! "$CURRENT_RUN_ID" =~ ^[1-9][0-9]*$ ]]; then
  echo "ERROR: Invalid current workflow run ID" >&2
  exit 2
fi

CURRENT_BASE="$CURRENT_TAG"

if [[ "$CURRENT_TAG" =~ ^(integration-[0-9]+\.[0-9]+\.[0-9]+-[0-9]+)\.[0-9]+$ ]]; then
  CURRENT_BASE="${BASH_REMATCH[1]}"
fi

CURRENT_RUN_NUMBER=$((10#$CURRENT_RUN))

WORKFLOW_PATH="integration-release.yml"
BRANCH="integration/ghostfolio-all-pr"

echo "=== Check integration release ordering ==="
echo "Repository: $REPOSITORY"
echo "Current tag: $CURRENT_TAG"
echo "Current run number: $CURRENT_RUN_NUMBER"
echo "Current run ID: $CURRENT_RUN_ID"

echo
echo "=== Check published releases ==="

if ! RELEASE_TAGS="$(
  gh api --paginate \
    "repos/$REPOSITORY/releases?per_page=100" \
    --jq '.[] | select(.draft == false) | .tag_name'
)"; then
  echo "ERROR: Cannot retrieve published GitHub releases" >&2
  exit 1
fi

LATEST_RUN=0
LATEST_TAG=""

while IFS= read -r tag; do
  [[ -n "$tag" ]] || continue

  if [[ ! "$tag" =~ $TAG_PATTERN ]]; then
    continue
  fi

  run_number=$((10#${BASH_REMATCH[1]}))

  if (( run_number > LATEST_RUN )); then
    LATEST_RUN=$run_number
    LATEST_TAG="$tag"
  fi
done <<< "$RELEASE_TAGS"

if (( LATEST_RUN > CURRENT_RUN_NUMBER )); then
  echo "A newer integration release already exists: $LATEST_TAG"
  echo "Integration channel update skipped."
  exit 10
fi

if (( LATEST_RUN == CURRENT_RUN_NUMBER )) && [[ -n "$LATEST_TAG" ]]; then
  normalized_latest="$LATEST_TAG"

  if [[ "$LATEST_TAG" =~ ^(integration-[0-9]+\.[0-9]+\.[0-9]+-[0-9]+)\.[0-9]+$ ]]; then
    normalized_latest="${BASH_REMATCH[1]}"
  fi

  if [[ "$normalized_latest" != "$CURRENT_BASE" ]]; then
    echo "ERROR: Conflicting release tags use the same run number" >&2
    echo "Current: $CURRENT_TAG" >&2
    echo "Latest:  $LATEST_TAG" >&2
    exit 1
  fi
fi

check_active_runs() {
  local status="$1"
  local active_runs
  local run_id
  local run_number
  local extra
  local numeric_run

  echo
  echo "=== Check workflow runs: $status ==="

  if ! active_runs="$(
    gh api --paginate \
      "repos/$REPOSITORY/actions/workflows/$WORKFLOW_PATH/runs?branch=$BRANCH&status=$status&per_page=100" \
      --jq '.workflow_runs[] | [.id, .run_number] | @tsv'
  )"; then
    echo "ERROR: Cannot retrieve workflow runs with status $status" >&2
    return 1
  fi

  while IFS=$'\t' read -r run_id run_number extra; do
    [[ -n "$run_id" ]] || continue

    if [[ ! "$run_id" =~ ^[1-9][0-9]*$ ]] ||
       [[ ! "$run_number" =~ ^[1-9][0-9]*$ ]] ||
       [[ -n "${extra:-}" ]]; then
      echo "ERROR: Invalid workflow run data returned by GitHub" >&2
      return 1
    fi

    # Re-running the current workflow must not block itself.
    if [[ "$run_id" == "$CURRENT_RUN_ID" ]]; then
      continue
    fi

    numeric_run=$((10#$run_number))

    if (( numeric_run > CURRENT_RUN_NUMBER )); then
      echo "A newer workflow run is $status: $run_id (run $numeric_run)"
      echo "Integration channel update skipped."
      return 10
    fi
  done <<< "$active_runs"

  echo "No newer $status workflow runs found."
  return 0
}

for status in queued in_progress; do
  if check_active_runs "$status"; then
    :
  else
    result=$?

    if [[ "$result" -eq 10 ]]; then
      exit 10
    fi

    echo "ERROR: Cannot establish workflow execution ordering" >&2
    exit 1
  fi
done

echo
echo "Integration release ordering verified."
echo "No newer published or active workflow runs detected."
exit 0
