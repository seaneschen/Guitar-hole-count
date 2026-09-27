#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
local_node="$repo_root/.local/runtime/bin/node"

if [ -x "$local_node" ]; then
  node_dir="$repo_root/.local/runtime/bin"
elif command -v node >/dev/null 2>&1; then
  node_dir=$(dirname -- "$(command -v node)")
else
  echo "Node.js 20 or newer is required. Install Node, then run npm install." >&2
  exit 1
fi

PATH="$node_dir:/usr/bin:/bin"
export PATH
exec "$node_dir/npm" "$@"
