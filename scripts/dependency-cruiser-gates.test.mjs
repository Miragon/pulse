import assert from "node:assert/strict"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { after, before, describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { cruise } from "dependency-cruiser"
import extractDepcruiseOptions from "dependency-cruiser/config-utl/extract-depcruise-options"
import extractTSConfig from "dependency-cruiser/config-utl/extract-ts-config"

/**
 * Self-test of the dependency rules in .dependency-cruiser.cjs (a gate that has never been
 * red is decoration). It builds a pnpm-shaped fixture workspace under os.tmpdir() that holds
 * the apps and packages the rules are about, including the ones the repo does not have yet
 * (an apps/cli, an apps/vscode named pulse-vscode, two -domain packages), cruises it ONCE
 * with the REAL config over the paths of the pinned `pnpm lint:architecture` command, and
 * asserts the EXACT set of rules each planted import trips. Exact, so an edge that only
 * no-cross-package-deep-imports catches never passes as "some violation".
 *
 * Every import is planted in all the shapes the header of .dependency-cruiser.cjs names:
 * a relative escape, a declared dependency resolved through the importer's own
 * node_modules symlink (the fixture links every workspace package into every importer, as
 * pnpm does for a declared dependency), and a bare specifier (any subpath, `vscode`).
 *
 * A new or changed rule adds its cases here: the last suite fails while a rule of the
 * config has no case that expects it.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const CONFIG = path.join(repoRoot, ".dependency-cruiser.cjs")

// The fixture workspace: directory -> package.json extras. Every package's `main` is its
// src/index.ts, so nothing needs a build.
const SERVER = "apps/mcp-server-camunda7"
const CLI = "apps/cli"
const EXT = "apps/vscode"
const SHELL = "packages/core/widget-shell"
const C7_CLIENT = "packages/connectors/camunda/camunda7-client"
const C7_CONNECTOR = "packages/connectors/camunda/camunda7-connector"
const C7_DOMAIN = "packages/connectors/camunda/camunda7-domain"
const AN_CLIENT = "packages/connectors/analytics/analytics-client"
const AN_CONNECTOR = "packages/connectors/analytics/analytics-connector"
const AN_DOMAIN = "packages/connectors/analytics/analytics-domain"

const WORKSPACE = {
  [SERVER]: { name: "@miragon/pulse-mcp-server-camunda7", private: true },
  [CLI]: { name: "@miragon/pulse-cli" },
  [EXT]: { name: "pulse-vscode", engines: { vscode: "^1.101.0" } },
  [SHELL]: { name: "@miragon/pulse-widget-shell" },
  [C7_CLIENT]: { name: "@miragon/pulse-camunda7-client" },
  [C7_CONNECTOR]: { name: "@miragon/pulse-camunda7-connector" },
  [C7_DOMAIN]: { name: "@miragon/pulse-camunda7-domain" },
  [AN_CLIENT]: { name: "@miragon/pulse-analytics-client" },
  [AN_CONNECTOR]: { name: "@miragon/pulse-analytics-connector" },
  [AN_DOMAIN]: { name: "@miragon/pulse-analytics-domain" },
}

// Third-party stubs installed into every importer's own node_modules. `vscode` is left out
// on purpose: the extension host provides it at runtime, so it stays a bare specifier.
// `reactive` and `pulse-vscode-tools` prove the name patterns are anchored.
const THIRD_PARTY = [
  "react",
  "react-dom",
  "lucide-react",
  "@tanstack/react-query",
  "mcp-use",
  "@modelcontextprotocol/sdk",
  "@miragon/mcp-toolkit-core",
  "@miragon/mcp-toolkit-ui",
  "hono",
  "postgres",
  "prom-client",
  "zod",
  "@hey-api/client-fetch",
  "preact",
  "bpmn-js",
  "diagram-js",
  "@miragon/modeler-shell",
  "commander",
  "vitest",
  "reactive",
  "pulse-vscode-tools",
]

const PEERS = "connectors-are-peers"
const OWN_CLIENT = "connectors-own-their-client"
const OWN_DOMAIN = "connectors-own-their-domain"
const CLIENT_LEAF = "clients-are-leaves"
const DOMAIN_LEAF = "domains-are-leaves"
const DOMAIN_PURE = "domains-are-pure"
const CORE = "core-is-foundation"
const NO_APP = "packages-never-import-the-app"
const APP_APP = "apps-never-import-apps"
const HEADLESS = "cli-is-headless"
const NO_CLI = "nothing-imports-the-cli"
const NOT_HOST = "extension-is-not-an-mcp-host"
const NO_EXT = "nothing-imports-the-extension"
const DEEP = "no-cross-package-deep-imports"
const CIRCULAR = "no-circular"

const CLI_SRC = `${CLI}/src/index.ts`
const SERVER_SRC = `${SERVER}/src/index.ts`
const EXT_SRC = `${EXT}/src/extension.ts`
const SHELL_SRC = `${SHELL}/src/index.ts`
const C7_CLIENT_SRC = `${C7_CLIENT}/src/index.ts`
const C7_CONNECTOR_SRC = `${C7_CONNECTOR}/src/index.ts`
const C7_DOMAIN_SRC = `${C7_DOMAIN}/src/index.ts`
const AN_CONNECTOR_SRC = `${AN_CONNECTOR}/src/index.ts`

// Leaf modules the relative escapes point at. They import nothing, so no probe forms a cycle
// unless a case plants one on purpose.
const LEAVES = [
  `${SERVER}/src/target.ts`,
  `${SERVER}/src/lib.ts`,
  `${CLI}/src/target.ts`,
  `${CLI}/src/lib.ts`,
  `${EXT}/src/target.ts`,
  `${EXT}/src/panel.ts`,
  `${SHELL}/src/target.ts`,
  `${C7_CLIENT}/src/target.ts`,
  `${C7_CLIENT}/src/lib.ts`,
  `${C7_CLIENT}/src/x-connector/y.ts`,
  `${C7_CLIENT}/src/generated/sdk.gen.ts`,
  `${C7_CONNECTOR}/src/order-domain/model.ts`,
  `${C7_CONNECTOR}/src/generated/catalog.ts`,
  `${C7_DOMAIN}/src/target.ts`,
  `${C7_DOMAIN}/src/model.ts`,
  `${AN_DOMAIN}/src/target.ts`,
]
const JSON_LEAVES = [`${CLI}/src/generated/commands.json`]

/**
 * One suite per rule: [importer, specifier, exact rules, form?]. `form` "type" plants an
 * `import type`, "dynamic" an `import()`, the default a side-effect `import`.
 */
const SUITES = [
  {
    rule: HEADLESS,
    title: "the CLI imports only -domain packages of the workspace and nothing of the MCP/UI stack",
    cases: [
      ...[
        "@miragon/pulse-widget-shell",
        "@miragon/pulse-widget-shell/server",
        "@miragon/pulse-camunda7-connector",
        "@miragon/pulse-camunda7-client",
        "@miragon/pulse-camunda7-client/sdk",
        "@miragon/pulse-camunda7-client/routes",
        "react",
        "react-dom/client",
        "lucide-react",
        "@tanstack/react-query",
        "mcp-use/react",
        "@modelcontextprotocol/sdk/server",
        "@miragon/mcp-toolkit-ui/app",
        "hono",
        "postgres",
        "prom-client",
        "zod",
        "@hey-api/client-fetch",
        "preact",
        "bpmn-js",
        "diagram-js",
        "@miragon/modeler-shell",
        "vscode",
      ].map((spec) => [CLI_SRC, spec, [HEADLESS]]),
      [CLI_SRC, "pulse-vscode", [APP_APP, HEADLESS, NO_EXT]],
      [
        `${CLI}/src/escape-package.ts`,
        "../../../packages/core/widget-shell/src/target.ts",
        [HEADLESS, DEEP],
      ],
      // Allowed: a -domain package (any subpath), the CLI's own libraries and Node built-ins.
      [CLI_SRC, "@miragon/pulse-camunda7-domain", []],
      [CLI_SRC, "@miragon/pulse-camunda7-domain/testing", []],
      [CLI_SRC, "@miragon/pulse-analytics-domain", []],
      [CLI_SRC, "commander", []],
      [CLI_SRC, "node:fs", []],
      [CLI_SRC, "./lib.ts", []],
      [CLI_SRC, "reactive", []],
      [CLI_SRC, "pulse-vscode-tools", []],
    ],
  },
  {
    rule: NO_CLI,
    title: "nothing imports the CLI",
    cases: [
      [SERVER_SRC, "@miragon/pulse-cli", [APP_APP, NO_CLI]],
      [SERVER_SRC, "@miragon/pulse-cli/commands", [APP_APP, NO_CLI]],
      [`${SERVER}/src/escape-cli.ts`, "../../cli/src/target.ts", [APP_APP, NO_CLI, DEEP]],
      [EXT_SRC, "@miragon/pulse-cli", [APP_APP, NOT_HOST, NO_CLI]],
      [SHELL_SRC, "@miragon/pulse-cli", [NO_APP, NO_CLI]],
      [
        `${SHELL}/src/escape-cli.ts`,
        "../../../../apps/cli/src/target.ts",
        [CORE, NO_APP, NO_CLI, DEEP],
      ],
      [C7_DOMAIN_SRC, "@miragon/pulse-cli", [DOMAIN_LEAF, NO_APP, NO_CLI]],
      // Anchored: a package whose name only starts with the CLI's is not the CLI.
      [SERVER_SRC, "@miragon/pulse-client", []],
    ],
  },
  {
    rule: NOT_HOST,
    title:
      "the extension imports only -domain packages of the workspace and nothing of the MCP/UI stack",
    cases: [
      ...[
        "@miragon/pulse-widget-shell",
        "@miragon/pulse-widget-shell/widgets",
        "@miragon/pulse-camunda7-client",
        "@miragon/pulse-camunda7-client/sdk",
        "@miragon/pulse-camunda7-client/routes",
        "@miragon/pulse-camunda7-connector",
        "@miragon/pulse-vscode-core",
        "react",
        "react-dom",
        "lucide-react",
        "@tanstack/react-query",
        "mcp-use",
        "@modelcontextprotocol/sdk",
        "@miragon/mcp-toolkit-ui/app",
        "hono",
        "postgres",
        "prom-client",
        "zod",
        "@hey-api/client-fetch",
      ].map((spec) => [EXT_SRC, spec, [NOT_HOST]]),
      [EXT_SRC, "@miragon/pulse-mcp-server-camunda7", [APP_APP, NOT_HOST]],
      [
        `${EXT}/src/escape-package.ts`,
        "../../../packages/core/widget-shell/src/target.ts",
        [NOT_HOST, DEEP],
      ],
      [`${EXT}/src/escape-app.ts`, "../../cli/src/target.ts", [APP_APP, NOT_HOST, NO_CLI, DEEP]],
      // Allowed: a -domain package, the host API, the extension's own UI stack, Node.
      [EXT_SRC, "@miragon/pulse-camunda7-domain", []],
      [EXT_SRC, "@miragon/pulse-camunda7-domain/testing", []],
      [EXT_SRC, "vscode", []],
      [EXT_SRC, "preact", []],
      [EXT_SRC, "preact/hooks", []],
      [EXT_SRC, "bpmn-js", []],
      [EXT_SRC, "bpmn-js/lib/NavigatedViewer", []],
      [EXT_SRC, "diagram-js", []],
      [EXT_SRC, "@miragon/modeler-shell/vscode/extension", []],
      [EXT_SRC, "node:fs", []],
      [EXT_SRC, "./panel.ts", []],
    ],
  },
  {
    rule: NO_EXT,
    title: "nothing imports the extension",
    cases: [
      [SERVER_SRC, "pulse-vscode", [APP_APP, NO_EXT]],
      [SERVER_SRC, "pulse-vscode/out/api", [APP_APP, NO_EXT]],
      [`${SERVER}/src/escape-extension.ts`, "../../vscode/src/target.ts", [APP_APP, NO_EXT, DEEP]],
      [SHELL_SRC, "pulse-vscode", [NO_APP, NO_EXT]],
      [C7_CLIENT_SRC, "pulse-vscode", [NO_APP, NO_EXT]],
      [C7_CLIENT_SRC, "pulse-vscode/out/api", [NO_APP, NO_EXT]],
      [C7_DOMAIN_SRC, "pulse-vscode", [DOMAIN_LEAF, NO_APP, NO_EXT]],
      // Anchored: the name is unscoped, and a third-party pulse-vscode-tools is not the extension.
      [SERVER_SRC, "pulse-vscode-tools", []],
      [SHELL_SRC, "pulse-vscode-tools", []],
    ],
  },
  {
    rule: APP_APP,
    title: "an app never imports an app",
    cases: [
      [CLI_SRC, "@miragon/pulse-mcp-server-camunda7", [APP_APP, HEADLESS]],
      [EXT_SRC, "@miragon/pulse-mcp-server-camunda7/src/setup", [APP_APP, NOT_HOST]],
      [
        `${CLI}/src/escape-app.ts`,
        "../../mcp-server-camunda7/src/target.ts",
        [APP_APP, HEADLESS, DEEP],
      ],
      // Its own npm name is no way around the rule either: import own modules relatively.
      [`${SERVER}/src/self.ts`, "@miragon/pulse-mcp-server-camunda7", [APP_APP]],
      [`${EXT}/src/self.ts`, "pulse-vscode", [APP_APP]],
      [`${CLI}/src/self.ts`, "@miragon/pulse-cli/commands", [APP_APP, HEADLESS]],
      // The MCP server's composition stays legal.
      [SERVER_SRC, "@miragon/pulse-widget-shell", []],
      [SERVER_SRC, "@miragon/pulse-widget-shell/server", []],
      [SERVER_SRC, "@miragon/pulse-camunda7-connector", []],
      [SERVER_SRC, "@miragon/pulse-analytics-connector", []],
      [SERVER_SRC, "react", []],
      [SERVER_SRC, "zod", []],
      [SERVER_SRC, "mcp-use/server", []],
      [SERVER_SRC, "./lib.ts", []],
    ],
  },
  {
    rule: NO_APP,
    title: "no package imports an app",
    cases: [
      [SHELL_SRC, "@miragon/pulse-mcp-server-camunda7", [CORE, NO_APP]],
      [
        `${SHELL}/src/escape-app.ts`,
        "../../../../apps/mcp-server-camunda7/src/target.ts",
        [CORE, NO_APP, DEEP],
      ],
      [C7_CLIENT_SRC, "@miragon/pulse-mcp-server-camunda7", [CLIENT_LEAF, NO_APP]],
      [C7_CONNECTOR_SRC, "@miragon/pulse-mcp-server-camunda7", [NO_APP]],
      [C7_CONNECTOR_SRC, "@miragon/pulse-cli", [NO_APP, NO_CLI]],
      [C7_CONNECTOR_SRC, "pulse-vscode", [NO_APP, NO_EXT]],
      [C7_DOMAIN_SRC, "@miragon/pulse-mcp-server-camunda7", [DOMAIN_LEAF, NO_APP]],
    ],
  },
  {
    rule: CORE,
    title: "packages/core reaches up into no connector, client, -domain package or app",
    cases: [
      [SHELL_SRC, "@miragon/pulse-camunda7-domain", [CORE]],
      [SHELL_SRC, "@miragon/pulse-camunda7-domain/testing", [CORE]],
      [SHELL_SRC, "@miragon/pulse-camunda7-connector", [CORE]],
      [SHELL_SRC, "@miragon/pulse-analytics-client", [CORE]],
      [SHELL_SRC, "react", []],
      [SHELL_SRC, "zod", []],
      [SHELL_SRC, "mcp-use", []],
      [SHELL_SRC, "@miragon/mcp-toolkit-ui", []],
    ],
  },
  {
    rule: PEERS,
    title: "connectors never import each other, also through their own node_modules",
    cases: [
      [C7_CONNECTOR_SRC, "@miragon/pulse-analytics-connector", [PEERS]],
      [C7_CONNECTOR_SRC, "@miragon/pulse-analytics-connector/widgets", [PEERS]],
      // The old pattern's reach stays: a client folder named like a connector is still caught.
      [
        `${C7_CONNECTOR}/src/escape.ts`,
        "../../camunda7-client/src/x-connector/y.ts",
        [PEERS, DEEP],
      ],
      [C7_CONNECTOR_SRC, "@miragon/pulse-camunda7-client", []],
      [C7_CONNECTOR_SRC, "@miragon/pulse-widget-shell", []],
      [C7_CONNECTOR_SRC, "react", []],
      [C7_CONNECTOR_SRC, "zod", []],
      [C7_CONNECTOR_SRC, "node:fs", []],
    ],
  },
  {
    rule: OWN_CLIENT,
    title: "a connector depends on its own client only",
    cases: [
      [C7_CONNECTOR_SRC, "@miragon/pulse-analytics-client", [OWN_CLIENT]],
      [AN_CONNECTOR_SRC, "@miragon/pulse-camunda7-client/sdk", [OWN_CLIENT]],
      [AN_CONNECTOR_SRC, "@miragon/pulse-analytics-client", []],
    ],
  },
  {
    rule: OWN_DOMAIN,
    title: "a connector depends on its own -domain package only",
    cases: [
      [C7_CONNECTOR_SRC, "@miragon/pulse-analytics-domain", [OWN_DOMAIN]],
      [AN_CONNECTOR_SRC, "@miragon/pulse-camunda7-domain", [OWN_DOMAIN]],
      [AN_CONNECTOR_SRC, "@miragon/pulse-camunda7-domain/testing", [OWN_DOMAIN]],
      [
        `${C7_CONNECTOR}/src/escape-domain.ts`,
        "../../../analytics/analytics-domain/src/target.ts",
        [OWN_DOMAIN, DEEP],
      ],
      [C7_CONNECTOR_SRC, "@miragon/pulse-camunda7-domain", []],
      [C7_CONNECTOR_SRC, "@miragon/pulse-camunda7-domain/testing", []],
      [AN_CONNECTOR_SRC, "@miragon/pulse-analytics-domain", []],
      // The own domain by relative path is only a deep import; a connector folder named
      // `*-domain/` is no domain at all.
      [`${C7_CONNECTOR}/src/escape-own-domain.ts`, "../../camunda7-domain/src/target.ts", [DEEP]],
      [C7_CONNECTOR_SRC, "./order-domain/model.ts", []],
    ],
  },
  {
    rule: CLIENT_LEAF,
    title: "clients are leaves, also for workspace packages in their own node_modules",
    cases: [
      [C7_CLIENT_SRC, "@miragon/pulse-widget-shell", [CLIENT_LEAF]],
      [C7_CLIENT_SRC, "@miragon/pulse-camunda7-domain", [CLIENT_LEAF]],
      [C7_CLIENT_SRC, "@miragon/pulse-analytics-client", [CLIENT_LEAF]],
      [C7_CLIENT_SRC, "@miragon/pulse-camunda7-connector/widgets", [CLIENT_LEAF]],
      [`${C7_CLIENT}/src/escape.ts`, "../../camunda7-domain/src/target.ts", [CLIENT_LEAF, DEEP]],
      [C7_CLIENT_SRC, "zod", []],
      [C7_CLIENT_SRC, "./lib.ts", []],
    ],
  },
  {
    rule: DOMAIN_LEAF,
    title: "a -domain package imports no workspace package, no zod and nothing of the MCP/UI stack",
    cases: [
      ...[
        "@miragon/pulse-widget-shell",
        "@miragon/pulse-widget-shell/server",
        "@miragon/pulse-camunda7-client",
        "@miragon/pulse-camunda7-client/sdk",
        "@miragon/pulse-camunda7-client/routes",
        "@miragon/pulse-camunda7-connector",
        "@miragon/pulse-analytics-domain",
        "zod",
        "react",
        "lucide-react",
        "@tanstack/react-query",
        "mcp-use",
        "@modelcontextprotocol/sdk",
        "@miragon/mcp-toolkit-core",
        "hono",
        "postgres",
        "prom-client",
        "@hey-api/client-fetch",
        "vscode",
        "commander",
      ].map((spec) => [C7_DOMAIN_SRC, spec, [DOMAIN_LEAF]]),
      // A type-only import counts too (tsPreCompilationDeps): no `import type` from the SDK.
      [`${C7_DOMAIN}/src/client-type.ts`, "@miragon/pulse-camunda7-client", [DOMAIN_LEAF], "type"],
      [`${C7_DOMAIN}/src/escape.ts`, "../../camunda7-client/src/target.ts", [DOMAIN_LEAF, DEEP]],
      // Its tests are leaves too: a test imports no zod either.
      [`${C7_DOMAIN}/src/index.test.ts`, "zod", [DOMAIN_LEAF]],
      [C7_DOMAIN_SRC, "./model.ts", []],
      [C7_DOMAIN_SRC, "reactive", []],
      [`${C7_DOMAIN}/src/index.test.ts`, "vitest", []],
    ],
  },
  {
    rule: DOMAIN_PURE,
    title: "a -domain package imports no Node built-in outside its tests",
    cases: [
      [`${C7_DOMAIN}/src/node-fs.ts`, "node:fs", [DOMAIN_PURE]],
      [`${C7_DOMAIN}/src/fs.ts`, "fs", [DOMAIN_PURE]],
      [`${C7_DOMAIN}/src/crypto.ts`, "node:crypto", [DOMAIN_PURE]],
      [`${C7_DOMAIN}/src/stream-type.ts`, "node:stream", [DOMAIN_PURE], "type"],
      [`${C7_DOMAIN}/src/os-dynamic.ts`, "node:os", [DOMAIN_PURE], "dynamic"],
      [`${AN_DOMAIN}/src/index.ts`, "node:path", [DOMAIN_PURE]],
      // Only *.test.ts(x) and *.test-support.ts(x) are tests.
      [`${C7_DOMAIN}/src/latest.ts`, "node:path", [DOMAIN_PURE]],
      [`${C7_DOMAIN}/src/test.ts`, "node:path", [DOMAIN_PURE]],
      [`${C7_DOMAIN}/src/index.test.ts`, "node:fs", []],
      [`${C7_DOMAIN}/src/engine.test-support.ts`, "node:crypto", []],
      [`${C7_DOMAIN}/src/view.test.tsx`, "node:path", []],
    ],
  },
  {
    rule: DEEP,
    title: "no relative escape into a sibling package",
    cases: [
      [
        `${C7_DOMAIN}/src/escape-shell.ts`,
        "../../../../core/widget-shell/src/target.ts",
        [DOMAIN_LEAF, DEEP],
      ],
      [
        `${SERVER}/src/escape-package.ts`,
        "../../../packages/core/widget-shell/src/target.ts",
        [DEEP],
      ],
    ],
  },
  {
    rule: CIRCULAR,
    title: "no runtime import cycle; type-only cycles are tolerated",
    cases: [
      [`${SERVER}/src/cycle-a.ts`, "./cycle-b.ts", [CIRCULAR]],
      [`${SERVER}/src/cycle-b.ts`, "./cycle-a.ts", [CIRCULAR]],
      [`${SERVER}/src/type-cycle-a.ts`, "./type-cycle-b.ts", [], "type"],
      [`${SERVER}/src/type-cycle-b.ts`, "./type-cycle-a.ts", [], "type"],
    ],
  },
]

/** Every app the real repo has: {dir, name} from apps/<dir>/package.json. */
function realApps() {
  const appsDir = path.join(repoRoot, "apps")
  return fs
    .readdirSync(appsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => fs.existsSync(path.join(appsDir, entry.name, "package.json")))
    .map((entry) => ({
      dir: entry.name,
      name: JSON.parse(fs.readFileSync(path.join(appsDir, entry.name, "package.json"), "utf8"))
        .name,
    }))
}

// The sync suite: each REAL app name, imported by a package and by another fixture app, in
// the declared shape (where the fixture has a package by that name) and as a bare subpath.
const APPS = realApps()
const SYNC_CASES = APPS.filter(({ name }) => name).flatMap(({ dir, name }) => {
  const otherApp = [SERVER, EXT, CLI].find((app) => app !== `apps/${dir}`)
  return [name, `${name}/sync-probe`].flatMap((spec) => [
    { from: `${C7_CONNECTOR}/src/sync-${dir}.ts`, spec, rule: NO_APP, app: name },
    { from: `${otherApp}/src/sync-${dir}.ts`, spec, rule: APP_APP, app: name },
  ])
})

/** The path arguments of the pinned `pnpm lint:architecture` command. */
function lintArchitecturePaths() {
  const rootPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"))
  const words = rootPackage.scripts["lint:architecture"].trim().split(/\s+/)
  const configAt = words.indexOf("--config")
  assert.equal(words[0], "depcruise", "lint:architecture no longer runs depcruise")
  assert.equal(
    words[configAt + 1],
    ".dependency-cruiser.cjs",
    "lint:architecture no longer reads .dependency-cruiser.cjs; point this self-test at its config",
  )
  return words.slice(1, configAt)
}

/**
 * Expands the command's `*` segments against the fixture. dependency-cruiser's own glob walk
 * follows symlinks, and the fixture links every package into every other one (cycles), so
 * the cruise gets the matching directories, which it walks without entering node_modules.
 */
function expandPaths(root, patterns) {
  return patterns.flatMap((pattern) => {
    const segments = pattern.split("/")
    for (const segment of segments) {
      assert.ok(segment === "*" || !/[*?[\]{}!]/.test(segment), `unsupported glob ${pattern}`)
    }
    const matches = segments.reduce(
      (bases, segment) =>
        bases.flatMap((base) => {
          if (segment !== "*")
            return fs.existsSync(path.join(root, base, segment)) ? [path.join(base, segment)] : []
          return fs
            .readdirSync(path.join(root, base), { withFileTypes: true })
            .filter((entry) => entry.isDirectory() && entry.name !== "node_modules")
            .map((entry) => path.join(base, entry.name))
        }),
      [""],
    )
    assert.ok(matches.length > 0, `${pattern} matches nothing in the fixture`)
    return matches
  })
}

const statement = (spec, form, index) => {
  if (form === "type") return `import type * as Probe${index} from "${spec}"`
  if (form === "dynamic") return `void import("${spec}")`
  return `import "${spec}"`
}

function buildFixture(root) {
  const write = (rel, text) => {
    const file = path.join(root, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, text)
  }
  const names = Object.values(WORKSPACE).map((extras) => extras.name)
  for (const [dir, extras] of Object.entries(WORKSPACE)) {
    const dependencies = Object.fromEntries(
      [...names, ...THIRD_PARTY].filter((n) => n !== extras.name).map((n) => [n, "*"]),
    )
    write(`${dir}/package.json`, JSON.stringify({ ...extras, main: "src/index.ts", dependencies }))
    // pnpm's shape of a declared workspace dependency: a relative directory symlink.
    for (const [otherDir, other] of Object.entries(WORKSPACE)) {
      if (otherDir === dir) continue
      const link = path.join(root, dir, "node_modules", other.name)
      fs.mkdirSync(path.dirname(link), { recursive: true })
      fs.symlinkSync(path.relative(path.dirname(link), path.join(root, otherDir)), link, "dir")
    }
    for (const name of THIRD_PARTY) {
      write(`${dir}/node_modules/${name}/package.json`, JSON.stringify({ name, main: "index.js" }))
      write(`${dir}/node_modules/${name}/index.js`, "module.exports = {}\n")
    }
  }

  // One import per (importer, module): depcruise merges two imports of one module into one
  // edge, so a second case on the same pair (another form, `fs` next to `node:fs`) would
  // assert nothing of its own. Give it its own importer file instead.
  const probes = new Map()
  const planted = new Set()
  const plant = (from, spec, form) => {
    const key = `${from} -> ${spec.replace(/^node:/, "")}`
    assert.ok(!planted.has(key), `duplicate case ${key}: plant it in a file of its own`)
    planted.add(key)
    const lines = probes.get(from) ?? []
    probes.set(from, [...lines, statement(spec, form, lines.length)])
  }
  for (const { cases } of SUITES) for (const [from, spec, , form] of cases) plant(from, spec, form)
  for (const { from, spec } of SYNC_CASES) plant(from, spec)
  plant(`${CLI}/src/catalog.ts`, "./generated/commands.json")
  plant(C7_CLIENT_SRC, "./generated/sdk.gen.ts")
  plant(C7_CONNECTOR_SRC, "./generated/catalog.ts")

  for (const leaf of LEAVES) {
    assert.ok(!probes.has(leaf), `${leaf} is a leaf target and must not import anything`)
    write(leaf, "export {}\n")
  }
  for (const leaf of JSON_LEAVES) write(leaf, "{}\n")
  for (const [from, lines] of probes) write(from, `${lines.join("\n")}\nexport {}\n`)
  for (const dir of Object.keys(WORKSPACE)) {
    if (!fs.existsSync(path.join(root, dir, "src/index.ts")))
      write(`${dir}/src/index.ts`, "export {}\n")
  }
}

let root
let output
/** `${source} -> ${module as written}` => { rules, resolved } */
let edges

before(async () => {
  // realpath: on macOS os.tmpdir() sits behind the /var -> /private/var symlink.
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "depcruise-gates-")))
  buildFixture(root)
  const options = await extractDepcruiseOptions(CONFIG)
  options.baseDir = root
  options.tsConfig = { fileName: path.join(repoRoot, options.tsConfig.fileName) }
  const result = await cruise(
    expandPaths(root, lintArchitecturePaths()),
    options,
    {},
    {
      tsConfig: extractTSConfig(options.tsConfig.fileName),
    },
  )
  output = result.output
  edges = new Map(
    output.modules.flatMap((module) =>
      module.dependencies.map((dependency) => [
        `${module.source} -> ${dependency.module}`,
        {
          rules: (dependency.rules ?? []).map((rule) => rule.name).sort(),
          resolved: dependency.resolved,
        },
      ]),
    ),
  )
})

