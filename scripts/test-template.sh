#!/usr/bin/env bash
set -euo pipefail

# Drift gate for templates/composed-server: builds the published libraries
# from THIS workspace, packs them into tarballs (pnpm pack rewrites
# workspace:* to real versions), points a throwaway copy of the template at
# the tarballs via pnpm overrides, and runs the template's full bar. Catches
# "the template no longer compiles against the packages we are about to
# release" before the release train publishes to npm, and a file the bar or
# `pnpm dev` writes that the template's own .gitignore misses. Run from
# anywhere; leaves the working tree untouched.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$ROOT/templates/composed-server"
PACK_DIR="$(mktemp -d)"
WORK="$(mktemp -d)/composed-server"

# The libraries a composed server builds on, from the workspace itself
# (scripts/workspace-packages.mjs: published to npm from packages/, the same
# predicate the release gate and the mirror workflow read): a package added,
# moved or made private changes this list through its manifest alone.
LIBRARIES="$(node "$ROOT/scripts/workspace-packages.mjs" libraries)"
PACKAGES=()
NAMES=()
while IFS=$'\t' read -r dir name; do
  PACKAGES+=("$dir")
  NAMES+=("$name")
done <<<"$LIBRARIES"
if ((${#PACKAGES[@]} == 0)); then
  echo "test-template: no library found under $ROOT/packages" >&2
  exit 1
fi

# The template's pins must equal the workspace's: the @miragon/pulse-* libraries
# (release-please bumps them via extra-files), mcp-use, react, react-dom, zod,
# lucide-react and @tanstack/react-query (scripts/template-pins.mjs says why).
node "$ROOT/scripts/template-pins.mjs"

# Build what the tarballs ship (files: dist [+ src]).
FILTERS=()
for name in "${NAMES[@]}"; do FILTERS+=("--filter" "$name"); done
pnpm --dir "$ROOT" exec turbo run build "${FILTERS[@]}"

for p in "${PACKAGES[@]}"; do
  base="$(basename "$p")"
  mkdir -p "$PACK_DIR/$base"
  (cd "$ROOT/$p" && pnpm pack --pack-destination "$PACK_DIR/$base" >/dev/null)
done

# What the tarballs ship: no tests, every entry and every relative import inside
# (scripts/pack-contents.mjs).
node "$ROOT/scripts/pack-contents.mjs" "$PACK_DIR"/*/*.tgz

rsync -a --exclude node_modules --exclude dist --exclude .mcp-use "$TEMPLATE/" "$WORK/"

# Overrides beat both the template's direct pins and the transitive
# @miragon/pulse-* ranges inside the packed packages.
{
  echo ""
  echo "overrides:"
  for i in "${!PACKAGES[@]}"; do
    base="$(basename "${PACKAGES[$i]}")"
    tgz=("$PACK_DIR/$base"/*.tgz)
    echo "  \"${NAMES[$i]}\": \"file:${tgz[0]}\""
  done
} >> "$WORK/pnpm-workspace.yaml"

# A starter repo has only the template's own .gitignore: the monorepo's root one
# hides generated files here that would dirty it. The copy (outside the
# monorepo) becomes a git repo of its own, its files staged before the bar; a
# file the bar leaves that is neither staged nor ignored fails below. The
# user's global excludes stay out, so a local run sees what CI sees.
git_work() { git -C "$WORK" -c core.excludesFile=/dev/null "$@"; }
git_work init -q
git_work add -A

cd "$WORK"
pnpm install --no-frozen-lockfile
pnpm build
pnpm typecheck
pnpm test

# pnpm-lock.yaml is the one new file a starter repo commits (its Dockerfile
# installs with --frozen-lockfile).
LEFT="$(git_work ls-files --others --exclude-standard | grep -vx 'pnpm-lock.yaml' || true)"
if [[ -n "$LEFT" ]]; then
  echo "test-template: install, build, typecheck and test left files that templates/composed-server/.gitignore does not ignore, so a fresh starter repo shows them as changes:" >&2
  echo "$LEFT" >&2
  exit 1
fi
# `mcp-use dev` writes mcp-env.d.ts next to the server entry on every `pnpm dev`;
# the bar above never runs it.
if ! git_work check-ignore -q server/mcp-env.d.ts; then
  echo "test-template: templates/composed-server/.gitignore does not ignore mcp-env.d.ts, which every \`pnpm dev\` writes to server/; add the line." >&2
  exit 1
fi

echo "test-template: OK"
