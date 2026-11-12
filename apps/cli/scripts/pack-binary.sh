#!/usr/bin/env bash
# Packs a standalone executable of the CLI as <executable>.tar.xz, the archive a release attaches
# for macOS and Linux and the Homebrew formula installs (publish-cli.yml; ci.yml packs it on every
# pull request): the executable as pulse-cli and the licences of what it holds, LICENSE (the
# CLI's), THIRD_PARTY_LICENSES.txt (the works of others its bundle holds) and NODE_LICENSE (the
# Node.js the executable embeds: build:exe copies the node that runs it and keeps that node's
# LICENSE in build/node-license/<executable>, the default here).
#
#   scripts/pack-binary.sh build/bin/pulse-cli-linux-x64 [<LICENSE of the embedded Node.js>]
#
# GNU tar passes XZ_OPT to xz (publish-cli.yml and ci.yml set -T0).
set -euo pipefail

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "usage: $0 <executable> [<LICENSE of the embedded Node.js>]" >&2
  exit 2
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
executable="$1"
node_license="${2:-$root/build/node-license/$(basename "$executable")}"
for file in "$executable" "$root/LICENSE" "$root/THIRD_PARTY_LICENSES.txt" "$node_license"; do
  if [ ! -f "$file" ]; then
    echo "$0: $file does not exist (the Node.js LICENSE: build:exe keeps it when it runs on an" \
      "official Node.js build, or name it)" >&2
    exit 1
  fi
done

pack="$(mktemp -d)"
trap 'rm -rf "$pack"' EXIT
install -m 0755 "$executable" "$pack/pulse-cli"
install -m 0644 "$root/LICENSE" "$root/THIRD_PARTY_LICENSES.txt" "$pack/"
install -m 0644 "$node_license" "$pack/NODE_LICENSE"
tar -C "$pack" -cJf "$executable.tar.xz" pulse-cli LICENSE THIRD_PARTY_LICENSES.txt NODE_LICENSE
echo "Packed $executable.tar.xz:"
tar -tvJf "$executable.tar.xz"
