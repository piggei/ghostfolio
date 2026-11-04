#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
set -euo pipefail
root=$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
qualify_node=${HA_QUALIFY_NODE:-node}
if ! command -v "$qualify_node" >/dev/null 2>&1; then
  echo 'MISSING PREREQUISITE: Node.js 22.x. See docs/ci/ghostfolio-ng-ha-local-qualification.md' >&2
  exit 2
fi
qualify_version=$("$qualify_node" --version 2>/dev/null) || {
  echo 'MISSING OR INCOMPATIBLE PREREQUISITE: executable Node.js 22.x required' >&2
  exit 2
}
if [[ "$qualify_version" != v22.* ]]; then
  echo "INCOMPATIBLE PREREQUISITE: Node.js 22.x required, found $qualify_version" >&2
  exit 2
fi
exec "$qualify_node" "$root/scripts/qualify-ha-orchestrator-local.mjs" "$@"
