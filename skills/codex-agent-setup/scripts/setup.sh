#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
INSTALLER="${PLUGIN_ROOT}/scripts/codex-agents/install.py"

if ! command -v python3 >/dev/null 2>&1; then
  echo "error: python3 is required" >&2
  exit 1
fi
if [[ ! -f "${INSTALLER}" ]]; then
  echo "error: 1Sat Codex agent installer is missing: ${INSTALLER}" >&2
  exit 1
fi

export ONESAT_PLUGIN_ROOT="${PLUGIN_ROOT}"
exec python3 "${INSTALLER}" --plugin-root "${PLUGIN_ROOT}" "$@"
