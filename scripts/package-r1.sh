#!/bin/sh
set -eu

source_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
output_root="$source_root/dist"
output_path="$output_root/guitar-hole-count-r1.zip"
temporary_root=$(mktemp -d "/tmp/guitar-hole-count-r1.XXXXXX")
temporary_path="$temporary_root/guitar-hole-count-r1.zip"
trap 'rm -rf "$temporary_root"' EXIT

mkdir -p "$output_root"
(cd "$source_root/r1" && /usr/bin/zip -q "$temporary_path" index.html styles.css core.js app.js icon.svg README.md)
mv -f "$temporary_path" "$output_path"
rm -rf "$temporary_root"
trap - EXIT

echo "$output_path"
