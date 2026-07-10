#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
GENERATOR="${PLUGIN_ROOT}/scripts/codex-agents/generate.py"
MATERIALIZER="${PLUGIN_ROOT}/scripts/codex-agents/materialize_skills.py"

if ! command -v python3 >/dev/null 2>&1; then
  echo "error: python3 is required" >&2
  exit 1
fi

export ONESAT_PLUGIN_ROOT="${PLUGIN_ROOT}"
python3 "${MATERIALIZER}" --plugin-root "${PLUGIN_ROOT}" "$@"
exec python3 "${GENERATOR}" --plugin-root "${PLUGIN_ROOT}" "$@"
