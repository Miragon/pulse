#!/usr/bin/env bash
set -euo pipefail

# Drift gate for templates/composed-server: builds the seven published packages
# from THIS workspace, packs them into tarballs (pnpm pack rewrites
# workspace:* to real versions), points a throwaway copy of the template at
# the tarballs via pnpm overrides, and runs the template's full bar. Catches
# "the template no longer compiles against the packages we are about to
# release" before the release train publishes to npm. Run from anywhere;
# leaves the working tree untouched.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$ROOT/templates/composed-server"
PACK_DIR="$(mktemp -d)"
WORK="$(mktemp -d)/composed-server"

# Package directories under packages/; npm names come from each package.json.
PACKAGES=(
  core/engine-core
  core/ui
  core/widget-shell
  connectors/engine/engine-client
  connectors/engine/engine-connector
  connectors/analytics/analytics-client
  connectors/analytics/analytics-connector
)

pkg_name() { node -p "require('$ROOT/packages/$1/package.json').name"; }

# The template's committed @miragon/pulse-* pins must match the workspace versions:
# release-please bumps both together via extra-files; a drifted pin means an
# extra-files entry is missing and customers would install a stale release.
# A dependency the check does not know would slip past it: one under the old
# @miragon-ai scope (renamed in #415) or a @miragon/pulse-* name the workspace
# does not publish would install whatever npm holds under that name (the old
# scope's last release, 0.20.0) and stay green. Both fail, in every
# package.json of the template (server, modules, root).
# mcp-use is checked too: it is exact in every stanza, peers included (a drifted
# second instance resurrects the duplicate-React-context hang). release-please
# does NOT bump it, so a repo-wide mcp-use bump must include the template by
# hand. The engine connector's pin is the canonical one.
ROOT="$ROOT" node - <<'EOF'
const fs = require("fs")
const root = process.env.ROOT
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"))
const pkgDirs = [
  "core/engine-core",
  "core/ui",
  "core/widget-shell",
  "connectors/engine/engine-client",
  "connectors/engine/engine-connector",
  "connectors/analytics/analytics-client",
  "connectors/analytics/analytics-connector",
]
const versions = Object.fromEntries(
  pkgDirs
    .map((p) => read(`${root}/packages/${p}/package.json`))
    .map((pj) => [pj.name, pj.version]),
)
const engine = read(`${root}/packages/connectors/engine/engine-connector/package.json`)
const MCP_USE = engine.peerDependencies?.["mcp-use"]
if (!MCP_USE || MCP_USE !== engine.devDependencies?.["mcp-use"]) {
  console.error(
    `The engine connector must pin mcp-use exactly, peer and dev alike ` +
      `(peer ${MCP_USE}, dev ${engine.devDependencies?.["mcp-use"]}).`,
  )
  process.exit(1)
}
// Every package.json of the template, found on disk: a module added later is
// checked without an edit here.
const templateRoot = `${root}/templates/composed-server`
const SKIP_DIRS = new Set(["node_modules", "dist", ".mcp-use"])
const templateManifests = (dir, rel = "") =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      return SKIP_DIRS.has(entry.name) ? [] : templateManifests(`${dir}/${entry.name}`, path)
    }
    return entry.name === "package.json" ? [path] : []
  })
const manifests = templateManifests(templateRoot).sort()
if (!manifests.includes("server/package.json")) {
  console.error(`No server/package.json under ${templateRoot}: is the template still there?`)
  process.exit(1)
}
const OLD_SCOPE = "@miragon-ai/"
const PRODUCT_SCOPE = "@miragon/pulse-"
const bad = []
const unknown = []
for (const file of manifests) {
  const pj = read(`${templateRoot}/${file}`)
  for (const stanza of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    for (const [name, pin] of Object.entries(pj[stanza] ?? {})) {
      if (name.startsWith(OLD_SCOPE)) {
        unknown.push(`${file} (${stanza}): ${name} is the old scope, renamed to ${PRODUCT_SCOPE}*`)
        continue
      }
      if (name.startsWith(PRODUCT_SCOPE) && !(name in versions)) {
        unknown.push(`${file} (${stanza}): ${name} is no package of this workspace`)
        continue
      }
      const expected = versions[name] ?? (name === "mcp-use" ? MCP_USE : undefined)
      if (expected && pin !== expected) {
        bad.push(`${file} (${stanza}): ${name} pinned ${pin}, workspace is ${expected}`)
      }
    }
  }
}
if (unknown.length) {
  console.error(
    "Template depends on packages this workspace does not publish (pnpm would install " +
      "whatever npm holds under that name; known: " +
      Object.keys(versions).join(", ") +
      "):\n" +
      unknown.join("\n"),
  )
}
if (bad.length) {
  console.error(
    "Template pins drifted from the workspace versions (missing release-please extra-files " +
      "entry, or an mcp-use bump that skipped the template?):\n" +
      bad.join("\n"),
  )
}
if (unknown.length || bad.length) process.exit(1)
EOF

# Build what the tarballs ship (files: dist [+ src]).
FILTERS=()
for p in "${PACKAGES[@]}"; do FILTERS+=("--filter" "$(pkg_name "$p")"); done
pnpm --dir "$ROOT" exec turbo run build "${FILTERS[@]}"

for p in "${PACKAGES[@]}"; do
  base="$(basename "$p")"
  mkdir -p "$PACK_DIR/$base"
  (cd "$ROOT/packages/$p" && pnpm pack --pack-destination "$PACK_DIR/$base" >/dev/null)
done

rsync -a --exclude node_modules --exclude dist --exclude .mcp-use "$TEMPLATE/" "$WORK/"

# Overrides beat both the template's direct pins and the transitive
# @miragon/pulse-* ranges inside the packed packages.
{
  echo ""
  echo "overrides:"
  for p in "${PACKAGES[@]}"; do
    base="$(basename "$p")"
    tgz=("$PACK_DIR/$base"/*.tgz)
    echo "  \"$(pkg_name "$p")\": \"file:${tgz[0]}\""
  done
} >> "$WORK/pnpm-workspace.yaml"

cd "$WORK"
pnpm install --no-frozen-lockfile
pnpm build
pnpm typecheck
pnpm test

echo "test-template: OK"
