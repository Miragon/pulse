import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { testOnePlan } from "./local-test-one.mjs"
import { REPO_ROOT } from "./source-scan.mjs"
import { readWorkspace } from "./workspace-packages.mjs"

const root = "/repo"
const workspace = [
  {
    dir: "apps/cli",
    manifest: {
      name: "@x/cli",
      scripts: { test: "vitest run" },
      devDependencies: { "@x/core": "workspace:*" },
    },
  },
  { dir: "docs", manifest: { name: "@x/docs", scripts: {} } },
  {
    dir: "packages/core",
    manifest: { name: "@x/core", scripts: { test: "vitest run" }, dependencies: { zod: "4.6.7" } },
  },
  {
    dir: "packages/shell",
    manifest: {
      name: "@x/shell",
      scripts: { test: "vitest run" },
      dependencies: { "@x/core": "workspace:*" },
    },
  },
  {
    dir: "packages/view",
    manifest: {
      name: "@x/view",
      scripts: { test: "vitest run" },
      devDependencies: { "@vitest/browser-playwright": "5.0.5" },
    },
  },
]
const plan = (files, options = {}) =>
  testOnePlan({ files, watch: false, root, cwd: root, workspace, exists: () => true, ...options })

/** The paths a run hands to vitest. */
const selected = (run) => run.args.slice(3, -1)

describe("testOnePlan", () => {
  it("runs a file in its package with coverage off, the packages under it built first", () => {
    assert.deepEqual(plan(["packages/shell/src/a.test.tsx"]), {
      builds: ["@x/shell^..."],
      runs: [
        {
          dir: "packages/shell",
          name: "@x/shell",
          args: ["exec", "vitest", "run", "src/a.test.tsx", "--coverage.enabled=false"],
          hint: undefined,
        },
      ],
    })
  })

  it("counts a dev dependency among the packages to build", () => {
    assert.deepEqual(plan(["apps/cli/src/a.test.ts"]).builds, ["@x/cli^..."])
  })

  it("builds nothing for a package without a workspace dependency", () => {
    assert.deepEqual(plan(["packages/core/src/a.test.ts"]).builds, [])
  })

  it("watches under --watch, coverage still off", () => {
    assert.deepEqual(plan(["packages/core/src/a.test.ts"], { watch: true }).runs[0].args, [
      "exec",
      "vitest",
      "watch",
      "src/a.test.ts",
      "--coverage.enabled=false",
    ])
  })

  it("groups files per package and runs each package once", () => {
    const { builds, runs } = plan([
      "apps/cli/src/a.test.ts",
      "packages/shell/src/b.test.ts",
      "apps/cli/src/c.test.ts",
    ])
    assert.deepEqual(builds, ["@x/cli^...", "@x/shell^..."])
    assert.deepEqual(
      runs.map((run) => [run.name, selected(run)]),
      [
        ["@x/cli", ["src/a.test.ts", "src/c.test.ts"]],
        ["@x/shell", ["src/b.test.ts"]],
      ],
    )
  })

  it("names the browser install for a package that runs tests in Chromium", () => {
    assert.match(
      plan(["packages/view/src/a.test.tsx"]).runs[0].hint,
      /@x\/view runs tests in Chromium.*--filter @x\/view exec playwright install chromium/,
    )
  })

  it("refuses --watch over several packages, naming them", () => {
    const refused = plan(["apps/cli/src/a.test.ts", "packages/core/src/b.test.ts"], { watch: true })
    assert.match(refused.message, /--watch follows one package.*@x\/cli, @x\/core/)
  })

  it("reads a relative path from where the command started, an absolute one as it is", () => {
    const fromPackage = plan(["src/a.test.ts"], { cwd: "/repo/packages/core" })
    assert.deepEqual(selected(fromPackage.runs[0]), ["src/a.test.ts"])
    const absolute = plan(["/repo/packages/core/src/a.test.ts"], { cwd: "/elsewhere" })
    assert.deepEqual(selected(absolute.runs[0]), ["src/a.test.ts"])
  })

  it("selects a whole package by its directory", () => {
    assert.deepEqual(selected(plan(["packages/core"]).runs[0]), ["."])
  })

  it("does not take a sibling directory with the same prefix for the package", () => {
    assert.match(plan(["packages/core-old/a.test.ts"]).message, /belongs to no workspace package/)
  })

  it("names a file that does not exist where it looked", () => {
    const refused = plan(["src/gone.test.ts"], { cwd: "/repo/apps/cli", exists: () => false })
    assert.equal(refused.message, "No such file: /repo/apps/cli/src/gone.test.ts")
  })

  it("points a file outside the packages at what runs it", () => {
    assert.match(plan(["scripts/local-args.test.mjs"]).message, /node --test scripts\//)
    assert.match(plan(["/elsewhere/a.test.ts"]).message, /belongs to no workspace package/)
  })

  it("names a package without tests", () => {
    assert.match(plan(["docs/index.md"]).message, /belongs to @x\/docs, which has no tests/)
  })

  it("points the suites a package's test leaves out at their scripts", () => {
    assert.match(
      plan(["apps/cli/test/integration/operaton.it.test.ts"]).message,
      /needs Docker.*--fail-if-no-match --filter @x\/cli test:engines/,
    )
    assert.match(
      plan(["apps/cli/test/adapters/c7-conformance.engine.test.ts"]).message,
      /needs Docker.*test:engines/,
    )
    assert.match(
      plan(["apps/cli/test-host/analytics.spec.ts"]).message,
      /needs Playwright.*--filter @x\/cli test:host/,
    )
  })

  it("resolves files of the real workspace, the extension's and a connector's", () => {
    const real = (file) =>
      testOnePlan({
        files: [file],
        watch: false,
        root: REPO_ROOT,
        cwd: REPO_ROOT,
        workspace: readWorkspace(REPO_ROOT),
        exists: () => true,
      })
    const extension = real("apps/vscode/test/webview/a.test.tsx")
    assert.deepEqual(extension.builds, ["pulse-cockpit^..."])
    assert.match(extension.runs[0].hint, /install chromium/)
    assert.deepEqual(real("packages/connectors/engine/engine-core/src/a.test.ts").builds, [])
    assert.equal(
      real("packages/connectors/engine/engine-connector/src/a.test.tsx").runs[0].dir,
      "packages/connectors/engine/engine-connector",
    )
  })
})
