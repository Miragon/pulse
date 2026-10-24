import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { expandWorkspaceGlobs, workspaceGlobs } from "./check-package-scripts.mjs"
import { ratchetKind } from "./check-ratchets.mjs"
import {
  CAP_EXCEPTION_TRAILER,
  FILE_CAP,
  changedFilesByPackage,
  inMutateScope,
  packageOf,
  planMutationRuns,
  strykerArgs,
  strykerPackages,
  unknownPackageRoots,
} from "./mutation-diff.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const files = (n) => Array.from({ length: n }, (_, i) => `src/f${i}.ts`)

describe("planMutationRuns — the file cap fails loudly instead of skipping", () => {
  it("runs every package under the cap", () => {
    const plan = planMutationRuns(new Map([["packages/core/a", files(FILE_CAP)]]))
    assert.equal(plan.failed, false)
    assert.deepEqual(plan.capped, [])
    assert.equal(plan.runs.length, 1)
  })

  it("FAILS a package over the cap (it used to exit 0 with no mutation check)", () => {
    const plan = planMutationRuns(
      new Map([
        ["packages/core/a", files(FILE_CAP + 1)],
        ["packages/core/b", files(2)],
      ]),
    )
    assert.equal(plan.failed, true)
    assert.deepEqual(plan.capped, [{ pkg: "packages/core/a", count: FILE_CAP + 1 }])
    assert.deepEqual(
      plan.runs.map((r) => r.pkg),
      ["packages/core/b"],
    )
  })

  it("caps an app like any package (a CLI import lands far over the cap)", () => {
    const plan = planMutationRuns(new Map([["apps/cli", files(FILE_CAP + 1)]]))
    assert.equal(plan.failed, true)
    assert.deepEqual(plan.capped, [{ pkg: "apps/cli", count: 26 }])
    assert.deepEqual(plan.runs, [])
  })

  it("waves the capped package through only with the explicit trailer", () => {
    const plan = planMutationRuns(new Map([["packages/core/a", files(40)]]), {
      exceptionReason: "Mutation-Cap-Exception: full local run 71%",
    })
    assert.equal(plan.failed, false)
    assert.equal(plan.capped.length, 1)
    assert.ok(CAP_EXCEPTION_TRAILER.test("refactor: x\n\nMutation-Cap-Exception: full run 71%"))
    assert.ok(!CAP_EXCEPTION_TRAILER.test("refactor: x\n\nMutation-Cap-Exception: "))
  })
})

describe("inMutateScope", () => {
  it("matches nested globs and honours negations", () => {
    const mutate = ["src/**/*.ts", "!src/**/*.test.ts", "!src/postgres.ts"]
    assert.ok(inMutateScope("src/ui/bpmn-heatmap/x.ts", mutate))
    assert.ok(!inMutateScope("src/ui/x.test.ts", mutate))
    assert.ok(!inMutateScope("src/postgres.ts", mutate))
    assert.ok(!inMutateScope("README.md", mutate))
  })
})

/** Files inside a package root, and the root packageOf must report for each. */
const INSIDE = [
  ["apps/cli/src/commands/inspect.ts", "apps/cli", "src/commands/inspect.ts"],
  ["apps/vscode/src/extension.ts", "apps/vscode", "src/extension.ts"],
  // A nested dir stays inside its one app package.
  ["apps/vscode/webview/src/main.tsx", "apps/vscode", "webview/src/main.tsx"],
  ["apps/mcp-server-camunda7/src/index.ts", "apps/mcp-server-camunda7", "src/index.ts"],
  [
    "packages/connectors/camunda/camunda7-domain/src/use-cases/inspect.ts",
    "packages/connectors/camunda/camunda7-domain",
    "src/use-cases/inspect.ts",
  ],
  [
    "packages/core/widget-shell/src/ui/bpmn-heatmap/heat-utils.ts",
    "packages/core/widget-shell",
    "src/ui/bpmn-heatmap/heat-utils.ts",
  ],
  [
    "packages/connectors/analytics/analytics-client/src/queries/x.ts",
    "packages/connectors/analytics/analytics-client",
    "src/queries/x.ts",
  ],
]

/** Files outside every package root: the gate never mutates them. */
const OUTSIDE = [
  "apps/README.md",
  "apps/cli",
  "apps/cli/",
  "packages/core/README.md",
  "packages/connectors/camunda/README.md",
  "scripts/mutation-diff.mjs",
  "docs/index.md",
  "templates/composed-server/server/src/x.ts",
  "engine-plugins/x/src/a.kt",
  ".context/pulse-vscode/src/x.ts",
  "xapps/cli/src/a.ts",
  "packages/tier/x/src/a.ts",
]