after(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true })
})

/** The cruised edge of one planted import (depcruise records `node:fs` as `fs`). */
function edgeOf(from, spec) {
  const edge =
    edges.get(`${from} -> ${spec}`) ?? edges.get(`${from} -> ${spec.replace(/^node:/, "")}`)
  assert.ok(edge, `no edge ${from} -> ${spec} in the cruise result`)
  return edge
}

for (const { rule, title, cases } of SUITES) {
  describe(`${rule}: ${title}`, () => {
    for (const [from, spec, expected, form] of cases) {
      const label = `${from} -> ${spec}${form ? ` (${form})` : ""}`
      it(`${label} trips [${expected.join(", ")}]`, () => {
        const edge = edgeOf(from, spec)
        assert.deepEqual(edge.rules, [...expected].sort(), `${label} (resolved: ${edge.resolved})`)
      })
    }
  })
}

describe("options.exclude keeps only the hey-api SDK out of the graph", () => {
  it("cruises a generated tree anywhere else (a CLI command catalog, a connector catalog)", () => {
    const sources = new Set(output.modules.map((module) => module.source))
    assert.ok(sources.has(`${CLI}/src/generated/commands.json`), "apps/cli/src/generated dropped")
    assert.ok(
      sources.has(`${C7_CONNECTOR}/src/generated/catalog.ts`),
      "connector generated dropped",
    )
    assert.deepEqual(edgeOf(`${CLI}/src/catalog.ts`, "./generated/commands.json").rules, [])
  })

  it("excludes camunda7-client/src/generated", () => {
    const generated = `${C7_CLIENT}/src/generated/`
    const hits = output.modules.flatMap((module) => [
      ...(module.source.startsWith(generated) ? [module.source] : []),
      ...module.dependencies
        .filter((dependency) => dependency.resolved.startsWith(generated))
        .map((dependency) => `${module.source} -> ${dependency.resolved}`),
    ])
    assert.deepEqual(hits, [])
  })
})

