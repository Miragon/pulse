import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
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
  suppressionDirectives,
} from "./check-ratchets.mjs"

/**
 * Negative tests for the ratchet self-protection: every forbidden direction
 * must produce a violation, every allowed one must not. The CLI wrapper
 * (merge-base resolution, trailer escape) runs in `pnpm lint`; the direction
 * policy lives in the pure `checkRatchetFile`.
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
const PKG_VITEST = "packages/connectors/camunda/camunda7-client/vitest.config.ts"
const BASE_THRESHOLDS = "thresholds: { statements: 44, branches: 32, functions: 45, lines: 44 },"
// Packages that do not exist yet: the ratchet must cover them before they arrive.
const CLI_DIR = "apps/cli"
const VSCODE_DIR = "apps/vscode"
const DOMAIN_DIR = "packages/connectors/camunda/camunda7-domain"
const REAL_VITEST_CONFIGS = [
  "apps/mcp-server-camunda7/vitest.config.ts",
  "packages/core/widget-shell/vitest.config.ts",
  "packages/connectors/camunda/camunda7-client/vitest.config.ts",
  "packages/connectors/camunda/camunda7-connector/vitest.config.ts",
  "packages/connectors/analytics/analytics-client/vitest.config.ts",
  "packages/connectors/analytics/analytics-connector/vitest.config.ts",
]

describe("ratchetKind", () => {
  it("recognises every monitored location and nothing else", () => {
    assert.equal(ratchetKind("apps/mcp-server-camunda7/vitest.config.ts"), "vitest")
    assert.equal(ratchetKind("packages/core/widget-shell/vitest.config.ts"), "vitest")
    assert.equal(ratchetKind(PKG_VITEST), "vitest")
    assert.equal(ratchetKind("vitest.shared.ts"), "vitest")
    assert.equal(ratchetKind("packages/core/widget-shell/stryker.config.json"), "stryker")
    assert.equal(ratchetKind("eslint.config.mjs"), "eslint")
    assert.equal(ratchetKind("knip.jsonc"), "knip")
    assert.equal(
      ratchetKind("apps/mcp-server-camunda7/test/__golden__/char-budgets.json"),
      "char-budgets",
    )
    assert.equal(
      ratchetKind("apps/mcp-server-camunda7/test/__golden__/bundle-budget.json"),
      "bundle-budget",
    )
    assert.equal(ratchetKind("package.json"), "root-scripts")
    assert.equal(ratchetKind("packages/core/widget-shell/package.json"), "package-scripts")
    assert.equal(ratchetKind("apps/mcp-server-camunda7/package.json"), "package-scripts")
    assert.equal(ratchetKind("packages/core/widget-shell/vitest.stryker.config.ts"), null)
    assert.equal(ratchetKind("templates/composed-server/vitest.config.ts"), null)
    assert.equal(ratchetKind("templates/composed-server/server/package.json"), null)
  })

  it("already covers the apps and the -domain package that do not exist yet", () => {
    // A CLI app, a VS Code extension app and a connector's -domain package.
    for (const pkg of [CLI_DIR, VSCODE_DIR, DOMAIN_DIR]) {
      assert.equal(ratchetKind(`${pkg}/vitest.config.ts`), "vitest", pkg)
      assert.equal(ratchetKind(`${pkg}/stryker.config.json`), "stryker", pkg)
      assert.equal(ratchetKind(`${pkg}/package.json`), "package-scripts", pkg)
    }
    // The docs workspace: only its manifest's `prettier` key is checked.
    assert.equal(ratchetKind("docs/package.json"), "workspace-manifest")
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
    "apps/mcp-server-camunda7/eslint.config.js",
    "packages/connectors/camunda/camunda7-connector/src/data/eslint.config.mjs",
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
    "packages/connectors/camunda/camunda7-client/stryker.conf.cjs",
  ]

  it("flags each one — also when the diff introduces it", () => {
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
      `${DOMAIN_DIR}/vitest.config.cjs`,
      "packages/core/widget-shell/vitest.config.mjs",
      "apps/mcp-server-camunda7/vitest.config.cts",
    ])
      flags(rel, /second vitest config.*loads the first it finds.*Keep the package's config/)
  })

  it("leaves the configs vitest does not resolve from a package dir alone", () => {
    for (const rel of [
      // the widget bundle's build config, which vitest.config.ts outranks
      "apps/mcp-server-camunda7/vite.config.ts",
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
      `${DOMAIN_DIR}/.prettierrc.json`,
      "packages/core/widget-shell/src/ui/.prettierrc",
      "apps/.prettierrc",
      // Outside apps/ and packages/ too: `prettier --check .` reads every directory.
      "docs/.prettierrc",
      "docs/.vitepress/.prettierrc.json",
      "docs/package.yaml",
      "templates/composed-server/.prettierrc.json",
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
      `${DOMAIN_DIR}/src/.editorconfig`,
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
    for (const rel of [PKG_VITEST, "apps/mcp-server-camunda7/vitest.config.ts"]) {
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
  const DOMAIN = `${DOMAIN_DIR}/vitest.config.ts`
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
        checkRatchetFile(`${DOMAIN_DIR}/vitest.config.ts`, null, merged).join("\n"),
        /neither merges sharedConfig/,
        enabled,
      )
    }
  })

  it("carries a non-zero floor for each of the four metrics", () => {
    const introduce = (thresholds) =>
      checkRatchetFile(`${DOMAIN_DIR}/vitest.config.ts`, null, vitestConfig({ thresholds }))
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
        exclude: ["ENGINE_TEST", "test/fixtures/**"],
        extends: true,
      },
      browser: { include: ["src/webview/**/*.test.tsx"], exclude: [], extends: true },
      engine: { include: ["ENGINE_TEST"], exclude: [], extends: true },
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
      ["root-scripts", "package-scripts", "workspace-manifest"].includes(ratchetKind(rel)),
    )
    assert.ok(manifests.includes("package.json") && manifests.includes("docs/package.json"))
    for (const rel of manifests) {
      const text = readFileSync(rel, "utf8")
      assert.deepEqual(checkRatchetFile(rel, text, text), [], rel)
    }
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

  it("flags dropping `enabled: true` — vitest then defaults to coverage off", () => {
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
    assert.ok(exclude.includes("**/src/postgres.ts"))
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

describe("eslint ratchets (shrink-only debt, budgets never raised)", () => {
  const config = ({
    complexity = "{}",
    maxLines = '{ "src/a.ts": 420 }',
    budget = 15,
    extraBlocks = "",
    ignores = '"**/dist/**"',
  } = {}) => `
export const complexityRatchet = ${complexity}
export const maxLinesRatchet = ${maxLines}
export default [
  { ignores: [${ignores}] },
  {
    files: ["packages/*/src/**/*.ts"],
    rules: {
      complexity: ["error", ${budget}],
      "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }],
    },
  },
  { files: ["src/messages/*.sweep.ts"], rules: { "max-lines": "off" } },
  ${extraBlocks}
  ...Object.entries(complexityRatchet).map(([file, max]) => ({
    files: [file],
    rules: { complexity: ["error", max] },
  })),
  ...Object.entries(maxLinesRatchet).map(([file, max]) => ({
    files: [file],
    rules: { "max-lines": ["error", { max, skipBlankLines: true, skipComments: true }] },
  })),
]`
  const base = config()

  it("reads the real eslint.config.mjs without errors", () => {
    const { maps, budgets, errors } = extractEslintRatchets(
      "eslint.config.mjs",
      readFileSync("eslint.config.mjs", "utf8"),
    )
    assert.deepEqual(errors, [])
    assert.ok("maxLinesRatchet" in maps && "complexityRatchet" in maps)
    const budgetsOf = (filesKey) =>
      Object.entries(budgets)
        .filter(([key, b]) => key.includes(`| files ${filesKey} |`) && !b.exemption)
        .map(([, b]) => b.numbers[0])
        .sort((a, b) => a - b)
    // The global budgets, the CLI's stricter ones (apps/cli: complexity 10, 300 lines for the
    // shipped code and scripts, the global 400 for its tests in and outside src/) and the VS
    // Code extension's stricter house budgets (apps/vscode: complexity 10, 300 lines).
    assert.deepEqual(
      budgetsOf(
        '["apps/*/src/**/*.{ts,tsx}","packages/core/*/src/**/*.{ts,tsx}","packages/connectors/*/*/src/**/*.{ts,tsx}"]',
      ),
      [15, 400],
    )
    assert.deepEqual(budgetsOf('["apps/cli/**/*.ts"]'), [10, 300])
    assert.deepEqual(budgetsOf('["apps/cli/**/*.test.ts","apps/cli/test/**/*.ts"]'), [400])
    assert.deepEqual(budgetsOf('["apps/vscode/**/*.{ts,tsx,js,mjs,cjs}"]'), [10])
    assert.deepEqual(
      budgetsOf(
        '["apps/vscode/{src,dev,scripts,sandbox}/**/*.{ts,tsx,js,mjs,cjs}","apps/vscode/test/webview/harness.tsx","apps/vscode/test/smoke/*.cjs"]',
      ),
      [300],
    )
    const all = Object.values(budgets).filter((b) => !b.exemption && b.numbers.length > 0)
    assert.equal(
      all.length,
      7,
      "a new complexity/max-lines setting is new debt (or a new app's budget)",
    )
  })

  it("accepts lowering and removing entries, tightening the budget and dropping an exemption", () => {
    assert.deepEqual(
      checkRatchetFile("eslint.config.mjs", base, config({ maxLines: "{}", budget: 12 })),
      [],
    )
    const withoutExemption = base.replace(
      '{ files: ["src/messages/*.sweep.ts"], rules: { "max-lines": "off" } },',
      "",
    )
    assert.deepEqual(checkRatchetFile("eslint.config.mjs", base, withoutExemption), [])
  })

  it("flags a new and a raised debt entry", () => {
    const violations = checkRatchetFile(
      "eslint.config.mjs",
      base,
      config({ maxLines: '{ "src/a.ts": 430, "src/b.ts": 410 }' }),
    )
    assert.equal(violations.length, 2)
    assert.match(violations.join("\n"), /"src\/a\.ts": 420 -> 430/)
    assert.match(violations.join("\n"), /new maxLinesRatchet entry "src\/b\.ts"/)
  })

  it("flags a raised global budget", () => {
    const violations = checkRatchetFile("eslint.config.mjs", base, config({ budget: 20 }))
    assert.equal(violations.length, 1)
    assert.match(violations[0], /15 -> 20/)
  })

  it("flags an override block that bypasses the debt maps", () => {
    for (const block of [
      '{ files: ["src/big.ts"], rules: { complexity: ["error", 40] } },',
      '{ files: ["src/big.ts"], rules: { "max-lines": "off" } },',
      '{ files: ["src/big.ts"], rules: { complexity: "warn" } },',
    ]) {
      const violations = checkRatchetFile("eslint.config.mjs", base, config({ extraBlocks: block }))
      assert.equal(violations.length, 1, block)
      assert.match(violations[0], /New code gets the global budget/)
    }
  })

  it("flags a removed global budget and a non-literal debt map", () => {
    const noBudget = base.replace('complexity: ["error", 15],', "")
    assert.match(
      checkRatchetFile("eslint.config.mjs", base, noBudget).join("\n"),
      /budget setting .* was removed/,
    )
    const computed = config({ maxLines: "buildDebt()" })
    assert.match(
      checkRatchetFile("eslint.config.mjs", base, computed).join("\n"),
      /maxLinesRatchet is not an object literal/,
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

  it("keys an ignore by the block it sits in — copying an exemption into the global ignores is new", () => {
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

  it("fails closed on every shape the AST cannot read", () => {
    const cases = {
      "rules from a const": [
        'const relaxed = { complexity: "off", "max-lines": "off" }',
        '{ files: ["src/big.ts"], rules: relaxed },',
      ],
      "spread inside rules": [
        "",
        '{ files: ["src/big.ts"], rules: { ...{ complexity: "off" } } },',
      ],
      "computed rule key": ["", '{ files: ["src/big.ts"], rules: { ["complexity"]: "off" } },'],
      "shorthand rules": [
        'const rules = { complexity: "off" }',
        '{ files: ["src/big.ts"], rules },',
      ],
      "spread into a config block": [
        'const lax = { rules: { complexity: "off" } }',
        '{ ...lax, files: ["src/big.ts"] },',
      ],
      "imported config element": ['import lax from "./lax.mjs"', "...lax,"],
      "debt smuggled past the frozen map": [
        "",
        '...Object.entries({ ...maxLinesRatchet, "src/big.ts": 900 }).map(([file, max]) => ({ files: [file], rules: { "max-lines": ["error", { max }] } })),',
      ],
    }
    for (const [label, [pre, block]] of Object.entries(cases)) {
      const violations = checkRatchetFile(
        "eslint.config.mjs",
        base,
        `${pre}\n${config({ extraBlocks: block })}`,
      )
      assert.ok(violations.length > 0, label)
      assert.match(violations.join("\n"), /reads literals only/, label)
    }
  })

  it("treats a gate rule switched off or to warn as an exemption", () => {
    for (const block of [
      '{ files: ["src/tools/raw.ts"], rules: { "no-restricted-syntax": "off" } },',
      '{ files: ["src/tools/raw.ts"], rules: { "no-restricted-syntax": ["warn", "X"] } },',
    ]) {
      const violations = checkRatchetFile("eslint.config.mjs", base, config({ extraBlocks: block }))
      assert.equal(violations.length, 1, block)
      assert.match(violations[0], /exemption/)
    }
  })

  it("ignores parser-project partitions (no rules) — they route files, not exempt them", () => {
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
  const rel = "apps/mcp-server-camunda7/test/__golden__/char-budgets.json"
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
  const rel = "apps/mcp-server-camunda7/test/__golden__/bundle-budget.json"
  const base = JSON.stringify({ $comment: "x", "mcp-app.js": 405000, "mcp-app.css": 13300 })

  it("flags a raised or removed ceiling, accepts a lowered one", () => {
    assert.match(
      checkRatchetFile(
        rel,
        base,
        JSON.stringify({ "mcp-app.js": 410000, "mcp-app.css": 13300 }),
      )[0],
      /405000 -> 410000 bytes gzip/,
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
      "test:pg":
        "TEST_DATABASE_URL=${TEST_DATABASE_URL:-x} pnpm --filter @miragon/pulse-widget-shell --filter @miragon/pulse-camunda7-connector run test",
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

    it("pins the gates CI runs directly too (test:pg, typecheck, format:check)", () => {
      for (const scripts of [
        // widget-shell is the only package with Postgres suites
        {
          "test:pg":
            "TEST_DATABASE_URL=${TEST_DATABASE_URL:-x} pnpm --filter @miragon/pulse-camunda7-connector run test",
        },
        { typecheck: "turbo run typecheck --filter=!@miragon/pulse-widget-shell" },
        { "format:check": "prettier --check . || true" },
      ]) {
        const violations = checkRatchetFile("package.json", old, withScripts(scripts))
        assert.equal(violations.length, 1, JSON.stringify(scripts))
      }
      const { "test:pg": _dropped, ...withoutPg } = BASE_SCRIPTS
      assert.match(
        checkRatchetFile("package.json", old, JSON.stringify({ scripts: withoutPg }))[0],
        /"test:pg" was removed/,
      )
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
  const rel = "packages/connectors/camunda/camunda7-connector/package.json"
  const BASE = {
    build: "tsc",
    lint: "eslint src",
    "lint:fix": "eslint src --fix",
    typecheck: "tsc --noEmit && tsc -p tsconfig.widgets.json",
    test: "vitest run",
    "test:mutation": "stryker run",
  }
  const pkg = (scripts) =>
    JSON.stringify({ name: "@miragon/pulse-x", scripts: { ...BASE, ...scripts } })

  it("flags lint/typecheck/test/test:mutation changed in any way", () => {
    for (const scripts of [
      { test: "vitest run --coverage.enabled=false" },
      { test: "vitest run --coverage.thresholds.lines=0" },
      { lint: "eslint src || true" },
      { lint: "eslint src --rule 'complexity: off'" },
      { lint: "eslint src/index.ts" },
      { typecheck: "tsc --noEmit" },
      { "test:mutation": "stryker run lax.json" },
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
        assert.match(violations[0], new RegExp(`"${script}" was removed — a CI or release job`))
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
  const rel = "packages/connectors/camunda/camunda7-connector/src/tools/x.ts"
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
