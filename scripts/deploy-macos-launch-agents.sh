#!/bin/sh
set -eu

source_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
runtime_root="/Users/seaneschen/Library/Application Support/GuitarHoleCount"
launch_agents_root="/Users/seaneschen/Library/LaunchAgents"
launch_domain="gui/$(id -u)"

bootstrap_agent() {
  plist_path=$1
  attempt=0
  until launchctl bootstrap "$launch_domain" "$plist_path"; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 5 ]; then
      return 1
    fi
    sleep 1
  done
}

mkdir -p \
  "$runtime_root/.local/ngrok" \
  "$runtime_root/.local/tunnel-client" \
  "$runtime_root/data" \
  "$runtime_root/secrets" \
  "$runtime_root/tunnel-client" \
  "$launch_agents_root"

ditto "$source_root/server" "$runtime_root/server"
ditto "$source_root/web" "$runtime_root/web"
ditto "$source_root/r1" "$runtime_root/r1"
ditto "$source_root/node_modules" "$runtime_root/node_modules"
ditto "$source_root/.local/runtime" "$runtime_root/.local/runtime"
cp "$source_root/.local/tunnel-client-v0.0.15/tunnel-client" \
  "$runtime_root/.local/tunnel-client/tunnel-client"
cp "$source_root/.local/tunnel-client-v0.0.15/cloudflared" \
  "$runtime_root/.local/tunnel-client/cloudflared"
if [ -x "$source_root/.local/ngrok/ngrok" ]; then
  cp "$source_root/.local/ngrok/ngrok" "$runtime_root/.local/ngrok/ngrok"
  chmod 755 "$runtime_root/.local/ngrok/ngrok"
fi
cp "$source_root/package.json" "$runtime_root/package.json"
cp "$source_root/ops/macos/tunnel-client/guitar-hole-count.yaml" \
  "$runtime_root/tunnel-client/guitar-hole-count.yaml"

if [ -f "$source_root/.env.local" ]; then
  control_plane_api_key=$(/usr/bin/sed -n 's/^CONTROL_PLANE_API_KEY=//p' "$source_root/.env.local" | /usr/bin/tail -n 1)
  if [ -z "$control_plane_api_key" ]; then
    echo "Missing CONTROL_PLANE_API_KEY in $source_root/.env.local" >&2
    exit 1
  fi
  umask 077
  printf '%s' "$control_plane_api_key" > "$runtime_root/secrets/control-plane.key"
  chmod 600 "$runtime_root/secrets/control-plane.key"
elif [ ! -s "$runtime_root/secrets/control-plane.key" ]; then
  echo "No tunnel credential is available." >&2
  exit 1
fi

if [ -f "$source_root/.env.local" ]; then
  r1_api_token=$(/usr/bin/sed -n 's/^R1_API_TOKEN=//p' "$source_root/.env.local" | /usr/bin/tail -n 1)
else
  r1_api_token=""
fi
if [ -n "$r1_api_token" ]; then
  umask 077
  printf '%s' "$r1_api_token" > "$runtime_root/secrets/r1-api.key"
elif [ ! -s "$runtime_root/secrets/r1-api.key" ]; then
  umask 077
  /usr/bin/openssl rand -hex 32 > "$runtime_root/secrets/r1-api.key"
fi
chmod 600 "$runtime_root/secrets/r1-api.key"

if [ ! -f "$runtime_root/data/state.json" ] && [ -f "$source_root/data/state.json" ]; then
  cp "$source_root/data/state.json" "$runtime_root/data/state.json"
fi

cp "$source_root/ops/macos/com.seaneschen.guitar-hole-count.server.plist" \
  "$launch_agents_root/com.seaneschen.guitar-hole-count.server.plist"
cp "$source_root/ops/macos/com.seaneschen.guitar-hole-count.openai-tunnel.plist" \
  "$launch_agents_root/com.seaneschen.guitar-hole-count.openai-tunnel.plist"
if [ -x "$runtime_root/.local/ngrok/ngrok" ] && [ -s "$runtime_root/secrets/ngrok.yml" ]; then
  cp "$source_root/ops/macos/com.seaneschen.guitar-hole-count.r1-tunnel.plist" \
    "$launch_agents_root/com.seaneschen.guitar-hole-count.r1-tunnel.plist"
fi

launchctl bootout "$launch_domain/com.seaneschen.guitar-hole-count.r1-tunnel" 2>/dev/null || true
launchctl bootout "$launch_domain/com.seaneschen.guitar-hole-count.openai-tunnel" 2>/dev/null || true
launchctl bootout "$launch_domain/com.seaneschen.guitar-hole-count.server" 2>/dev/null || true

bootstrap_agent \
  "$launch_agents_root/com.seaneschen.guitar-hole-count.server.plist"

attempt=0
until /usr/bin/curl -fsS http://127.0.0.1:8787/ >/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "MCP server did not become ready; see $runtime_root/data/server-launchd.log" >&2
    exit 1
  fi
  sleep 1
done

if [ -x "$runtime_root/.local/ngrok/ngrok" ] && [ -s "$runtime_root/secrets/ngrok.yml" ]; then
  bootstrap_agent \
    "$launch_agents_root/com.seaneschen.guitar-hole-count.r1-tunnel.plist"

  r1_api_token=$(/bin/cat "$runtime_root/secrets/r1-api.key")
  attempt=0
  until /usr/bin/curl -fsS \
    -H "Authorization: Bearer ${r1_api_token}" \
    -H "ngrok-skip-browser-warning: 1" \
    https://reconvene-devalue-petticoat.ngrok-free.dev/api/v1/snapshot >/dev/null; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 30 ]; then
      echo "R1 tunnel did not become ready; see $runtime_root/data/r1-tunnel-launchd.log" >&2
      exit 1
    fi
    sleep 1
  done
fi

bootstrap_agent \
  "$launch_agents_root/com.seaneschen.guitar-hole-count.openai-tunnel.plist"

attempt=0
until /usr/bin/curl -fsS http://127.0.0.1:8788/readyz >/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "OpenAI tunnel did not become ready; see $runtime_root/data/openai-tunnel-launchd.log" >&2
    exit 1
  fi
  sleep 1
done

launchctl bootout "$launch_domain/com.seaneschen.guitar-hole-count.tunnel" 2>/dev/null || true
legacy_plist="$launch_agents_root/com.seaneschen.guitar-hole-count.tunnel.plist"
if [ -f "$legacy_plist" ]; then
  mv "$legacy_plist" "$runtime_root/com.seaneschen.guitar-hole-count.tunnel.legacy.plist"
fi

echo "Guitar Hole Count background services installed."
echo "Runtime: $runtime_root"
echo "OpenAI tunnel: ready"
if [ -s "$runtime_root/secrets/ngrok.yml" ]; then
  echo "R1 tunnel: https://reconvene-devalue-petticoat.ngrok-free.dev"
fi
