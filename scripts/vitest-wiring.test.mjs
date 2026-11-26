// @ts-check
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { after, describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { checkWorkspace, workspaceGlobs } from "./check-package-scripts.mjs"
import { MUTATION_PAUSED } from "./mutation-pause.mjs"
import { WIRING, checkVitestWiring, wiringFindings } from "./vitest-wiring.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/** A real package's config, the one the review planted its violation in. */
const ADAPTER = "packages/connectors/c7/c7-adapter/vitest.config.ts"
const ADAPTER_TEXT = readFileSync(path.join(repoRoot, ADAPTER), "utf8")
const SHARED_IMPORT = 'import { sharedConfig } from "../../../../vitest.shared"\n'

/** The adapter's config without sharedConfig, measuring with a coverage block of its own. */
const SELF_ENABLED = ADAPTER_TEXT.replace(SHARED_IMPORT, "")
  .replace("mergeConfig(\n  sharedConfig,", "mergeConfig(\n  {},")
  .replace("coverage: {", 'coverage: {\n        enabled: true,\n        provider: "v8",')

/** A config of the canonical shape, its import written as `specifier`, `extra` on line 3. */
const canonical = (/** @type {string} */ specifier, extra = "") =>
  [
    'import { defineConfig, mergeConfig } from "vitest/config"',
    `import { sharedConfig } from "${specifier}"`,
    extra,
    "export default mergeConfig(sharedConfig, defineConfig({ test: { coverage: {} } }))",
    "",
  ].join("\n")

/**
 * The finding of a config that is not wired, for `reason`.
 * @param {string} rel
 * @param {string} reason
 */
const unwired = (rel, reason) =>
  `${rel}: ${reason}, so its run misses what vitest.shared.ts hands every package's run: ` +
  "coverage switched on and the check that each floor follows its measurement and measures " +
  "something (scripts/coverage-floors.mjs); a `coverage.enabled: true` of the package's own " +
  `measures without that check. Write ${WIRING}`

describe("wiringFindings: a package's vitest.config.ts merges sharedConfig", () => {
  it("passes the canonical shape, its import with or without an extension and aliased", () => {
    assert.deepEqual(wiringFindings(ts, ADAPTER, ADAPTER_TEXT), [])
    for (const specifier of [
      "../../vitest.shared",
      "../../vitest.shared.js",
      "../../vitest.shared.ts",
    ])
      assert.deepEqual(wiringFindings(ts, "apps/cli/vitest.config.ts", canonical(specifier)), [])
    const aliased = canonical("../../vitest.shared")
      .replace("{ sharedConfig }", "{ sharedConfig as base }")
      .replace("mergeConfig(sharedConfig,", "mergeConfig(base,")
    assert.match(aliased, /\{ sharedConfig as base \}[\s\S]*mergeConfig\(base,/)
    assert.deepEqual(wiringFindings(ts, "apps/cli/vitest.config.ts", aliased), [])
  })

  it("fails a changed config that drops sharedConfig and switches coverage on itself", () => {
    assert.ok(!SELF_ENABLED.includes("sharedConfig") && SELF_ENABLED.includes("enabled: true"))
    assert.deepEqual(wiringFindings(ts, ADAPTER, SELF_ENABLED), [
      unwired(ADAPTER, "it imports no sharedConfig from the repository's vitest.shared.ts"),
    ])
  })

  it("fails every other shape: the base from elsewhere, another merge, another export", () => {
    const rel = "apps/cli/vitest.config.ts"
    const text = canonical("../../vitest.shared")
    for (const [label, changed, reason] of [
      [
        "a vitest.shared of the package's own",
        text.replace("../../vitest.shared", "./vitest.shared"),
        "it imports no sharedConfig from the repository's vitest.shared.ts",
      ],
      [
        "a type-only import",
        text.replace("{ sharedConfig }", "type { sharedConfig }"),
        "it imports no sharedConfig from the repository's vitest.shared.ts",
      ],
      [
        "Vite's mergeConfig",
        text.replace(
          'mergeConfig } from "vitest/config"',
          '} from "vitest/config"\nimport { mergeConfig } from "vite"',
        ),
        'it imports no mergeConfig from "vitest/config"',
      ],
      [
        "an empty base",
        text.replace("mergeConfig(sharedConfig,", "mergeConfig({},"),
        "its default export is not mergeConfig(sharedConfig, …)",
      ],
      [
        "the base second",
        text.replace(/mergeConfig\(sharedConfig, (.*)\)\n/, "mergeConfig($1, sharedConfig)\n"),
        "its default export is not mergeConfig(sharedConfig, …)",
      ],
      [
        "a spread whose test block replaces the base's",
        text.replace(/export default (mergeConfig.*)\n/, "export default { ...$1, test: {} }\n"),
        "its default export is not mergeConfig(sharedConfig, …)",
      ],
      [
        "the merge held in a const",
        text.replace("export default mergeConfig", "const config = mergeConfig") +
          "export default config\n",
        "its default export is not mergeConfig(sharedConfig, …)",
      ],
    ])
      assert.deepEqual(wiringFindings(ts, rel, changed), [unwired(rel, reason)], label)
  })

  it("fails a file that reaches the base beyond the merge, where code could change it", () => {
    const rel = "apps/cli/vitest.config.ts"
    const text = canonical("../../vitest.shared")
    const reaches = (/** @type {number} */ line) =>
      `${rel}: reaches sharedConfig beyond mergeConfig's first argument and a named import of ` +
      `it (line ${line}), where code could change what vitest.shared.ts hands the run before ` +
      "vitest reads it (the check that each floor follows its measurement among it). Name " +
      "sharedConfig only there, import nothing else of vitest.shared.ts, and set the package's " +
      "options in mergeConfig's second argument"
    for (const [label, changed, line] of /** @type {[string, string, number][]} */ ([
      [
        "a mutation before the export",
        canonical("../../vitest.shared", "sharedConfig.test.reporters.length = 0"),
        3,
      ],
      [
        "a mutation in the second argument",
        text.replace("{ test: {", "{ test: { reporters: sharedConfig.test.reporters.splice(0),"),
        4,
      ],
      [
        "a namespace import",
        canonical("../../vitest.shared", 'import * as shared from "../../vitest.shared.js"'),
        3,
      ],
      [
        "a dynamic import",
        canonical("../../vitest.shared", 'void import("../../vitest.shared")'),
        3,
      ],
    ]))
      assert.deepEqual(wiringFindings(ts, rel, changed), [reaches(line)], label)
    // A property of that name is no use of the binding.
    const property = canonical(
      "../../vitest.shared",
      "export const names = { sharedConfig: 1 }.sharedConfig",
    )
    assert.deepEqual(wiringFindings(ts, rel, property), [])
  })
})

const roots = /** @type {string[]} */ ([])
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

/**
 * A workspace with the given vitest configs (package dir → text, null for none), each package
 * with a package.json and src/; returns its root.
 * @param {Record<string, string | null>} configs
 */
function workspace(configs) {
  const root = mkdtempSync(path.join(tmpdir(), "vitest-wiring-"))
  roots.push(root)
  const write = (/** @type {string} */ file, /** @type {string} */ text) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), text)
  }
  write(
    "pnpm-workspace.yaml",
    'packages:\n  - "apps/*"\n  - "packages/core/*"\n  - "packages/connectors/*/*"\n',
  )
  for (const [dir, text] of Object.entries(configs)) {
    write(`${dir}/package.json`, JSON.stringify({ name: `@miragon/pulse-${path.basename(dir)}` }))
    write(`${dir}/src/index.ts`, "export {}\n")
    if (text !== null) write(`${dir}/vitest.config.ts`, text)
  }
  return root
}

