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
import { INTERFACE_PACKAGES } from "./source-scan.mjs"

/** The outputs of the `changes` job. */
export const SCOPES = [
  "typescript",
  "mcp",
  "mcp-engines",
  "template",
  "starter-engine",
  "cli",
  "vscode",
  "vscode-package",
  "orca",
  "cibseven-example",
  "brand",
  "plugins",
]

/** The apps that ship a Claude Code plugin (apps/<app>/skills/<plugin>/.claude-plugin/plugin.json). */
export const PLUGIN_APPS = ["cli", "mcp-server", "vscode"]

const PROSE = /\.(?:md|png|jpe?g|gif|webp)$/

/** Prose under these dirs is read by tests, so it counts as code. */
const PACKAGE_CODE = /(?:^|\/)(?:src|test|test-host|dev|scripts)\//

/** Paths outside the packages; first match wins, no match runs everything. */
export const PATH_RULES = [
  { pattern: /^(?:\.github\/workflows\/ci\.yml$|\.github\/actions\/|scripts\/)/, scopes: SCOPES },
  // Checked by lint:github, and licence tests read workflows: the CLI's release licence test
  // publish-cli.yml (apps/cli/scripts/release-licenses.test.ts), the server image's licence test
  // docker-build.yml (apps/mcp-server/test/third-party-licenses.test.ts), Pulse for VS Code's
  // publish-vscode-extension.yml (apps/vscode/test/architecture/third-party-licenses.test.ts),
  // Pulse for Orca's publish-orca-plugin.yml (apps/orca/test/third-party-licenses.test.ts): this
  // scope runs them.
  { pattern: /^\.github\//, scopes: ["typescript"] },
  // Read by the CLI's tests and bundled into the CLI as its guide topics.
  { pattern: /^docs\/cli\//, scopes: ["typescript", "brand", "cli"] },
  // Read by the token drift scan (pulse-ui).
  { pattern: /^docs\/.*\.css$/, scopes: ["brand", "typescript"] },
  // Linted by lint:configs.
  { pattern: /^docs\/\.vitepress\/(?:config|theme\/index)\.ts$/, scopes: ["brand", "typescript"] },
  // Read by scripts/local-env.test.mjs: the second worktree's command.
  { pattern: /^docs\/mcp\/developer\.md$/, scopes: ["brand", "typescript"] },
  // Generated from @miragon/pulse-ui/glossary, whose page test (pulse-ui) holds it to the data.
  { pattern: /^docs\/glossary\.md$/, scopes: ["brand", "typescript"] },
  // A generic extra-file of release-please: lint:github holds the version it marks (the release
  // tag a copy of the template is cloned from) to the release's.
  { pattern: /^docs\/mcp\/claude-artifacts\.md$/, scopes: ["brand", "typescript"] },
  { pattern: /^docs\//, scopes: ["brand"] },
  // Read by scripts/server-env-names.test.mjs.
  { pattern: /^\.env\.example$/, scopes: ["typescript"] },
  { pattern: /^README\.md$/, scopes: ["brand"] },
  { pattern: /^[^/]+\.md$/, scopes: [] },
  // Read by pulse-ui's token tests (cd-tokens.test.ts, token-drift.test.ts); CI checks the sums too.
  { pattern: /^\.miragon\/brand-assets\.(?:yaml|sha256)$/, scopes: ["brand", "typescript"] },
  // The journeys: Pulse for VS Code's harness-isolation.test.ts reads that they start VS Code
  // through the screenshot driver.
  { pattern: /^\.miragon\/shots\//, scopes: ["brand", "typescript"] },
  { pattern: /^\.miragon\//, scopes: ["brand"] },
  { pattern: /^\.claude\//, scopes: [] },
  // The marketplace: the plugins job validates it and every plugin it lists, and the MCP server's
  // plugin test (the TypeScript job) reads that it lists the server's plugin.
  { pattern: /^\.claude-plugin\//, scopes: ["plugins", "typescript"] },
  // The shared editor settings: only the always-on format check reads them.
  { pattern: /^\.vscode\//, scopes: [] },
  { pattern: /^playground\/cibseven-example\//, scopes: ["cibseven-example"] },
  // Read by scripts/local-env.test.mjs (the Compose file, the engines of the playground's board).
  { pattern: /^playground\/(?:docker|boards)\//, scopes: ["typescript"] },
  { pattern: /^playground\//, scopes: [] },
  // The starter's try-out engine: its own job starts it; the template's format check reads it.
  {
    pattern: /^templates\/composed-server\/compose\.yaml$/,
    scopes: ["starter-engine", "template", "typescript"],
  },
  // The fixture module's document: test:host renders it too (own-view-module.ts).
  {
    pattern: /^templates\/fixtures\/prebuilt-module\/src\/board\.html$/,
    scopes: ["mcp", "template", "typescript"],
  },
  // The Claude artifact's agent file and README: the MCP server's plugin test reads the tools the
  // agent file names, and lint:github holds the release tag the README marks (a generic
  // extra-file of release-please); docs-refs reads both in its always-on job.
  { pattern: /^templates\/claude-artifact\/(?:CLAUDE|README)\.md$/, scopes: ["typescript"] },
  { pattern: /^templates\/.*\.(?:md|png|jpe?g|gif|webp)$/, scopes: [] },
  // The token drift scan (pulse-ui) reads them; the template's own job tests them.
  { pattern: /^templates\//, scopes: ["template", "typescript"] },
]

/** Package files that checks outside the package read too. */
export const ALSO_READ_BY = [
  { pattern: /^apps\/cli\/README\.md$/, scopes: ["brand"] },
  // pulse-ui's README: its browser chat suite (src/browser-chat.test.ts) renders the example of
  // "Use in a page without a build" over the bundle, so the example it shows is one that runs.
  { pattern: /^packages\/core\/ui\/README\.md$/, scopes: ["typescript"] },
  // widget-shell's README: its browser page suite renders the example of "Use in a page without a
  // build" over its browser bundle in Chromium, so the example it shows is one that runs.
  { pattern: /^packages\/core\/widget-shell\/README\.md$/, scopes: ["typescript"] },
  // The Claude Code plugins the apps ship (apps/<app>/skills/<plugin>, each listed in
  // .claude-plugin/marketplace.json): the plugins job validates each and holds its version to its
  // app's manifest (PLUGIN_APPS). The MCP server's own tests read its plugin, prose included (the
  // plugin test): the TypeScript job runs them, while the package rules leave its prose to none.
  // The CLI's prose is code by the package rules.
  { pattern: /^apps\/mcp-server\/skills\//, scopes: ["plugins", "typescript"] },
  {
    pattern: new RegExp(`^apps/(?:${PLUGIN_APPS.join("|")})/(?:skills/|package\\.json$)`),
    scopes: ["plugins"],
  },
  // The docs package's manifest: the CLI bundles pages of it, so its licence test reads its
  // name and licence; it pins the docs kit (@miragon/docs-starter), whose tokens the token
  // drift test (pulse-ui) reads.
  { pattern: /^docs\/package\.json$/, scopes: ["cli", "typescript"] },
  // The one Camunda 7 REST spec, its patches and its route table, read as files: c7-client's
  // generate (the SDK, which the MCP server and the template build on) and the CLI's catalog
  // test read the patched spec c7-core's generate writes from them, and the licence tests of the
  // CLI and of c7-client the spec's info, texts, LICENSE and NOTICE. The MCP server's engine
  // suite sends through that SDK by that table (the rule below).
  {
    pattern: /^packages\/connectors\/c7\/c7-core\/(?:spec\/|src\/generated\/routes\.json$)/,
    scopes: ["cli", "mcp", "mcp-engines", "template", "typescript"],
  },
  // What the MCP server's engine suite runs (the connector's test:engines in the Engines legs):
  // c7-core's src (its runtime, the port and routes it reads by, its seed, its recorded board) and
  // the world's diagrams, the SDK, c8-core's src and world (the runtime the connector builds per
  // call for a Camunda 8 engine, the seed and the diagrams of the connector's Camunda 8 suite,
  // which those legs load and skip, since CI starts no Camunda 8 image until #531), engine-core's
  // conformance kit, the transport, the profile
  // format, the board package (its format and builder), and the connector's engine port and
  // connection, its runtime per dialect with the providers and the flavor table it picks one by,
  // the board feed's build (its board files, src/data/board-*.ts and the one XML read it draws a
  // diagram by), the instance list's build whose "With incident" chip the suite holds to a board's
  // counter (src/data/cockpit-data.ts and the reads it builds on), its manifest and its vitest
  // configs. Any other change of these packages leaves the suite off.
  {
    pattern: new RegExp(
      "^packages/(?:" +
        [
          "connectors/c7/c7-core/(?:src|world)/",
          "connectors/c7/c7-client/src/",
          "connectors/c8/c8-core/(?:src|world)/",
          "connectors/engine/engine-core/src/",
          "core/http/src/",
          "core/profile/src/",
          "core/board/src/",
          "connectors/engine/engine-connector/(?:src/lib/(?:core-adapter|engine)/|src/providers/|src/engine-provider\\.ts$|package\\.json$|vitest\\.(?:engines\\.)?config\\.ts$)",
          "connectors/engine/engine-connector/src/(?:board-files\\.ts|data/(?:board-[\\w.-]+|cockpit-data|definition-info|engine-reads)\\.ts|lib/bpmn/definition-xml\\.ts)$",
        ].join("|") +
        ")",
    ),
    scopes: ["mcp-engines"],
  },
]

export function packageScopes(dir) {
  const scopes = ["typescript"]
  const interfacePackage = INTERFACE_PACKAGES.some((name) => dir === `packages/${name}`)
  if (dir.startsWith("packages/") && !interfacePackage) scopes.push("mcp", "template")
  // The web app shows the MCP views on pages of the server: the MCP jobs run its suites.
  if (dir === "apps/mcp-server" || dir === "apps/web") scopes.push("mcp")
  if (dir === "apps/cli") scopes.push("cli")
  if (dir === "apps/vscode") scopes.push("vscode", "vscode-package")
  if (dir === "apps/orca") scopes.push("orca")
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
