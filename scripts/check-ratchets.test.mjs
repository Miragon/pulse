import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { after, describe, it } from "node:test"
import { BaseCoverageProvider } from "vitest/node"
import {
  EXCEPTION_TRAILER,
  checkRatchetFile,
  compareSuppressions,
  extractEslintRatchets,
  extractVitestCoverage,
  isPullRequest,
  ratchetKind,
  resolveBaseRef,
  run,
  suppressionDirectives,
  TEMPLATE_PRETTIER,
  violationKey,
} from "./check-ratchets.mjs"

/**
 * Negative tests for the ratchet self-protection: every forbidden direction
 * must produce a violation, every allowed one must not. The direction
 * policy lives in the pure `checkRatchetFile`; the CLI (merge-base resolution,
 * the per-commit replay that scopes the trailer escape) runs here against
 * synthetic git repositories and in `pnpm lint` against this one.
 */

const vitestConfig = ({ thresholds, exclude = "", extra = "" }) => `
import { defineConfig, mergeConfig } from "vitest/config"
import { sharedConfig } from "../../vitest.shared"
export default mergeConfig(sharedConfig, defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      // Ratchet: frozen 2 points under the baseline.
      ${exclude}
      ${thresholds}
      ${extra}
    },
  },
}))
`
const PKG_VITEST = "packages/connectors/c7/c7-client/vitest.config.ts"
const BASE_THRESHOLDS = "thresholds: { statements: 44, branches: 32, functions: 45, lines: 44 },"
// The apps and a new connector-family package: the ratchet covers each by its layout.
const CLI_DIR = "apps/cli"
const VSCODE_DIR = "apps/vscode"
const FAMILY_DIR = "packages/connectors/fam/x-connector"
const REAL_VITEST_CONFIGS = [
  "apps/mcp-server/vitest.config.ts",
  "packages/core/widget-shell/vitest.config.ts",
  "packages/connectors/c7/c7-client/vitest.config.ts",
  "packages/connectors/engine/engine-connector/vitest.config.ts",
]

describe("ratchetKind", () => {
  it("recognises every monitored location and nothing else", () => {
    assert.equal(ratchetKind("apps/mcp-server/vitest.config.ts"), "vitest")
    assert.equal(ratchetKind("packages/core/widget-shell/vitest.config.ts"), "vitest")
    assert.equal(ratchetKind(PKG_VITEST), "vitest")
    assert.equal(ratchetKind("vitest.shared.ts"), "vitest")
    assert.equal(ratchetKind("packages/core/widget-shell/stryker.config.json"), "stryker")
    assert.equal(ratchetKind("eslint.config.mjs"), "eslint")
    assert.equal(ratchetKind("knip.jsonc"), "knip")
    assert.equal(ratchetKind("apps/mcp-server/test/__golden__/char-budgets.json"), "char-budgets")
    assert.equal(ratchetKind("apps/mcp-server/test/__golden__/bundle-budget.json"), "bundle-budget")
    assert.equal(ratchetKind("apps/vscode/test/__golden__/bundle-budget.json"), "bundle-budget")
    assert.equal(ratchetKind("apps/cli/test/__golden__/bundle-budget.json"), "bundle-budget")
    assert.equal(ratchetKind("package.json"), "root-scripts")
    assert.equal(ratchetKind("packages/core/widget-shell/package.json"), "package-scripts")
    assert.equal(ratchetKind("apps/mcp-server/package.json"), "package-scripts")
    assert.equal(ratchetKind("packages/core/widget-shell/vitest.stryker.config.ts"), null)
    assert.equal(ratchetKind("templates/composed-server/vitest.config.ts"), null)
  })

  it("covers the CLI, the extension and a new connector-family package", () => {
    for (const pkg of [CLI_DIR, VSCODE_DIR, FAMILY_DIR]) {
      assert.equal(ratchetKind(`${pkg}/vitest.config.ts`), "vitest", pkg)
      assert.equal(ratchetKind(`${pkg}/stryker.config.json`), "stryker", pkg)
      assert.equal(ratchetKind(`${pkg}/package.json`), "package-scripts", pkg)
    }
    // The docs workspace: only its manifest's `prettier` key is checked.
    assert.equal(ratchetKind("docs/package.json"), "workspace-manifest")
  })

  it("checks only the `prettier` key of the starter's manifests, none inside node_modules", () => {
    for (const rel of [
      "templates/composed-server/package.json",
      "templates/composed-server/server/package.json",
      "templates/composed-server/modules/mcp-notes/package.json",
    ])
      assert.equal(ratchetKind(rel), "template-manifest", rel)
    for (const rel of [
      "templates/composed-server/node_modules/prettier/package.json",
      "templates/composed-server/server/node_modules/zod/package.json",
    ])
      assert.equal(ratchetKind(rel), null, rel)
  })
})

describe("shadowing configs (loaded BEFORE the ratcheted file)", () => {
  // ESLint resolves the nearest eslint.config.* upward from each linted file
  // and tries .js before .mjs; knip tries knip.json before knip.jsonc; Stryker
  // tries stryker.conf.json before stryker.config.json. Each of these would
  // replace a ratcheted config while the ratchet kept reading the old one.
  const SHADOWS = [
    "eslint.config.js",
    "eslint.config.cjs",
    "eslint.config.ts",
    "eslint.config.mts",
    "apps/mcp-server/eslint.config.js",
    "packages/connectors/engine/engine-connector/src/data/eslint.config.mjs",
    "knip.json",
    ".knip.json",
    ".knip.jsonc",
    "knip.ts",
    "knip.js",
    "knip.config.ts",
    "knip.config.js",
    "packages/core/widget-shell/stryker.conf.json",
    "packages/core/widget-shell/.stryker.config.json",
    "packages/core/widget-shell/stryker.config.mjs",
    "packages/connectors/c7/c7-client/stryker.conf.cjs",
  ]

  it("flags each one, also when the diff introduces it", () => {
    for (const rel of SHADOWS) {
      assert.equal(ratchetKind(rel), "shadow-config", rel)
      const violations = checkRatchetFile(rel, null, '{"ignore":["**"]}')
      assert.equal(violations.length, 1, rel)
      assert.match(violations[0], /would be loaded INSTEAD of/, rel)
    }
  })

  it("is quiet while the shadow is absent, and outside the tools' lookup paths", () => {
    assert.deepEqual(checkRatchetFile("knip.json", '{"ignore":["**"]}', null), [])
    assert.equal(ratchetKind("templates/composed-server/eslint.config.mjs"), null)
    assert.equal(ratchetKind("docs/eslint.config.js"), null)
    assert.equal(ratchetKind("packages/core/widget-shell/src/stryker.conf.json"), null)
  })

  it("flags a deleted knip.jsonc and a package.json#knip block (merged under knip.jsonc)", () => {
    assert.match(checkRatchetFile("knip.jsonc", "{}", null)[0], /knip\.jsonc was removed/)
    const root = (extra) => JSON.stringify({ scripts: { lint: "turbo run lint" }, ...extra })
    assert.match(
      checkRatchetFile("package.json", root({}), root({ knip: { include: ["files"] } }))[0],
      /package\.json#knip/,
    )
  })
})

