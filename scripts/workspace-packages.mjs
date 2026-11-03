#!/usr/bin/env node
/**
 * Which workspace packages npm receives, and which of them are libraries: the one predicate the
 * release gate (check-github-config.mjs), the published-imports scan, the template drift gate
 * (test-template.sh, template-pins.mjs) and the starter mirror (sync-template-mirror.yml) read,
 * so a package added, moved or made private changes all of them through its manifest alone. Node
 * built-ins only: the mirror workflow runs it before any install.
 *
 *   node scripts/workspace-packages.mjs libraries   one `dir<TAB>name` line per library
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expandWorkspaceGlobs, workspaceGlobs } from "./check-package-scripts.mjs"

/** A VS Code extension: an app whose package.json declares engines.vscode. */
export const isVscodeExtension = (manifest) => manifest?.engines?.vscode !== undefined

/** Published to npm: not private and no VS Code extension, which ships as a .vsix instead. */
export const isNpmPublished = (manifest) =>
  manifest?.private !== true && !isVscodeExtension(manifest)

/**
 * A library: published to npm from packages/, what a composed server builds on. An app on npm
 * (the CLI) is an interface of its own that no server imports, so the template neither packs nor
 * waits for it.
 */
export const isPublishedLibrary = ({ dir, manifest }) =>
  isNpmPublished(manifest) && dir.startsWith("packages/")

/** Every workspace package as `{ dir, manifest }`, sorted by directory. */
export function readWorkspace(root) {
  const file = path.join(root, "pnpm-workspace.yaml")
  const globs = workspaceGlobs(readFileSync(file, "utf8"))
  // The shared expansion throws on a glob it cannot expand; no glob at all would read nothing.
  if (globs.length === 0) throw new Error(`${file} lists no packages: globs`)
  return expandWorkspaceGlobs(root, globs).map((dir) => ({
    dir,
    manifest: JSON.parse(readFileSync(path.join(root, dir, "package.json"), "utf8")),
  }))
}

/** The libraries of the workspace at `root` (see isPublishedLibrary), sorted by directory. */
export const publishedLibraries = (root) => readWorkspace(root).filter(isPublishedLibrary)

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const [command] = process.argv.slice(2)
  if (command !== "libraries") {
    console.error("usage: node scripts/workspace-packages.mjs libraries")
    process.exit(2)
  }
  const libraries = publishedLibraries(root)
  if (libraries.length === 0) {
    console.error(`No library is published from ${root}/packages: is the workspace still there?`)
    process.exit(1)
  }
  for (const { dir, manifest } of libraries) {
    console.log(`${dir}\t${manifest.name}`)
  }
}