/** @param {string} root */
const findingsOf = (root) => {
  const globs = workspaceGlobs(readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8"))
  return checkVitestWiring(
    ts,
    root,
    checkWorkspace(root, globs, { mutationPaused: true }).sourceDirs,
  )
}

describe("checkVitestWiring over the workspace's source packages", () => {
  const CLI = canonical("../../vitest.shared.js")
  const ADAPTER_DIR = path.posix.dirname(ADAPTER)

  it("passes wired packages and leaves a missing config to check-package-scripts.mjs", () => {
    assert.deepEqual(
      findingsOf(
        workspace({ "apps/cli": CLI, [ADAPTER_DIR]: ADAPTER_TEXT, "packages/core/x": null }),
      ),
      [],
    )
  })

  it("fails a changed package config and a new package's config that leave sharedConfig out", () => {
    const fresh = `import { defineConfig } from "vitest/config"
export default defineConfig({
  test: { coverage: { enabled: true, provider: "v8", thresholds: { lines: 90, statements: 90, functions: 90, branches: 90 } } },
})
`
    const reason = "it imports no sharedConfig from the repository's vitest.shared.ts"
    assert.deepEqual(
      findingsOf(
        workspace({ "apps/cli": CLI, [ADAPTER_DIR]: SELF_ENABLED, "packages/core/fresh": fresh }),
      ),
      [unwired(ADAPTER, reason), unwired("packages/core/fresh/vitest.config.ts", reason)],
    )
  })

  it("real repo: every source package's config merges sharedConfig", () => {
    const globs = workspaceGlobs(readFileSync(path.join(repoRoot, "pnpm-workspace.yaml"), "utf8"))
    const { sourceDirs } = checkWorkspace(repoRoot, globs, { mutationPaused: MUTATION_PAUSED })
    assert.ok(sourceDirs.includes("apps/cli") && sourceDirs.includes(ADAPTER_DIR))
    assert.deepEqual(checkVitestWiring(ts, repoRoot, sourceDirs), [])
  })
})