describe("shadowing vitest, prettier and editorconfig files", () => {
  const flags = (rel, pattern) => {
    assert.equal(ratchetKind(rel), "shadow-config", rel)
    const violations = checkRatchetFile(rel, null, "export default {}")
    assert.equal(violations.length, 1, rel)
    assert.match(violations[0], pattern, rel)
    assert.ok(violations[0].startsWith(rel), rel)
  }

  it("flags a second vitest config in a package (vitest tries .ts first, the others without it)", () => {
    for (const rel of [
      `${CLI_DIR}/vitest.config.mts`,
      `${VSCODE_DIR}/vitest.config.js`,
      `${FAMILY_DIR}/vitest.config.cjs`,
      "packages/core/widget-shell/vitest.config.mjs",
      "apps/mcp-server/vitest.config.cts",
    ])
      flags(rel, /second vitest config.*loads the first it finds.*Keep the package's config/)
  })

  it("leaves the configs vitest does not resolve from a package dir alone", () => {
    for (const rel of [
      // the widget bundle's build config, which vitest.config.ts outranks
      "apps/mcp-server/vite.config.ts",
      "packages/core/widget-shell/vitest.stryker.config.ts",
      `${CLI_DIR}/src/vitest.config.mts`,
      "templates/composed-server/server/vitest.config.mts",
    ])
      assert.equal(ratchetKind(rel), null, rel)
  })

  it("flags every prettier config below the root and every root one but .prettierrc.json", () => {
    for (const rel of [
      `${CLI_DIR}/.prettierrc`,
      `${CLI_DIR}/.prettierrc.json`,
      `${VSCODE_DIR}/.prettierrc.yaml`,
      `${VSCODE_DIR}/.prettierrc.json5`,
      `${VSCODE_DIR}/.prettierrc.toml`,
      `${VSCODE_DIR}/.prettierrc.cjs`,
      `${CLI_DIR}/prettier.config.mjs`,
      `${CLI_DIR}/prettier.config.ts`,
      `${CLI_DIR}/package.yaml`,
      `${FAMILY_DIR}/.prettierrc.json`,
      "packages/core/widget-shell/src/ui/.prettierrc",
      "apps/.prettierrc",
      // Outside apps/ and packages/ too: `prettier --check .` reads every directory.
      "docs/.prettierrc",
      "docs/.vitepress/.prettierrc.json",
      "docs/package.yaml",
      // The starter's one sanctioned copy is templates/composed-server/.prettierrc.json alone.
      "templates/composed-server/.prettierrc",
      "templates/composed-server/server/.prettierrc.json",
      "templates/composed-server/server/prettier.config.mjs",
      "scripts/.prettierrc.yml",
      "playground/prettier.config.js",
      ".github/.prettierrc",
      ".prettierrc",
      ".prettierrc.yaml",
      "prettier.config.js",
      "package.yaml",
    ])
      flags(rel, /prettier config of its own.*NEAREST.*root \.prettierrc\.json `overrides`/)
  })

  it("flags every .editorconfig below the root (prettier reads it for every option .prettierrc.json leaves open)", () => {
    for (const rel of [
      `${VSCODE_DIR}/.editorconfig`,
      `${FAMILY_DIR}/src/.editorconfig`,
      "docs/.editorconfig",
      "templates/composed-server/.editorconfig",
      "scripts/.editorconfig",
    ])
      flags(rel, /overrides the root \.editorconfig.*Add a section/)
  })

  it("leaves the root configs, ignore files, look-alikes and installed dependencies alone", () => {
    for (const rel of [
      ".prettierrc.json",
      ".editorconfig",
      ".prettierignore",
      `${CLI_DIR}/.prettierignore`,
      "docs/.prettierignore",
      "scripts/prettier-config.test.mjs",
      "templates/composed-server/editorconfig.md",
      `${VSCODE_DIR}/node_modules/some-dep/.prettierrc`,
      "packages/core/widget-shell/node_modules/some-dep/.editorconfig",
      "docs/node_modules/vitepress/.prettierrc",
      "node_modules/some-dep/.editorconfig",
    ])
      assert.equal(ratchetKind(rel), null, rel)
    assert.deepEqual(checkRatchetFile(`${CLI_DIR}/.prettierrc`, "{}", null), [])
  })
})

describe("the starter's prettier config: the root's settings without `overrides`", () => {
  const SETTINGS = { semi: false, printWidth: 100, plugins: ["prettier-plugin-tailwindcss"] }
  const OVERRIDES = [{ files: ["apps/vscode/**"], options: { plugins: [] } }]
  const ROOT = JSON.stringify({ ...SETTINGS, overrides: OVERRIDES })
  const json = (value) => `${JSON.stringify(value, null, 2)}\n`
  /** The copy's violations, the root config of the same side read as `root`. */
  const check = (text, root = ROOT) =>
    checkRatchetFile(
      TEMPLATE_PRETTIER,
      null,
      text,
      () => true,
      (rel) => (rel === ".prettierrc.json" ? root : null),
    )

  it("is a kind of its own, not a shadow config", () => {
    assert.equal(ratchetKind(TEMPLATE_PRETTIER), "template-prettier")
  })

  it("passes the root's settings in any key order, and no copy at all", () => {
    assert.deepEqual(check(json(SETTINGS)), [])
    assert.deepEqual(check(json({ plugins: SETTINGS.plugins, printWidth: 100, semi: false })), [])
    assert.deepEqual(check(null), [])
  })

  it("fails a setting of its own, a dropped or changed one, the root's overrides and a root moved alone", () => {
    for (const [text, root] of [
      [json({ ...SETTINGS, requirePragma: true }), ROOT],
      [json({ semi: false, printWidth: 100 }), ROOT],
      [json({ ...SETTINGS, semi: true }), ROOT],
      [json({ ...SETTINGS, overrides: OVERRIDES }), ROOT],
      [json(SETTINGS), JSON.stringify({ ...SETTINGS, printWidth: 110, overrides: OVERRIDES })],
    ]) {
      const violations = check(text, root)
      assert.equal(violations.length, 1, text)
      assert.match(
        violations[0],
        /^templates\/composed-server\/\.prettierrc\.json is not the root \.prettierrc\.json without `overrides`: .*copy its settings, without `overrides`, here\.$/,
        text,
      )
    }
  })

  it("fails a broken copy and a missing or broken root", () => {
    assert.match(check("{ nope")[0], /\.prettierrc\.json is not valid JSON/)
    for (const root of [null, "{ nope"])
      assert.match(check(json(SETTINGS), root)[0], /missing or not valid JSON.*Restore the root/)
  })
})

describe("no `prettier` key in a workspace package.json (read before any .prettierrc)", () => {
  const manifest = (extra = {}) =>
    JSON.stringify({ name: "x", scripts: { lint: "eslint src", test: "vitest run" }, ...extra })

  it("flags the key in the root, an existing package, an introduced app and the docs workspace", () => {
    for (const [rel, before] of [
      ["package.json", manifest()],
      ["packages/core/widget-shell/package.json", manifest()],
      [`${CLI_DIR}/package.json`, null],
      [`${VSCODE_DIR}/package.json`, null],
      ["docs/package.json", manifest()],
    ]) {
      for (const value of [{ singleQuote: true }, "@some-org/prettier-config"]) {
        const violations = checkRatchetFile(rel, before, manifest({ prettier: value }))
        assert.equal(violations.length, 1, rel)
        assert.match(violations[0], /package\.json#prettier.*root \.prettierrc\.json `overrides`/)
      }
    }
  })

  it("flags the key in the starter's manifests, naming its copy of the root config", () => {
    for (const [rel, before] of [
      ["templates/composed-server/package.json", manifest()],
      ["templates/composed-server/server/package.json", manifest()],
      ["templates/composed-server/modules/my-module/package.json", null],
    ]) {
      const violations = checkRatchetFile(rel, before, manifest({ prettier: { semi: true } }))
      assert.equal(violations.length, 1, rel)
      assert.match(
        violations[0],
        /package\.json#prettier.*copy its settings, without `overrides`, into templates\/composed-server\/\.prettierrc\.json; delete the key\.$/,
        rel,
      )
    }
    assert.deepEqual(
      checkRatchetFile("templates/composed-server/package.json", manifest(), manifest()),
      [],
    )
  })

  it("is quiet without the key, also for an introduced package", () => {
    assert.deepEqual(checkRatchetFile(`${CLI_DIR}/package.json`, null, manifest()), [])
    assert.deepEqual(checkRatchetFile("docs/package.json", manifest(), manifest()), [])
    assert.deepEqual(checkRatchetFile("docs/package.json", manifest(), null), [])
  })

  it("flags an introduced manifest that is not valid JSON", () => {
    assert.match(checkRatchetFile(`${CLI_DIR}/package.json`, null, "{ nope")[0], /not valid JSON/)
  })
})

describe("vitest coverage thresholds (raise-only, never removed)", () => {
  const base = vitestConfig({ thresholds: BASE_THRESHOLDS })

  it("reads the literal thresholds of the real package configs", () => {
    for (const rel of [PKG_VITEST, "apps/mcp-server/vitest.config.ts"]) {
      const { thresholds, error } = extractVitestCoverage(rel, readFileSync(rel, "utf8"))
      assert.equal(error, undefined)
      assert.deepEqual(Object.keys(thresholds).sort(), [
        "branches",
        "functions",
        "lines",
        "statements",
      ])
    }
  })

  it("flags a lowered metric", () => {
    const violations = checkRatchetFile(
      PKG_VITEST,
      base,
      vitestConfig({
        thresholds: "thresholds: { statements: 40, branches: 32, functions: 45, lines: 44 },",
      }),
    )
    assert.equal(violations.length, 1)
    assert.match(violations[0], /thresholds\.statements: 44 -> 40/)
  })

  it("accepts raising and reformatting", () => {
    assert.deepEqual(
      checkRatchetFile(
        PKG_VITEST,
        base,
        vitestConfig({
          thresholds:
            "thresholds: {\n statements: 50,\n branches: 32,\n functions: 45,\n lines: 44\n},",
        }),
      ),
      [],
    )
  })

  it("flags a removed metric, removed thresholds and a non-literal value (fail closed)", () => {
    const dropped = vitestConfig({
      thresholds: "thresholds: { branches: 32, functions: 45, lines: 44 },",
    })
    assert.equal(checkRatchetFile(PKG_VITEST, base, dropped).length, 1)
    assert.equal(checkRatchetFile(PKG_VITEST, base, vitestConfig({ thresholds: "" })).length, 4)
    const computed = vitestConfig({
      thresholds: "thresholds: { statements: FLOOR, branches: 32, functions: 45, lines: 44 },",
    })
    assert.match(checkRatchetFile(PKG_VITEST, base, computed)[0], /no longer a number literal/)
    assert.match(checkRatchetFile(PKG_VITEST, base, null)[0], /was removed/)
  })

  it("flags coverage switched off and a spread that could hide thresholds", () => {
    const off = vitestConfig({ thresholds: BASE_THRESHOLDS, extra: "enabled: false," })
    assert.match(checkRatchetFile(PKG_VITEST, base, off)[0], /coverage\.enabled is now false/)
    const spread = vitestConfig({ thresholds: BASE_THRESHOLDS, extra: "...looser," })
    assert.match(checkRatchetFile(PKG_VITEST, base, spread)[0], /spread\/shorthand/)
  })

  it("fails closed on an ambiguous second coverage block", () => {
    const twice = `${base}\nexport const other = { coverage: { thresholds: { lines: 1 } } }`
    assert.match(checkRatchetFile(PKG_VITEST, base, twice)[0], /2 `coverage` blocks/)
  })

  it("flags a package that stops merging sharedConfig (vitest's default is coverage off)", () => {
    const standalone = base.replace("mergeConfig(sharedConfig, defineConfig(", "(defineConfig(")
    assert.match(
      checkRatchetFile(PKG_VITEST, base, standalone).join("\n"),
      /no longer merges sharedConfig/,
    )
    const selfEnabled = vitestConfig({ thresholds: BASE_THRESHOLDS, extra: "enabled: true," })
    assert.deepEqual(
      checkRatchetFile(
        PKG_VITEST,
        base,
        selfEnabled.replace("mergeConfig(sharedConfig, defineConfig(", "(defineConfig("),
      ),
      [],
    )
  })
})

describe("vitest coverage thresholds: glob keys, perFile, the 100 shorthand, count floors", () => {
  const DOMAIN = `${FAMILY_DIR}/vitest.config.ts`
  const GLOBAL = "statements: 90, branches: 85, functions: 90, lines: 90"
  const config = (body) => vitestConfig({ thresholds: `thresholds: { ${body} },` })
  const base = config(`${GLOBAL}, "src/core/**": { lines: 98, branches: 95 }`)
  const check = (before, after) => checkRatchetFile(DOMAIN, before, after)
  const withExtra = (extra) => vitestConfig({ thresholds: `thresholds: { ${GLOBAL} },`, extra })

  it("reads glob keys next to the global floors", () => {
    const read = extractVitestCoverage(DOMAIN, base)
    assert.deepEqual(read.thresholds, { statements: 90, branches: 85, functions: 90, lines: 90 })
    assert.deepEqual(read.globThresholds, { "src/core/**": { lines: 98, branches: 95 } })
    assert.deepEqual(read.opaque, [])
  })

  it("flags a lowered glob floor, a dropped glob metric and a removed glob", () => {
    const lowered = check(base, config(`${GLOBAL}, "src/core/**": { lines: 90, branches: 95 }`))
    assert.equal(lowered.length, 1)
    assert.match(lowered[0], /coverage\.thresholds\["src\/core\/\*\*"\]\.lines: 98 -> 90/)
    const dropped = check(base, config(`${GLOBAL}, "src/core/**": { lines: 98 }`))
    assert.equal(dropped.length, 1)
    assert.match(dropped[0], /\["src\/core\/\*\*"\]\.branches was removed/)
    const removed = check(base, config(GLOBAL))
    assert.equal(removed.length, 1)
    assert.match(removed[0], /\["src\/core\/\*\*"\] was removed/)
  })

  it("reads a renamed glob as removed (a glob that matches no file passes vacuously)", () => {
    const renamed = check(base, config(`${GLOBAL}, "src/domain/**": { lines: 98, branches: 95 }`))
    assert.equal(renamed.length, 1)
    assert.match(renamed[0], /\["src\/core\/\*\*"\] was removed.*renamed glob/)
  })

  it("accepts a new glob, also below the global floors (vitest still holds every file to those)", () => {
    const added = config(
      `${GLOBAL}, "src/core/**": { lines: 98, branches: 95 }, "src/io/**": { lines: 10 }`,
    )
    assert.deepEqual(check(base, added), [])
  })

  it("accepts raising, adding a metric, reordering, quote style and a literal computed key", () => {
    for (const body of [
      `"src/core/**": { branches: 96, lines: 99, functions: 90 }, ${GLOBAL}`,
      `${GLOBAL}, 'src/core/**': { lines: 98, branches: 95 }`,
      `${GLOBAL}, ["src/core/**"]: { lines: 98, branches: 95 }`,
    ])
      assert.deepEqual(check(base, config(body)), [], body)
  })

  it("reads the LAST of duplicate keys, as JS does: a metric, a glob, a glob's metric, thresholds", () => {
    for (const [after, pattern] of [
      [
        config(`${GLOBAL}, "src/core/**": { lines: 98, branches: 95 }, lines: 10`),
        /\.lines: 90 -> 10/,
      ],
      [
        config(
          `${GLOBAL}, "src/core/**": { lines: 98, branches: 95 }, "src/core/**": { lines: 10, branches: 95 }`,
        ),
        /\["src\/core\/\*\*"\]\.lines: 98 -> 10/,
      ],
      [
        config(`${GLOBAL}, "src/core/**": { lines: 98, branches: 95, lines: 10 }`),
        /\["src\/core\/\*\*"\]\.lines: 98 -> 10/,
      ],
      [
        vitestConfig({
          thresholds: `thresholds: { ${GLOBAL}, "src/core/**": { lines: 98, branches: 95 } }, thresholds: { lines: 10 },`,
        }),
        /\.statements was removed/,
      ],
    ]) {
      const violations = check(base, after)
      assert.ok(violations.length > 0, String(pattern))
      assert.match(violations.join("\n"), pattern)
    }
    // The other way round the last, stricter value is the one vitest applies.
    assert.deepEqual(
      check(
        base,
        config(`lines: 10, ${GLOBAL}, "src/core/**": { lines: 10, lines: 98, branches: 95 }`),
      ),
      [],
    )
  })

  it("fails closed on what it cannot read: a non-literal glob, metric, key, spread or accessor", () => {
    const nonLiteral = check(base, config(`${GLOBAL}, "src/core/**": CORE`))
    assert.equal(nonLiteral.length, 2)
    assert.match(nonLiteral[1], /non-literal `thresholds\["src\/core\/\*\*"\]: CORE`/)
    const metric = check(base, config(`${GLOBAL}, "src/core/**": { lines: FLOOR, branches: 95 }`))
    assert.equal(metric.length, 2)
    assert.match(metric.join("\n"), /\.lines was removed/)
    assert.match(
      check(config(GLOBAL), config(`${GLOBAL}, [CORE_GLOB]: { lines: 98 }`))[0],
      /computed key \[CORE_GLOB\]/,
    )
    // A spread or accessor written AFTER the literals overrides them at runtime.
    assert.match(
      check(config(GLOBAL), config(`${GLOBAL}, ...LOOSER`))[0],
      /`thresholds: \.\.\.LOOSER`/,
    )
    assert.match(
      check(config(GLOBAL), config(`${GLOBAL}, get lines() { return 0 }`))[0],
      /getlines/,
    )
    assert.match(
      check(base, config(`${GLOBAL}, "src/core/**": { lines: 98, branches: 95, ...LOOSER }`))[0],
      /src\/core.*\.\.\.LOOSER/,
    )
    // A typo is a glob with no floors to vitest: opaque here, never a silent no-op.
    assert.match(check(config(GLOBAL), config(`${GLOBAL}, line: 95`))[0], /line"\]: 95/)
    assert.match(
      check(config(GLOBAL), config(`${GLOBAL}, __proto__: { lines: 0 }`))[0],
      /__proto__/,
    )
    // A non-object thresholds value hides every floor.
    assert.match(
      check(config(GLOBAL), vitestConfig({ thresholds: "thresholds: FLOORS," })).join("\n"),
      /`thresholds: FLOORS`/,
    )
  })

  it("fails closed on a computed key anywhere in the file (it could be enabled, exclude, thresholds)", () => {
    for (const extra of ['["enabled"]: false,', "[KEY]: false,"])
      assert.equal(check(config(GLOBAL), withExtra(extra)).length, 1, extra)
  })

  it("never switches perFile off, and never on next to a count floor", () => {
    const perFile = config(`${GLOBAL}, perFile: true`)
    assert.match(check(perFile, config(GLOBAL))[0], /perFile is now undefined \(was true\)/)
    assert.match(check(perFile, config(`${GLOBAL}, perFile: false`))[0], /perFile is now false/)
    assert.deepEqual(check(config(GLOBAL), perFile), [])
    assert.match(
      check(config("lines: -10"), config("lines: -10, perFile: true"))[0],
      /negative floor/,
    )
    assert.match(
      check(perFile, config(`${GLOBAL}, perFile: PER_FILE`)).join("\n"),
      /perFile: PER_FILE/,
    )
  })

  it("expands the 100 shorthand the way vitest does (truthy at the top, exactly true in a glob)", () => {
    const hundred = config("100: true")
    assert.equal(check(hundred, config("")).length, 4)
    assert.deepEqual(check(hundred, config("100: true, lines: 1")), [])
    assert.match(
      check(hundred, config("lines: 99, statements: 100, branches: 100, functions: 100"))[0],
      /lines: 100 -> 99/,
    )
    assert.deepEqual(
      check(config("statements: 100, branches: 100, functions: 100, lines: 100"), hundred),
      [],
    )
    assert.deepEqual(extractVitestCoverage(DOMAIN, config('"src/**": { 100: 1 }')).globThresholds, {
      "src/**": {},
    })
    assert.equal(extractVitestCoverage(DOMAIN, config("100: 1")).thresholds.lines, 100)
    assert.equal(
      check(config('"src/**": { 100: true }'), config('"src/**": { lines: 100 }')).length,
      3,
    )
    assert.match(check(hundred, config("100: FULL")).join("\n"), /thresholds\.100: FULL/)
  })

  it("compares count floors (-N = at most N uncovered) only where they compare", () => {
    assert.deepEqual(check(config("lines: -10"), config("lines: -5")), [])
    assert.match(check(config("lines: -5"), config("lines: -10"))[0], /lines: -5 -> -10/)
    assert.deepEqual(check(config("lines: -5"), config("lines: 100")), [])
    assert.match(check(config("lines: -5"), config("lines: 99"))[0], /compare only through 100/)
    assert.match(check(config("lines: 90"), config("lines: -5"))[0], /compare only through 100/)
    assert.deepEqual(check(config("lines: 0"), config("lines: -5")), [])
  })

  it("flags deleting a config that carried only glob floors or perFile", () => {
    assert.match(check(config('"src/**": { lines: 98 }'), null)[0], /was removed while it carried/)
    assert.match(check(config("perFile: true"), null)[0], /was removed while it carried/)
    assert.deepEqual(check(config(""), null), [])
  })

  it("leaves autoUpdate free (it only writes raised floors) and ignores what vitest ignores in a glob", () => {
    assert.deepEqual(check(config(`${GLOBAL}, autoUpdate: true`), config(GLOBAL)), [])
    assert.deepEqual(
      check(config(GLOBAL), config(`${GLOBAL}, autoUpdate: (v) => Math.floor(v)`)),
      [],
    )
    assert.deepEqual(
      check(config('"src/**": { lines: 98, perFile: true }'), config('"src/**": { lines: 98 }')),
      [],
    )
  })

  it("reads every real config without a glob, a project or an unreadable shape", () => {
    for (const rel of ["vitest.shared.ts", ...REAL_VITEST_CONFIGS]) {
      const text = readFileSync(rel, "utf8")
      const read = extractVitestCoverage(rel, text)
      assert.equal(read.error, undefined, rel)
      assert.deepEqual(read.opaque, [], rel)
      assert.deepEqual(read.globThresholds, {}, rel)
      assert.equal(read.projects, null, rel)
      assert.deepEqual(checkRatchetFile(rel, text, text), [], rel)
    }
  })
})

describe("an introduced vitest config must already be a working ratchet", () => {
  const FLOORS = "statements: 90, branches: 85, functions: 90, lines: 90"
  const standalone = (coverage) => `import { defineConfig } from "vitest/config"
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: { provider: "v8", ${coverage} },
  },
})`

  it("measures: a standalone config needs coverage.enabled: true (vitest's default is off)", () => {
    const off = checkRatchetFile(
      `${CLI_DIR}/vitest.config.ts`,
      null,
      standalone(`thresholds: { ${FLOORS} }`),
    )
    assert.equal(off.length, 1)
    assert.match(off[0], /neither merges sharedConfig nor sets coverage\.enabled: true/)
    assert.deepEqual(
      checkRatchetFile(
        `${CLI_DIR}/vitest.config.ts`,
        null,
        standalone(`enabled: true, thresholds: { ${FLOORS} }`),
      ),
      [],
    )
    // Merging sharedConfig does not help when the package switches coverage off again.
    for (const enabled of ["false", "COVERAGE"]) {
      const merged = vitestConfig({
        thresholds: `thresholds: { ${FLOORS} },`,
        extra: `enabled: ${enabled},`,
      })
      assert.match(
        checkRatchetFile(`${FAMILY_DIR}/vitest.config.ts`, null, merged).join("\n"),
        /neither merges sharedConfig/,
        enabled,
      )
    }
  })

  it("carries a non-zero floor for each of the four metrics", () => {
    const introduce = (thresholds) =>
      checkRatchetFile(`${FAMILY_DIR}/vitest.config.ts`, null, vitestConfig({ thresholds }))
    assert.deepEqual(
      introduce(`thresholds: { ${FLOORS}, "src/core/**": { lines: 98 }, perFile: true },`),
      [],
    )
    assert.deepEqual(introduce("thresholds: { 100: true },"), [])
    assert.match(
      introduce("")[0],
      /no coverage floor for statements, branches, functions, lines.*0 is no floor/,
    )
    assert.match(introduce("thresholds: { lines: 90 },")[0], /statements, branches, functions\./)
    assert.match(introduce(`thresholds: { ${FLOORS.replace("90", "0")} },`)[0], /for statements\./)
    // Glob floors or perFile alone leave the rest of the package unguarded.
    assert.equal(introduce('thresholds: { "src/**": { lines: 98 }, perFile: true },').length, 1)
  })

  it("is readable: no unreadable shape, no opaque member", () => {
    const twice = `${vitestConfig({ thresholds: `thresholds: { ${FLOORS} },` })}\nexport const x = { test: {} }`
    assert.match(
      checkRatchetFile(`${CLI_DIR}/vitest.config.ts`, null, twice)[0],
      /2 `test` blocks.*readable by the ratchet from its first commit/,
    )
    const spread = vitestConfig({ thresholds: `thresholds: { ${FLOORS} },`, extra: "...LAX," })
    assert.match(
      checkRatchetFile(`${CLI_DIR}/vitest.config.ts`, null, spread)[0],
      /non-literal `\.\.\.LAX`.*nothing to compare against/,
    )
  })

  it("accepts every real package config as if it were new", () => {
    for (const rel of REAL_VITEST_CONFIGS)
      assert.deepEqual(checkRatchetFile(rel, null, readFileSync(rel, "utf8")), [], rel)
  })
})

describe("vitest.shared.ts carries no floors (a package key would override them unseen)", () => {
  const shared = (thresholds) => `
import { coverageConfigDefaults, defineConfig } from "vitest/config"
export const sharedConfig = defineConfig({
  test: { coverage: { provider: "v8", enabled: true, exclude: [...coverageConfigDefaults.exclude], ${thresholds} } },
})`

  it("flags a global floor, a glob floor and perFile, and nothing without them", () => {
    for (const thresholds of [
      "thresholds: { lines: 90 },",
      'thresholds: { "src/**": { lines: 90 } },',
      "thresholds: { perFile: true },",
    ]) {
      const violations = checkRatchetFile("vitest.shared.ts", shared(""), shared(thresholds))
      assert.equal(violations.length, 1, thresholds)
      assert.match(violations[0], /belong in each package's vitest\.config\.ts/, thresholds)
    }
    assert.deepEqual(checkRatchetFile("vitest.shared.ts", shared(""), shared("")), [])
    const real = readFileSync("vitest.shared.ts", "utf8")
    assert.deepEqual(checkRatchetFile("vitest.shared.ts", real, real), [])
  })
})

describe("inline test.projects (keyed by their literal name)", () => {
  const VSCODE = `${VSCODE_DIR}/vitest.config.ts`
  const project = (name, include, extra = "", outer = "extends: true,") =>
    `{ ${outer} test: { name: ${JSON.stringify(name)}, include: ${JSON.stringify(include)}, ${extra} } }`
  const UNIT = project("unit", ["src/**/*.test.ts"], 'exclude: [ENGINE_TEST, "test/fixtures/**"],')
  const BROWSER = project("browser", ["src/webview/**/*.test.tsx"], "browser: { enabled: true },")
  // Two `include` keys: the last one wins, in JS and in the ratchet.
  const ENGINE = project("engine", [], "include: [ENGINE_TEST], testTimeout: 180_000,")
  // The shape of a VS Code extension's config: root coverage with global and
  // glob floors, three inline projects that inherit the root config.
  const projectsConfig = ({ projects = [UNIT, BROWSER, ENGINE], core = 98 } = {}) => `
import { defineConfig } from "vitest/config"
const ENGINE_TEST = "test/**/*.engine.test.ts"
export default defineConfig({
  plugins: [bpmnAsText],
  test: {
    clearMocks: true,
    coverage: {
      provider: "v8",
      enabled: true,
      include: ["src/**/*.{ts,tsx}"],
      thresholds: {
        lines: 93, statements: 93, functions: 94, branches: 83,
        "src/core/**": { lines: ${core}, statements: 98, functions: 98, branches: 90 },
        "src/webview/**": { lines: 78, statements: 78, functions: 78, branches: 68 },
      },
    },
    ${projects === null ? "" : `projects: [${projects.join(", ")}],`}
  },
})`
  const base = projectsConfig()
  const check = (after, before = base) => checkRatchetFile(VSCODE, before, after)

  it("reads root coverage and the projects of a config the ratchet could not read before", () => {
    const read = extractVitestCoverage(VSCODE, base)
    assert.equal(read.error, undefined)
    assert.deepEqual(read.opaque, [])
    assert.deepEqual(Object.keys(read.globThresholds), ["src/core/**", "src/webview/**"])
    assert.deepEqual(read.projects, {
      unit: {
        include: ["src/**/*.test.ts"],
        // A string constant is read as the glob it holds.
        exclude: ["test/**/*.engine.test.ts", "test/fixtures/**"],
        extends: true,
      },
      browser: { include: ["src/webview/**/*.test.tsx"], exclude: [], extends: true },
      engine: { include: ["test/**/*.engine.test.ts"], exclude: [], extends: true },
    })
    assert.deepEqual(checkRatchetFile(VSCODE, null, base), [])
  })

  it("ratchets the floors of a projects config", () => {
    assert.match(check(projectsConfig({ core: 90 }))[0], /\["src\/core\/\*\*"\]\.lines: 98 -> 90/)
  })

  it("flags a removed or renamed project, a narrowed include, a new exclude and a switched extends", () => {
    assert.match(
      check(projectsConfig({ projects: [UNIT, ENGINE] }))[0],
      /\["browser"\] was removed/,
    )
    const renamed = project("dom", ["src/webview/**/*.test.tsx"])
    assert.match(
      check(projectsConfig({ projects: [UNIT, renamed, ENGINE] }))[0],
      /\["browser"\] was removed \(a renamed project reads as removed\)/,
    )
    const narrowed = project("browser", ["src/webview/ui/**/*.test.tsx"])
    assert.match(
      check(projectsConfig({ projects: [UNIT, narrowed, ENGINE] }))[0],
      /test\.projects\["browser"\]\.include lost "src\/webview\/\*\*\/\*\.test\.tsx"/,
    )
    const excluded = project("browser", ["src/webview/**/*.test.tsx"], 'exclude: ["**/slow/**"],')
    assert.match(
      check(projectsConfig({ projects: [UNIT, excluded, ENGINE] }))[0],
      /new test\.projects\["browser"\]\.exclude entry "\*\*\/slow\/\*\*"/,
    )
    const detached = project("browser", ["src/webview/**/*.test.tsx"], "", "extends: false,")
    assert.match(
      check(projectsConfig({ projects: [UNIT, detached, ENGINE] }))[0],
      /\["browser"\]\.extends: true -> false/,
    )
  })

  it("accepts a new project, a grown include, a dropped exclude, reordering and an object name", () => {
    const smoke = project("smoke", ["test/smoke/**/*.test.ts"])
    const grown = project("browser", ["src/webview/**/*.test.tsx", "test/webview/**/*.test.tsx"])
    const unitAll = project("unit", ["src/**/*.test.ts"], "exclude: [ENGINE_TEST],")
    const labelled = BROWSER.replace(
      'name: "browser"',
      'name: { label: "browser", color: "green" }',
    )
    for (const projects of [
      [UNIT.replace('name: "unit",', 'name: "lax", name: "unit",'), BROWSER, ENGINE],
      [UNIT, BROWSER, ENGINE, smoke],
      [UNIT, grown, ENGINE],
      [unitAll, BROWSER, ENGINE],
      [ENGINE, UNIT, BROWSER],
      [UNIT, labelled, ENGINE],
    ])
      assert.deepEqual(check(projectsConfig({ projects })), [], projects.join(" | "))
  })

  it("flags projects appearing in, or disappearing from, a config", () => {
    const plain = projectsConfig({ projects: null })
    assert.match(check(base, plain)[0], /test\.projects appeared \(unit, browser, engine\)/)
    assert.match(check(plain)[0], /test\.projects was removed \(was unit, browser, engine\)/)
    assert.deepEqual(check(plain, plain), [])
  })

  it("fails closed on a project it cannot key or read", () => {
    const errorOf = (projects) => extractVitestCoverage(VSCODE, projectsConfig({ projects })).error
    assert.match(errorOf(['{ test: { include: ["x"] } }']), /without a literal name/)
    assert.match(errorOf(["{ test: { name: NAME } }"]), /without a literal name/)
    assert.match(errorOf(["{ extends: true }"]), /without a literal `test` block/)
    assert.match(errorOf([UNIT, UNIT]), /project name "unit" is taken twice/)
    assert.match(errorOf([project("__proto__", ["x"])]), /"__proto__" is taken twice/)
    // A project built by a function: its test block is no root test.projects entry.
    assert.match(
      errorOf(["() => ({ test: { name: 'e2e' } })"]),
      /2 `test` blocks outside test\.projects/,
    )
    // A project coverage block next to the root one: ambiguous, so unreadable.
    assert.match(
      errorOf([project("unit", ["x"], "coverage: { enabled: false },")]),
      /2 `coverage` blocks/,
    )
    // vitest reads coverage from the root config only: a project's never applies.
    const projectCoverage = projectsConfig({
      projects: [project("unit", ["x"], "coverage: { thresholds: { lines: 1 } },")],
    }).replace(/coverage: \{\n {6}provider[\s\S]*?\n {4}\},\n/, "")
    assert.match(extractVitestCoverage(VSCODE, projectCoverage).error, /inside an inline project/)
    // A projects list outside the root test block is not vitest's.
    const misplaced = base.replace("plugins: [bpmnAsText],", `projects: [${UNIT}],`)
    assert.match(
      extractVitestCoverage(VSCODE, misplaced).error,
      /projects` list the ratchet does not read/,
    )
    // So is a coverage block outside the root test block.
    const topLevel = base.replace(
      "plugins: [bpmnAsText],",
      "coverage: { thresholds: { lines: 1 } },",
    )
    assert.match(extractVitestCoverage(VSCODE, topLevel).error, /2 `coverage` blocks/)
    const onlyTopLevel = `import { defineConfig } from "vitest/config"
export default defineConfig({ coverage: { enabled: true, thresholds: { lines: 90 } }, test: {} })`
    assert.match(extractVitestCoverage(VSCODE, onlyTopLevel).error, /outside the root `test` block/)
  })

  it("freezes what loads or overrides a project out of sight", () => {
    for (const [projects, pattern] of [
      [
        [UNIT, BROWSER, ENGINE, '"./vitest.e2e.config.ts"'],
        /test\.projects element "\.\/vitest\.e2e/,
      ],
      [[UNIT, BROWSER, ENGINE, "() => E2E_PROJECT"], /test\.projects element \(\)=>E2E_PROJECT/],
      [
        [UNIT, BROWSER, ENGINE, "defineProject(E2E)"],
        /test\.projects element defineProject\(E2E\)/,
      ],
      [[UNIT, BROWSER, ENGINE, "...EXTRA"], /test\.projects element \.\.\.EXTRA/],
      [
        [
          project(
            "unit",
            ["src/**/*.test.ts"],
            'exclude: [ENGINE_TEST, "test/fixtures/**"],',
            "...LAX, extends: true,",
          ),
          BROWSER,
          ENGINE,
        ],
        /element member \.\.\.LAX/,
      ],
      [
        [
          project(
            "unit",
            ["src/**/*.test.ts"],
            'exclude: [ENGINE_TEST, "test/fixtures/**"], ...LAX,',
          ),
          BROWSER,
          ENGINE,
        ],
        /test\.projects\["unit"\]: \.\.\.LAX/,
      ],
      [
        [UNIT.replace("extends: true", 'extends: "./vitest.base.ts"'), BROWSER, ENGINE],
        /\["unit"\]\.extends: "\.\/vitest\.base\.ts"/,
      ],
      // A duplicate key reads as JS reads it: the LAST one wins, so a harmless first
      // value cannot hide the path vitest loads, nor the name it runs the project under.
      [
        [
          UNIT.replace("extends: true,", 'extends: true, extends: "./loose.config.ts",'),
          BROWSER,
          ENGINE,
        ],
        /\["unit"\]\.extends: "\.\/loose\.config\.ts"/,
      ],
      [
        [UNIT.replace('name: "unit",', 'name: "unit", name: "lax",'), BROWSER, ENGINE],
        /\["unit"\] was removed/,
      ],
      [
        [UNIT.replace('name: "unit",', 'name: { label: "unit", label: "lax" },'), BROWSER, ENGINE],
        /\["unit"\] was removed/,
      ],
    ]) {
      const violations = check(projectsConfig({ projects }))
      assert.ok(violations.length > 0, String(pattern))
      assert.match(violations.join("\n"), pattern)
    }
    assert.match(
      check(base.replace(/projects: \[[\s\S]*\],\n/, "projects: PROJECTS,\n")).join("\n"),
      /`test\.projects: PROJECTS`/,
    )
  })
})

describe("a ratchet file unreadable on the base is never compared again", () => {
  const twoTests = `${vitestConfig({ thresholds: BASE_THRESHOLDS })}\nexport const x = { test: {} }`

  it("fails a vitest config unreadable on both sides, and a deleted one", () => {
    const both = checkRatchetFile(PKG_VITEST, twoTests, twoTests)
    assert.equal(both.length, 1)
    assert.match(both[0], /on the base and in the working tree.*never compared/)
    assert.match(checkRatchetFile(PKG_VITEST, twoTests, null)[0], /could not read its base/)
  })

  it("holds the readable new side to the rules of an introduced config", () => {
    assert.deepEqual(
      checkRatchetFile(PKG_VITEST, twoTests, vitestConfig({ thresholds: BASE_THRESHOLDS })),
      [],
    )
    assert.match(
      checkRatchetFile(PKG_VITEST, twoTests, vitestConfig({ thresholds: "" }))[0],
      /carries no coverage floor/,
    )
  })

  it("fails a JSON ratchet broken on both sides, and judges a fixed one alone", () => {
    const rel = "packages/core/widget-shell/stryker.config.json"
    assert.match(checkRatchetFile(rel, "{ nope", "{ nope")[0], /not valid JSON/)
    assert.deepEqual(checkRatchetFile(rel, "{ nope", '{ "mutate": ["src/a.ts"] }'), [])
    const pkg = "packages/core/widget-shell/package.json"
    assert.match(
      checkRatchetFile(pkg, "{ nope", JSON.stringify({ prettier: {} }))[0],
      /package\.json#prettier/,
    )
  })
})

describe("the vitest threshold semantics the glob ratchet relies on (vitest/node)", () => {
  // Read from the vitest the repo pins: a new glob only ADDS a floor because
  // the global set still holds every file, a non-metric key is a glob, and
  // `100` inside a glob counts only as exactly `true`. A vitest bump that
  // changes any of this fails here before the ratchet's reasoning goes stale.
  class Probe extends BaseCoverageProvider {
    createCoverageMap() {
      const files = []
      return {
        files: () => files,
        addFileCoverage: (file) => files.push(file),
        fileCoverageFor: (file) => file,
      }
    }
  }
  const resolve = (thresholds) => {
    const probe = new Probe()
    probe.options = { thresholds }
    probe.ctx = { config: { root: "/pkg" } }
    const all = ["/pkg/src/core/a.ts", "/pkg/src/io/b.ts"]
    return probe.resolveThresholds({ files: () => all, fileCoverageFor: (file) => file })
  }

  it("holds glob-matched files to the global floors too", () => {
    const [global, core] = resolve({ lines: 90, "src/core/**": { lines: 10 } })
    assert.equal(global.name, "global")
    assert.deepEqual(global.coverageMap.files(), ["/pkg/src/core/a.ts", "/pkg/src/io/b.ts"])
    assert.deepEqual(core.coverageMap.files(), ["/pkg/src/core/a.ts"])
    assert.equal(core.thresholds.lines, 10)
  })

  it("reads every other key as a glob, and `100` in a glob only as exactly true", () => {
    const [, typo, strict, loose] = resolve({
      lines: 90,
      line: 80,
      "a/**": { 100: true },
      "b/**": { 100: 1 },
    })
    assert.equal(typo.name, "line")
    assert.deepEqual(
      Object.values(typo.thresholds).filter((value) => value !== undefined),
      [],
    )
    assert.equal(strict.thresholds.branches, 100)
    assert.equal(loose.thresholds.lines, undefined)
  })
})

describe("the real repository carries no shadowing config and no package.json#prettier", () => {
  it("holds for every tracked and untracked file", () => {
    const listed = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
      .split("\n")
      .filter(Boolean)
    assert.deepEqual(
      listed.filter((rel) => ratchetKind(rel) === "shadow-config"),
      [],
    )
    const manifests = listed.filter((rel) =>
      ["root-scripts", "package-scripts", "workspace-manifest", "template-manifest"].includes(
        ratchetKind(rel),
      ),
    )
    for (const rel of [
      "package.json",
      "docs/package.json",
      "templates/composed-server/package.json",
      "templates/composed-server/server/package.json",
    ])
      assert.ok(manifests.includes(rel), rel)
    for (const rel of manifests) {
      const text = readFileSync(rel, "utf8")
      assert.deepEqual(checkRatchetFile(rel, text, text), [], rel)
    }
  })

  it("holds the starter's prettier config to the root's settings", () => {
    const text = readFileSync(TEMPLATE_PRETTIER, "utf8")
    const read = (rel) => readFileSync(rel, "utf8")
    assert.deepEqual(
      checkRatchetFile(TEMPLATE_PRETTIER, text, text, () => true, read),
      [],
    )
  })
})

describe("coverage exclude (shrink-only)", () => {
  const shared = (entries) => `
import { coverageConfigDefaults, defineConfig } from "vitest/config"
export const sharedConfig = defineConfig({
  test: { coverage: { provider: "v8", enabled: true, exclude: [
    ...coverageConfigDefaults.exclude,
    ${entries.map((e) => JSON.stringify(e)).join(",\n    ")},
  ] } },
})`
  const base = shared(["**/src/postgres.ts", "**/src/*-store-postgres.ts"])

  it("flags a new exclusion and accepts dropping one", () => {
    const grown = shared(["**/src/postgres.ts", "**/src/*-store-postgres.ts", "**/src/hard.ts"])
    const violations = checkRatchetFile("vitest.shared.ts", base, grown)
    assert.equal(violations.length, 1)
    assert.match(violations[0], /new coverage\.exclude entry "\*\*\/src\/hard\.ts"/)
    assert.deepEqual(checkRatchetFile("vitest.shared.ts", base, shared(["**/src/postgres.ts"])), [])
  })

  it("flags dropping `enabled: true` (vitest then defaults to coverage off)", () => {
    const dropped = base.replace("enabled: true, ", "")
    assert.match(
      checkRatchetFile("vitest.shared.ts", base, dropped)[0],
      /coverage\.enabled is now undefined \(was true\)/,
    )
    // A duplicate key: the last one is the one vitest reads.
    const switched = base.replace("enabled: true, ", "enabled: true, enabled: false, ")
    assert.match(
      checkRatchetFile("vitest.shared.ts", base, switched)[0],
      /coverage\.enabled is now false \(was true\)/,
    )
  })

  it("reads the real shared config", () => {
    const { exclude, enabled } = extractVitestCoverage(
      "vitest.shared.ts",
      readFileSync("vitest.shared.ts", "utf8"),
    )
    assert.equal(enabled, true)
    assert.ok(exclude.includes("...coverageConfigDefaults.exclude"))
    assert.deepEqual(exclude, ["...coverageConfigDefaults.exclude"])
  })

  it("flags a coverage.include that appears in the shared config", () => {
    const narrowed = base.replace("enabled: true,", 'enabled: true, include: ["src/lib/**"],')
    assert.match(
      checkRatchetFile("vitest.shared.ts", base, narrowed).join("\n"),
      /coverage\.include/,
    )
  })
})

describe("measured surface: include lists only grow (the counterpart of exclude)", () => {
  const base = vitestConfig({ thresholds: BASE_THRESHOLDS })

  it("flags a coverage.include where vitest measured every loaded file", () => {
    const narrowed = vitestConfig({
      thresholds: BASE_THRESHOLDS,
      extra: 'include: ["src/profile.ts"],',
    })
    const violations = checkRatchetFile(PKG_VITEST, base, narrowed)
    assert.equal(violations.length, 1)
    assert.match(violations[0], /coverage\.include appeared/)
  })

  it("lets an existing coverage.include grow, never shrink or vanish", () => {
    const withInclude = (globs) =>
      vitestConfig({ thresholds: BASE_THRESHOLDS, extra: `include: ${JSON.stringify(globs)},` })
    const old = withInclude(["src/**"])
    assert.deepEqual(checkRatchetFile(PKG_VITEST, old, withInclude(["src/**", "test/**"])), [])
    assert.match(
      checkRatchetFile(PKG_VITEST, old, withInclude(["src/lib/**"]))[0],
      /coverage\.include lost "src\/\*\*"/,
    )
    assert.match(checkRatchetFile(PKG_VITEST, old, base)[0], /coverage\.include was removed/)
  })

  it("flags a narrowed test.include and a new test.exclude", () => {
    const narrowed = base.replace(
      'include: ["src/**/*.test.ts"]',
      'include: ["src/lib/**/*.test.ts"]',
    )
    assert.match(
      checkRatchetFile(PKG_VITEST, base, narrowed)[0],
      /test\.include lost "src\/\*\*\/\*\.test\.ts"/,
    )
    const excluded = base.replace(
      'include: ["src/**/*.test.ts"],',
      'include: ["src/**/*.test.ts"], exclude: ["src/widgets/**"],',
    )
    assert.match(checkRatchetFile(PKG_VITEST, base, excluded)[0], /new test\.exclude entry/)
    const grown = base.replace('["src/**/*.test.ts"]', '["src/**/*.test.ts", "test/**/*.test.ts"]')
    assert.deepEqual(checkRatchetFile(PKG_VITEST, base, grown), [])
  })
})

describe("include and exclude lists built from a constant (read entry by entry)", () => {
  const listConst = (...entries) => `const EXCLUDED = ${JSON.stringify(entries)}`
  // A package config whose coverage list names, spreads or is shorthand for a constant.
  const config = ({
    decl = listConst("src/a.ts"),
    use = "exclude: EXCLUDED,",
    after = "",
    test = 'include: ["src/**/*.test.ts"],',
  } = {}) => `
import { coverageConfigDefaults, defineConfig, mergeConfig } from "vitest/config"
import { sharedConfig } from "../../vitest.shared"
${decl}
${after}
export default mergeConfig(sharedConfig, defineConfig({
  test: {
    ${test}
    coverage: {
      ${use}
      ${BASE_THRESHOLDS}
    },
  },
}))
`
  const check = (before, after) => checkRatchetFile(PKG_VITEST, before, after)
  const read = (options) => extractVitestCoverage(PKG_VITEST, config(options))
  const SPREAD = 'exclude: ["src/**/*.d.ts", ...EXCLUDED],'
  const literal = vitestConfig({ thresholds: BASE_THRESHOLDS, exclude: 'exclude: ["src/a.ts"],' })

  it("fails an exclude constant that grows, named or spread", () => {
    for (const use of ["exclude: EXCLUDED,", SPREAD]) {
      const violations = check(
        config({ use }),
        config({ use, decl: listConst("src/a.ts", "src/host/b.ts") }),
      )
      assert.equal(violations.length, 1, use)
      assert.match(violations[0], /new coverage\.exclude entry "src\/host\/b\.ts"/, use)
    }
  })

  it("passes an exclude constant that shrinks, and a literal list moved into a constant and back", () => {
    for (const use of ["exclude: EXCLUDED,", SPREAD])
      assert.deepEqual(
        check(config({ use, decl: listConst("src/a.ts", "src/host/b.ts") }), config({ use })),
        [],
        use,
      )
    assert.deepEqual(check(literal, config()), [])
    assert.deepEqual(check(config(), literal), [])
    // A config that introduces a constant it reads through has nothing opaque.
    assert.deepEqual(checkRatchetFile(PKG_VITEST, null, config()), [])
  })

  it("reads a spread of it, a constant built from another and its type wrappers entry by entry", () => {
    assert.deepEqual(read({ use: SPREAD, decl: listConst("src/a.ts", "src/b.ts") }).exclude, [
      "src/**/*.d.ts",
      "src/a.ts",
      "src/b.ts",
    ])
    const chained = `${listConst("src/a.ts")}\nconst HOST = [...EXCLUDED, "src/host/**"]`
    assert.deepEqual(read({ decl: chained, use: "exclude: HOST," }).exclude, [
      "src/a.ts",
      "src/host/**",
    ])
    assert.deepEqual(read({ decl: chained, use: "exclude: [...EXCLUDED, ...HOST]," }).exclude, [
      "src/a.ts",
      "src/a.ts",
      "src/host/**",
    ])
    // A cycle (a TDZ error at runtime) ends, as an entry of its own text that is opaque.
    const cycle = read({ decl: "const A = [...B]\nconst B = [...A]", use: "exclude: A," })
    assert.deepEqual(cycle.exclude, ["...A"])
    assert.match(cycle.opaque.join("\n"), /^coverage\.exclude: \.\.\.A \(A: /)
    // A chain of any length is followed: the first link grows, the list grows.
    const links = (...first) =>
      [`const A0 = ${JSON.stringify(first)}`]
        .concat([1, 2, 3, 4, 5].map((i) => `const A${i} = [...A${i - 1}]`))
        .join("\n")
    assert.match(
      check(
        config({ decl: links("src/a.ts"), use: "exclude: A5," }),
        config({ decl: links("src/a.ts", "src/**"), use: "exclude: A5," }),
      )[0],
      /new coverage\.exclude entry "src\/\*\*"/,
    )
    for (const decl of [
      'const EXCLUDED = ["src/a.ts"] as const',
      'const EXCLUDED = (["src/a.ts"]) satisfies string[]',
      'const EXCLUDED: string[] = ["src/a.ts"]',
    ])
      for (const use of ["exclude: [...EXCLUDED] as string[],", "exclude: EXCLUDED as string[],"])
        assert.deepEqual(read({ decl, use }).exclude, ["src/a.ts"], `${decl} / ${use}`)
    // An import stays one entry of its own text: its content is the dependency's,
    // and a name the entry declares itself is pinned by that text.
    const imported = read({ use: "exclude: [...coverageConfigDefaults.exclude]," })
    assert.deepEqual(imported.exclude, ["...coverageConfigDefaults.exclude"])
    assert.deepEqual(imported.opaque, [])
    const filtered = read({
      use: 'exclude: coverageConfigDefaults.exclude.filter((glob) => glob !== "x"),',
    })
    assert.deepEqual(filtered.exclude, [
      'coverageConfigDefaults.exclude.filter((glob)=>glob!=="x")',
    ])
    assert.deepEqual(filtered.opaque, [])
  })

  it("reads a string constant and a template of constants as the glob it holds", () => {
    const glob = (value) => config({ decl: `const GEN = ${value}`, use: "exclude: [GEN]," })
    assert.deepEqual(read({ decl: 'const GEN = "src/gen/**"', use: "exclude: [GEN]," }).exclude, [
      "src/gen/**",
    ])
    assert.match(
      check(glob('"src/gen/**"'), glob('"src/**"'))[0],
      /new coverage\.exclude entry "src\/\*\*"/,
    )
    const template = (dir) =>
      config({
        decl: `export const DIR = "${dir}"\nconst GEN = \`\${DIR}/**\``,
        use: "exclude: [GEN, `${DIR}/*.d.ts`, `v${1}`],",
      })
    assert.deepEqual(extractVitestCoverage(PKG_VITEST, template("src/gen")).exclude, [
      "src/gen/**",
      "src/gen/*.d.ts",
      "v1",
    ])
    const widened = check(template("src/gen"), template("src"))
    assert.deepEqual(
      widened.map((v) => v.match(/entry "(.*?)"/)[1]),
      ["src/**", "src/*.d.ts"],
    )
    // A glob moved into a string constant is no change.
    const asLiteral = vitestConfig({
      thresholds: BASE_THRESHOLDS,
      exclude: 'exclude: ["src/gen/**"],',
    })
    assert.deepEqual(check(asLiteral, glob('"src/gen/**"')), [])
  })

  it("reads a list shorthand of a constant also next to keys and members of its name", () => {
    const shorthand = (...entries) =>
      config({ decl: `const exclude = ${JSON.stringify(entries)}`, use: "exclude," })
    assert.deepEqual(extractVitestCoverage(PKG_VITEST, shorthand("src/a.ts")).opaque, [])
    assert.match(
      check(shorthand("src/a.ts"), shorthand("src/a.ts", "src/b.ts"))[0],
      /new coverage\.exclude entry "src\/b\.ts"/,
    )
    // A key `exclude:`, a member `.exclude` or a type names no binding.
    const crowded = read({
      decl: 'const exclude = ["src/a.ts"]\ntype Excluded = typeof exclude',
      use: "exclude,",
      test: 'include: ["src/**/*.test.ts"], exclude: [...coverageConfigDefaults.exclude],',
    })
    assert.deepEqual(crowded.opaque, [])
    assert.deepEqual(crowded.exclude, ["src/a.ts"])
    const include = read({ decl: 'const include = ["src/**"]', use: "include," })
    assert.deepEqual([include.include, include.opaque], [["src/**"], []])
    // A shorthand of anything else stays opaque: another key, or an import.
    const other = config({ decl: "const reporter = ['text']", use: "reporter," })
    assert.deepEqual(extractVitestCoverage(PKG_VITEST, other).opaque, ["reporter"])
    const fromModule = config({ decl: 'import { exclude } from "./excluded"', use: "exclude," })
    assert.deepEqual(extractVitestCoverage(PKG_VITEST, fromModule).opaque, ["exclude"])
  })

  it("reads include, test and project lists from constants too", () => {
    const include = (...globs) =>
      config({ decl: `const MEASURED = ${JSON.stringify(globs)}`, use: "include: MEASURED," })
    assert.match(
      check(include("src/**", "scripts/**"), include("src/**"))[0],
      /coverage\.include lost "scripts\/\*\*"/,
    )
    const testList = (key, ...globs) =>
      config({
        decl: `const TESTS = ${JSON.stringify(globs)}`,
        use: "",
        test: key === "include" ? "include: [...TESTS]," : 'include: ["src/**"], exclude: TESTS,',
      })
    assert.match(
      check(
        testList("exclude", "src/slow/**"),
        testList("exclude", "src/slow/**", "src/flaky/**"),
      )[0],
      /new test\.exclude entry "src\/flaky\/\*\*"/,
    )
    assert.match(
      check(testList("include", "src/**", "test/**"), testList("include", "src/**"))[0],
      /test\.include lost "test\/\*\*"/,
    )
    const project = (include, exclude) => `
import { defineConfig } from "vitest/config"
const UNIT = ${JSON.stringify(include)}
const ENGINE_TESTS = ${JSON.stringify(exclude)}
export default defineConfig({
  test: {
    coverage: { enabled: true, ${BASE_THRESHOLDS} },
    projects: [{ extends: true, test: { name: "unit", include: UNIT, exclude: ENGINE_TESTS } }],
  },
})`
    const ENGINE = "test/**/*.engine.test.ts"
    assert.match(
      check(project(["test/**"], [ENGINE]), project(["test/**"], [ENGINE, "test/ui/**"]))[0],
      /new test\.projects\["unit"\]\.exclude entry "test\/ui\/\*\*"/,
    )
    assert.match(
      check(project(["test/**", "src/**"], [ENGINE]), project(["test/**"], [ENGINE]))[0],
      /test\.projects\["unit"\]\.include lost "src\/\*\*"/,
    )
  })

  it("makes an entry that names a binding it cannot read through opaque, with the reason", () => {
    const shadowed = `
import { defineConfig } from "vitest/config"
${listConst("src/a.ts")}
export default defineConfig(() => {
  const EXCLUDED = ["src/a.ts", "src/b.ts"]
  return { test: { coverage: { enabled: true, exclude: EXCLUDED, ${BASE_THRESHOLDS} } } }
})`
    // Each push below names no member of the constant's name, so only the
    // read itself can tell that the constant may hold more than its literal.
    const viaValues = 'function widen(o) { Object.values(o)[0].push("src/b.ts") }'
    const viaBlock = 'function widen(o) { Object.values(o)[0].exclude.push("src/b.ts") }'
    const NAMED = /named other than as an include\/exclude list/
    for (const [label, after, reason] of [
      ["pushed to", config({ after: 'EXCLUDED.push("src/b.ts")' }), NAMED],
      ["passed on", config({ after: "widen(EXCLUDED)" }), NAMED],
      ["passed on in a shorthand", config({ after: `${viaValues}\nwiden({ EXCLUDED })` }), NAMED],
      [
        "a list shorthand passed on",
        config({
          decl: 'const exclude = ["src/a.ts"]',
          use: "exclude,",
          after: `${viaValues}\nwiden({ exclude })`,
        }),
        NAMED,
      ],
      [
        "the list key of another block",
        config({ after: `${viaBlock}\nwiden({ opts: { exclude: EXCLUDED } })` }),
        NAMED,
      ],
      [
        "another key of the block",
        config({ use: "exclude: EXCLUDED, reportsDirectory: EXCLUDED," }),
        NAMED,
      ],
      ["exported", config({ decl: `export ${listConst("src/a.ts")}` }), /exported/],
      ["exported by name", config({ after: "export { EXCLUDED }" }), /exported/],
      [
        "declared with let",
        config({ decl: listConst("src/a.ts").replace("const", "let") }),
        /let or var/,
      ],
      ["shadowed", shadowed, /declared more than once/],
      ["local", shadowed.replace(`${listConst("src/a.ts")}\n`, ""), /no top-level const/],
      [
        "no literal",
        config({ decl: 'const EXCLUDED = ["src/a.ts"].filter(Boolean)' }),
        /no array, string or template literal/,
      ],
      [
        "a function",
        config({
          decl: 'function EXCLUDED() { return ["src/a.ts"] }',
          use: "exclude: EXCLUDED(),",
        }),
        /no top-level const/,
      ],
      ["changed in eval", config({ after: `eval('EXCLUDED.push("src/b.ts")')` }), /calls eval/],
    ]) {
      const violations = check(literal, after).join("\n")
      assert.match(violations, /new coverage\.exclude entry "(EXCLUDED|exclude)(\(\))?"/, label)
      assert.match(violations, /new spread\/shorthand or non-literal `coverage\.exclude: /, label)
      assert.match(violations, reason, label)
      // A config that introduces one fails: from then on it could grow unseen.
      const introduced = checkRatchetFile(PKG_VITEST, null, after).join("\n")
      assert.match(introduced, /nothing to compare against/, label)
      assert.match(introduced, reason, label)
    }
  })

  it("keeps the code an unread binding hangs on in sight: an edit to it is a new opaque entry", () => {
    const PUSH = 'EXCLUDED.push("src/b.ts")'
    const helper = (globs) => `function widen(list) { list.push(${globs}) }\nwiden(EXCLUDED)`
    const evaluated = (globs) => `eval('EXCLUDED.push(${globs})')`
    for (const [label, before, after] of [
      ["the literal", { after: PUSH }, { after: PUSH, decl: listConst("src/a.ts", "src/**") }],
      ["the push", { after: PUSH }, { after: 'EXCLUDED.push("src/b.ts", "src/**")' }],
      ["a helper it is passed to", { after: helper('"b"') }, { after: helper('"b", "src/**"') }],
      ["the code eval runs", { after: evaluated('"b"') }, { after: evaluated('"b", "src/**"') }],
    ]) {
      const violations = check(config(before), config(after))
      assert.equal(violations.length, 1, label)
      assert.match(
        violations[0],
        /new spread\/shorthand or non-literal `coverage\.exclude: EXCLUDED/,
        label,
      )
    }
    // Unchanged, it stays as the base had it.
    assert.deepEqual(check(config({ after: PUSH }), config({ after: PUSH })), [])
  })

  it("holds a helper object with a block of its own to the one-block rule", () => {
    // A list key of a test or coverage block reads as harmless only because the
    // ratchet reads every such block or fails on the file.
    for (const [after, error] of [
      [
        'const helper = { coverage: { exclude: EXCLUDED } }\nhelper.coverage.exclude.push("src/**")',
        /2 `coverage` blocks/,
      ],
      [
        'const helper = { test: { exclude: EXCLUDED } }\nhelper.test.exclude.push("src/**")',
        /2 `test` blocks/,
      ],
    ])
      assert.match(check(config(), config({ after })).join("\n"), error)
  })
})

describe("stryker policy (break raise-only, mutate grow-only)", () => {
  const rel = "packages/core/widget-shell/stryker.config.json"
  const json = (o) => JSON.stringify(o)
  const base = json({ mutate: ["src/a.ts", "src/b.ts"], thresholds: { break: 60 } })

  it("flags a lowered break", () => {
    const violations = checkRatchetFile(
      rel,
      base,
      json({ mutate: ["src/a.ts", "src/b.ts"], thresholds: { break: 50 } }),
    )
    assert.equal(violations.length, 1)
    assert.match(violations[0], /60 -> 50/)
  })

  it("flags a shrunken allowlist without a break raise", () => {
    const violations = checkRatchetFile(
      rel,
      base,
      json({ mutate: ["src/a.ts"], thresholds: { break: 60 } }),
    )
    assert.equal(violations.length, 1)
    assert.match(violations[0], /measuring less/)
  })

  it("accepts shrinking together with a break raise, and growing", () => {
    assert.deepEqual(
      checkRatchetFile(rel, base, json({ mutate: ["src/a.ts"], thresholds: { break: 70 } })),
      [],
    )
    assert.deepEqual(
      checkRatchetFile(
        rel,
        base,
        json({ mutate: ["src/a.ts", "src/b.ts", "src/c.ts"], thresholds: { break: 60 } }),
      ),
      [],
    )
  })

  it("lets an entry go whose file no longer exists (deleted or renamed)", () => {
    const gone = (p) => !p.endsWith("/src/b.ts")
    assert.deepEqual(
      checkRatchetFile(
        rel,
        base,
        json({ mutate: ["src/a.ts", "src/b2.ts"], thresholds: { break: 60 } }),
        gone,
      ),
      [],
    )
  })

  it("negations invert the direction", () => {
    const negBase = json({ mutate: ["src/*.ts", "!src/untested.ts"], thresholds: { break: 60 } })
    assert.deepEqual(
      checkRatchetFile(rel, negBase, json({ mutate: ["src/*.ts"], thresholds: { break: 60 } })),
      [],
    )
    const violations = checkRatchetFile(
      rel,
      negBase,
      json({ mutate: ["src/*.ts", "!src/untested.ts", "!src/out.ts"], thresholds: { break: 60 } }),
    )
    assert.equal(violations.length, 1)
    assert.match(violations[0], /!src\/out\.ts/)
  })

  it("flags excluded mutators and a deleted config", () => {
    const violations = checkRatchetFile(
      rel,
      base,
      json({
        mutate: ["src/a.ts", "src/b.ts"],
        thresholds: { break: 60 },
        mutator: { excludedMutations: ["StringLiteral"] },
      }),
    )
    assert.match(violations[0], /excludedMutations entry "StringLiteral"/)
    assert.match(checkRatchetFile(rel, base, null)[0], /was removed/)
  })

  it("flags a broken new file", () => {
    assert.match(checkRatchetFile(rel, base, "{ nope")[0], /not valid JSON/)
  })

  it("pins every option that decides which mutants exist or how they count", () => {
    const withOption = (extra) =>
      json({ mutate: ["src/a.ts", "src/b.ts"], thresholds: { break: 60 }, ...extra })
    for (const extra of [
      { ignoreStatic: true },
      { ignorers: ["console"] },
      // A timed-out mutant counts as DETECTED: a tiny timeout "kills" them all.
      { timeoutMS: 1 },
      { timeoutFactor: 0.01 },
      { mutator: { plugins: ["jsx"] } },
      { testRunner: "command" },
      { vitest: { configFile: "vitest.lax.config.ts" } },
    ]) {
      const violations = checkRatchetFile(rel, base, withOption(extra))
      assert.equal(violations.length, 1, JSON.stringify(extra))
      assert.match(violations[0], /pinned to the merge base/)
    }
  })

  it("leaves report-only options and the low/high bands free", () => {
    assert.deepEqual(
      checkRatchetFile(
        rel,
        base,
        json({
          mutate: ["src/a.ts", "src/b.ts"],
          thresholds: { break: 60, high: 90, low: 70 },
          concurrency: 2,
          reporters: ["json"],
          incremental: false,
        }),
      ),
      [],
    )
  })
})

describe("eslint ratchets (ignores shrink-only, no local import)", () => {
  const config = ({ ignores = '"**/dist/**"', pre = "", extraBlocks = "" } = {}) => `${pre}
export default [
  { ignores: [${ignores}] },
  {
    files: ["packages/*/src/**/*.ts"],
    rules: { complexity: ["error", 15] },
  },
  ${extraBlocks}
]`
  const base = config()

  it("reads the real eslint.config.mjs: its ignores, no opaque entry and no local import", () => {
    const { ignores, opaque, imports } = extractEslintRatchets(
      "eslint.config.mjs",
      readFileSync("eslint.config.mjs", "utf8"),
    )
    assert.ok(ignores.length > 0)
    assert.deepEqual(opaque, [])
    assert.deepEqual(imports, [])
  })

  it("accepts a dropped ignore and a dropped block", () => {
    assert.deepEqual(checkRatchetFile("eslint.config.mjs", base, config({ ignores: "" })), [])
    assert.deepEqual(
      checkRatchetFile(
        "eslint.config.mjs",
        config({ extraBlocks: '{ files: ["src/x.ts"], rules: { "max-lines": "off" } },' }),
        base,
      ),
      [],
    )
  })

  it("flags a grown ignores list", () => {
    const violations = checkRatchetFile(
      "eslint.config.mjs",
      base,
      config({ ignores: '"**/dist/**", "packages/x/src/tools/raw.ts"' }),
    )
    assert.equal(violations.length, 1)
    assert.match(violations[0], /new `ignores` entry "packages\/x\/src\/tools\/raw\.ts"/)
  })

  it("flags an ignore in a block of a rule the effective-config check does not compare", () => {
    const block = (ignores) =>
      `{ files: ["src/**"], ignores: [${ignores}], rules: { "no-restricted-imports": ["error", "x"] } },`
    const violations = checkRatchetFile(
      "eslint.config.mjs",
      config({ extraBlocks: block("") }),
      config({ extraBlocks: block('"src/widgets/**"') }),
    )
    assert.equal(violations.length, 1)
    assert.match(
      violations[0],
      /"src\/widgets\/\*\*" \(exempts from: rules no-restricted-imports\)/,
    )
  })

  it("resolves exemption lists moved into constants, and still sees them grow", () => {
    const gate = (list) =>
      `${list}\nexport default [{ files: ["src/**"], ignores: [...exempt], rules: { "no-restricted-syntax": ["error"] } }]`
    const literal = `const exempt = []\nexport default [{ files: ["src/**"], ignores: ["src/widget-tools.ts"], rules: { "no-restricted-syntax": ["error"] } }]`
    assert.deepEqual(
      checkRatchetFile(
        "eslint.config.mjs",
        literal,
        gate('const exempt = ["src/widget-tools.ts"]'),
      ),
      [],
    )
    const grown = checkRatchetFile(
      "eslint.config.mjs",
      literal,
      gate('const exempt = ["src/widget-tools.ts", "src/tools/raw.ts"]'),
    )
    assert.equal(grown.length, 1)
    assert.match(grown[0], /src\/tools\/raw\.ts/)
  })

  it("keys an ignore by the block it sits in: copying an exemption into the global ignores is new", () => {
    const gates = (globalIgnores) => `export default [
  { ignores: [${globalIgnores}] },
  { files: ["src/**/*.ts"], ignores: ["src/widget-tools/**"], rules: { "no-restricted-syntax": ["error", "X"] } },
]`
    const violations = checkRatchetFile(
      "eslint.config.mjs",
      gates('"**/dist/**"'),
      gates('"**/dist/**", "src/widget-tools/**"'),
    )
    assert.equal(violations.length, 1)
    assert.match(violations[0], /entry "src\/widget-tools\/\*\*" \(exempts from: every rule/)
  })

  it("resolves a shorthand `ignores` const and sees it grow", () => {
    const block = (ignores) =>
      `export default [{ files: ["src/**"], ${ignores}, rules: { "no-restricted-syntax": ["error"] } }]`
    const violations = checkRatchetFile(
      "eslint.config.mjs",
      block('ignores: ["src/widget-tools.ts"]'),
      `const ignores = ["src/widget-tools.ts", "src/tools/**"]\n${block("ignores")}`,
    )
    assert.equal(violations.length, 1)
    assert.match(violations[0], /src\/tools\/\*\*/)
  })

  it("flags a local or dynamic import: the base would be evaluated with today's module", () => {
    for (const [label, pre, extraBlocks] of [
      ["local import", 'import lax from "./lax.mjs"', "...lax,"],
      ["dynamic import", "", '...(await import("./lax.mjs")).default,'],
      ["require", "", '...require("./lax.cjs"),'],
    ]) {
      const violations = checkRatchetFile("eslint.config.mjs", base, config({ pre, extraBlocks }))
      assert.equal(violations.length, 1, label)
      assert.match(violations[0], /evaluates the base config next to today's files/, label)
    }
    assert.deepEqual(
      checkRatchetFile(
        "eslint.config.mjs",
        base,
        config({ pre: 'import tseslint from "typescript-eslint"' }),
      ),
      [],
    )
  })

  it("flags a removed config", () => {
    assert.match(checkRatchetFile("eslint.config.mjs", base, null)[0], /was removed/)
  })

  it("ignores parser-project partitions (no rules): they route files, not exempt them", () => {
    const partition = (globs) =>
      `export default [{ ignores: [${globs}], languageOptions: { parserOptions: {} } }]`
    assert.deepEqual(
      checkRatchetFile(
        "eslint.config.mjs",
        partition('"ui/**"'),
        partition('"ui/**", "widgets/**"'),
      ),
      [],
    )
  })
})

describe("eslint ignores built from a constant (read entry by entry only where nothing can grow it)", () => {
  const exempt = (...globs) => `const EXEMPT = ${JSON.stringify(globs)}`
  // A config whose gate block's `ignores` names, spreads or is shorthand for a constant.
  const config = ({
    decl = exempt("src/widget-tools.ts"),
    after = "",
    use = "ignores: EXEMPT,",
    blocks = "",
    callee = "tseslint.config",
  } = {}) => `import tseslint from "typescript-eslint"
${decl}
${after}
export default ${callee}(
  { ignores: ["**/dist/**"] },
  { files: ["src/**"], ${use} rules: { "no-restricted-syntax": ["error", "X"] } },
  ${blocks}
)`
  const check = (before, after) => checkRatchetFile("eslint.config.mjs", before, after)
  const read = (options) => extractEslintRatchets("eslint.config.mjs", config(options))
  const GATE = "rules no-restricted-syntax :: "
  const GLOBAL = "every rule (global ignores) :: **/dist/**"
  // The constant shared with the files list of another gate and the ignores of a partition.
  const SHARED =
    '{ files: EXEMPT, rules: { complexity: ["error", 15] } }, { ignores: [...EXEMPT], languageOptions: {} },'
  const literal = config({ decl: "", use: 'ignores: ["src/widget-tools.ts"],' })

  it("reads a constant the blocks share as files and ignores lists entry by entry", () => {
    for (const use of ["ignores: EXEMPT,", "ignores: [...EXEMPT],", "ignores: (EXEMPT),"]) {
      const shared = read({ use, blocks: SHARED })
      assert.deepEqual(shared.opaque, [], use)
      assert.deepEqual(shared.ignores, [GLOBAL, `${GATE}src/widget-tools.ts`], use)
    }
    // A literal computed key is the same key to ESLint.
    const computed = read({
      blocks: '{ ["files"]: EXEMPT, rules: { complexity: ["error", 15] } },',
    })
    assert.deepEqual(
      [computed.ignores, computed.opaque],
      [[GLOBAL, `${GATE}src/widget-tools.ts`], []],
    )
    const shorthand = read({ decl: 'const ignores = ["src/widget-tools.ts"]', use: "ignores," })
    assert.deepEqual(
      [shorthand.ignores, shorthand.opaque],
      [[GLOBAL, `${GATE}src/widget-tools.ts`], []],
    )
    // Moving a literal list into a constant and back is no change, also for a config it introduces.
    assert.deepEqual(check(literal, config({ blocks: SHARED })), [])
    assert.deepEqual(check(config({ blocks: SHARED }), literal), [])
    assert.deepEqual(check(null, config({ blocks: SHARED })), [])
  })

  it("fails a shared constant that grows and passes one that shrinks", () => {
    for (const use of ["ignores: EXEMPT,", 'ignores: ["src/x.ts", ...EXEMPT],']) {
      const grown = check(
        config({ use, blocks: SHARED }),
        config({ use, blocks: SHARED, decl: exempt("src/widget-tools.ts", "src/tools/**") }),
      )
      assert.equal(grown.length, 1, use)
      assert.match(
        grown[0],
        /new `ignores` entry "src\/tools\/\*\*" \(exempts from: rules no-restricted-syntax\)/,
        use,
      )
      assert.deepEqual(
        check(
          config({ use, blocks: SHARED, decl: exempt("src/widget-tools.ts", "src/tools/**") }),
          config({ use, blocks: SHARED }),
        ),
        [],
        use,
      )
    }
  })

  it("reads a string constant and a template of constants as the glob it holds", () => {
    const glob = (dir) =>
      config({
        decl: `const DIR = "${dir}"\nconst GEN = \`\${DIR}/**\``,
        use: "ignores: [GEN, `${DIR}/*.d.ts`],",
      })
    assert.deepEqual(extractEslintRatchets("eslint.config.mjs", glob("src/gen")).ignores, [
      GLOBAL,
      `${GATE}src/gen/**`,
      `${GATE}src/gen/*.d.ts`,
    ])
    assert.deepEqual(
      check(glob("src/gen"), glob("src")).map((v) => v.match(/entry "(.*?)"/)[1]),
      ["src/**", "src/*.d.ts"],
    )
    assert.deepEqual(
      check(
        config({ decl: "", use: 'ignores: ["src/gen/**", "src/gen/*.d.ts"],' }),
        glob("src/gen"),
      ),
      [],
    )
  })

  it("reads blocks the exported config holds through arrays, spreads and its imported helper's call", () => {
    const gate = '{ files: ["src/**"], ignores: EXEMPT, rules: { complexity: ["error", 15] } }'
    const exporting = (exported, pre = "") =>
      extractEslintRatchets(
        "eslint.config.mjs",
        `import js from "@eslint/js"
import tseslint from "typescript-eslint"
import { defineConfig } from "eslint/config"
${exempt("src/widget-tools.ts")}
const BLOCKS = [{ rules: {} }]
let LET_BLOCKS = [{ rules: {} }]
function widen(...blocks) { return blocks }
const HANDED = [widen]
const CYCLE = [CYCLE_BACK]
const CYCLE_BACK = [CYCLE]
const lib = { config: widen }
${pre}
export default ${exported}`,
      )
    const readable = [["rules complexity :: src/widget-tools.ts"], []]
    for (const exported of [
      gate,
      `[${gate}]`,
      `[[${gate}]]`,
      `[...[${gate}]]`,
      `([(${gate})])`,
      `tseslint.config(${gate})`,
      `tseslint.config([${gate}])`,
      `(tseslint.config(...[${gate}]))`,
      `(tseslint as any).config(${gate})`,
      `(tseslint.config)(${gate})`,
      `defineConfig([${gate}])`,
      // An import's value and a const of the file holding blocks hand the helper no code.
      `tseslint.config(js.configs.recommended, ...tseslint.configs.strict, ${gate}, ...BLOCKS)`,
    ]) {
      const { ignores, opaque } = exporting(exported)
      assert.deepEqual([ignores, opaque], readable, exported)
    }
    // Other reads of the helper's import that leave its callee as it is.
    for (const [pre, exported = `tseslint.config(${gate})`] of [
      ["const strict = tseslint.configs.strict"],
      ["const strict = (tseslint as any).configs.strict"],
      ["tseslint.configs.strict = []"],
      ["const unused = tseslint.config({})"],
      ["const unused = (tseslint.config as any)({})"],
      ["const name = tseslint.config.name"],
      ['const name = tseslint.config["name"]'],
      ["const unused = defineConfig([])", `defineConfig([${gate}])`],
      // A second import cannot rebind an import binding called itself.
      ['import { defineConfig as again } from "eslint/config"', `defineConfig([${gate}])`],
    ]) {
      const { ignores, opaque } = exporting(exported, pre)
      assert.deepEqual([ignores, opaque], readable, pre)
    }
    const NO_BLOCK = /no block of the exported config/
    const CALLEE = /callee is no import of the file/
    const HANDS = /may hand the helper code/
    const IMPORT = /hands on or writes the import/
    const AGAIN = /imports the module of the exported call's helper a second time/
    // A block another function receives, or the callee of the exported call, is none, nor
    // is a block of a call that is no imported helper's, can be changed or receives code.
    for (const [exported, reason, pre] of [
      [`tseslint.config(widen(${gate}))`, NO_BLOCK],
      [`[widen(${gate})]`, NO_BLOCK],
      [`new Config(${gate})`, NO_BLOCK],
      [`(${gate})()`, NO_BLOCK],
      [`[${gate}].map((block) => block)`, NO_BLOCK],
      [`[tseslint.config(${gate})]`, NO_BLOCK],
      [`widen(${gate})`, CALLEE],
      [`lib.config(${gate})`, CALLEE],
      [`Reflect.apply(widen, null, [${gate}])`, CALLEE],
      // A callee that does not rest on a name is no import either.
      [`((...blocks) => blocks)(${gate})`, CALLEE],
      [`tseslint.config.bind(null)(${gate})`, CALLEE],
      [`tseslint.config(${gate}, widen)`, HANDS],
      // The first argument hands code as much as any other ...
      [`tseslint.config(widen, ${gate})`, HANDS],
      [`tseslint.config(${gate}, (blocks) => blocks)`, HANDS],
      [`tseslint.config(${gate}, [widen])`, HANDS],
      // ... and so does an array with one element that hands it, whatever the others hold.
      [`tseslint.config(${gate}, [widen, {}])`, HANDS],
      [`tseslint.config(${gate}, ...HANDED)`, HANDS],
      [`tseslint.config(${gate}, ...LET_BLOCKS)`, HANDS],
      // A name declared twice may be either declaration, whichever comes first.
      [
        `tseslint.config(${gate}, ...TWICE)`,
        HANDS,
        "function shadow() { const TWICE = [{ rules: {} }] }\nconst TWICE = [widen]",
      ],
      [
        `tseslint.config(${gate}, ...TWICE)`,
        HANDS,
        "const TWICE = [widen]\nfunction shadow() { const TWICE = [{ rules: {} }] }",
      ],
      [`tseslint.config(${gate}, ...CYCLE)`, HANDS],
      [`tseslint.config(${gate}, ...BLOCKS.map(widen))`, HANDS],
      [`tseslint.config(${gate})`, IMPORT, "tseslint.config = widen"],
      [`tseslint.config(${gate})`, IMPORT, "(tseslint as any).config = widen"],
      [`tseslint.config(${gate})`, IMPORT, 'tseslint["config"] = widen'],
      [`tseslint.config(${gate})`, IMPORT, "Object.assign(tseslint, lib)"],
      [`tseslint.config(${gate})`, IMPORT, "delete tseslint.config"],
      [`tseslint.config(${gate})`, /calls eval/, "eval('')"],
      [
        `tseslint.config(${gate})`,
        AGAIN,
        'import * as again from "typescript-eslint"\nagain.default.config = widen',
      ],
      [`tseslint.config(${gate})`, AGAIN, 'import { config } from "typescript-eslint"'],
      [`tseslint.config(${gate})`, AGAIN, 'import again from "typescript-eslint"'],
      // An import the reader cannot place counts as a second one.
      [`cfg.config(${gate})`, AGAIN, 'import cfg = require("typescript-eslint")'],
    ]) {
      const label = `${pre ?? ""} ${exported}`
      const { ignores, opaque } = exporting(exported, pre)
      assert.deepEqual(ignores, ["rules complexity :: EXEMPT"], label)
      assert.match(opaque.join("\n"), /\(EXEMPT: /, label)
      const block = opaque.find((entry) => entry.includes(": the list of its block ("))
      assert.match(block, reason, label)
    }
  })

  it("makes an ignores entry opaque wherever the constant could grow, with the reason, and fails it", () => {
    // Each push below names no member of the constant's name, so only the read
    // itself can tell that the constant may hold more than its literal.
    const viaValues = 'function widen(o) { Object.values(o)[0].push("src/**") }'
    const viaBlock = 'function widen(o) { o.files.push("src/**"); return o }'
    const NAMED = /named other than as a files\/ignores list of a block of the exported config/
    for (const [label, options, reason] of [
      ["pushed to", { after: 'EXEMPT.push("src/**")' }, NAMED],
      ["spliced", { after: 'EXEMPT.splice(0, 0, "src/**")' }, NAMED],
      ["assigned to", { after: 'EXEMPT[1] = "src/**"' }, NAMED],
      ["passed on", { after: "widen(EXEMPT)" }, NAMED],
      ["passed on in a shorthand", { after: `${viaValues}\nwiden({ EXEMPT })` }, NAMED],
      [
        "the files list of a block outside the config",
        { after: `${viaValues}\nwiden({ files: EXEMPT })` },
        NAMED,
      ],
      [
        "the ignores list of a named block",
        { after: 'const block = { ignores: EXEMPT, rules: {} }\nblock.ignores.push("src/**")' },
        NAMED,
      ],
      [
        "a block the config passes to another function",
        { after: viaBlock, blocks: "widen({ files: EXEMPT, rules: {} })," },
        NAMED,
      ],
      [
        "a block nested in another key",
        { blocks: "{ settings: { nested: { files: EXEMPT } } }," },
        NAMED,
      ],
      // A rule can change what it receives through settings.
      ["another key of a block", { blocks: "{ files: [], settings: EXEMPT }," }, NAMED],
      // A block's own code reaches its lists as `this`.
      [
        "the files list of a block with an accessor",
        { blocks: "{ files: EXEMPT, get languageOptions() { return {} } }," },
        NAMED,
      ],
      [
        "the files list of a block with a setter",
        { blocks: "{ files: EXEMPT, set languageOptions(value) {} }," },
        NAMED,
      ],
      [
        "the files list of a block with a method",
        { blocks: "{ files: EXEMPT, toJSON() { return {} } }," },
        NAMED,
      ],
      [
        "the files list of a block with a function a caller runs as its method",
        { blocks: "{ files: EXEMPT, toJSON: (function () { return {} }) }," },
        NAMED,
      ],
      [
        "the files list of a block with __proto__",
        { blocks: "{ files: EXEMPT, __proto__: {} }," },
        NAMED,
      ],
      [
        'the files list of a block with "__proto__"',
        { blocks: '{ files: EXEMPT, "__proto__": {} },' },
        NAMED,
      ],
      [
        "a block of a local function's call",
        { after: "function widen(...blocks) { return blocks }", callee: "widen" },
        NAMED,
      ],
      [
        "a block of a local object's config",
        { after: "const lib = { config: (...blocks) => blocks }", callee: "lib.config" },
        NAMED,
      ],
      [
        "a block of a helper whose import the file writes",
        { after: "tseslint.config = (...blocks) => blocks" },
        NAMED,
      ],
      ["a block of a helper handed a function", { blocks: "(blocks) => blocks," }, NAMED],
      ["a member of a block", { blocks: "...({ files: EXEMPT }).files.concat([])," }, NAMED],
      ["exported", { decl: `export ${exempt("src/widget-tools.ts")}` }, /exported/],
      ["exported by name", { after: "export { EXEMPT }" }, /exported/],
      [
        "declared with let",
        { decl: exempt("src/widget-tools.ts").replace("const", "let") },
        /let or var/,
      ],
      [
        "shadowed",
        { after: "function widen(EXEMPT) { return EXEMPT }" },
        /declared more than once/,
      ],
      [
        "no literal",
        { decl: 'const EXEMPT = ["src/widget-tools.ts"].concat([])' },
        /no array, string or template literal/,
      ],
      [
        "a function",
        { decl: 'function EXEMPT() { return ["src/widget-tools.ts"] }', use: "ignores: EXEMPT()," },
        /no top-level const/,
      ],
      ["changed in eval", { after: `eval('EXEMPT.push("src/**")')` }, /calls eval/],
    ]) {
      const after = config(options)
      const violations = check(literal, after).join("\n")
      assert.match(violations, /new `ignores` entry "EXEMPT(\(\))?"/, label)
      assert.match(
        violations,
        /new `ignores` entry the ratchet cannot read through: `ignores \(exempts from: rules no-restricted-syntax\): EXEMPT(\(\))? \(EXEMPT: /,
        label,
      )
      assert.match(violations, reason, label)
      // A config that introduces one fails: from then on it could grow unseen.
      const introduced = check(null, after).join("\n")
      assert.match(
        introduced,
        /nothing to compare against: `ignores \(exempts from: rules no-restricted-syntax\): EXEMPT/,
        label,
      )
      assert.match(introduced, reason, label)
    }
  })

  it("keeps the code an unread constant hangs on in sight: an edit to it is a new opaque entry", () => {
    const PUSH = 'EXEMPT.push("src/b.ts")'
    // A block of the exported config that names the constant other than in a list holds it
    // whole: code anywhere in that block reaches it, here as `this.settings.list`.
    const HOLDER = '{ files: ["x/**"], settings: { list: EXEMPT }'
    const GETTER = 'get languageOptions() { this.settings.list.push("src/**"); return {} }'
    for (const [label, before, after] of [
      [
        "the literal",
        { after: PUSH },
        { after: PUSH, decl: exempt("src/widget-tools.ts", "src/**") },
      ],
      ["the push", { after: PUSH }, { after: 'EXEMPT.push("src/b.ts", "src/**")' }],
      [
        "the block that names it",
        { blocks: `${HOLDER} },` },
        { blocks: `${HOLDER}, ${GETTER} },` },
      ],
    ]) {
      const violations = check(config(before), config(after))
      assert.equal(violations.length, 1, label)
      assert.match(
        violations[0],
        /read through: `ignores \(exempts from: [^)]*\): EXEMPT \(EXEMPT: /,
        label,
      )
    }
    // Unchanged, it stays as the base had it.
    assert.deepEqual(check(config({ after: PUSH }), config({ after: PUSH })), [])
  })

  it("keeps the list of any other exempting block opaque, with the code that reaches the block", () => {
    const head = 'import tseslint from "typescript-eslint"\n'
    const LIST = 'ignores: ["src/a.ts"], rules: { "no-restricted-imports": "error" }'
    const NO_BLOCK = /\(the block is no block of the exported config/
    const RUNS = /\(the block runs code of its own/
    for (const [label, before, after, reason] of [
      [
        "a named block",
        `const gate = { files: ["src/**"], ${LIST} }\nexport default tseslint.config(gate)`,
        `const gate = { files: ["src/**"], ${LIST} }\ngate.ignores.push("src/**")\nexport default tseslint.config(gate)`,
        NO_BLOCK,
      ],
      [
        "a named block whose list is an unread constant",
        `const EXEMPT = ["src/a.ts"]\nconst gate = { ignores: EXEMPT, rules: {} }\nexport default [gate]`,
        `const EXEMPT = ["src/a.ts"]\nconst gate = { ignores: EXEMPT, rules: {} }\ngate.ignores.push("src/**")\nexport default [gate]`,
        NO_BLOCK,
      ],
      [
        "a block a local function receives",
        `function widen(block) { return block }\nexport default [widen({ ${LIST} })]`,
        `function widen(block) { block.ignores.push("src/**"); return block }\nexport default [widen({ ${LIST} })]`,
        NO_BLOCK,
      ],
      [
        "a block a global hands to a local function",
        `function widen(...blocks) { return blocks }\nexport default Reflect.apply(widen, null, [{ ${LIST} }])`,
        `function widen(...blocks) { blocks[0].ignores.push("src/**"); return blocks }\nexport default Reflect.apply(widen, null, [{ ${LIST} }])`,
        /\(the exported call's callee is no import of the file/,
      ],
      [
        "a block an object with a getter holds",
        `const all = { gate: { ${LIST} }, get other() { return {} } }\nexport default [all.gate]`,
        `const all = { gate: { ${LIST} }, get other() { this.gate.ignores.push("src/**"); return {} } }\nexport default [all.gate]`,
        NO_BLOCK,
      ],
      [
        "a block with an accessor",
        `export default [{ ${LIST}, get languageOptions() { return {} } }]`,
        `export default [{ ${LIST}, get languageOptions() { this.ignores.push("src/**"); return {} } }]`,
        RUNS,
      ],
      // A block in a callee's place is handed every argument of the call, data too: the reader
      // does not tell that calling an object throws.
      [
        "the arguments of a call of a block",
        `export default [({ ${LIST} })({ files: ["x"] })]`,
        `export default [({ ${LIST} })({ files: ["y"] })]`,
        NO_BLOCK,
      ],
    ]) {
      // An edit to the code that reaches the block is a new opaque entry ...
      const violations = check(head + before, head + after)
      assert.equal(violations.length, 1, label)
      assert.match(
        violations[0],
        /new `ignores` entry the ratchet cannot read through: `ignores \(exempts from: rules [^)]*\): the list of its block \(/,
        label,
      )
      assert.match(violations[0], reason, label)
      // ... unchanged, it stays as the base had it, and a config that introduces one fails.
      assert.deepEqual(check(head + before, head + before), [], label)
      assert.match(
        check(null, head + before).join("\n"),
        /nothing to compare against: `ignores \(exempts from: rules [^)]*\): the list of its block/,
        label,
      )
    }
    // The entries themselves compare as ever: the list may shrink, not grow.
    const named = (globs, other = "x") =>
      `${head}const gate = { files: ["src/**"], ignores: ${JSON.stringify(globs)}, rules: { "no-restricted-imports": "error" } }
export default tseslint.config(gate, { files: ["${other}"], rules: {} })`
    assert.deepEqual(check(named(["src/a.ts", "src/b.ts"]), named(["src/a.ts"])), [])
    // Data next to the block reaches it no more than other blocks of the exported config do,
    // so an edit to them is no new entry.
    const GATE_BLOCK = `{ ${LIST} }`
    for (const [label, config] of [
      ["another block of the exported config", (other) => named(["src/a.ts"], other)],
      [
        "another element of an array",
        (other) =>
          `${head}function widen(block) { return block }\nexport default [widen(${GATE_BLOCK}), { files: ["${other}"], rules: {} }]`,
      ],
      [
        "an object argument of the call",
        (other) =>
          `${head}function widen(block) { return block }\nexport default [widen(${GATE_BLOCK}, { files: ["${other}"] })]`,
      ],
      [
        "an object argument of a constructor call",
        (other) =>
          `${head}function Widen(block) { return block }\nexport default [new Widen(${GATE_BLOCK}, { files: ["${other}"] })]`,
      ],
      [
        "another key of an object",
        (other) =>
          `${head}const all = { gate: ${GATE_BLOCK}, other: { files: ["${other}"] } }\nexport default [all.gate]`,
      ],
    ])
      assert.deepEqual(check(config("x"), config("y")), [], label)
    const grown = check(named(["src/a.ts"]), named(["src/a.ts", "src/**"]))
    assert.equal(grown.length, 1)
    assert.match(
      grown[0],
      /new `ignores` entry "src\/\*\*" \(exempts from: rules no-restricted-imports\)/,
    )
  })
})

describe("knip policy (ignore lists shrink-only)", () => {
  const base = `{
    // comment
    "ignore": ["templates/**"],
    "workspaces": { "docs": { "ignoreDependencies": ["vue",], }, },
  }`

  it("flags grown top-level and nested ignore lists", () => {
    const top = base.replace('["templates/**"]', '["templates/**", "src/dead.ts"]')
    assert.match(checkRatchetFile("knip.jsonc", base, top)[0], /src\/dead\.ts/)
    const nested = base.replace('["vue",]', '["vue", "left-pad"]')
    assert.match(checkRatchetFile("knip.jsonc", base, nested)[0], /left-pad/)
  })

  it("flags a config-level issue-type exclude, a relaxed rule and a boolean ignore", () => {
    const relaxed = (extra) => base.replace('"ignore":', `${extra}, "ignore":`)
    assert.match(
      checkRatchetFile("knip.jsonc", base, relaxed('"exclude": ["files"]'))[0],
      /exclude: files/,
    )
    assert.match(
      checkRatchetFile("knip.jsonc", base, relaxed('"rules": { "dependencies": "warn" }'))[0],
      /rules\.dependencies: warn/,
    )
    assert.match(
      checkRatchetFile("knip.jsonc", base, relaxed('"ignoreExportsUsedInFile": true'))[0],
      /ignoreExportsUsedInFile: true/,
    )
    assert.deepEqual(
      checkRatchetFile("knip.jsonc", base, relaxed('"rules": { "files": "error" }')),
      [],
    )
  })

  it("flags an issue-type include, a workspace project and a new entry glob", () => {
    const relaxed = (extra) => base.replace('"ignore":', `${extra}, "ignore":`)
    assert.match(
      checkRatchetFile("knip.jsonc", base, relaxed('"include": ["files"]'))[0],
      /"include" appeared/,
    )
    const scoped = base.replace(
      '"ignoreDependencies"',
      '"project": ["src/**"], "ignoreDependencies"',
    )
    assert.match(checkRatchetFile("knip.jsonc", base, scoped)[0], /workspaces\.docs\.project/)
    const entry = base.replace(
      '"ignoreDependencies"',
      '"entry": ["src/dead.ts"], "ignoreDependencies"',
    )
    assert.match(checkRatchetFile("knip.jsonc", base, entry)[0], /entry: src\/dead\.ts/)
  })

  it("lets an existing include grow but never shrink", () => {
    const withInclude = (types) =>
      base.replace('"ignore":', `"include": ${JSON.stringify(types)}, "ignore":`)
    const old = withInclude(["files", "dependencies"])
    assert.deepEqual(
      checkRatchetFile("knip.jsonc", old, withInclude(["files", "dependencies", "unlisted"])),
      [],
    )
    assert.match(
      checkRatchetFile("knip.jsonc", old, withInclude(["files"]))[0],
      /lost "dependencies"/,
    )
    assert.deepEqual(checkRatchetFile("knip.jsonc", old, base), [])
  })

  it("accepts shrinking and reads the real knip.jsonc", () => {
    assert.deepEqual(checkRatchetFile("knip.jsonc", base, base.replace('"vue",', "")), [])
    const real = readFileSync("knip.jsonc", "utf8")
    assert.deepEqual(checkRatchetFile("knip.jsonc", real, real), [])
  })
})

describe("char budgets (shrink-only)", () => {
  const rel = "apps/mcp-server/test/__golden__/char-budgets.json"
  const base = JSON.stringify({ $comment: "x", "tools-admin": 1000 })

  it("flags growth and removal, accepts shrinking", () => {
    assert.match(
      checkRatchetFile(rel, base, JSON.stringify({ "tools-admin": 1001 }))[0],
      /1000 -> 1001/,
    )
    assert.match(checkRatchetFile(rel, base, JSON.stringify({}))[0], /was removed/)
    assert.deepEqual(checkRatchetFile(rel, base, JSON.stringify({ "tools-admin": 900 })), [])
  })
})

describe("bundle budget (shrink-only)", () => {
  const rel = "apps/mcp-server/test/__golden__/bundle-budget.json"
  const base = JSON.stringify({ $comment: "x", "mcp-app.js": 405000, "mcp-app.css": 13300 })

  it("flags a raised or removed ceiling, accepts a lowered one", () => {
    assert.match(
      checkRatchetFile(
        rel,
        base,
        JSON.stringify({ "mcp-app.js": 410000, "mcp-app.css": 13300 }),
      )[0],
      /405000 -> 410000 bytes/,
    )
    assert.match(
      checkRatchetFile(rel, base, JSON.stringify({ "mcp-app.js": 405000 }))[0],
      /"mcp-app.css" was removed/,
    )
    assert.deepEqual(
      checkRatchetFile(rel, base, JSON.stringify({ "mcp-app.js": 400000, "mcp-app.css": 13000 })),
      [],
    )
  })
})

describe("the CLI's bundle budget (shrink-only, raw bytes)", () => {
  const rel = "apps/cli/test/__golden__/bundle-budget.json"
  const base = JSON.stringify({ $comment: "x", dist: 2342912 })

  it("flags a raised ceiling: without a Ratchet-Exception trailer the gate fails", () => {
    const [violation, ...rest] = checkRatchetFile(rel, base, JSON.stringify({ dist: 2359296 }))
    assert.match(
      violation,
      /apps\/cli\/test\/__golden__\/bundle-budget\.json -> "dist": 2342912 -> 2359296 bytes/,
    )
    assert.match(violation, /every npm install of the CLI downloads its dist/)
    assert.deepEqual(rest, [])
  })

  it("flags a removed ceiling and a removed file", () => {
    assert.match(
      checkRatchetFile(rel, base, JSON.stringify({ $comment: "x" }))[0],
      /"dist" was removed/,
    )
    assert.match(checkRatchetFile(rel, base, null)[0], /"dist" was removed/)
  })

  it("accepts a lowered or unchanged ceiling and reads the real file", () => {
    assert.deepEqual(checkRatchetFile(rel, base, JSON.stringify({ dist: 2326528 })), [])
    assert.deepEqual(checkRatchetFile(rel, base, base), [])
    const real = readFileSync(rel, "utf8")
    assert.deepEqual(checkRatchetFile(rel, real, real), [])
    assert.equal(typeof JSON.parse(real).dist, "number")
  })
})

describe("root scripts (no gate unhooked)", () => {
  const pkg = (lint, test = "turbo run test && pnpm test:scripts") =>
    JSON.stringify({ scripts: { lint, test, "lint:deadcode": "knip --exclude exports,types" } })
  const base = pkg("turbo run lint && pnpm lint:ratchets && pnpm lint:deadcode")

  it("flags a gate dropped from the lint or test chain", () => {
    assert.match(
      checkRatchetFile("package.json", base, pkg("turbo run lint && pnpm lint:deadcode"))[0],
      /"pnpm lint:ratchets" dropped out of `pnpm lint`/,
    )
    assert.match(
      checkRatchetFile(
        "package.json",
        base,
        pkg("turbo run lint && pnpm lint:ratchets && pnpm lint:deadcode", "turbo run test"),
      )[0],
      /test:scripts/,
    )
  })

  it("accepts an added gate and flags a new knip exclusion", () => {
    assert.deepEqual(
      checkRatchetFile(
        "package.json",
        base,
        pkg("turbo run lint && pnpm lint:ratchets && pnpm lint:new && pnpm lint:deadcode"),
      ),
      [],
    )
    const looser = base.replace("exports,types", "exports,types,files")
    assert.match(checkRatchetFile("package.json", base, looser)[0], /excludes "files"/)
  })

  describe("a gate command is pinned to the merge base", () => {
    const BASE_SCRIPTS = {
      lint: "turbo run lint && pnpm lint:architecture && pnpm lint:ratchets && pnpm lint:deadcode",
      test: "turbo run test && pnpm test:scripts",
      "lint:architecture": "depcruise apps/*/src packages/*/src --config .dc.cjs",
      "lint:ratchets": "node scripts/check-ratchets.mjs",
      "lint:deadcode": "knip --exclude exports,types",
      "test:scripts": 'node --test "scripts/*.test.mjs"',
      build: "turbo run build",
      typecheck: "turbo run typecheck",
      "format:check": "prettier --check .",
    }
    const withScripts = (scripts) => JSON.stringify({ scripts: { ...BASE_SCRIPTS, ...scripts } })
    const old = withScripts({})

    it("flags a hollowed, an extended and a re-pointed gate alike", () => {
      for (const scripts of [
        { "lint:architecture": "true" },
        { "lint:architecture": "depcruise apps/*/src --config .dc.cjs" },
        // argv[2] wins over the CI base ref: merge-base(HEAD, HEAD) compares nothing
        { "lint:ratchets": "node scripts/check-ratchets.mjs HEAD" },
        { "lint:ratchets": "node scripts/check-ratchets.mjs || true" },
        { "lint:ratchets": "node scripts/check-ratchets.mjs ; true" },
        { "lint:ratchets": "echo node scripts/check-ratchets.mjs" },
        { "lint:deadcode": "knip --exclude exports,types --no-exit-code" },
        { "lint:deadcode": "knip --exclude exports,types --include files" },
        { "lint:deadcode": "knip --exclude exports,types --config lax.json" },
        {
          "lint:architecture":
            "depcruise apps/*/src packages/*/src --config .dc.cjs --exclude packages",
        },
        { "test:scripts": 'node --test "scripts/*.test.mjs" --test-name-pattern=^$' },
        { "test:scripts": 'node --test "scripts/*.test.mjs" || exit 0' },
      ]) {
        const violations = checkRatchetFile("package.json", old, withScripts(scripts))
        assert.equal(violations.length, 1, JSON.stringify(scripts))
        assert.match(violations[0], /pinned to the merge base/, JSON.stringify(scripts))
      }
    })

    it("pins the gates CI runs directly too (build, typecheck, format:check)", () => {
      for (const scripts of [
        { build: "turbo run build --filter=!@miragon/pulse-cli" },
        { typecheck: "turbo run typecheck --filter=!@miragon/pulse-widget-shell" },
        { "format:check": "prettier --check . || true" },
      ]) {
        const violations = checkRatchetFile("package.json", old, withScripts(scripts))
        assert.equal(violations.length, 1, JSON.stringify(scripts))
      }
      for (const gate of ["build", "typecheck", "format:check"]) {
        const { [gate]: _dropped, ...without } = BASE_SCRIPTS
        assert.match(
          checkRatchetFile("package.json", old, JSON.stringify({ scripts: without }))[0],
          new RegExp(`"${gate}" was removed`),
          gate,
        )
      }
    })

    it("lets the --exclude lists shrink, and reformatting pass", () => {
      assert.deepEqual(
        checkRatchetFile(
          "package.json",
          old,
          withScripts({
            "lint:deadcode": "knip --exclude exports",
            "lint:architecture": "depcruise  apps/*/src packages/*/src   --config .dc.cjs",
          }),
        ),
        [],
      )
    })

    it("lets a chain gain plain `pnpm <script>` gates only", () => {
      for (const lint of [
        `exit 0 && ${BASE_SCRIPTS.lint}`,
        `${BASE_SCRIPTS.lint} || true`,
        `${BASE_SCRIPTS.lint}; true`,
        `${BASE_SCRIPTS.lint} && echo done`,
      ]) {
        const violations = checkRatchetFile("package.json", old, withScripts({ lint }))
        assert.ok(violations.length > 0, lint)
      }
      assert.deepEqual(
        checkRatchetFile(
          "package.json",
          old,
          withScripts({ lint: `${BASE_SCRIPTS.lint} && pnpm lint:new`, "lint:new": "node x.mjs" }),
        ),
        [],
      )
    })
  })
})

describe("package gate scripts are pinned to the merge base", () => {
  const rel = "packages/connectors/engine/engine-connector/package.json"
  const BASE = {
    build: "tsc",
    lint: "eslint src",
    "lint:fix": "eslint src --fix",
    typecheck: "tsc --noEmit && tsc -p tsconfig.widgets.json",
    test: "vitest run",
  }
  const pkg = (scripts) =>
    JSON.stringify({ name: "@miragon/pulse-x", scripts: { ...BASE, ...scripts } })

  it("flags lint/typecheck/test changed in any way", () => {
    for (const scripts of [
      { test: "vitest run --coverage.enabled=false" },
      { test: "vitest run --coverage.thresholds.lines=0" },
      { lint: "eslint src || true" },
      { lint: "eslint src --rule 'complexity: off'" },
      { lint: "eslint src/index.ts" },
      { typecheck: "tsc --noEmit" },
    ]) {
      const violations = checkRatchetFile(rel, pkg({}), pkg(scripts))
      assert.equal(violations.length, 1, JSON.stringify(scripts))
      assert.match(violations[0], /pinned to the merge base/)
    }
  })

  it("leaves non-gate scripts free and a new package to lint:package-scripts", () => {
    assert.deepEqual(
      checkRatchetFile(rel, pkg({}), pkg({ "lint:fix": "eslint src --fix --cache", dev: "x" })),
      [],
    )
    assert.deepEqual(
      checkRatchetFile(rel, null, pkg({ test: "vitest run --coverage.enabled=false" })),
      [],
    )
  })

  describe("the scripts a CI or release job runs by name", () => {
    const extension = "apps/vscode/package.json"
    const CI_SCRIPTS = {
      "test:engines": "vitest run --config vitest.engines.config.ts",
      "test:smoke": "node scripts/build.mjs && vscode-test --config .vscode-test.mjs",
      package:
        "node scripts/build.mjs --production && vsce package --no-dependencies --readme-path MARKETPLACE.md",
      "marketplace:publish": "vsce publish",
      "open-vsx:publish": "ovsx publish",
    }
    const app = (scripts) =>
      JSON.stringify({
        name: "pulse",
        engines: { vscode: "^1.101.0" },
        scripts: { ...BASE, ...CI_SCRIPTS, ...scripts },
      })

    it("flags each one changed in any way", () => {
      for (const scripts of [
        { "test:smoke": "node scripts/build.mjs && vscode-test --config .vscode-test.mjs || true" },
        { "test:smoke": "node scripts/build.mjs" },
        { package: "node scripts/build.mjs --production && vsce package" },
        { "test:engines": "vitest run --config vitest.engines.config.ts --passWithNoTests" },
        { "marketplace:publish": "vsce publish --allow-proposed-apis" },
        { "open-vsx:publish": "true" },
      ]) {
        const violations = checkRatchetFile(extension, app({}), app(scripts))
        assert.equal(violations.length, 1, JSON.stringify({ scripts, violations }))
        assert.match(violations[0], /runs it by name, so it is pinned to the merge base/)
      }
    })

    it("flags each one removed", () => {
      for (const script of Object.keys(CI_SCRIPTS)) {
        const scripts = JSON.parse(app({})).scripts
        delete scripts[script]
        const violations = checkRatchetFile(
          extension,
          app({}),
          JSON.stringify({ name: "pulse", scripts }),
        )
        assert.equal(violations.length, 1, script)
        assert.match(violations[0], new RegExp(`"${script}" was removed: a CI or release job`))
      }
    })

    it("leaves whitespace, a new package and a script the base lacks free", () => {
      const spaced = { package: `  ${CI_SCRIPTS.package.replaceAll(" ", "  ")} ` }
      assert.deepEqual(checkRatchetFile(extension, app({}), app(spaced)), [])
      assert.deepEqual(checkRatchetFile(extension, null, app({ "open-vsx:publish": "true" })), [])
      assert.deepEqual(
        checkRatchetFile(rel, pkg({}), pkg({ "test:engines": "vitest run --config x.ts" })),
        [],
      )
    })
  })
})

describe("base ref resolution in CI", () => {
  it("ignores a positional base ref when the PR base is known", () => {
    assert.deepEqual(
      resolveBaseRef(["node", "check-ratchets.mjs", "HEAD"], { GITHUB_BASE_REF: "main" }),
      {
        ref: "origin/main",
        ignoredArg: "HEAD",
      },
    )
    assert.equal(resolveBaseRef(["node", "check-ratchets.mjs", "HEAD"], {}).ref, "HEAD")
    assert.equal(resolveBaseRef(["node", "check-ratchets.mjs"], {}).ref, "origin/main")
  })

  it("knows when an empty comparison would be vacuous", () => {
    assert.equal(isPullRequest({ GITHUB_EVENT_NAME: "pull_request" }), true)
    assert.equal(isPullRequest({ GITHUB_EVENT_NAME: "pull_request_target" }), true)
    assert.equal(isPullRequest({ GITHUB_EVENT_NAME: "push" }), false)
    assert.equal(isPullRequest({}), false)
  })
})

describe("inline suppressions (shrink-only)", () => {
  const rel = "packages/connectors/engine/engine-connector/src/tools/x.ts"
  const code = 'server.tool("x", {}, handler)\n'

  it("flags a new comment that switches a gate off", () => {
    for (const comment of [
      "// eslint-disable-next-line no-restricted-syntax",
      "/* eslint-disable complexity, max-lines */",
      "/* eslint-disable */",
      "// eslint-disable-line max-lines -- legacy file",
      '/* eslint complexity: ["error", 99] */',
      "/* eslint no-restricted-syntax: off */",
      "/* v8 ignore next */",
      "/* istanbul ignore next */",
      "/* c8 ignore start */",
      "// Stryker disable next-line all: flaky",
    ]) {
      const violations = compareSuppressions(rel, code, `${comment}\n${code}`)
      assert.ok(violations.length > 0, comment)
      assert.ok(violations[0].includes(`${rel}:1`), `${comment}: ${violations[0]}`)
    }
  })

  it("ignores other rules, comment-like strings and directives the base already had", () => {
    for (const text of [
      "// eslint-disable-next-line @typescript-eslint/no-unused-vars\nconst a = 1\n",
      'const s = "// eslint-disable-next-line complexity"\n',
      "const t = `/* v8 ignore next */`\n",
      "// a comment that mentions eslint-disable complexity\n",
      "/* v8 ignore stop */\n// Stryker restore all\n",
    ]) {
      assert.deepEqual(compareSuppressions(rel, code, text), [], text)
    }
    const kept = `// eslint-disable-next-line complexity\n${code}`
    assert.deepEqual(compareSuppressions(rel, kept, `${code}${kept}`), [])
  })

  it("reads comments in .tsx (not JSX text) and before a closing brace", () => {
    const tsx = [
      "export function A() {",
      "  return <p>// eslint-disable-next-line complexity</p>",
      "  // eslint-disable-next-line max-lines",
      "}",
    ].join("\n")
    assert.deepEqual(
      suppressionDirectives("x.tsx", tsx).map((d) => [d.directive, d.line]),
      [["eslint-disable-next-line max-lines", 3]],
    )
  })
})

describe("introduction and the escape trailer", () => {
  it("a file absent on the base is free, except a package vitest config that is no working ratchet", () => {
    assert.deepEqual(
      checkRatchetFile(PKG_VITEST, null, vitestConfig({ thresholds: BASE_THRESHOLDS })),
      [],
    )
    // Without floors the introduced config would be compared against nothing forever.
    assert.match(
      checkRatchetFile(PKG_VITEST, null, vitestConfig({ thresholds: "" }))[0],
      /carries no coverage floor/,
    )
    assert.deepEqual(checkRatchetFile("knip.jsonc", undefined, "{}"), [])
  })

  it("the trailer must be a line of its own with a reason", () => {
    assert.ok(EXCEPTION_TRAILER.test("fix: x\n\nRatchet-Exception: module moved to core"))
    assert.ok(!EXCEPTION_TRAILER.test("fix: x\n\nRatchet-Exception: "))
    assert.ok(!EXCEPTION_TRAILER.test("mentions Ratchet-Exception: inline"))
  })
})

/**
 * The trailer covers the commit that carries it: the checker replays itself
 * commit by commit in a synthetic repository (a `main` branch as the base)
 * and waves a net violation only when every commit that makes it carries
 * the trailer.
 */
describe("the trailer covers its own commit (replayed per commit)", () => {
  const BUDGET = "apps/a/test/__golden__/char-budgets.json"
  const VITEST = "packages/core/x/vitest.config.ts"
  const TRAILER = "Ratchet-Exception: the model must read the new tool"
  const dirs = []
  after(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  })

  /** A repository with `main` holding the budget at 100, checked out on `branch`. */
  function synthetic(files = {}) {
    const dir = mkdtempSync(path.join(tmpdir(), "ratchet-range-"))
    dirs.push(dir)
    // Never the caller's GIT_* (a hook exports GIT_DIR): it would point these
    // commits at the outer repository.
    const env = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
      ),
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com",
    }
    const git = (...args) =>
      execFileSync("git", args, {
        cwd: dir,
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim()
    const write = (rel, text) => {
      mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
      writeFileSync(path.join(dir, rel), text)
    }
    const budget = (value) => write(BUDGET, `${JSON.stringify({ tools: value }, null, 2)}\n`)
    const commit = (message, change) => {
      change?.()
      git("add", "-A")
      git("commit", "-q", "--allow-empty", "-m", message)
      return git("rev-parse", "HEAD")
    }
    git("init", "-q", "-b", "main")
    budget(100)
    for (const [rel, text] of Object.entries(files)) write(rel, text)
    commit("chore: base")
    git("checkout", "-q", "-b", "branch")
    const check = async (env = {}) => {
      const out = []
      const code = await run({
        root: dir,
        argv: ["node", "check-ratchets.mjs", "main"],
        env,
        log: (line) => out.push(line),
        error: (line) => out.push(line),
      })
      return { code, out: out.join("\n") }
    }
    return { dir, git, write, budget, commit, check }
  }

  it("keys a violation by file and wording, numbers and quoted from -> to values aside", () => {
    assert.equal(
      violationKey(`${BUDGET} -> "tools": 86058 -> 86500 model-visible characters.`),
      violationKey(`${BUDGET} -> "tools": 86500 -> 87000 model-visible characters.`),
    )
    assert.equal(
      violationKey('p/package.json -> the "test" gate changed: "vitest run" -> "vitest run -x".'),
      violationKey('p/package.json -> the "test" gate changed: "vitest" -> "vitest run -y".'),
    )
    assert.equal(violationKey("a.ts:12,40 -> new (0 -> 2)"), violationKey("a.ts:7 -> new (1 -> 2)"))
    assert.notEqual(
      violationKey(`${BUDGET} -> "tools": 1 -> 2`),
      violationKey(`${BUDGET} -> "x": 1 -> 2`),
    )
    // Digits inside a name stay: camunda7 is not camunda8, v8 ignore is not c8 ignore.
    assert.notEqual(violationKey("v8 ignore next"), violationKey("c8 ignore next"))
  })

  it("waves a violation the commit that makes it covers, and names that commit and its reason", async () => {
    const repo = synthetic()
    repo.commit("feat: unrelated", () => repo.write("README.md", "x\n"))
    const sha = repo.commit(`feat: a new tool\n\n${TRAILER}`, () => repo.budget(120))
    const { code, out } = await repo.check()
    assert.equal(code, 0, out)
    assert.match(out, /RATCHET EXCEPTION APPLIED: .*"tools": 100 -> 120/)
    assert.ok(out.includes(`waved by ${sha.slice(0, 9)} ("feat: a new tool"): ${TRAILER}`), out)
  })

  it("fails a violation made in A while only B carries a trailer", async () => {
    const repo = synthetic()
    const a = repo.commit("feat: a", () => repo.budget(120))
    repo.commit(`feat: b\n\n${TRAILER}`, () => repo.write("README.md", "x\n"))
    const { code, out } = await repo.check()
    assert.equal(code, 1, out)
    assert.match(out, /RATCHET VIOLATION .*"tools": 100 -> 120/)
    assert.ok(out.includes(`made by ${a.slice(0, 9)} ("feat: a"), which carries no`), out)
    assert.match(out, /reword that commit .*a trailer on any other commit covers nothing/)
  })

  it("needs the trailer on every commit that makes it: made in A, made again in B", async () => {
    // Decision: a budget raised in A (no trailer) and again in B (trailer)
    // fails: B's reason does not cover A's growth. With both trailers it passes.
    const repo = synthetic()
    const a = repo.commit("feat: a", () => repo.budget(110))
    repo.commit(`feat: b\n\n${TRAILER}`, () => repo.budget(120))
    const bare = await repo.check()
    assert.equal(bare.code, 1, bare.out)
    assert.ok(bare.out.includes(`made by ${a.slice(0, 9)}`), bare.out)

    const both = synthetic()
    const first = both.commit(`feat: a\n\n${TRAILER}`, () => both.budget(110))
    const second = both.commit(`feat: b\n\n${TRAILER}`, () => both.budget(120))
    const covered = await both.check()
    assert.equal(covered.code, 0, covered.out)
    for (const sha of [first, second])
      assert.ok(covered.out.includes(`waved by ${sha.slice(0, 9)}`))
  })

  it("an older trailer covers nothing the uncommitted changes or a later commit make", async () => {
    const repo = synthetic()
    repo.commit(`feat: a\n\n${TRAILER}`, () => repo.budget(120))
    repo.budget(130) // uncommitted
    const dirty = await repo.check()
    assert.equal(dirty.code, 1, dirty.out)
    assert.match(
      dirty.out,
      /made by the uncommitted changes in the working tree, which no trailer covers/,
    )

    const later = repo.commit("feat: c", () => repo.budget(130))
    const committed = await repo.check()
    assert.equal(committed.code, 1, committed.out)
    assert.ok(committed.out.includes(`made by ${later.slice(0, 9)} ("feat: c")`), committed.out)
  })

  it("a merge counts against its branch-side parent; its own change needs its own trailer", async () => {
    const repo = synthetic()
    const a = repo.commit(`feat: a\n\n${TRAILER}`, () => repo.budget(120))
    repo.git("checkout", "-q", "main")
    repo.commit("feat: main moves on", () => repo.write("MAIN.md", "x\n"))
    repo.git("checkout", "-q", "branch")
    repo.git("merge", "-q", "--no-edit", "main")
    const merged = await repo.check()
    assert.equal(merged.code, 0, merged.out)
    assert.ok(merged.out.includes(`waved by ${a.slice(0, 9)}`), merged.out)

    // A loosening made in the merge itself (an evil merge) is the merge's own.
    repo.git("checkout", "-q", "main")
    repo.commit("feat: main again", () => repo.write("MAIN2.md", "x\n"))
    repo.git("checkout", "-q", "branch")
    repo.git("merge", "-q", "--no-commit", "main")
    repo.budget(125)
    const evil = repo.commit("Merge main into branch")
    const loosened = await repo.check()
    assert.equal(loosened.code, 1, loosened.out)
    assert.ok(loosened.out.includes(`made by ${evil.slice(0, 9)} ("Merge main into branch")`))
    assert.match(loosened.out, /give the merge commit the trailer, or rebase onto the base/)
  })

  it("GitHub's pull-request test merge (base tip first) counts against the branch", async () => {
    const repo = synthetic()
    const a = repo.commit(`feat: a\n\n${TRAILER}`, () => repo.budget(120))
    repo.git("checkout", "-q", "main")
    repo.commit("feat: main moves on", () => repo.write("MAIN.md", "x\n"))
    // actions/checkout's refs/pull/N/merge: the base tip is the first parent.
    repo.git("checkout", "-q", "--detach", "main")
    repo.git("merge", "-q", "--no-ff", "-m", "Merge abc into def", "branch")
    repo.git("update-ref", "refs/remotes/origin/main", "main")
    const { code, out } = await repo.check({ GITHUB_BASE_REF: "main" })
    assert.equal(code, 0, out)
    assert.ok(out.includes(`waved by ${a.slice(0, 9)}`), out)
    assert.ok(!out.includes("Merge abc into def"), out)
  })

  it("holds the starter's prettier copy to the root config of the same commit", async () => {
    const config = (printWidth, extra = {}) =>
      `${JSON.stringify({ semi: false, printWidth, ...extra }, null, 2)}\n`
    const overrides = { overrides: [{ files: ["apps/x/**"], options: { semi: true } }] }
    const repo = synthetic({
      ".prettierrc.json": config(100, overrides),
      [TEMPLATE_PRETTIER]: config(100),
    })
    const base = await repo.check()
    assert.equal(base.code, 0, base.out)
    // The root moves alone: the copy drifts, no commit makes that, so no trailer covers it.
    repo.commit(`style: wider\n\n${TRAILER}`, () =>
      repo.write(".prettierrc.json", config(110, overrides)),
    )
    const drifted = await repo.check()
    assert.equal(drifted.code, 1, drifted.out)
    assert.match(drifted.out, /server\/\.prettierrc\.json is not the root \.prettierrc\.json/)
    repo.commit("style: the starter too", () => repo.write(TEMPLATE_PRETTIER, config(110)))
    const followed = await repo.check()
    assert.equal(followed.code, 0, followed.out)
  })

  it("fails closed when no single commit makes a violation (the steps only add up to it)", async () => {
    // A switches perFile on (no count floor yet: fine), B trades a floor for a
    // count floor (its own violation, covered). Only together do they make
    // "perFile next to a negative floor": no commit's trailer covers that.
    const config = (thresholds) => `import { defineConfig, mergeConfig } from "vitest/config"
import { sharedConfig } from "../../../vitest.shared"
export default mergeConfig(sharedConfig, defineConfig({
  test: { coverage: { thresholds: { ${thresholds} } } },
}))
`
    const repo = synthetic({
      [VITEST]: config("statements: 80, branches: 80, functions: 80, lines: 80"),
    })
    repo.commit(`test: per file\n\n${TRAILER}`, () =>
      repo.write(
        VITEST,
        config("statements: 80, branches: 80, functions: 80, lines: 80, perFile: true"),
      ),
    )
    repo.commit(`test: count floor\n\n${TRAILER}`, () =>
      repo.write(
        VITEST,
        config("statements: 80, branches: 80, functions: 80, lines: -5, perFile: true"),
      ),
    )
    const { code, out } = await repo.check()
    assert.equal(code, 1, out)
    assert.match(out, /RATCHET EXCEPTION APPLIED: .*lines: 80 -> -5/)
    assert.match(out, /RATCHET VIOLATION .*perFile switched on next to a negative floor/)
    assert.match(out, /no single commit makes it/)
  })

  it("holds a config brought back to a path the base holds to the commit that brings it back", async () => {
    // Decision: A removes the config (trailer), B brings another one back with a lower floor.
    // Against its parent B's file reads as introduced, so the lower floor would only add up
    // from two steps and no trailer could cover it; compared with the base's file there, B
    // makes it: without a trailer B fails, with one it is waved.
    const config = (branches) => `import { defineConfig, mergeConfig } from "vitest/config"
import { sharedConfig } from "../../../vitest.shared"
export default mergeConfig(sharedConfig, defineConfig({
  test: { coverage: { thresholds: { statements: 99, branches: ${branches}, functions: 99, lines: 99 } } },
}))
`
    const removeThenBringBack = (trailerOnB) => {
      const repo = synthetic({ [VITEST]: config(98) })
      repo.commit(`refactor: the package moves away\n\n${TRAILER}`, () =>
        repo.git("rm", "-q", VITEST),
      )
      const b = repo.commit(
        `feat: another package at the path${trailerOnB ? `\n\n${TRAILER}` : ""}`,
        () => repo.write(VITEST, config(90)),
      )
      return { repo, b }
    }
    const bare = removeThenBringBack(false)
    const failed = await bare.repo.check()
    assert.equal(failed.code, 1, failed.out)
    assert.match(failed.out, /RATCHET VIOLATION .*branches: 98 -> 90/)
    assert.ok(failed.out.includes(`made by ${bare.b.slice(0, 9)}`), failed.out)
    assert.doesNotMatch(failed.out, /no single commit makes it/)

    const covered = removeThenBringBack(true)
    const waved = await covered.repo.check()
    assert.equal(waved.code, 0, waved.out)
    assert.match(waved.out, /RATCHET EXCEPTION APPLIED: .*branches: 98 -> 90/)
    assert.ok(waved.out.includes(`waved by ${covered.b.slice(0, 9)}`), waved.out)

    // Brought back with the base's floors, the path holds what it held: nothing to cover.
    const same = synthetic({ [VITEST]: config(98) })
    same.commit(`refactor: away\n\n${TRAILER}`, () => same.git("rm", "-q", VITEST))
    same.commit("feat: back", () => same.write(VITEST, config(98)))
    const kept = await same.check()
    assert.doesNotMatch(kept.out, /branches/)
  })

  it("fails every violation when no commit carries a trailer", async () => {
    const repo = synthetic()
    repo.commit("feat: a", () => repo.budget(120))
    const { code, out } = await repo.check()
    assert.equal(code, 1, out)
    assert.match(out, /RATCHET VIOLATION .*"tools": 100 -> 120/)
    assert.match(out, /no commit in the range carries a trailer/)
  })

  it("matches the effective ESLint config file by file", async () => {
    const files = (extra) => `export default [
  { files: ["packages/**/*.ts"], rules: { complexity: ["error", 15] } },${extra}
]
`
    const relax = (file) => `\n  { files: ["${file}"], rules: { complexity: "off" } },`
    const sources = {
      "packages/a/src/x.ts": "export const x = 1\n",
      "packages/b/src/y.ts": "export const y = 1\n",
    }
    const repo = synthetic({ "eslint.config.mjs": files(""), ...sources })
    repo.commit(`build: relax x\n\n${TRAILER}`, () =>
      repo.write("eslint.config.mjs", files(relax("packages/a/src/x.ts"))),
    )
    const one = await repo.check()
    assert.equal(one.code, 0, one.out)
    assert.match(
      one.out,
      /complexity is no longer an error for 1 file\(s\): packages\/a\/src\/x\.ts/,
    )

    // B relaxes another file without a trailer: the same reason, a file A never made.
    const b = repo.commit("build: relax y", () =>
      repo.write(
        "eslint.config.mjs",
        files(relax("packages/a/src/x.ts") + relax("packages/b/src/y.ts")),
      ),
    )
    const two = await repo.check()
    assert.equal(two.code, 1, two.out)
    assert.match(two.out, /complexity is no longer an error for 2 file\(s\)/)
    assert.ok(two.out.includes(`made by ${b.slice(0, 9)} ("build: relax y")`), two.out)

    // File by file, not reason by reason: a relaxation of y made and undone
    // without a trailer is no maker of x's relaxation.
    const undone = synthetic({ "eslint.config.mjs": files(""), ...sources })
    undone.commit("build: relax y", () =>
      undone.write("eslint.config.mjs", files(relax("packages/b/src/y.ts"))),
    )
    undone.commit("build: undo y", () => undone.write("eslint.config.mjs", files("")))
    const c = undone.commit(`build: relax x\n\n${TRAILER}`, () =>
      undone.write("eslint.config.mjs", files(relax("packages/a/src/x.ts"))),
    )
    const only = await undone.check()
    assert.equal(only.code, 0, only.out)
    assert.ok(only.out.includes(`waved by ${c.slice(0, 9)}`), only.out)
  })

  it("keys a no-restricted-syntax carve-out by selector: a second one of the same file is another commit's", async () => {
    // A (trailer) carves WithStatement out of f.ts; B (no trailer, then the
    // uncommitted changes) also carves DebuggerStatement out of it. The net
    // finding names one selector as its example; each lost selector is its own key.
    const config = (override) => `export default [
  { files: ["packages/**/*.ts"], rules: { "no-restricted-syntax": ["error", "WithStatement", "DebuggerStatement"] } },${override}
]
`
    const only = (...selectors) =>
      `\n  { files: ["packages/a/src/f.ts"], rules: { "no-restricted-syntax": ${JSON.stringify(["error", ...selectors])} } },`
    const repo = synthetic({
      "eslint.config.mjs": config(""),
      "packages/a/src/f.ts": "export const f = 1\n",
      "packages/b/src/g.ts": "export const g = 1\n",
      "packages/c/src/h.ts": "export const h = 1\n",
    })
    const a = repo.commit(`build: carve With out of f\n\n${TRAILER}`, () =>
      repo.write("eslint.config.mjs", config(only("DebuggerStatement"))),
    )
    const waved = await repo.check()
    assert.equal(waved.code, 0, waved.out)
    assert.ok(waved.out.includes(`waved by ${a.slice(0, 9)}`), waved.out)

    repo.write("eslint.config.mjs", config(only("ThisExpression"))) // uncommitted
    const dirty = await repo.check()
    assert.equal(dirty.code, 1, dirty.out)
    assert.match(dirty.out, /RATCHET VIOLATION .*no-restricted-syntax drops 2 selector/)
    assert.match(dirty.out, /made by the uncommitted changes in the working tree/)

    const b = repo.commit("build: carve Debugger out of f too")
    const committed = await repo.check()
    assert.equal(committed.code, 1, committed.out)
    assert.ok(committed.out.includes(`made by ${b.slice(0, 9)}`), committed.out)
    assert.ok(!committed.out.includes(`made by ${a.slice(0, 9)}`), committed.out)
  })

  it("reads the repository at root even when the caller's environment sets GIT_DIR", async () => {
    const repo = synthetic()
    const a = repo.commit(`feat: a\n\n${TRAILER}`, () => repo.budget(120))
    const saved = process.env.GIT_DIR
    process.env.GIT_DIR = path.join(repo.dir, "no-such-repository")
    try {
      const { code, out } = await repo.check()
      assert.equal(code, 0, out)
      assert.ok(out.includes(`waved by ${a.slice(0, 9)}`), out)
    } finally {
      if (saved === undefined) delete process.env.GIT_DIR
      else process.env.GIT_DIR = saved
    }
  })

  it("a file added later under an exemption belongs to the commit that made the exemption", async () => {
    const config = (extra) => `export default [
  { files: ["packages/**/*.ts"], rules: { complexity: ["error", 15] } },${extra}
]
`
    const exempt = `\n  { files: ["packages/a/src/**"], rules: { complexity: "off" } },`
    const repo = synthetic({
      "eslint.config.mjs": config(""),
      "packages/a/src/x.ts": "export const x = 1\n",
    })
    const a = repo.commit(`build: exempt a\n\n${TRAILER}`, () =>
      repo.write("eslint.config.mjs", config(exempt)),
    )
    repo.commit("feat: z", () => repo.write("packages/a/src/z.ts", "export const z = 1\n"))
    const { code, out } = await repo.check()
    assert.equal(code, 0, out)
    assert.match(out, /complexity is no longer an error for 2 file\(s\)/)
    assert.ok(out.includes(`waved by ${a.slice(0, 9)}`), out)
  })
})
