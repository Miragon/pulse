#!/usr/bin/env bash
# Writes the licences a release attaches beside the executables (publish-cli.yml's licences job)
# under names its upload takes: pulse-cli-LICENSE (the CLI's), pulse-cli-THIRD_PARTY_LICENSES.txt
# (the works of others its bundle holds) and pulse-cli-NODE_LICENSE (the Node.js the executables
# embed). The archive of a macOS or Linux executable holds the same files
# (scripts/pack-binary.sh); the Windows executable and the raw ones carry them this way.
#
# The release attaches one Node.js licence, which the five executables share: <node licences>
# holds the LICENSE build:exe kept on each target's runner (build/node-license/<executable>), one
# per executable of the release, and the script fails when one is missing, one belongs to no
# executable or their texts differ, naming the executables of each text. It compares texts, not
# versions: each target takes the newest Node.js 24 when its job runs, and patch releases of
# Node.js mostly share one text, so a release during the run fails only when it changed the text.
# Carriage returns do not count: the Windows build of Node.js ships its LICENSE with CRLF line
# ends, the others and the asset with LF.
#
#   scripts/release-licenses.sh <folder of the executables' Node.js licences> <output folder>
set -euo pipefail
shopt -s nullglob

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <folder of the executables' Node.js licences> <output folder>" >&2
  exit 2
fi

fail() {
  echo "$0: $*" >&2
  exit 1
}

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
licences="$1"
out="$2"
# The executables of a release: ASSET_NAMES in scripts/exe/sea.ts, the matrix of publish-cli.yml.
executables=(pulse-cli-linux-x64 pulse-cli-linux-arm64 pulse-cli-macos-x64 pulse-cli-macos-arm64
  pulse-cli-windows-x64.exe)

for file in "$root/LICENSE" "$root/THIRD_PARTY_LICENSES.txt"; do
  [ -f "$file" ] || fail "$file does not exist"
done
[ -d "$licences" ] || fail "$licences is no folder"
for file in "$licences"/*; do
  case " ${executables[*]} " in
    *" $(basename "$file") "*) ;;
    *) fail "$file is the licence of no executable of the release (${executables[*]})" ;;
  esac
done

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
# One entry per licence text: the executables that ship it, the first one standing for the text.
texts=()
for executable in "${executables[@]}"; do
  file="$licences/$executable"
  [ -s "$file" ] || fail "$file does not exist or is empty: build:exe keeps the licence of the" \
    "Node.js an executable embeds, on an official Node.js build"
  tr -d '\r' <"$file" >"$work/$executable"
  for ((i = 0; i < ${#texts[@]}; i++)); do
    if cmp -s "$work/${texts[i]%% *}" "$work/$executable"; then
      texts[i]="${texts[i]} $executable"
      continue 2
    fi
  done
  texts+=("$executable")
done
if [ "${#texts[@]}" -ne 1 ]; then
  {
    echo "$0: the Node.js licences of the executables differ, line ends aside; one line per text:"
    printf '  %s\n' "${texts[@]}"
    echo "Build the executables on the older Node.js again (build:exe prints the version it embeds)."
  } >&2
  exit 1
fi

mkdir -p "$out"
install -m 0644 "$root/LICENSE" "$out/pulse-cli-LICENSE"
install -m 0644 "$root/THIRD_PARTY_LICENSES.txt" "$out/pulse-cli-THIRD_PARTY_LICENSES.txt"
install -m 0644 "$work/${executables[0]}" "$out/pulse-cli-NODE_LICENSE"
echo "The ${#executables[@]} executables share one Node.js licence; the licences of the release:"
ls -l "$out"/pulse-cli-LICENSE "$out"/pulse-cli-THIRD_PARTY_LICENSES.txt "$out"/pulse-cli-NODE_LICENSE
