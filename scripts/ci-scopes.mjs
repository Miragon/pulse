#!/usr/bin/env node
/**
 * The CI scopes a pull request needs, as outputs of ci.yml's `changes` job. Fails closed: a push,
 * a shared input or an unknown path turns on every scope.
 */
import { execFileSync } from "node:child_process"
import { appendFileSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expandWorkspaceGlobs, workspaceGlobs } from "./check-package-scripts.mjs"

/** The outputs of the `changes` job. */
export const SCOPES = [
  "typescript",
  "mcp",
  "template",
  "cli",
  "vscode",
  "vscode-package",
  "kotlin",
  "cibseven-example",
  "brand",
]

const PROSE = /\.(?:md|png|jpe?g|gif|webp)$/

/** Prose under these dirs is read by tests, so it counts as code. */
const PACKAGE_CODE = /(?:^|\/)(?:src|test|test-host|dev|scripts)\//

/** Paths outside the packages; first match wins, no match runs everything. */
export const PATH_RULES = [
  { pattern: /^(?:\.github\/workflows\/ci\.yml$|\.github\/actions\/|scripts\/)/, scopes: SCOPES },
  // Checked by lint:github only.
  { pattern: /^\.github\//, scopes: ["typescript"] },
  // Read by the CLI's tests.
  { pattern: /^docs\/cli\//, scopes: ["typescript", "brand"] },
  // Read by the token drift test.
  { pattern: /^docs\/\.vitepress\/miragon\//, scopes: ["typescript", "brand"] },
  { pattern: /^docs\//, scopes: ["brand"] },
  // Read by setup-env.test.ts.
  { pattern: /^\.env\.example$/, scopes: ["typescript"] },
  { pattern: /^README\.md$/, scopes: ["brand"] },
  { pattern: /^[^/]+\.md$/, scopes: [] },
  { pattern: /^\.miragon\//, scopes: ["brand"] },
  { pattern: /^(?:\.claude|\.conductor)\//, scopes: [] },
  { pattern: /^\.claude-plugin\//, scopes: ["cli"] },
  { pattern: /^engine-plugins\//, scopes: ["kotlin"] },
  { pattern: /^playground\/cibseven-example\//, scopes: ["cibseven-example"] },
  // Read by the metrics contract tests.
  { pattern: /^playground\/docker\//, scopes: ["typescript"] },
  { pattern: /^playground\//, scopes: [] },
  { pattern: /^templates\/.*\.(?:md|png|jpe?g|gif|webp)$/, scopes: [] },
  // brand.css is read by the stylesheet test.
  { pattern: /^templates\//, scopes: ["template", "typescript"] },
]

/** Package files that checks outside the package read too. */
export const ALSO_READ_BY = [
  {
    pattern: /^packages\/connectors\/analytics\/analytics-client\/metrics-contract\.json$/,
    scopes: ["kotlin"],
  },
  { pattern: /^apps\/cli\/README\.md$/, scopes: ["brand"] },
]

export function packageScopes(dir) {
  const scopes = ["typescript"]
  if (dir.startsWith("packages/")) scopes.push("mcp", "template")
  if (dir === "apps/mcp-server-camunda7") scopes.push("mcp")
  if (dir === "apps/cli") scopes.push("cli")
  if (dir === "apps/vscode") scopes.push("vscode", "vscode-package")
  return scopes
}

/** Only the .vsix reads the extension's listing. */
const packageProseScopes = (dir) => (dir === "apps/vscode" ? ["vscode-package"] : [])

/** The CLI's tests read its README and skills. */
const proseIsCode = (dir) => dir === "apps/cli"

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
]

/** `changed` plus all transitive dependents. */
export function withDependents(changed, packages) {
  const dirOf = new Map(packages.map(({ dir, manifest }) => [manifest.name, dir]))
  const dependents = new Map()
  for (const { dir, manifest } of packages) {
    for (const field of DEPENDENCY_FIELDS) {
      for (const name of Object.keys(manifest[field] ?? {})) {
        const dependency = dirOf.get(name)
        if (dependency === undefined) continue
        if (!dependents.has(dependency)) dependents.set(dependency, new Set())
        dependents.get(dependency).add(dir)
      }
    }
  }
  const affected = new Set(changed)
  const queue = [...changed]
  while (queue.length > 0) {
    for (const dependent of dependents.get(queue.pop()) ?? []) {
      if (affected.has(dependent)) continue
      affected.add(dependent)
      queue.push(dependent)
    }
  }
  return affected
}

const firstMatch = (rules, file) => rules.find(({ pattern }) => pattern.test(file))

const packageOf = (file, packages) => packages.find(({ dir }) => file.startsWith(`${dir}/`))

export function scopesFor(files, packages) {
  const scopes = new Set()
  const changedPackages = new Set()
  for (const file of files) {
    for (const scope of firstMatch(ALSO_READ_BY, file)?.scopes ?? []) scopes.add(scope)
    const rule = firstMatch(PATH_RULES, file)
    const owner = rule === undefined ? packageOf(file, packages) : undefined
    if (rule !== undefined) {
      for (const scope of rule.scopes) scopes.add(scope)
    } else if (owner === undefined) {
      return new Set(SCOPES)
    } else if (
      PROSE.test(file) &&
      !PACKAGE_CODE.test(file.slice(owner.dir.length + 1)) &&
      !proseIsCode(owner.dir)
    ) {
      for (const scope of packageProseScopes(owner.dir)) scopes.add(scope)
    } else {
      changedPackages.add(owner.dir)
    }
  }
  for (const dir of withDependents(changedPackages, packages)) {
    for (const scope of packageScopes(dir)) scopes.add(scope)
  }
  return scopes
}

/** Files the PR's merge commit changes, or undefined without one. */
export function mergeCommitFiles(git) {
  try {
    git(["rev-parse", "--verify", "--quiet", "HEAD^2"])
  } catch {
    return undefined
  }
  return git(["diff", "--name-only", "HEAD^1", "HEAD"]).split("\n").filter(Boolean)
}

function readWorkspace(root) {
  const globs = workspaceGlobs(readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8"))
  return expandWorkspaceGlobs(root, globs).map((dir) => ({
    dir,
    manifest: JSON.parse(readFileSync(path.join(root, dir, "package.json"), "utf8")),
  }))
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8" })
  const files = process.env.GITHUB_EVENT_NAME === "pull_request" ? mergeCommitFiles(git) : undefined
  const scopes = files === undefined ? new Set(SCOPES) : scopesFor(files, readWorkspace(root))
  const reason =
    files === undefined
      ? "not a pull request merge commit: every scope"
      : `${files.length} changed files`
  console.log(`CI scopes (${reason}):`)
  for (const scope of SCOPES) console.log(`  ${scopes.has(scope) ? "run " : "skip"} ${scope}`)
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      SCOPES.map((scope) => `${scope}=${scopes.has(scope)}\n`).join(""),
    )
  }
}
