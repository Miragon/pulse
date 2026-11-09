import assert from "node:assert/strict"
import { mkdtempSync, rmdirSync, symlinkSync, unlinkSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, it } from "node:test"
import { realpathOnDisk, testOnePlan } from "./local-test-one.mjs"
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
  testOnePlan({ files, watch: false, root, cwd: root, workspace, realpath: (p) => p, ...options })

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
    assert.match(plan(["packages/view"]).runs[0].hint, /install chromium/)
  })

  it("names no browser install when every file it runs is a Node test file", () => {
    assert.equal(plan(["packages/view/src/a.test.ts"]).runs[0].hint, undefined)
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

  it("reads a relative path from the root when it is not where pnpm ran (pnpm -C <root>)", () => {
    const atRoot = (p) => (p.startsWith("/repo/scripts/") ? undefined : p)
    const fromScripts = plan(["packages/core/src/a.test.ts"], {
      cwd: "/repo/scripts",
      realpath: atRoot,
    })
    assert.deepEqual(selected(fromScripts.runs[0]), ["src/a.test.ts"])
  })

  it("names a file that does not exist everywhere it looked", () => {
    const missing = { realpath: () => undefined }
    const refused = plan(["src/gone.test.ts"], { ...missing, cwd: "/repo/apps/cli" })
    assert.equal(
      refused.message,
      "No such file: /repo/apps/cli/src/gone.test.ts or /repo/src/gone.test.ts",
    )
    assert.equal(plan(["/repo/a.test.ts"], missing).message, "No such file: /repo/a.test.ts")
  })

  it("matches a checkout reached through a symlink, the root resolved or not", () => {
    const realpath = (p) => p.replace(/^\/tmp\//, "/private/tmp/")
    const linked = "/tmp/repo/packages/core/src/a.test.ts"
    for (const checkout of ["/private/tmp/repo", "/tmp/repo"]) {
      const { runs } = plan([linked], { root: checkout, cwd: "/tmp/repo", realpath })
      assert.deepEqual([runs[0].dir, ...selected(runs[0])], ["packages/core", "src/a.test.ts"])
    }
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
      plan(["apps/cli/test-host/fleet.spec.ts"]).message,
      /needs Playwright.*--filter @x\/cli test:host/,
    )
    assert.match(
      plan(["packages/view/test/smoke/activation.test.cjs"]).message,
      /needs VS Code.*--filter @x\/view test:smoke/,
    )
  })

  it("knows those suites by the path inside the package, however the file was given", () => {
    const fromTestHost = plan(["fleet.spec.ts"], { cwd: "/repo/apps/cli/test-host" })
    assert.match(fromTestHost.message, /needs Playwright.*test:host/)
    assert.match(plan(["apps/cli/test-host"]).message, /needs Playwright.*test:host/)
    assert.equal(plan(["apps/cli/test/test-host-fake.test.ts"]).runs.length, 1)
  })

  it("resolves files of the real workspace, the extension's and a connector's", () => {
    const real = (file) =>
      testOnePlan({
        files: [file],
        watch: false,
        root: REPO_ROOT,
        cwd: REPO_ROOT,
        workspace: readWorkspace(REPO_ROOT),
        realpath: (p) => p,
      })
    const extension = real("apps/vscode/test/webview/a.test.tsx")
    assert.deepEqual(extension.builds, ["pulse-cockpit^..."])
    assert.match(extension.runs[0].hint, /install chromium/)
    // c7-core's tests run on the engine contract's build; the contract depends on nothing.
    assert.deepEqual(real("packages/connectors/c7/c7-core/src/a.test.ts").builds, [
      "@miragon/pulse-c7-core^...",
    ])
    assert.deepEqual(real("packages/core/engine-contract/test/a.test.ts").builds, [])
    assert.equal(
      real("packages/connectors/engine/engine-connector/src/a.test.tsx").runs[0].dir,
      "packages/connectors/engine/engine-connector",
    )
  })

  it("resolves a real file through a symlinked checkout on disk", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "test-one-"))
    const link = path.join(dir, "checkout")
    symlinkSync(REPO_ROOT, link, "dir")
    try {
      const { runs } = testOnePlan({
        files: [path.join(link, "packages/connectors/c7/c7-core/src/dates.test.ts")],
        watch: false,
        root: REPO_ROOT,
        cwd: link,
        workspace: readWorkspace(REPO_ROOT),
        realpath: realpathOnDisk,
      })
      assert.deepEqual(
        [runs[0].dir, ...selected(runs[0])],
        ["packages/connectors/c7/c7-core", "src/dates.test.ts"],
      )
    } finally {
      unlinkSync(link)
      rmdirSync(dir)
    }
  })
})
