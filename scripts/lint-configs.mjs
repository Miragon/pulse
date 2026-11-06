#!/usr/bin/env node
/**
 * ESLint over the standalone config files typescript-eslint's default project types
 * (DEFAULT_PROJECT_FILES in eslint.config.mjs). Every package lints its source dirs, so nothing else
 * in `pnpm lint` reaches them and the pre-commit hook would be their only linter: an error in one
 * would surface on someone's unrelated commit.
 *
 * Runs as `pnpm lint:configs` (chained into the root `pnpm lint`, after `turbo run lint`: typed
 * linting needs the workspace packages' built types). Run alone before a build, it names the types
 * that are missing and says to build first.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { ESLint } from "eslint"
import { DEFAULT_PROJECT_FILES } from "../eslint.config.mjs"
import { readWorkspace } from "./workspace-packages.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/** `from "x"` and a bare `import "x"`, the import forms a config file uses. */
const IMPORT_SPECIFIER = /\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']/g

/** The package a bare specifier names: `@scope/name` or `name`, without the subpath. */
const packageOf = (specifier) =>
  specifier
    .split("/")
    .slice(0, specifier.startsWith("@") ? 2 : 1)
    .join("/")

/** The types file a package.json exports for `subpath` (`.` or `./server`), if it names one. */
function typesFor(manifest, subpath) {
  const { exports } = manifest
  if (exports === undefined) return subpath === "." ? manifest.types : undefined
  const entry =
    typeof exports === "string" ? (subpath === "." ? exports : undefined) : exports[subpath]
  return typeof entry === "string" ? entry : entry?.types
}

/**
 * Every import of a workspace package in `files`, with the types file (repo-relative) its
 * package.json exports for it. Typed linting reads a workspace package through those types, which
 * `pnpm build` writes; without them it reports the import as an error-typed value (no-unsafe-*)
 * and never says that a build is missing.
 */
export function workspaceTypeImports(root, files, workspace = readWorkspace(root)) {
  const packages = new Map(workspace.map((pkg) => [pkg.manifest.name, pkg]))
  const imports = []
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), "utf8")
    for (const [, from, bare] of source.matchAll(IMPORT_SPECIFIER)) {
      const specifier = from ?? bare
      const pkg = packages.get(packageOf(specifier))
      if (!pkg) continue
      const types = typesFor(pkg.manifest, `.${specifier.slice(pkg.manifest.name.length)}`)
      if (types) imports.push({ file, specifier, types: path.posix.join(pkg.dir, types) })
    }
  }
  return imports
}

/** The imports among `imports` whose types file is not on disk, one line each, or none. */
export const unbuiltTypes = (root, imports) =>
  imports
    .filter(({ types }) => !fs.existsSync(path.join(root, types)))
    .map(({ file, specifier, types }) => `${file} imports ${specifier}: ${types} is not built`)

/**
 * ESLint's report over `files`, and whether it is clean. A warning is not clean: an ignored file
 * comes back as one, with no error, and would drop out of the gate unnoticed. No file fails too, a
 * gate over nothing would stay green.
 */
export async function lintConfigs(files, eslint) {
  if (files.length === 0) {
    return { clean: false, report: "lint:configs: no files to lint in DEFAULT_PROJECT_FILES" }
  }
  const results = await eslint.lintFiles(files)
  const formatter = await eslint.loadFormatter("stylish")
  return {
    clean: results.every((result) => result.errorCount + result.warningCount === 0),
    report: await formatter.format(results),
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMain) {
  const unbuilt = unbuiltTypes(repoRoot, workspaceTypeImports(repoRoot, DEFAULT_PROJECT_FILES))
  if (unbuilt.length > 0) {
    console.error(
      `lint:configs lints with the workspace packages' built types, and these are missing:\n` +
        unbuilt.map((line) => `  ${line}\n`).join("") +
        "Run pnpm build first.",
    )
    process.exit(1)
  }
  const eslint = new ESLint({ cwd: repoRoot })
  const { clean, report } = await lintConfigs(DEFAULT_PROJECT_FILES, eslint)
  if (!clean) {
    console.error(report)
    process.exit(1)
  }
  console.log(`Config files: ESLint is clean over all ${DEFAULT_PROJECT_FILES.length}.`)
}
