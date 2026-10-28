import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import {
  GATE_PATH,
  MUTATION_REPORT,
  NO_MUTATION_APPS,
  checkFilters,
  checkMutationExemptions,
  checkPackageConfigs,
  checkPackageScripts,
  checkStrykerConfig,
  checkWorkspace,
  expandWorkspaceGlobs,
  laxFilters,
  repoTextFiles,
  unknownFilters,
  workspaceGlobs,
} from "./check-package-scripts.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const COMPLETE = { lint: "eslint src", typecheck: "tsc --noEmit", test: "vitest run" }

describe("checkPackageScripts", () => {
  it("accepts a package that defines lint, typecheck and test", () => {
    assert.deepEqual(checkPackageScripts("packages/x", COMPLETE), [])
    assert.deepEqual(
      checkPackageScripts("apps/y", {
        lint: "eslint src test test-host",
        typecheck: "tsc --noEmit && tsc -p tsconfig.ui.json",
        test: "vitest run",
      }),
      [],
    )
    // the root configs, too (the CLI's tsdown and vitest configs)
    assert.deepEqual(
      checkPackageScripts("apps/z", { ...COMPLETE, lint: "eslint src scripts test *.config.ts" }),
      [],
    )
  })

  it("flags each missing script — turbo would skip the package silently", () => {
    const errors = checkPackageScripts("packages/x", {
      typecheck: "tsc --noEmit",
      test: "vitest run",
    })
    assert.equal(errors.length, 1)
    assert.match(errors[0], /missing "lint" script/)
    assert.equal(checkPackageScripts("packages/x", undefined).length, 3)
  })

  it("flags a script that exists but runs nothing of substance", () => {
    const errors = checkPackageScripts("packages/x", {
      ...COMPLETE,
      lint: "true",
      test: "echo skipped",
    })
    assert.equal(errors.length, 2)
    assert.match(errors[0], /"lint" script is "true"/)
    assert.match(errors[1], /expected it to run `vitest run`/)
  })

  it("requires the lint script to cover src", () => {
    assert.equal(checkPackageScripts("packages/x", { ...COMPLETE, lint: "eslint test" }).length, 1)
  })

  it("rejects commands that run the tool but switch its gate off", () => {
    for (const scripts of [
      { test: "vitest run --coverage.enabled=false" },
      { test: "vitest run --coverage.thresholds.lines=0" },
      { test: "vitest run --passWithNoTests" },
      { test: "vitest run || true" },
      { lint: "eslint src || true" },
      { lint: "eslint src --rule 'complexity: off'" },
      { lint: "eslint src --no-config-lookup" },
      { lint: "eslint src/index.ts" },
      { lint: "eslint src *.ts" },
      { lint: "eslint src *.config.ts test" },
      { lint: "eslint *.config.ts" },
      { typecheck: "tsc --version" },
      { typecheck: "tsc --noEmit; true" },
    ]) {
      const errors = checkPackageScripts("packages/x", { ...COMPLETE, ...scripts })
      assert.equal(errors.length, 1, JSON.stringify(scripts))
      assert.match(errors[0], /expected/, JSON.stringify(scripts))
    }
  })

  it("requires typecheck to cover every extra tsconfig project of the package", () => {
    const tsconfigs = ["tsconfig.widgets.json"]
    assert.match(
      checkPackageScripts("packages/x", COMPLETE, { tsconfigs })[0],
      /does not run `tsc -p tsconfig\.widgets\.json`/,
    )
    assert.deepEqual(
      checkPackageScripts(
        "packages/x",
        { ...COMPLETE, typecheck: "tsc --noEmit && tsc -p tsconfig.widgets.json" },
        { tsconfigs },
      ),
      [],
    )
  })
})

