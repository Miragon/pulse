import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import {
  CONNECTOR_ROLES,
  GENERATED_DIRS,
  checkLayout,
  checkPackageName,
  checkPackageNaming,
  compareVersions,
  existingFiles,
  listRepoFiles,
  packageKind,
  versionFloor,
} from "./check-package-naming.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const require = createRequire(import.meta.url)

const SDK = "packages/connectors/camunda/camunda7-client/src/generated"
const DOMAIN = "packages/connectors/camunda/camunda7-domain"
const WORKSPACE = [
  "packages:",
  '  - "apps/*"',
  '  - "packages/core/*"',
  '  - "packages/connectors/*/*"',
  '  - "docs"',
  "",
].join("\n")
const EXTENSION = {
  name: "pulse-vscode",
  publisher: "miragon-gmbh",
  engines: { vscode: "^1.101.0" },
  devDependencies: { "@types/vscode": "1.101.0" },
}
const scoped = (dir) => ({ name: `@miragon/pulse-${path.posix.basename(dir)}` })

/** Today's packages plus the CLI, the extension and the first -domain package. */
const FUTURE = {
  "pnpm-workspace.yaml": WORKSPACE,
  "apps/mcp-server-camunda7/package.json": {
    name: "@miragon/pulse-mcp-server-camunda7",
    private: true,
    bin: { "mcp-server-camunda7": "dist/index.js" },
  },
  "apps/cli/package.json": { name: "@miragon/pulse-cli", bin: { "pulse-cli": "dist/cli.js" } },
  "apps/vscode/package.json": EXTENSION,
  "packages/core/widget-shell/package.json": { name: "@miragon/pulse-widget-shell" },
  "packages/connectors/camunda/camunda7-client/package.json": scoped("camunda7-client"),
  "packages/connectors/camunda/camunda7-domain/package.json": scoped("camunda7-domain"),
  "packages/connectors/camunda/camunda7-connector/package.json": scoped("camunda7-connector"),
  "packages/connectors/analytics/analytics-client/package.json": scoped("analytics-client"),
  "packages/connectors/analytics/analytics-connector/package.json": scoped("analytics-connector"),
  "docs/package.json": { name: "@miragon/pulse-docs", private: true },
}

const DIR = Symbol("directory")

