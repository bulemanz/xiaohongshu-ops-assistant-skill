#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${XHS_ENV_FILE:-$ROOT/.env}"
NODE_BIN="${NODE_BIN:-node}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

exec "$NODE_BIN" "$ROOT/src/scheduler.mjs" --publish --comments --auto-send