describe("packageOf: the package roots the gate mutates", () => {
  it("maps apps, core packages and connector-family packages (incl. a -domain) to their root", () => {
    for (const [file, pkg, rel] of INSIDE) assert.deepEqual(packageOf(file), { pkg, rel }, file)
  })

  it("returns null outside every package root (anchored, known tiers only)", () => {
    for (const file of OUTSIDE) assert.equal(packageOf(file), null, file)
  })

  it("agrees with check-ratchets.mjs on the root set", () => {
    // A root mutation-diff gates whose configs check-ratchets would not ratchet
    // (or the reverse) is a hole in one of the two gates.
    for (const [, pkg] of INSIDE) {
      assert.equal(ratchetKind(`${pkg}/stryker.config.json`), "stryker", pkg)
      assert.equal(ratchetKind(`${pkg}/vitest.config.ts`), "vitest", pkg)
    }
    for (const dir of ["packages/tier/x", "docs", "templates/composed-server/server", "xapps/a"]) {
      assert.equal(packageOf(`${dir}/src/a.ts`), null, dir)
      assert.notEqual(ratchetKind(`${dir}/stryker.config.json`), "stryker", dir)
      assert.notEqual(ratchetKind(`${dir}/vitest.config.ts`), "vitest", dir)
    }
    // A nested dir is not a root of its own in either gate.
    assert.equal(packageOf("apps/vscode/webview/stryker.config.json")?.pkg, "apps/vscode")
    assert.equal(ratchetKind("apps/vscode/webview/stryker.config.json"), null)
  })
})

describe("changedFilesByPackage", () => {
  const MUTATE = {
    "apps/cli": ["src/**/*.ts", "!src/**/*.test.ts"],
    "packages/connectors/camunda/camunda7-domain": ["src/**/*.ts"],
  }
  const gone = new Set(["apps/cli/src/gone.ts"])

  it("keeps the existing, in-scope files of packages with a stryker config", () => {
    const asked = []
    const byPackage = changedFilesByPackage(
      [
        "apps/cli/src/a.ts",
        "apps/cli/src/a.test.ts",
        "apps/cli/README.md",
        "apps/cli/src/gone.ts",
        "apps/cli/src/b.ts",
        "apps/vscode/src/b.ts",
        "apps/mcp-server-camunda7/src/index.ts",
        "packages/connectors/camunda/camunda7-domain/src/use-cases/c.ts",
        "scripts/x.mjs",
      ],
      {
        fileExists: (file) => !gone.has(file),
        mutateOf: (pkg) => {
          asked.push(pkg)
          return MUTATE[pkg] ?? null
        },
      },
    )
    assert.deepEqual(
      byPackage,
      new Map([
        ["apps/cli", ["src/a.ts", "src/b.ts"]],
        ["packages/connectors/camunda/camunda7-domain", ["src/use-cases/c.ts"]],
      ]),
    )
    // One config read per package; none for files outside every root.
    assert.deepEqual(asked, [
      "apps/cli",
      "apps/vscode",
      "apps/mcp-server-camunda7",
      "packages/connectors/camunda/camunda7-domain",
    ])
  })

  it("returns an empty map when no change is in scope", () => {
    const byPackage = changedFilesByPackage(["docs/index.md", "apps/cli/README.md"], {
      fileExists: () => true,
      mutateOf: (pkg) => MUTATE[pkg] ?? null,
    })
    assert.equal(byPackage.size, 0)
  })

  it("mirrors an empty allowlist: Stryker mutates nothing, so nothing is in scope", () => {
    const byPackage = changedFilesByPackage(["apps/cli/src/a.ts"], {
      fileExists: () => true,
      mutateOf: () => [],
    })
    assert.equal(byPackage.size, 0)
  })

  it("THROWS for a config without a mutate list instead of skipping the package", () => {
    for (const mutate of [undefined, {}, "src/**/*.ts", ["src/**/*.ts", 3]]) {
      assert.throws(
        () =>
          changedFilesByPackage(["apps/cli/src/a.ts"], {
            fileExists: () => true,
            mutateOf: () => mutate,
          }),
        /apps\/cli\/stryker\.config\.json has no "mutate" allowlist/,
        JSON.stringify(mutate),
      )
    }
  })

  it("never reads the config of a deleted file's package", () => {
    const byPackage = changedFilesByPackage(["apps/cli/src/gone.ts"], {
      fileExists: () => false,
      mutateOf: () => assert.fail("read a config for a deleted file"),
    })
    assert.equal(byPackage.size, 0)
  })
})

