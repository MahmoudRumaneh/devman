#!/usr/bin/env bash
# One command to launch Devman API: a local web UI for pasting endpoint
# routes + role tokens (admin/creator/student) and running them.
set -Eeuo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PORT="${PORT:-8787}"
URL="http://127.0.0.1:$PORT"

command -v node >/dev/null || {
  echo "node is required. Run npm ci once before starting Devman API." >&2
  exit 1
}

node -e "require.resolve('yaml')" >/dev/null 2>&1 || {
  echo "dependencies are missing. Run npm ci before starting Devman API." >&2
  exit 1
}

echo "Starting Devman API at $URL"
(
  sleep 1
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1
  elif command -v open >/dev/null 2>&1; then open "$URL" >/dev/null 2>&1
  fi
) &

exec node server.js "$PORT"
