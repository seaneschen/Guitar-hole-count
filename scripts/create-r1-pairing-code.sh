#!/bin/sh
set -eu

runtime_root="/Users/seaneschen/Library/Application Support/GuitarHoleCount"
pairing_path="$runtime_root/secrets/r1-pairing.json"
temporary_path="$runtime_root/secrets/r1-pairing.$$.tmp"
random_value=$(/usr/bin/od -An -N4 -tu4 /dev/urandom | /usr/bin/tr -d ' ')
pairing_code=$((random_value % 900000 + 100000))
expires_at=$((($(date +%s) + 600) * 1000))

mkdir -p "$runtime_root/secrets"
umask 077
printf '{"code":"%s","expiresAt":%s}\n' "$pairing_code" "$expires_at" > "$temporary_path"
mv -f "$temporary_path" "$pairing_path"
chmod 600 "$pairing_path"

echo "$pairing_code"