describe("workspace discovery", () => {
  it("reads the plain-list packages: globs and stops at the next top-level key", () => {
    const yaml = [
      "packages:",
      '  - "apps/*"',
      "  - packages/core/*",
      "  - 'docs' # site",
      "",
      "overrides:",
      '  qs: "^6"',
    ].join("\n")
    assert.deepEqual(workspaceGlobs(yaml), ["apps/*", "packages/core/*", "docs"])
  })

  it("expands one- and two-level globs to dirs that carry a package.json", () => {
    const root = mkdtempSync(path.join(tmpdir(), "pkg-scripts-"))
    try {
      for (const dir of ["apps/a", "packages/connectors/fam/x-client", "docs", "apps/no-pkg"]) {
        mkdirSync(path.join(root, dir), { recursive: true })
        if (dir !== "apps/no-pkg") writeFileSync(path.join(root, dir, "package.json"), "{}")
      }
      assert.deepEqual(
        expandWorkspaceGlobs(root, ["apps/*", "packages/connectors/*/*", "docs", "missing/*"]),
        ["apps/a", "docs", "packages/connectors/fam/x-client"],
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

/** A stryker.config.json that passes every rule (the shape the repo's packages use). */
const GOOD_STRYKER = {
  testRunner: "vitest",
  mutate: ["src/**/*.ts", "!src/**/*.test.ts"],
  reporters: ["clear-text", "progress", "json"],
  jsonReporter: { fileName: "reports/mutation-report.json" },
  thresholds: { high: 80, low: 60, break: 92 },
}

const withThresholds = (thresholds) => ({ ...GOOD_STRYKER, thresholds })

describe("checkStrykerConfig: a config whose defaults would keep the gate green or blind", () => {
  it("accepts a config with a floor, an allowlist and the json report at the shared path", () => {
    assert.deepEqual(checkStrykerConfig("apps/cli", GOOD_STRYKER), [])
    assert.equal(MUTATION_REPORT, "reports/mutation-report.json")
  })

  it("requires a numeric thresholds.break above 0 (null, a missing or a 0 break never fails)", () => {
    for (const thresholds of [
      { high: 80, low: 60 },
      { high: 80, low: 60, break: null },
      { break: 0 },
      { break: -1 },
      { break: 101 },
      { break: "92" },
      { break: Number.NaN },
      undefined,
    ]) {
      const errors = checkStrykerConfig("apps/cli", withThresholds(thresholds))
      assert.equal(errors.length, 1, JSON.stringify(thresholds))
      assert.match(errors[0], /^apps\/cli\/stryker\.config\.json: thresholds\.break is /)
      assert.match(errors[0], /never fails the run/)
    }
    assert.deepEqual(checkStrykerConfig("apps/cli", withThresholds({ break: 92 })), [])
    assert.deepEqual(checkStrykerConfig("apps/cli", withThresholds({ break: 100 })), [])
    assert.deepEqual(checkStrykerConfig("apps/cli", withThresholds({ break: 0.5 })), [])
  })

  it("requires a mutate list of glob strings (Stryker's defaults cannot be mirrored)", () => {
    for (const mutate of [
      undefined,
      null,
      "src/**/*.ts",
      {},
      ["src/**/*.ts", 3],
      ["src/a.ts", " "],
    ]) {
      const errors = checkStrykerConfig("apps/cli", { ...GOOD_STRYKER, mutate })
      assert.equal(errors.length, 1, JSON.stringify(mutate))
      assert.match(errors[0], /"mutate" is not a list of glob strings/)
    }
  })

  it("rejects a mutate list that selects nothing: empty or negations only", () => {
    for (const mutate of [[], ["!src/**/*.test.ts"]]) {
      const errors = checkStrykerConfig("apps/cli", { ...GOOD_STRYKER, mutate })
      assert.equal(errors.length, 1, JSON.stringify(mutate))
      assert.match(errors[0], /"mutate" selects nothing/)
    }
  })

  it("requires the json reporter (Stryker's defaults write no json)", () => {
    for (const reporters of [undefined, ["clear-text", "progress", "html"], "json"]) {
      const errors = checkStrykerConfig("apps/cli", { ...GOOD_STRYKER, reporters })
      assert.equal(errors.length, 1, JSON.stringify(reporters))
      assert.match(errors[0], /"reporters" does not include "json"/)
    }
  })

  it("requires the json report at reports/mutation-report.json, not Stryker's default path", () => {
    for (const jsonReporter of [
      { fileName: "reports/mutation/mutation.json" },
      { fileName: "./reports/mutation-report.json" },
      {},
      undefined,
    ]) {
      const errors = checkStrykerConfig("apps/cli", { ...GOOD_STRYKER, jsonReporter })
      assert.equal(errors.length, 1, JSON.stringify(jsonReporter))
      assert.match(errors[0], /read only reports\/mutation-report\.json/)
    }
    assert.match(
      checkStrykerConfig("apps/cli", { ...GOOD_STRYKER, jsonReporter: undefined })[0],
      /unset \(Stryker writes reports\/mutation\/mutation\.json\)/,
    )
  })

  it("reports every broken rule of a config that is not an object", () => {
    assert.equal(checkStrykerConfig("apps/cli", null).length, 4)
    assert.equal(checkStrykerConfig("apps/cli", []).length, 4)
  })
})

const STRYKER_OK = { exists: true, config: GOOD_STRYKER }

describe("checkPackageConfigs: the configs a source package's scripts measure against", () => {
  it("accepts a package with a vitest.config.ts and a valid stryker.config.json", () => {
    assert.deepEqual(
      checkPackageConfigs("packages/connectors/camunda/camunda7-connector", {
        hasVitestConfig: true,
        stryker: STRYKER_OK,
      }),
      [],
    )
  })

  it("requires a vitest.config.ts: vitest's default measures no coverage", () => {
    const errors = checkPackageConfigs("packages/connectors/camunda/camunda7-connector", {
      hasVitestConfig: false,
      stryker: STRYKER_OK,
    })
    assert.equal(errors.length, 1)
    assert.match(
      errors[0],
      /^packages\/connectors\/camunda\/camunda7-connector: no vitest\.config\.ts/,
    )
    assert.match(errors[0], /sharedConfig/)
  })

  it("requires a stryker.config.json unless the app is exempt", () => {
    const errors = checkPackageConfigs("apps/cli", {
      hasVitestConfig: true,
      stryker: { exists: false },
    })
    assert.equal(errors.length, 1)
    assert.match(errors[0], /^apps\/cli: no stryker\.config\.json/)
    assert.deepEqual(
      checkPackageConfigs("apps/server", {
        hasVitestConfig: true,
        stryker: { exists: false },
        exemptReason: "composition root",
      }),
      [],
    )
  })

  it("fails an exemption once the app carries a config, and still checks that config", () => {
    const errors = checkPackageConfigs("apps/server", {
      hasVitestConfig: true,
      stryker: { exists: true, config: withThresholds({ break: null }) },
      exemptReason: "composition root",
    })
    assert.equal(errors.length, 2)
    assert.match(errors[0], /listed in NO_MUTATION_APPS but carries a stryker\.config\.json/)
    assert.match(errors[1], /thresholds\.break/)
  })

  it("names an unreadable config instead of crashing or skipping it", () => {
    const errors = checkPackageConfigs("apps/cli", {
      hasVitestConfig: true,
      stryker: { exists: true, parseError: "Unexpected token" },
    })
    assert.equal(errors.length, 1)
    assert.match(
      errors[0],
      /^apps\/cli\/stryker\.config\.json is not valid JSON \(Unexpected token\)/,
    )
  })
})

describe("checkMutationExemptions: NO_MUTATION_APPS cannot outlive its reason", () => {
  const sources = ["apps/server", "apps/cli", "packages/core/a"]

  it("accepts an app that is a source package and carries a reason", () => {
    assert.deepEqual(checkMutationExemptions(sources, { "apps/server": "composition root" }), [])
    assert.deepEqual(checkMutationExemptions(sources, {}), [])
  })

  it("fails a stale entry: the app is gone or has no src/", () => {
    const errors = checkMutationExemptions(sources, { "apps/gone": "composition root" })
    assert.equal(errors.length, 1)
    assert.match(errors[0], /"apps\/gone" is not a workspace package with src\/ .*remove the/)
  })

  it("exempts apps only: a package is a library the gate must mutate", () => {
    for (const dir of ["packages/core/a", "apps/cli/src", "docs"]) {
      const errors = checkMutationExemptions(sources, { [dir]: "reason" })
      assert.equal(errors.length, 1, dir)
      assert.match(errors[0], /is not an app \(apps\/<name>\)/)
    }
  })

  it("requires a reason", () => {
    for (const reason of ["", "  ", undefined, 1]) {
      const errors = checkMutationExemptions(sources, { "apps/server": reason })
      assert.equal(errors.length, 1, JSON.stringify(reason))
      assert.match(errors[0], /carries no reason/)
    }
  })

  it("the real map exempts only apps, each with a reason", () => {
    assert.deepEqual(Object.keys(NO_MUTATION_APPS), ["apps/mcp-server-camunda7"])
    for (const reason of Object.values(NO_MUTATION_APPS)) assert.ok(reason.length > 20)
  })
})

const SCRIPTS = COMPLETE

/**
 * A workspace fixture: every package below passes, so each case breaks one
 * thing. The apps are the ones P1 prepares for (a published CLI and a VS Code
 * extension, which declares engines.vscode), plus a connector package and an
 * exempt server app.
 */
const PACKAGES = {
  "apps/cli": { name: "@miragon/pulse-cli", stryker: GOOD_STRYKER },
  "apps/vscode": {
    name: "pulse",
    engines: { vscode: "^1.95.0" },
    stryker: GOOD_STRYKER,
  },
  "apps/server": { name: "@miragon/pulse-fixture-root", stryker: null },
  "packages/connectors/camunda/camunda7-connector": {
    name: "@miragon/pulse-camunda7-connector",
    stryker: GOOD_STRYKER,
  },
}
const EXEMPT = { "apps/server": "the fixture's composition root" }

/** Builds the fixture under a fresh tmpdir with `change(packages)` applied; returns its root. */
function workspaceFixture(change = () => {}) {
  const packages = structuredClone(PACKAGES)
  change(packages)
  const root = mkdtempSync(path.join(tmpdir(), "pkg-configs-"))
  const write = (file, content) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), content)
  }
  write(
    "pnpm-workspace.yaml",
    'packages:\n  - "apps/*"\n  - "packages/core/*"\n  - "packages/connectors/*/*"\n  - "docs"\n',
  )
  // The docs site: no src/, so no gate applies.
  write("docs/package.json", JSON.stringify({ name: "@miragon/pulse-docs" }))
  for (const [dir, { name, engines, stryker, vitest = true, raw }] of Object.entries(packages)) {
    write(`${dir}/package.json`, JSON.stringify({ name, engines, scripts: SCRIPTS }))
    write(`${dir}/src/index.ts`, "export {}\n")
    if (vitest) write(`${dir}/vitest.config.ts`, "export default {}\n")
    if (raw !== undefined) write(`${dir}/stryker.config.json`, raw)
    else if (stryker) write(`${dir}/stryker.config.json`, JSON.stringify(stryker))
  }
  return root
}

/** The errors checkWorkspace reports for the fixture with `change` applied. */
function workspaceErrors(change, { noMutationApps = EXEMPT } = {}) {
  const root = workspaceFixture(change)
  try {
    const globs = workspaceGlobs(readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8"))
    return checkWorkspace(root, globs, { noMutationApps })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const CONNECTOR = "packages/connectors/camunda/camunda7-connector"

describe("checkWorkspace over fixture trees", () => {
  it("passes the fixture as built and checks only packages with src/", () => {
    const { errors, sourceDirs } = workspaceErrors()
    assert.deepEqual(errors, [])
    assert.deepEqual(sourceDirs, ["apps/cli", "apps/server", "apps/vscode", CONNECTOR])
  })

  it("flags a connector package without vitest.config.ts", () => {
    const { errors } = workspaceErrors((p) => (p[CONNECTOR].vitest = false))
    assert.deepEqual(errors.length, 1)
    assert.match(
      errors[0],
      /^packages\/connectors\/camunda\/camunda7-connector: no vitest\.config\.ts/,
    )
  })

  it("flags an apps/cli without stryker.config.json", () => {
    const { errors } = workspaceErrors((p) => (p["apps/cli"].stryker = null))
    assert.equal(errors.length, 1)
    assert.match(errors[0], /^apps\/cli: no stryker\.config\.json/)
  })

  it("flags an engines.vscode app without stryker.config.json", () => {
    const { errors } = workspaceErrors((p) => (p["apps/vscode"].stryker = null))
    assert.equal(errors.length, 1)
    assert.match(errors[0], /^apps\/vscode: no stryker\.config\.json/)
  })

  it("flags the exempt app once the exemption is gone", () => {
    const { errors } = workspaceErrors(undefined, { noMutationApps: {} })
    assert.equal(errors.length, 1)
    assert.match(errors[0], /^apps\/server: no stryker\.config\.json/)
  })

  for (const [label, stryker, pattern] of [
    ["break null", withThresholds({ high: 80, low: 60, break: null }), /thresholds\.break is null/],
    ["break missing", withThresholds({ high: 80, low: 60 }), /thresholds\.break is missing/],
    ["mutate []", { ...GOOD_STRYKER, mutate: [] }, /"mutate" selects nothing/],
    [
      "jsonReporter at Stryker's default path",
      { ...GOOD_STRYKER, jsonReporter: { fileName: "reports/mutation/mutation.json" } },
      /jsonReporter\.fileName is "reports\/mutation\/mutation\.json"/,
    ],
    [
      "reporters without json",
      { ...GOOD_STRYKER, reporters: ["clear-text", "progress"] },
      /"reporters" does not include "json"/,
    ],
  ]) {
    it(`flags a connector package's stryker.config.json with ${label}`, () => {
      const { errors } = workspaceErrors((p) => (p[CONNECTOR].stryker = stryker))
      assert.equal(errors.length, 1, errors.join("\n"))
      assert.ok(errors[0].startsWith(`${CONNECTOR}/stryker.config.json: `), errors[0])
      assert.match(errors[0], pattern)
    })
  }

  it("flags an engines.vscode app's config that is not valid JSON", () => {
    const { errors } = workspaceErrors((p) => (p["apps/vscode"].raw = "{ mutate: [ }"))
    assert.equal(errors.length, 1)
    assert.match(errors[0], /^apps\/vscode\/stryker\.config\.json is not valid JSON/)
  })

  it("flags a stale NO_MUTATION_APPS entry: the app is gone", () => {
    const { errors } = workspaceErrors((p) => delete p["apps/server"])
    assert.equal(errors.length, 1)
    assert.match(errors[0], /"apps\/server" is not a workspace package with src\//)
  })

  it("flags a stale NO_MUTATION_APPS entry: the app now carries a stryker.config.json", () => {
    const { errors } = workspaceErrors((p) => (p["apps/server"].stryker = GOOD_STRYKER))
    assert.equal(errors.length, 1)
    assert.match(errors[0], /^apps\/server: listed in NO_MUTATION_APPS but carries/)
  })

  it("real repo: every source package passes, the exempt server app included", () => {
    const globs = workspaceGlobs(readFileSync(path.join(repoRoot, "pnpm-workspace.yaml"), "utf8"))
    const { errors, sourceDirs } = checkWorkspace(repoRoot, globs)
    assert.deepEqual(errors, [])
    for (const dir of [
      "apps/mcp-server-camunda7",
      "packages/core/widget-shell",
      "packages/connectors/camunda/camunda7-client",
      "packages/connectors/camunda/camunda7-connector",
      "packages/connectors/analytics/analytics-client",
      "packages/connectors/analytics/analytics-connector",
    ]) {
      assert.ok(sourceDirs.includes(dir), dir)
    }
    assert.ok(!sourceDirs.includes("docs"))
  })
})

// The flag is spelled through a constant, so this file names no stale filter itself.
const FLAG = "--filter"
const SHORT = "-F"

describe("unknownFilters: every filter that names a package names one of its workspace", () => {
  const known = new Set(["@miragon/pulse-widget-shell", "pulse"])
  for (const [text, stale] of [
    [`pnpm ${FLAG} pulse build`, []],
    [`pnpm ${FLAG}=pulse... build`, []],
    [`pnpm ${FLAG} @miragon/pulse-widget-shell test`, []],
    [`pnpm ${FLAG} pulse-vsocde build`, ["pulse-vsocde"]],
    [`pnpm ${FLAG}=pulse-vsocde^... build`, ["pulse-vsocde"]],
    [`pnpm ${FLAG} "!pulse-vsocde" -r build`, ["pulse-vsocde"]],
    [`pnpm ${SHORT} pulse-vsocde build`, ["pulse-vsocde"]],
    [`"x": "pnpm ${FLAG} \\"pulse-vsocde\\" build"`, ["pulse-vsocde"]],
    // One stale name among valid ones passes --fail-if-no-match, so it is checked on its own.
    [`pnpm ${FLAG} pulse ${FLAG} pulse-vsocde build`, ["pulse-vsocde"]],
    [`pnpm ${FLAG} @miragon/pulse-widget-shel test`, ["@miragon/pulse-widget-shel"]],
    // A path selector names no package: --fail-if-no-match covers it on a gate path.
    [`pnpm ${FLAG} ./apps/vscod build`, []],
    [`pnpm ${FLAG} "./modules/**" build`, []],
    [`pnpm ${FLAG} "{apps/vscod}" build`, []],
  ]) {
    it(`reads ${text}`, () => {
      assert.deepEqual(
        unknownFilters("x", text, known),
        stale.map((name) => `x:1 ${FLAG} ${name}`),
      )
    })
  }
})

describe("laxFilters: a pnpm filter on a gate path fails when it matches nothing", () => {
  it("knows the gate paths", () => {
    for (const file of [
      "package.json",
      "apps/vscode/package.json",
      "packages/core/widget-shell/package.json",
      "docs/package.json",
      "Dockerfile",
      ".github/workflows/ci.yml",
      ".github/actions/release/publish/action.yaml",
      "scripts/test-template.sh",
    ])
      assert.ok(GATE_PATH.test(file), file)
    for (const file of ["apps/cli/README.md", "apps/vscode/src/package.json.ts", "docs/x.md"])
      assert.ok(!GATE_PATH.test(file), file)
  })

  it("flags a package script's or a composite action's filter without the flag", () => {
    const build = `pnpm ${FLAG} ./packages/core/widget-shell build`
    assert.deepEqual(
      laxFilters(
        "apps/vscode/package.json",
        [
          `"vscode:prepublish": "${build} && pnpm run bundle",`,
          `"ok": "pnpm --fail-if-no-match ${FLAG} ./apps/vscode build",`,
          `"turbo": "pnpm turbo run build ${FLAG}=./apps/vscode",`,
        ].join("\n"),
      ),
      [`apps/vscode/package.json:1 "vscode:prepublish": "${build}`],
    )
    assert.deepEqual(
      laxFilters(
        ".github/actions/setup/action.yml",
        `# pnpm ${FLAG} ./apps/vscode build\n      run: pnpm ${SHORT} ./apps/vscode build`,
      ),
      [`.github/actions/setup/action.yml:2 run: pnpm ${SHORT} ./apps/vscode build`],
    )
  })
})

describe("checkFilters over the repo", () => {
  it("passes the repo's text files", () => {
    const files = repoTextFiles(repoRoot)
    assert.ok(files.some(({ file }) => file === "CLAUDE.md"))
    assert.deepEqual(checkFilters(files), [])
  })

  it("reads the template's own packages for files under templates/ only", () => {
    const files = [
      { file: "package.json", text: JSON.stringify({ name: "@miragon/pulse-x" }) },
      { file: "templates/t/package.json", text: JSON.stringify({ name: "@acme/server" }) },
      { file: "templates/t/README.md", text: `pnpm ${FLAG} @acme/server dev` },
      { file: "docs/x.md", text: `pnpm ${FLAG} @acme/server dev` },
    ]
    assert.deepEqual(checkFilters(files), [
      `docs/x.md:1 ${FLAG} @acme/server: names no workspace package, so the filter matches nothing`,
    ])
  })
})
