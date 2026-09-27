#!/bin/sh
set -eu

source_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
runtime_root="/Users/seaneschen/Library/Application Support/GuitarHoleCount"
launch_agents_root="/Users/seaneschen/Library/LaunchAgents"
launch_domain="gui/$(id -u)"

mkdir -p "$runtime_root/.local" "$runtime_root/data" "$launch_agents_root"

ditto "$source_root/server" "$runtime_root/server"
ditto "$source_root/web" "$runtime_root/web"
ditto "$source_root/node_modules" "$runtime_root/node_modules"
ditto "$source_root/.local/runtime" "$runtime_root/.local/runtime"
cp "$source_root/.local/cloudflared" "$runtime_root/.local/cloudflared"
cp "$source_root/package.json" "$runtime_root/package.json"

if [ ! -f "$runtime_root/data/state.json" ] && [ -f "$source_root/data/state.json" ]; then
  cp "$source_root/data/state.json" "$runtime_root/data/state.json"
fi

cp "$source_root/ops/macos/com.seaneschen.guitar-hole-count.server.plist" \
  "$launch_agents_root/com.seaneschen.guitar-hole-count.server.plist"
cp "$source_root/ops/macos/com.seaneschen.guitar-hole-count.tunnel.plist" \
  "$launch_agents_root/com.seaneschen.guitar-hole-count.tunnel.plist"

launchctl bootout "$launch_domain/com.seaneschen.guitar-hole-count.tunnel" 2>/dev/null || true
launchctl bootout "$launch_domain/com.seaneschen.guitar-hole-count.server" 2>/dev/null || true

launchctl bootstrap "$launch_domain" \
  "$launch_agents_root/com.seaneschen.guitar-hole-count.server.plist"
launchctl bootstrap "$launch_domain" \
  "$launch_agents_root/com.seaneschen.guitar-hole-count.tunnel.plist"

echo "Guitar Hole Count background services installed."
echo "Runtime: $runtime_root"