/** Builds `files` (path -> JSON, text, DIR or undefined to drop) under tmpdir, runs `check`, removes it. */
function inTree(files, check) {
  const root = mkdtempSync(path.join(tmpdir(), "pkg-naming-"))
  try {
    for (const [rel, content] of Object.entries(files)) {
      if (content === undefined) continue
      const abs = path.join(root, rel)
      if (content === DIR) {
        mkdirSync(abs, { recursive: true })
        continue
      }
      mkdirSync(path.dirname(abs), { recursive: true })
      writeFileSync(abs, typeof content === "string" ? content : JSON.stringify(content))
    }
    return check(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const namingErrors = (files) => inTree(files, (root) => checkPackageNaming(root).errors)

/** Asserts exactly one error, matching `pattern`. */
function assertOne(errors, pattern, label) {
  assert.equal(errors.length, 1, `${label}: ${JSON.stringify(errors)}`)
  assert.match(errors[0], pattern, label)
}

describe("checkPackageName: today's packages", () => {
  it("accepts every package the repo has", () => {
    for (const [dir, manifest] of [
      [
        "apps/mcp-server-camunda7",
        { name: "@miragon/pulse-mcp-server-camunda7", private: true, bin: { x: "dist/index.js" } },
      ],
      ["packages/core/widget-shell", { name: "@miragon/pulse-widget-shell" }],
      ["packages/connectors/camunda/camunda7-client", scoped("camunda7-client")],
      ["packages/connectors/camunda/camunda7-connector", scoped("camunda7-connector")],
      ["packages/connectors/analytics/analytics-client", scoped("analytics-client")],
      ["packages/connectors/analytics/analytics-connector", scoped("analytics-connector")],
      ["docs", { name: "@miragon/pulse-docs", private: true }],
    ]) {
      assert.deepEqual(checkPackageName(dir, manifest), [], dir)
    }
  })
})

describe("checkPackageName: apps", () => {
  it("accepts a published CLI under the scope, with or without engines.node", () => {
    assert.deepEqual(checkPackageName("apps/cli", { name: "@miragon/pulse-cli" }), [])
    assert.deepEqual(
      checkPackageName("apps/cli", { name: "@miragon/pulse-cli", engines: { node: ">=22.22.2" } }),
      [],
    )
  })

  it("keys the extension branch on engines.vscode, not on engines", () => {
    assertOne(
      checkPackageName("apps/cli", { name: "pulse-cli", engines: { node: ">=22.22.2" } }),
      /must be '@miragon\/pulse-cli'.*only a VS Code extension/,
      "engines.node",
    )
  })

  it("names an app without engines.vscode @miragon/pulse-<dir>, and a missing name fails", () => {
    for (const manifest of [
      { name: "pulse-cli" },
      { name: "@acme/pulse-cli" },
      { name: "@miragon/cli" },
      { name: 42 },
    ]) {
      assertOne(
        checkPackageName("apps/cli", manifest),
        /npm name must be '@miragon\/pulse-cli'/,
        JSON.stringify(manifest),
      )
    }
    assertOne(checkPackageName("apps/cli", {}), /package\.json has no 'name'/, "{}")
    assertOne(checkPackageName("apps/cli", undefined), /no 'name'/, "no manifest")
  })
})

describe("checkPackageName: VS Code extension (an app with engines.vscode)", () => {
  it("accepts pulse-<dir>, private or not (the owner does not require private)", () => {
    for (const extra of [{}, { private: true }, { private: false }]) {
      assert.deepEqual(checkPackageName("apps/vscode", { ...EXTENSION, ...extra }), [])
    }
    const { devDependencies, ...withoutTypes } = EXTENSION
    assert.ok(devDependencies)
    assert.deepEqual(checkPackageName("apps/vscode", withoutTypes), [])
  })

  it("rejects a scoped name: vsce takes none", () => {
    assertOne(
      checkPackageName("apps/vscode", { ...EXTENSION, name: "@miragon/pulse-vscode" }),
      /must be named 'pulse-vscode'.*unscoped/,
      "scoped",
    )
  })

  it("rejects every other name, a missing one included", () => {
    for (const name of ["vscode", "pulse-vs-code", "miragon-vscode", undefined]) {
      assertOne(
        checkPackageName("apps/vscode", { ...EXTENSION, name }),
        /must be named 'pulse-vscode'/,
        String(name),
      )
    }
  })

  it("requires engines.vscode to be a non-empty string, whatever else it holds", () => {
    for (const vscode of ["", "   ", 101, null, {}, []]) {
      assertOne(
        checkPackageName("apps/vscode", { ...EXTENSION, engines: { vscode } }),
        /engines\.vscode must be a non-empty VS Code version range/,
        JSON.stringify(vscode),
      )
    }
    // A garbage engines.vscode still makes the app an extension: the scoped name fails too.
    assert.equal(
      checkPackageName("apps/vscode", { name: "@miragon/pulse-vscode", engines: { vscode: null } })
        .length,
      2,
    )
  })

  it("accepts @types/vscode whose floor does not exceed the engines.vscode floor", () => {
    for (const [engine, types, field] of [
      ["^1.101.0", "1.101.0", "devDependencies"],
      ["^1.101.0", "^1.100.0", "devDependencies"],
      ["^1.101.0", "~1.95.3", "devDependencies"],
      ["^1.101.0", "1.101.0", "dependencies"],
      ["^1.101.0", "1.101.x", "devDependencies"],
      ["^1.101.2", "1.101.1", "devDependencies"],
      [">=1.101.0", "1.101.0", "devDependencies"],
      ["1.101.x", "1.101.0", "devDependencies"],
      ["^1.101.0", "1.101.0-next.1", "devDependencies"],
      // vsce compares major.minor only: a DefinitelyTyped patch bump or an insider engine passes.
      ["^1.101.0", "^1.101.1", "devDependencies"],
      ["^1.101.0", "1.101.9", "devDependencies"],
      ["^1.101.0-insider", "1.101.0", "devDependencies"],
    ]) {
      const manifest = { name: "pulse-vscode", engines: { vscode: engine }, [field]: {} }
      manifest[field]["@types/vscode"] = types
      assert.deepEqual(checkPackageName("apps/vscode", manifest), [], `${engine} vs ${types}`)
    }
  })

  it("rejects @types/vscode whose floor exceeds the engines.vscode floor, in either dependency field", () => {
    for (const [engine, types, field] of [
      ["^1.101.0", "1.102.0", "devDependencies"],
      ["^1.101.0", "2.0.0", "dependencies"],
      ["^1.101.0", "^1.102.0-next.0", "devDependencies"],
      ["*", "1.101.0", "devDependencies"],
      ["^1.100.9", "1.101.0", "devDependencies"],
    ]) {
      const manifest = { name: "pulse-vscode", engines: { vscode: engine }, [field]: {} }
      manifest[field]["@types/vscode"] = types
      assertOne(
        checkPackageName("apps/vscode", manifest),
        new RegExp(`${field}\\["@types/vscode"\\].*vsce refuses to package that`),
        `${engine} vs ${types}`,
      )
    }
  })

  it("fails closed on an @types/vscode range it cannot read", () => {
    for (const types of [
      "latest",
      "workspace:*",
      ">1.100.0",
      "1.100.0 - 1.101.0",
      "^1.100.0 || ^1.101.0",
      "",
      1101,
    ]) {
      assertOne(
        checkPackageName("apps/vscode", {
          ...EXTENSION,
          devDependencies: { "@types/vscode": types },
        }),
        /devDependencies\["@types\/vscode"\] is .*not a range this gate can read/,
        JSON.stringify(types),
      )
    }
  })

  it("fails closed, once, on an engines.vscode it cannot read while @types/vscode is declared", () => {
    assertOne(
      checkPackageName("apps/vscode", {
        name: "pulse-vscode",
        engines: { vscode: "insiders" },
        dependencies: { "@types/vscode": "1.101.0" },
        devDependencies: { "@types/vscode": "1.101.0" },
      }),
      /engines\.vscode "insiders" is not a range this gate can read/,
      "insiders",
    )
  })

  it("grants no exception outside apps/: engines.vscode there fails on its own", () => {
    const vscode = { private: true, engines: { vscode: "^1.101.0" } }
    for (const dir of ["packages/core/foo", DOMAIN]) {
      const errors = checkPackageName(dir, { ...vscode, name: `pulse-${path.posix.basename(dir)}` })
      assert.equal(errors.length, 2, JSON.stringify(errors))
      assert.match(errors[0], /only an app under apps\/ can be one/)
      assert.match(errors[1], /npm name must be '@miragon\/pulse-/)
      assertOne(
        checkPackageName(dir, { ...vscode, ...scoped(dir) }),
        /only an app under apps\//,
        dir,
      )
    }
    assertOne(
      checkPackageName("docs", { name: "@miragon/pulse-docs", ...vscode }),
      /only an app under apps\//,
      "docs",
    )
  })
})

describe("checkPackageName: connector families", () => {
  it("admits -domain next to -connector and -client, in any family", () => {
    assert.deepEqual(checkPackageName(DOMAIN, scoped(DOMAIN)), [])
    assert.deepEqual(
      checkPackageName("packages/connectors/camunda8/camunda8-domain", {
        name: "@miragon/pulse-camunda8-domain",
      }),
      [],
    )
  })

  it("rejects every other suffix", () => {
    for (const base of [
      "camunda7-core",
      "camunda7domain",
      "camunda7-domains",
      "camunda7-domain-utils",
      "client",
    ]) {
      const dir = `packages/connectors/camunda/${base}`
      assertOne(
        checkPackageName(dir, scoped(dir)),
        /must end in -connector, -client or -domain/,
        base,
      )
    }
  })

  it("rejects an npm name that does not mirror the directory", () => {
    assertOne(
      checkPackageName(DOMAIN, { name: "@miragon/pulse-c7-domain" }),
      /npm name must be '@miragon\/pulse-camunda7-domain'/,
      "c7",
    )
  })
})

describe("checkPackageName: directory rules", () => {
  it("keeps the role suffixes to packages/connectors/<family>/", () => {
    for (const dir of [
      "packages/core/camunda7-domain",
      "packages/core/shared-client",
      "apps/foo-connector",
      "apps/foo-domain",
    ]) {
      assertOne(checkPackageName(dir, scoped(dir)), /belongs to packages\/connectors/, dir)
    }
    assertOne(
      checkPackageName("apps/vscode-client", {
        name: "pulse-vscode-client",
        engines: { vscode: "^1.101.0" },
      }),
      /role suffix -client/,
      "extension",
    )
  })

  it("rejects a directory that repeats the product prefix, even when the name follows it", () => {
    for (const [dir, manifest] of [
      ["apps/pulse-cli", { name: "@miragon/pulse-pulse-cli" }],
      ["apps/pulse", { name: "@miragon/pulse-pulse" }],
      ["packages/core/pulse-kit", { name: "@miragon/pulse-pulse-kit" }],
      [
        "packages/connectors/camunda/pulse-camunda7-domain",
        { name: "@miragon/pulse-pulse-camunda7-domain" },
      ],
      ["apps/pulse-vscode", { name: "pulse-pulse-vscode", engines: { vscode: "^1.101.0" } }],
    ]) {
      assertOne(checkPackageName(dir, manifest), /repeats the product prefix/, dir)
    }
    assert.deepEqual(checkPackageName("apps/pulsar", { name: "@miragon/pulse-pulsar" }), [])
  })

  it("requires lowercase kebab-case directories", () => {
    for (const dir of [
      "apps/Cli",
      "apps/my_cli",
      "apps/cli.v2",
      "apps/-cli",
      "apps/cli--x",
      "packages/core/Widget-Shell",
    ]) {
      assertOne(checkPackageName(dir, scoped(dir)), /lowercase kebab-case/, dir)
    }
  })

  it("holds docs to its name and to private", () => {
    assertOne(
      checkPackageName("docs", { name: "@miragon/docs", private: true }),
      /must be '@miragon\/pulse-docs'/,
      "name",
    )
    for (const extra of [{}, { private: "true" }, { private: false }]) {
      assertOne(
        checkPackageName("docs", { name: "@miragon/pulse-docs", ...extra }),
        /"private": true/,
        JSON.stringify(extra),
      )
    }
  })

  it("covers exactly the four layouts", () => {
    assert.equal(packageKind("apps/cli"), "app")
    assert.equal(packageKind("packages/core/widget-shell"), "core")
    assert.equal(packageKind(DOMAIN), "connector-family")
    assert.equal(packageKind("docs"), "docs")
    for (const dir of [
      "packages/domains/x",
      "apps/vscode/packages/core",
      "templates/composed-server",
      "packages/connectors/foo-connector",
      "docs/sub",
      "apps",
      "packages/core",
      "packages/connectors/camunda/camunda7-client/sub",
    ]) {
      assert.equal(packageKind(dir), undefined, dir)
      assertOne(checkPackageName(dir, scoped(dir)), /no naming rule covers/, dir)
    }
  })
})

describe("versionFloor and compareVersions", () => {
  it("reads the lowest version of a plain range", () => {
    for (const [range, floor] of [
      ["^1.101.0", "1.101.0"],
      ["~1.95.3", "1.95.3"],
      [">=1.2.3", "1.2.3"],
      [">= 1.2.3", "1.2.3"],
      ["=1.2.3", "1.2.3"],
      ["v1.2.3", "1.2.3"],
      [" 1.2.3 ", "1.2.3"],
      ["1.101", "1.101.0"],
      ["1", "1.0.0"],
      ["1.x", "1.0.0"],
      ["1.2.X", "1.2.0"],
      ["*", "0.0.0"],
      ["x", "0.0.0"],
      ["1.2.3+build.5", "1.2.3"],
    ]) {
      const parsed = versionFloor(range)
      assert.ok(parsed, range)
      assert.equal(parsed.version.join("."), floor, range)
      assert.deepEqual(parsed.prerelease, [], range)
    }
    assert.deepEqual(versionFloor("1.2.3-beta.1").prerelease, ["beta", "1"])
  })

  it("returns undefined for a range with no single readable floor", () => {
    for (const range of [
      "1.x.3",
      "1.2.x-beta",
      "01.2.3",
      ">1.2.3",
      "<2.0.0",
      "1.2.3 - 2.0.0",
      "^1.0.0 || ^2.0.0",
      ">=1.0.0 <2.0.0",
      "latest",
      "workspace:^1.0.0",
      "npm:@types/vscode@1.0.0",
      "",
      undefined,
      3,
    ]) {
      assert.equal(versionFloor(range), undefined, String(range))
    }
  })

  it("orders versions by semver precedence", () => {
    const sorted = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
      "1.0.1",
      "1.1.0",
      "2.0.0",
    ].map(versionFloor)
    for (let index = 1; index < sorted.length; index += 1) {
      assert.ok(compareVersions(sorted[index - 1], sorted[index]) < 0, `${index}`)
      assert.ok(compareVersions(sorted[index], sorted[index - 1]) > 0, `${index}`)
    }
    assert.equal(compareVersions(versionFloor("^1.2.3"), versionFloor("1.2.3")), 0)
    assert.equal(compareVersions(versionFloor("1.2.3-rc.1"), versionFloor("1.2.3-rc.1")), 0)
  })
})

describe("checkPackageNaming over a fixture tree", () => {
  it("passes the future layout: CLI, extension and a -domain package", () => {
    inTree(FUTURE, (root) => {
      assert.deepEqual(checkPackageNaming(root), { errors: [], checked: 10 })
    })
  })

  it("fails a directory without a package.json and one with broken JSON", () => {
    const errors = namingErrors({
      ...FUTURE,
      "apps/leftover/node_modules": DIR,
      "apps/broken/package.json": "{ not json",
    })
    assert.equal(errors.length, 2, JSON.stringify(errors))
    assert.match(errors[0], /^apps\/broken: package\.json is not valid JSON/)
    assert.match(errors[1], /^apps\/leftover: missing package\.json \(a directory left behind/)
  })

  it("fails a package.json without a name (no silent pass)", () => {
    assertOne(
      namingErrors({ ...FUTURE, "packages/core/x/package.json": { private: true } }),
      /^packages\/core\/x: .*no 'name'/,
      "no name",
    )
  })

  it("fails a workspace glob that reaches outside the known layouts", () => {
    for (const [glob, manifestPath] of [
      ["packages/domains/*", "packages/domains/camunda7-domain/package.json"],
      ["apps/*/packages/*", "apps/vscode/packages/core/package.json"],
      ["templates/*", "templates/composed-server/package.json"],
      ["packages/*", undefined],
      ["packages/connectors/*", undefined],
      ["*", undefined],
    ]) {
      const files = { ...FUTURE, "pnpm-workspace.yaml": `${WORKSPACE}  - "${glob}"\n` }
      if (manifestPath) files[manifestPath] = { name: "pulse-starter" }
      assertOne(namingErrors(files), /outside apps\/<dir>, packages\/core\/<dir>/, glob)
    }
  })

  it("fails glob syntax the gates do not expand", () => {
    for (const glob of [
      "apps/**",
      "!apps/legacy",
      "packages/{core,connectors}/*",
      "apps/?li",
      "apps/[a-z]*",
      "../outside/*",
      "apps/./cli",
    ]) {
      assertOne(
        namingErrors({ ...FUTURE, "pnpm-workspace.yaml": `${WORKSPACE}  - "${glob}"\n` }),
        /syntax the gates do not expand/,
        glob,
      )
    }
  })

  it("fails a package that no workspace glob includes", () => {
    const errors = namingErrors({
      ...FUTURE,
      "pnpm-workspace.yaml": 'packages:\n  - "packages/core/*"\n  - "packages/connectors/*/*"\n',
    })
    assert.deepEqual(
      errors.map((error) => error.split(":")[0]),
      ["apps/cli", "apps/mcp-server-camunda7", "apps/vscode", "docs"],
    )
    assert.match(errors[0], /no pnpm-workspace\.yaml glob includes it/)
  })

  it("fails a missing pnpm-workspace.yaml or one without packages: globs", () => {
    for (const yaml of [undefined, "overrides:\n  qs: ^6\n", 'packages: ["apps/*"]\n']) {
      assertOne(
        namingErrors({ ...FUTURE, "pnpm-workspace.yaml": yaml }),
        /no packages: globs found/,
        String(yaml),
      )
    }
  })

  it("reports a missing tier instead of crashing", () => {
    const tree = { "pnpm-workspace.yaml": WORKSPACE, "apps/cli/package.json": scoped("cli") }
    const errors = namingErrors(tree)
    assert.deepEqual(errors, [
      "packages/core/: missing; the layout expects apps/<dir>, packages/core/<dir> or " +
        "packages/connectors/<family>/<dir> (plus docs)",
      "packages/connectors/: missing; the layout expects apps/<dir>, packages/core/<dir> or " +
        "packages/connectors/<family>/<dir> (plus docs)",
    ])
  })

  it("passes the real repo", () => {
    const { errors, checked } = checkPackageNaming(repoRoot)
    assert.deepEqual(errors, [])
    assert.ok(checked >= 7, `checked ${checked}`)
  })
})

describe("checkLayout", () => {
  const BASE = [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "apps/mcp-server-camunda7/package.json",
    "apps/mcp-server-camunda7/src/index.ts",
    "apps/mcp-server-camunda7/test/fixtures/mcp-app.js",
    "packages/core/widget-shell/src/ui/x.tsx",
    `${SDK}/client.gen.ts`,
    `${SDK}/client/index.ts`,
    "templates/composed-server/server/package.json",
    "templates/composed-server/pnpm-workspace.yaml",
    "docs/package.json",
  ]

  it("passes the listed generated directory and today's layout", () => {
    assert.deepEqual(checkLayout(BASE), [])
  })

  it("fails an unlisted generated/ directory once, however many files it holds", () => {
    const errors = checkLayout([
      ...BASE,
      "apps/cli/src/generated/catalog.ts",
      "apps/cli/src/generated/messages.ts",
      `${DOMAIN}/src/generated/x.ts`,
      "packages/core/widget-shell/src/Generated/x.ts",
      `${SDK}/nested/generated/x.ts`,
    ])
    assert.deepEqual(
      errors.map((error) => error.split(":")[0]),
      [
        "apps/cli/src/generated",
        `${SDK}/nested/generated`,
        `${DOMAIN}/src/generated`,
        "packages/core/widget-shell/src/Generated",
      ],
    )
    assert.match(errors[0], /exempt from ESLint, prettier, the source scans and dependency-cruiser/)
    assert.match(errors[0], /GENERATED_DIRS/)
  })

  it("reads a generated directory only as a directory, and only under apps/ or packages/", () => {
    assert.deepEqual(
      checkLayout([
        ...BASE,
        "apps/cli/src/generated",
        "apps/cli/src/generated.ts",
        "apps/cli/src/generated-names.ts",
        "docs/generated/page.md",
        "playground/generated/x.ts",
      ]),
      [],
    )
  })

  it("fails a stale GENERATED_DIRS entry", () => {
    assertOne(
      checkLayout(BASE.filter((file) => !file.startsWith(SDK))),
      new RegExp(`^${SDK}: GENERATED_DIRS lists it, but no file lives there`),
      "stale",
    )
    assertOne(
      checkLayout(BASE, { generatedDirs: { ...GENERATED_DIRS, "apps/cli/src/generated": "x" } }),
      /^apps\/cli\/src\/generated: GENERATED_DIRS lists it/,
      "custom",
    )
    assert.deepEqual(
      checkLayout([...BASE, "apps/cli/src/generated/a.ts"], {
        generatedDirs: { ...GENERATED_DIRS, "apps/cli/src/generated": "x" },
      }),
      [],
    )
  })

  it("fails a JavaScript or module-TypeScript source under a package's src/", () => {
    const offenders = [
      "apps/vscode/src/webview/x.mjs",
      "apps/cli/src/a.js",
      `${DOMAIN}/src/a.cts`,
      `${DOMAIN}/src/b.mts`,
      "packages/core/widget-shell/src/c.cjs",
      "packages/core/widget-shell/src/d.jsx",
      "apps/cli/src/E.JS",
    ]
    const errors = checkLayout([...BASE, ...offenders])
    assert.deepEqual(
      errors.map((error) => error.split(":")[0]),
      [...offenders].sort(),
    )
    assert.match(errors[0], /read \.ts and \.tsx only/)
  })

  it("leaves scripts outside src/ and .ts/.tsx/.d.ts/.json under src/ alone", () => {
    assert.deepEqual(
      checkLayout([
        ...BASE,
        "apps/vscode/build.mjs",
        "apps/vscode/esbuild.config.js",
        "apps/cli/test/helper.js",
        `${DOMAIN}/src/a.ts`,
        `${DOMAIN}/src/b.d.ts`,
        `${DOMAIN}/src/c.json`,
        "apps/vscode/src/webview/view.tsx",
      ]),
      [],
    )
  })

  it("fails a package.json anywhere but a workspace package root", () => {
    const offenders = [
      "apps/vscode/packages/core/package.json",
      "packages/domain/camunda7/package.json",
      "packages/package.json",
      "packages/connectors/camunda/package.json",
      "apps/cli/test/fixtures/x/package.json",
      "apps/package.json",
    ]
    const errors = checkLayout([...BASE, ...offenders])
    assert.deepEqual(
      errors.map((error) => error.split(":")[0]),
      [...offenders].sort(),
    )
    assert.match(errors[0], /makes a nested package/)
    assert.deepEqual(
      checkLayout([
        ...BASE,
        "apps/cli/package.json",
        "packages/core/x/package.json",
        "packages/connectors/fam/x-domain/package.json",
      ]),
      [],
    )
  })

  it("fails a lockfile or pnpm-workspace.yaml under apps/ or packages/", () => {
    const offenders = [
      "apps/vscode/pnpm-workspace.yaml",
      "apps/vscode/pnpm-lock.yaml",
      "apps/cli/package-lock.json",
      "packages/core/x/yarn.lock",
      `${DOMAIN}/npm-shrinkwrap.json`,
      "apps/vscode/bun.lock",
      "apps/vscode/bun.lockb",
    ]
    const errors = checkLayout([...BASE, ...offenders])
    assert.deepEqual(
      errors.map((error) => error.split(":")[0]),
      [...offenders].sort(),
    )
  })

  it("passes the real repo, and GENERATED_DIRS names only directories that exist", () => {
    const files = listRepoFiles(repoRoot)
    assert.ok(files.includes("scripts/check-package-naming.mjs"))
    assert.ok(files.includes("pnpm-workspace.yaml"))
    assert.ok(!files.some((file) => file.split("/").includes("node_modules")))
    for (const dir of Object.keys(GENERATED_DIRS)) {
      assert.ok(
        files.some((file) => file.startsWith(`${dir}/`)),
        dir,
      )
    }
    assert.deepEqual(checkLayout(files), [])
  })
})

describe("existingFiles", () => {
  it("drops listed paths that are gone or are directories", () => {
    inTree({ "a/b.ts": "x", "c/d": DIR }, (root) => {
      assert.deepEqual(existingFiles(root, ["a/b.ts", "c/d", "gone.ts"]), ["a/b.ts"])
    })
  })
})

describe("the CLI", () => {
  it("resolves the repo from its own path, so it runs from any directory", () => {
    const output = execFileSync(
      process.execPath,
      [path.join(repoRoot, "scripts", "check-package-naming.mjs")],
      { cwd: tmpdir(), encoding: "utf8" },
    )
    assert.match(output, /^Package naming: all \d+ workspace packages follow/)
  })
})

describe("lockstep with .dependency-cruiser.cjs", () => {
  const { forbidden } = require("../.dependency-cruiser.cjs")
  const patterns = (spec) => (spec === undefined ? [] : [spec].flat())
  const rule = (name) => forbidden.find((entry) => entry.name === name)

  for (const role of CONNECTOR_ROLES) {
    it(`some rule constrains what a -${role} package imports`, () => {
      const probe = `packages/connectors/fam/x-${role}/src/index.ts`
      const rules = forbidden.filter((entry) =>
        patterns(entry.from?.path).some(
          (pattern) => pattern.includes(`-${role}/`) && new RegExp(pattern).test(probe),
        ),
      )
      assert.ok(
        rules.length > 0,
        `no forbidden rule's from.path names -${role}/ and matches ${probe}: the naming gate ` +
          `admits -${role} packages, so .dependency-cruiser.cjs needs their rule`,
      )
    })

    it(`core-is-foundation bans @miragon/pulse-*-${role}`, () => {
      const probe = `node_modules/@miragon/pulse-x-${role}/dist/index.js`
      assert.ok(
        patterns(rule("core-is-foundation")?.to?.path).some((pattern) =>
          new RegExp(pattern).test(probe),
        ),
        `core-is-foundation's to.path does not match ${probe}`,
      )
    })
  }

  it("packages-never-import-the-app bans every app under both name shapes the gate admits", () => {
    const apps = new Set(["@miragon/pulse-cli", "pulse-vscode"])
    for (const dir of listRepoFiles(repoRoot)) {
      const match = /^apps\/([^/]+)\/package\.json$/.exec(dir)
      if (match) apps.add(require(path.join(repoRoot, dir)).name)
    }
    const banned = patterns(rule("packages-never-import-the-app")?.to?.path)
    for (const name of apps) {
      const probe = `node_modules/${name}/dist/index.js`
      assert.ok(
        banned.some((pattern) => new RegExp(pattern).test(probe)),
        `packages-never-import-the-app's to.path does not match ${probe}`,
      )
    }
  })
})