describe("APP_PACKAGES names every real app of the repo", () => {
  it("finds the apps", () => {
    assert.ok(APPS.length > 0, "no apps/*/package.json found")
    for (const { dir, name } of APPS) assert.ok(name, `apps/${dir}/package.json has no name`)
  })

  for (const { from, spec, rule, app } of SYNC_CASES) {
    it(`${from} -> ${spec} trips ${rule}`, () => {
      assert.ok(
        edgeOf(from, spec).rules.includes(rule),
        `${from} -> ${spec} is not caught by ${rule}: add "${app}" to APP_PACKAGES in .dependency-cruiser.cjs`,
      )
    })
  }
})

describe("the self-test covers the whole config", () => {
  const config = createRequire(import.meta.url)(CONFIG)
  const configured = config.forbidden.map((rule) => rule.name)
  const expected = new Set(SUITES.flatMap(({ cases }) => cases.flatMap(([, , rules]) => rules)))

  it("every configured rule has a case that expects it", () => {
    const uncovered = configured.filter((name) => !expected.has(name))
    assert.deepEqual(uncovered, [], "add planted violations for these rules to SUITES")
  })

  it("every rule a case expects is configured (a renamed rule renames its cases)", () => {
    assert.deepEqual(
      [...expected].filter((name) => !configured.includes(name)),
      [],
    )
  })

  it("every rule is an error", () => {
    const soft = config.forbidden.filter((rule) => rule.severity !== "error").map((r) => r.name)
    assert.deepEqual(soft, [], "a rule below severity error never fails pnpm lint:architecture")
  })

  it("the connector-family roles the rules key on are connector, client and domain", () => {
    const roles = new Set(
      config.forbidden
        .flatMap((rule) => [rule.from.path ?? []].flat())
        .map((pattern) => /^\^packages\/connectors\/.*-([a-z]+)\/$/.exec(pattern)?.[1])
        .filter(Boolean),
    )
    assert.deepEqual([...roles].sort(), ["client", "connector", "domain"])
  })

  it("every real connector-family package carries one of those roles", () => {
    const familiesDir = path.join(repoRoot, "packages/connectors")
    const offenders = fs
      .readdirSync(familiesDir, { withFileTypes: true })
      .filter((family) => family.isDirectory())
      .flatMap((family) =>
        fs
          .readdirSync(path.join(familiesDir, family.name), { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .filter((entry) =>
            fs.existsSync(path.join(familiesDir, family.name, entry.name, "package.json")),
          )
          .map((entry) => `packages/connectors/${family.name}/${entry.name}`),
      )
      .filter((dir) => !/-(?:connector|client|domain)$/.test(dir))
    assert.deepEqual(offenders, [], "a package without a role suffix falls out of every rule")
  })
})