describe("strykerArgs", () => {
  it("runs the package's test:mutation over the diff on a throwaway incremental file", () => {
    assert.deepEqual(strykerArgs("apps/cli", ["src/a.ts", "src/b.ts"]), [
      "--fail-if-no-match",
      "--filter",
      "./apps/cli",
      "run",
      "test:mutation",
      "--mutate",
      "src/a.ts,src/b.ts",
      "--incrementalFile",
      ".stryker-tmp/diff-gate-incremental.json",
    ])
  })

  it("puts --fail-if-no-match before `run`, where pnpm reads its own options", () => {
    const args = strykerArgs("apps/vscode", ["src/x.ts"])
    assert.ok(args.indexOf("--fail-if-no-match") >= 0)
    assert.ok(args.indexOf("--fail-if-no-match") < args.indexOf("run"))
    assert.ok(args.indexOf("--filter") < args.indexOf("run"))
  })

  it("filters by the package dir, for a -domain package too", () => {
    const args = strykerArgs("packages/connectors/camunda/camunda7-domain", ["src/x.ts"], "x.json")
    assert.equal(
      args[args.indexOf("--filter") + 1],
      "./packages/connectors/camunda/camunda7-domain",
    )
    assert.equal(args.at(-1), "x.json")
  })
})

/** Writes `files` (path → content) under a fresh tmpdir and returns its root. */
function fixtureTree(files) {
  const root = mkdtempSync(path.join(tmpdir(), "mutation-diff-"))
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), content)
  }
  return root
}

const STRYKER = JSON.stringify({ mutate: ["src/**/*.ts"] })

describe("strykerPackages + unknownPackageRoots: no stryker package outside the gate", () => {
  it("lists the workspace dirs with a config and names the ones packageOf cannot reach", () => {
    const root = fixtureTree({
      "pnpm-workspace.yaml": [
        "packages:",
        '  - "apps/*"',
        '  - "packages/core/*"',
        '  - "packages/connectors/*/*"',
        '  - "packages/tier/*"',
        '  - "docs"',
      ].join("\n"),
      "apps/cli/package.json": JSON.stringify({ name: "@miragon/pulse-cli" }),
      "apps/cli/stryker.config.json": STRYKER,
      "apps/vscode/package.json": JSON.stringify({
        name: "pulse-vscode",
        engines: { vscode: "^1.95.0" },
      }),
      "apps/vscode/stryker.config.json": STRYKER,
      "apps/plain/package.json": JSON.stringify({ name: "@miragon/pulse-plain" }),
      "packages/connectors/camunda/camunda7-domain/package.json": JSON.stringify({
        name: "@miragon/pulse-camunda7-domain",
      }),
      "packages/connectors/camunda/camunda7-domain/stryker.config.json": STRYKER,
      "packages/tier/x/package.json": JSON.stringify({ name: "@miragon/pulse-x" }),
      "packages/tier/x/stryker.config.json": STRYKER,
      "docs/package.json": JSON.stringify({ name: "@miragon/pulse-docs" }),
      "docs/stryker.config.json": STRYKER,
      // Not a workspace member: never listed.
      "templates/composed-server/server/package.json": "{}",
      "templates/composed-server/server/stryker.config.json": STRYKER,
    })
    try {
      const dirs = strykerPackages(root)
      assert.deepEqual(dirs, [
        "apps/cli",
        "apps/vscode",
        "docs",
        "packages/connectors/camunda/camunda7-domain",
        "packages/tier/x",
      ])
      assert.deepEqual(unknownPackageRoots(dirs), ["docs", "packages/tier/x"])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("treats a nested dir as outside: its own root would be its parent app", () => {
    assert.deepEqual(unknownPackageRoots(["apps/vscode/webview", "apps/vscode"]), [
      "apps/vscode/webview",
    ])
  })

  it("real repo: every stryker package is a package root both gates know", () => {
    const dirs = strykerPackages(repoRoot)
    for (const dir of [
      "packages/core/widget-shell",
      "packages/connectors/camunda/camunda7-client",
      "packages/connectors/camunda/camunda7-connector",
      "packages/connectors/analytics/analytics-client",
      "packages/connectors/analytics/analytics-connector",
    ]) {
      assert.ok(dirs.includes(dir), dir)
    }
    assert.deepEqual(unknownPackageRoots(dirs), [])
    for (const dir of dirs) assert.equal(ratchetKind(`${dir}/stryker.config.json`), "stryker", dir)
  })

  it("real repo: every workspace source package is a root, so its config would be gated", () => {
    // check-package-scripts.mjs requires a stryker.config.json for every source
    // package but the exempt apps; one outside the roots would carry it unseen.
    const globs = workspaceGlobs(readFileSync(path.join(repoRoot, "pnpm-workspace.yaml"), "utf8"))
    const sources = expandWorkspaceGlobs(repoRoot, globs).filter((dir) =>
      existsSync(path.join(repoRoot, dir, "src")),
    )
    assert.ok(sources.includes("apps/mcp-server-camunda7"))
    assert.deepEqual(unknownPackageRoots(sources), [])
    for (const dir of sources) assert.equal(ratchetKind(`${dir}/vitest.config.ts`), "vitest", dir)
  })
})
