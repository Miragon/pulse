import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import {
  GATE_PATH,
  MUTATION_REPORT,
  MUTATED_PACKAGES,
  checkFilters,
  checkMutatedPackages,
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
import { MUTATION_PAUSED } from "./mutation-pause.mjs"

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

  it("flags each missing script: turbo would skip the package silently", () => {
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

  // Lax expansion would read `packages/**` as no package, so a new tier would leave every gate.
  it("fails on a glob it cannot expand instead of reading it as no package", () => {
    for (const glob of ["packages/**", "apps/cli-*", "!apps/old", "../outside", "apps/./x"]) {
      assert.throws(
        () => expandWorkspaceGlobs(tmpdir(), [glob]),
        /expand literal segments and a whole "\*" segment only/,
        glob,
      )
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
const NO_STRYKER = { exists: false }
const CORE = "packages/connectors/c7/c7-core"
const CONNECTOR = "packages/connectors/engine/engine-connector"
const CHOSEN = "owner decision: the shared pure rules"

describe("checkPackageConfigs: the configs a source package's scripts measure against", () => {
  it("accepts a listed package with a valid stryker.config.json and an unlisted one without", () => {
    assert.deepEqual(
      checkPackageConfigs(CORE, {
        hasVitestConfig: true,
        stryker: STRYKER_OK,
        mutatedReason: CHOSEN,
      }),
      [],
    )
    assert.deepEqual(
      checkPackageConfigs(CONNECTOR, { hasVitestConfig: true, stryker: NO_STRYKER }),
      [],
    )
  })

  it("requires a vitest.config.ts: vitest's default measures no coverage", () => {
    const errors = checkPackageConfigs(CONNECTOR, {
      hasVitestConfig: false,
      stryker: NO_STRYKER,
    })
    assert.equal(errors.length, 1)
    assert.match(
      errors[0],
      /^packages\/connectors\/engine\/engine-connector: no vitest\.config\.ts/,
    )
    assert.match(errors[0], /sharedConfig/)
  })

  it("requires a stryker.config.json in a listed package", () => {
    const errors = checkPackageConfigs(CORE, {
      hasVitestConfig: true,
      stryker: NO_STRYKER,
      mutatedReason: CHOSEN,
    })
    assert.equal(errors.length, 1)
    assert.match(
      errors[0],
      /^packages\/connectors\/c7\/c7-core: listed in MUTATED_PACKAGES but has no stryker\.config\.json/,
    )
  })

  it("fails a stryker.config.json in an unlisted package, valid or not", () => {
    for (const stryker of [
      STRYKER_OK,
      { exists: true, config: withThresholds({ break: null }) },
      { exists: true, parseError: "Unexpected token" },
    ]) {
      const errors = checkPackageConfigs("apps/cli", { hasVitestConfig: true, stryker })
      assert.equal(errors.length, 1, JSON.stringify(stryker))
      assert.match(
        errors[0],
        /^apps\/cli: carries a stryker\.config\.json but is not in MUTATED_PACKAGES/,
      )
    }
  })

  it("checks a listed package's config", () => {
    const errors = checkPackageConfigs(CORE, {
      hasVitestConfig: true,
      stryker: { exists: true, config: withThresholds({ break: null }) },
      mutatedReason: CHOSEN,
    })
    assert.equal(errors.length, 1)
    assert.match(
      errors[0],
      /^packages\/connectors\/c7\/c7-core\/stryker\.config\.json: thresholds\.break/,
    )
  })

  it("names an unreadable config instead of crashing or skipping it", () => {
    const errors = checkPackageConfigs(CORE, {
      hasVitestConfig: true,
      stryker: { exists: true, parseError: "Unexpected token" },
      mutatedReason: CHOSEN,
    })
    assert.equal(errors.length, 1)
    assert.match(
      errors[0],
      /^packages\/connectors\/c7\/c7-core\/stryker\.config\.json is not valid JSON \(Unexpected token\)/,
    )
  })

  it("skips only the Stryker rules while mutation testing is paused", () => {
    assert.deepEqual(
      checkPackageConfigs(CORE, {
        hasVitestConfig: true,
        stryker: NO_STRYKER,
        mutatedReason: CHOSEN,
        mutationPaused: true,
      }),
      [],
    )
    assert.deepEqual(
      checkPackageConfigs("apps/cli", {
        hasVitestConfig: true,
        stryker: STRYKER_OK,
        mutationPaused: true,
      }),
      [],
    )
    const errors = checkPackageConfigs(CORE, {
      hasVitestConfig: false,
      stryker: { exists: true, parseError: "Unexpected token" },
      mutatedReason: CHOSEN,
      mutationPaused: true,
    })
    assert.equal(errors.length, 1)
    assert.match(errors[0], /^packages\/connectors\/c7\/c7-core: no vitest\.config\.ts/)
  })
})

describe("checkMutatedPackages: MUTATED_PACKAGES cannot outlive its reason", () => {
  const sources = ["apps/server", "apps/cli", CORE]

  it("accepts a source package that carries a reason", () => {
    assert.deepEqual(checkMutatedPackages(sources, { [CORE]: CHOSEN }), [])
    assert.deepEqual(checkMutatedPackages(sources, {}), [])
  })

  it("fails a stale entry: the package is gone or has no src/", () => {
    const errors = checkMutatedPackages(sources, { "packages/core/gone": CHOSEN })
    assert.equal(errors.length, 1)
    assert.match(errors[0], /"packages\/core\/gone" is not a workspace package with src\//)
  })

  it("requires a reason", () => {
    for (const reason of ["", "  ", undefined, 1]) {
      const errors = checkMutatedPackages(sources, { [CORE]: reason })
      assert.equal(errors.length, 1, JSON.stringify(reason))
      assert.match(errors[0], /carries no reason/)
    }
  })

  it("the real map lists c7-core and the transport, each with the owner's decision", () => {
    assert.deepEqual(Object.keys(MUTATED_PACKAGES), [CORE, "packages/core/http"])
    assert.match(
      MUTATED_PACKAGES[CORE],
      /owner decision 2026-11-04: c7-core \(engine-core until 0\.27\)/,
    )
    assert.match(MUTATED_PACKAGES["packages/core/http"], /owner decision 2026-11-08/)
  })
})

const SCRIPTS = COMPLETE

/**
 * A workspace fixture: every package below passes, so each case breaks one
 * thing. A published CLI, a VS Code extension (it declares engines.vscode), a
 * server app and a connector package carry no stryker.config.json; the family
 * core is the one package the fixture's MUTATED lists, and carries one.
 */
const PACKAGES = {
  "apps/cli": { name: "@miragon/pulse-cli" },
  "apps/vscode": { name: "pulse", engines: { vscode: "^1.95.0" } },
  "apps/server": { name: "@miragon/pulse-fixture-root" },
  [CONNECTOR]: { name: "@miragon/pulse-engine-connector" },
  [CORE]: { name: "@miragon/pulse-c7-core", stryker: GOOD_STRYKER },
}
const MUTATED = { [CORE]: "the fixture's chosen package" }

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
  for (const [dir, spec] of Object.entries(packages)) {
    const { name, engines, stryker, vitest = true, src = true, raw } = spec
    write(`${dir}/package.json`, JSON.stringify({ name, engines, scripts: SCRIPTS }))
    if (src) write(`${dir}/src/index.ts`, "export {}\n")
    if (vitest) write(`${dir}/vitest.config.ts`, "export default {}\n")
    if (raw !== undefined) write(`${dir}/stryker.config.json`, raw)
    else if (stryker) write(`${dir}/stryker.config.json`, JSON.stringify(stryker))
  }
  return root
}

/** The errors checkWorkspace reports for the fixture with `change` applied. */
function workspaceErrors(change, { mutatedPackages = MUTATED, mutationPaused = false } = {}) {
  const root = workspaceFixture(change)
  try {
    const globs = workspaceGlobs(readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8"))
    return checkWorkspace(root, globs, { mutatedPackages, mutationPaused })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe("checkWorkspace over fixture trees", () => {
  it("passes the fixture as built and checks only packages with src/", () => {
    const { errors, sourceDirs } = workspaceErrors()
    assert.deepEqual(errors, [])
    assert.deepEqual(sourceDirs, ["apps/cli", "apps/server", "apps/vscode", CORE, CONNECTOR])
  })

  it("flags a connector package without vitest.config.ts", () => {
    const { errors } = workspaceErrors((p) => (p[CONNECTOR].vitest = false))
    assert.deepEqual(errors.length, 1)
    assert.match(
      errors[0],
      /^packages\/connectors\/engine\/engine-connector: no vitest\.config\.ts/,
    )
  })

  it("flags a listed package without stryker.config.json", () => {
    const { errors } = workspaceErrors((p) => (p[CORE].stryker = null))
    assert.equal(errors.length, 1)
    assert.match(errors[0], /^packages\/connectors\/c7\/c7-core: listed in MUTATED_PACKAGES/)
  })

  for (const dir of ["apps/cli", "apps/vscode", "apps/server", CONNECTOR]) {
    it(`flags a valid stryker.config.json in the unlisted ${dir}`, () => {
      const { errors } = workspaceErrors((p) => (p[dir].stryker = GOOD_STRYKER))
      assert.equal(errors.length, 1, errors.join("\n"))
      assert.ok(
        errors[0].startsWith(`${dir}: carries a stryker.config.json but is not in `),
        errors[0],
      )
    })
  }

  it("flags the chosen package's config once the package leaves the list", () => {
    const { errors } = workspaceErrors(undefined, { mutatedPackages: {} })
    assert.equal(errors.length, 1)
    assert.match(errors[0], /^packages\/connectors\/c7\/c7-core: carries a stryker\.config\.json/)
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
    it(`flags a listed package's stryker.config.json with ${label}`, () => {
      const { errors } = workspaceErrors((p) => (p[CORE].stryker = stryker))
      assert.equal(errors.length, 1, errors.join("\n"))
      assert.ok(errors[0].startsWith(`${CORE}/stryker.config.json: `), errors[0])
      assert.match(errors[0], pattern)
    })
  }

  it("flags a listed package's config that is not valid JSON", () => {
    const { errors } = workspaceErrors((p) => (p[CORE].raw = "{ mutate: [ }"))
    assert.equal(errors.length, 1)
    assert.match(
      errors[0],
      /^packages\/connectors\/c7\/c7-core\/stryker\.config\.json is not valid JSON/,
    )
  })

  it("flags a stale MUTATED_PACKAGES entry: the package is gone", () => {
    const { errors } = workspaceErrors((p) => delete p[CORE])
    assert.equal(errors.length, 1)
    assert.match(
      errors[0],
      /"packages\/connectors\/c7\/c7-core" is not a workspace package with src\//,
    )
  })

  it("flags a stale MUTATED_PACKAGES entry: the package has no src/", () => {
    const { errors, sourceDirs } = workspaceErrors((p) => (p[CORE].src = false))
    assert.ok(!sourceDirs.includes(CORE))
    assert.equal(errors.length, 1)
    assert.match(
      errors[0],
      /"packages\/connectors\/c7\/c7-core" is not a workspace package with src\//,
    )
  })

  it("checks no Stryker rule while mutation testing is paused", () => {
    const { errors } = workspaceErrors(
      (p) => {
        p[CONNECTOR].stryker = GOOD_STRYKER
        p[CORE].stryker = null
      },
      { mutatedPackages: { ...MUTATED, "packages/core/gone": "" }, mutationPaused: true },
    )
    assert.deepEqual(errors, [])
  })

  it("real repo: every source package passes, and only the listed ones carry a config", () => {
    const globs = workspaceGlobs(readFileSync(path.join(repoRoot, "pnpm-workspace.yaml"), "utf8"))
    const { errors, sourceDirs } = checkWorkspace(repoRoot, globs, {
      mutationPaused: MUTATION_PAUSED,
    })
    assert.deepEqual(errors, [])
    for (const dir of [
      "apps/mcp-server",
      "packages/core/widget-shell",
      "packages/connectors/c7/c7-client",
      "packages/connectors/engine/engine-connector",
      "packages/connectors/c7/c7-core",
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
