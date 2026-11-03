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
import { CONNECTOR_ROLES } from "./check-package-naming.mjs"

/**
 * Self-test of the dependency rules in .dependency-cruiser.cjs (a gate that has never been
 * red is decoration). It builds a pnpm-shaped fixture workspace under os.tmpdir() that holds
 * the apps and packages the rules are about, cruises it ONCE with the REAL
 * config over the paths of the pinned `pnpm lint:architecture` and `pnpm lint:architecture:cli`
 * commands, and asserts the EXACT set of rules each planted import trips. Exact, so an edge that only
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
const SERVER = "apps/mcp-server"
const CLI = "apps/cli"
const EXT = "apps/vscode"
const SHELL = "packages/core/widget-shell"
const UI = "packages/core/ui"
const ENGINE = "packages/connectors/engine/engine-core"
const ENGINE_CLIENT = "packages/connectors/engine/engine-client"
const ENGINE_CONNECTOR = "packages/connectors/engine/engine-connector"
const AN_CLIENT = "packages/connectors/analytics/analytics-client"
const AN_CONNECTOR = "packages/connectors/analytics/analytics-connector"
// No such package exists: a second family's core proves the core rules key on the role.
const AN_CORE = "packages/connectors/analytics/analytics-core"

const WORKSPACE = {
  [SERVER]: { name: "@miragon/pulse-mcp-server", private: true },
  [CLI]: { name: "@miragon/pulse-cli" },
  [EXT]: { name: "pulse-cockpit", engines: { vscode: "^1.101.0" } },
  [SHELL]: { name: "@miragon/pulse-widget-shell" },
  [UI]: { name: "@miragon/pulse-ui" },
  [ENGINE]: { name: "@miragon/pulse-engine-core" },
  [ENGINE_CLIENT]: { name: "@miragon/pulse-engine-client" },
  [ENGINE_CONNECTOR]: { name: "@miragon/pulse-engine-connector" },
  [AN_CLIENT]: { name: "@miragon/pulse-analytics-client" },
  [AN_CONNECTOR]: { name: "@miragon/pulse-analytics-connector" },
  [AN_CORE]: { name: "@miragon/pulse-analytics-core" },
}

// Third-party stubs installed into every importer's own node_modules. `vscode` is left out
// on purpose: the extension host provides it at runtime, so it stays a bare specifier.
// `reactive`, `pulse-tools` and `@miragon/pulse-mcp-server-kit` prove the name patterns are
// anchored (the last is no app, only a package whose name starts like the server's).
const THIRD_PARTY = [
  "react",
  "react-dom",
  "lucide-react",
  "@tanstack/react-query",
  "mcp-use",
  "@modelcontextprotocol/sdk",
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
  "pulse-tools",
  "@miragon/pulse-mcp-server-kit",
]

const PEERS = "connectors-are-peers"
const OWN_FAMILY = "connectors-own-their-family"
const CLIENT_LEAF = "clients-are-leaves"
const CORE = "core-is-foundation"
const UI_LEAF = "ui-is-a-leaf"
const NO_APP = "packages-never-import-the-app"
const APP_APP = "apps-never-import-apps"
const HEADLESS = "cli-is-headless"
const CORE_LEAF = "family-core-is-a-leaf"
const CORE_USERS = "family-core-consumers"
const CLI_CORE_LAYERS = "cli-family-core-only-in-workflow"
const NO_TESTING = "shipped-code-not-to-testing"
const DEEP = "no-cross-package-deep-imports"
const CIRCULAR = "no-circular"
const CLI_CYCLE = "cli-no-circular"
const CLI_DEPRECATED = "cli-no-deprecated-core"
const CLI_NOT_TEST = "cli-not-to-test"
const CLI_SRC_SCRIPTS = "cli-src-not-to-scripts-or-test"
const CLI_SUPPORT = "cli-test-support-only-from-tests"
const CLI_LAYER_BIN = "cli-command-layer-only-from-bin"
const CLI_COMMANDER = "cli-commander-only-in-command-layer"
const CLI_PURE = "cli-pure-layers-no-builtins"
const CLI_OPERATION_PATH = "cli-operation-only-path-builtin"
const CLI_DOCS = "cli-docs-only-catalog-errors-util"
const CLI_AUTH = "cli-auth-allowed-imports"
const CLI_CONFIG_AUTH = "cli-config-not-to-auth"
const CLI_LOGIN = "cli-interactive-login-only-from-auth-command"
const CLI_WORKFLOW_DEPS = "cli-workflow-not-to-cli-config-auth-bin"
const CLI_WORKFLOW_USERS = "cli-workflow-only-from-command-layer"
const CLI_API_ENGINE = "cli-api-only-workflow-engine"
const CLI_WORKFLOW_PORT = "cli-workflow-only-engine-port"
const CLI_PORT_TYPES = "cli-engine-port-types-only"
const CLI_API_ADAPTERS = "cli-api-only-from-adapters"
const CLI_API_API = "cli-api-not-to-other-api"
const CLI_ENGINES = "cli-engines-not-to-each-other"
const CLI_HTTP = "cli-http-not-to-config-cli-operation"
const CLI_GENERATED = "cli-generated-catalog-only-via-catalog-ts-or-adapters"
const CLI_OUTPUT = "cli-output-only-operation-result"
const CLI_OUTPUT_TYPES = "cli-output-operation-result-type-only"
const CLI_SCRIPTS = "cli-scripts-only-catalog-types-and-schema"

const CLI_SRC = `${CLI}/src/index.ts`
const SERVER_SRC = `${SERVER}/src/index.ts`
const EXT_SRC = `${EXT}/src/extension.ts`
const SHELL_SRC = `${SHELL}/src/index.ts`
const UI_SRC = `${UI}/src/index.ts`
const ENGINE_SRC = `${ENGINE}/src/index.ts`
const ENGINE_CORE = "@miragon/pulse-engine-core"
const AN_CORE_NAME = "@miragon/pulse-analytics-core"
const AN_CORE_SRC = `${AN_CORE}/src/index.ts`
const ENGINE_CLIENT_SRC = `${ENGINE_CLIENT}/src/index.ts`
const ENGINE_CONNECTOR_SRC = `${ENGINE_CONNECTOR}/src/index.ts`
const AN_CONNECTOR_SRC = `${AN_CONNECTOR}/src/index.ts`

// Leaf modules the relative escapes point at. They import nothing, so no probe forms a cycle
// unless a case plants one on purpose.
const LEAVES = [
  `${SERVER}/src/target.ts`,
  `${SERVER}/src/lib.ts`,
  `${CLI}/src/target.ts`,
  `${CLI}/src/lib.ts`,
  `${CLI}/src/cli/target.ts`,
  `${CLI}/src/workflow/target.ts`,
  `${CLI}/src/workflow/engine.ts`,
  `${CLI}/src/api/rest/target.ts`,
  `${CLI}/src/api/other/target.ts`,
  `${CLI}/src/engines/b/target.ts`,
  `${CLI}/src/auth/target.ts`,
  `${CLI}/src/auth/oauth/login.ts`,
  `${CLI}/src/config/target.ts`,
  `${CLI}/src/catalog/target.ts`,
  `${CLI}/src/catalog/types.ts`,
  `${CLI}/src/operation/target.ts`,
  `${CLI}/src/operation/result.ts`,
  `${CLI}/src/output/target.ts`,
  `${CLI}/src/http/client.ts`,
  `${CLI}/src/http/target.ts`,
  `${CLI}/src/engine-port/target.ts`,
  `${CLI}/src/errors.ts`,
  `${CLI}/src/runtime.ts`,
  `${CLI}/src/a.test.ts`,
  `${CLI}/scripts/target.ts`,
  `${CLI}/test/support/fake.ts`,
  `${SHELL}/src/target.ts`,
  `${UI}/src/target.ts`,
  `${UI}/src/lib.ts`,
  `${UI}/src/testing/glyphs.ts`,
  `${ENGINE}/src/target.ts`,
  `${ENGINE}/src/lib.ts`,
  `${ENGINE}/src/testing/fixture.ts`,
  `${AN_CORE}/src/lib.ts`,
  `${AN_CORE}/src/a.test.ts`,
  `${ENGINE_CLIENT}/src/target.ts`,
  `${ENGINE_CLIENT}/src/lib.ts`,
  `${ENGINE_CLIENT}/src/x-connector/y.ts`,
  `${ENGINE_CLIENT}/src/generated/sdk.gen.ts`,
  `${ENGINE_CONNECTOR}/src/generated/catalog.ts`,
]
const JSON_LEAVES = [`${CLI}/src/generated/commands.json`, `${CLI}/src/generated/catalog.a.json`]

/**
 * One suite per rule: [importer, specifier, exact rules, form?]. `form` "type" plants an
 * `import type`, "dynamic" an `import()`, the default a side-effect `import`.
 */
const SUITES = [
  {
    rule: HEADLESS,
    title: "the CLI imports no workspace package but the core it bundles, nor the MCP/UI stack",
    cases: [
      ...[
        "@miragon/pulse-widget-shell",
        "@miragon/pulse-widget-shell/server",
        "@miragon/pulse-engine-connector",
        "@miragon/pulse-engine-client",
        "@miragon/pulse-engine-client/sdk",
        "@miragon/pulse-engine-client/routes",
        "react",
        "react-dom/client",
        "lucide-react",
        "@tanstack/react-query",
        "mcp-use/react",
        "@modelcontextprotocol/sdk/server",
        "prom-client",
        "zod",
        "@hey-api/client-fetch",
        "preact",
        "bpmn-js",
        "diagram-js",
        "@miragon/modeler-shell",
        "vscode",
      ].map((spec) => [CLI_SRC, spec, [HEADLESS]]),
      // An app is the app rule's (apps-never-import-apps), not this one's.
      [CLI_SRC, "pulse-cockpit", [APP_APP]],
      [CLI_SRC, "@miragon/pulse-ui", [HEADLESS]],
      [
        `${CLI}/src/escape-package.ts`,
        "../../../packages/core/widget-shell/src/target.ts",
        [HEADLESS, DEEP],
      ],
      // Allowed: the CLI's own libraries and Node built-ins.
      [CLI_SRC, "commander", [CLI_COMMANDER]],
      [`${CLI}/src/cli/program.ts`, "commander", []],
      [CLI_SRC, "node:fs", []],
      [CLI_SRC, "./lib.ts", []],
      [CLI_SRC, "reactive", []],
      [CLI_SRC, "pulse-tools", []],
      // The exemption is anchored: a look-alike name and a relative escape stay violations.
      [`${CLI}/src/workflow/x.ts`, "@miragon/pulse-engine-corex", [HEADLESS]],
      [
        `${CLI}/src/workflow/escape-core.ts`,
        "../../../../packages/connectors/engine/engine-core/src/target.ts",
        [HEADLESS, DEEP],
      ],
      // It names the one core the CLI bundles: another family's core stays a violation.
      [`${CLI}/src/workflow/other-core.ts`, AN_CORE_NAME, [HEADLESS]],
    ],
  },
  {
    rule: CORE_LEAF,
    title: "a family core imports only its own modules: no package, no npm module, no built-in",
    cases: [
      [ENGINE_SRC, "@miragon/pulse-engine-client", [CORE_LEAF]],
      // engine-core and the engine family share the stem: the family stays out of the leaf.
      [ENGINE_SRC, "@miragon/pulse-engine-connector", [CORE_LEAF]],
      [ENGINE_SRC, AN_CORE_NAME, [CORE_LEAF]],
      [ENGINE_SRC, "@miragon/pulse-ui", [CORE_LEAF]],
      [ENGINE_SRC, "@miragon/pulse-widget-shell/server", [CORE_LEAF]],
      [ENGINE_SRC, "@miragon/pulse-cli", [NO_APP, CORE_LEAF]],
      ...["zod", "mcp-use", "react", "commander", "reactive", "node:fs", "path"].map((spec) => [
        ENGINE_SRC,
        spec,
        [CORE_LEAF],
      ]),
      [`${ENGINE}/src/escape.ts`, "../../../../core/ui/src/target.ts", [CORE_LEAF, DEEP]],
      [`${ENGINE}/src/escape-client.ts`, "../../engine-client/src/target.ts", [CORE_LEAF, DEEP]],
      // The shipped ./testing export is no test file: only *.test.ts may import vitest.
      [`${ENGINE}/src/testing/index.ts`, "vitest", [CORE_LEAF]],
      [ENGINE_SRC, "./lib.ts", []],
      [`${ENGINE}/src/a.test.ts`, "vitest", []],
      // Keyed on the role: any family's core is a leaf, by the layout alone.
      [AN_CORE_SRC, "@miragon/pulse-analytics-client", [CORE_LEAF]],
      [AN_CORE_SRC, "zod", [CORE_LEAF]],
      [AN_CORE_SRC, "./lib.ts", []],
    ],
  },
  {
    rule: CORE_USERS,
    title: "a family core is imported by its family's connector and the apps that bundle it",
    cases: [
      [SERVER_SRC, ENGINE_CORE, [CORE_USERS]],
      [SERVER_SRC, AN_CORE_NAME, [CORE_USERS]],
      [EXT_SRC, ENGINE_CORE, [CORE_USERS]],
      [
        `${SERVER}/src/escape-core.ts`,
        "../../../packages/connectors/engine/engine-core/src/target.ts",
        [CORE_USERS, DEEP],
      ],
      // The other packages answer to their own rule, each edge to exactly one.
      [AN_CONNECTOR_SRC, ENGINE_CORE, [OWN_FAMILY]],
      [ENGINE_CONNECTOR_SRC, AN_CORE_NAME, [OWN_FAMILY]],
      [SHELL_SRC, ENGINE_CORE, [CORE]],
      [SHELL_SRC, AN_CORE_NAME, [CORE]],
      [UI_SRC, ENGINE_CORE, [CORE, UI_LEAF]],
      [ENGINE_CLIENT_SRC, ENGINE_CORE, [CLIENT_LEAF]],
      [ENGINE_CLIENT_SRC, `${ENGINE_CORE}/testing`, [CLIENT_LEAF, NO_TESTING]],
      // Allowed: the family's own connector and the CLI, which bundles engine-core.
      [ENGINE_CONNECTOR_SRC, ENGINE_CORE, []],
      [AN_CONNECTOR_SRC, AN_CORE_NAME, []],
      [`${CLI}/src/workflow/inspect.ts`, ENGINE_CORE, []],
      [`${CLI}/src/engine-port/port.ts`, ENGINE_CORE, [], "type"],
      // The types-only rule of the engine port still bites on the new package.
      [`${CLI}/src/engine-port/value.ts`, ENGINE_CORE, [CLI_PORT_TYPES]],
    ],
  },
  {
    rule: CLI_CORE_LAYERS,
    title: "in the CLI only the workflow and engine-port layers (and tests) import the core",
    cases: [
      [CLI_SRC, ENGINE_CORE, [CLI_CORE_LAYERS]],
      [`${CLI}/src/cli/target-core.ts`, ENGINE_CORE, [CLI_CORE_LAYERS]],
      [`${CLI}/scripts/core.ts`, ENGINE_CORE, [CLI_CORE_LAYERS]],
      [CLI_SRC, `${ENGINE_CORE}/testing`, [CLI_CORE_LAYERS, NO_TESTING]],
      // Another family's core is cli-is-headless's alone.
      [`${CLI}/src/cli/other-core.ts`, AN_CORE_NAME, [HEADLESS]],
      [`${CLI}/src/f.test.ts`, ENGINE_CORE, []],
    ],
  },
  {
    rule: NO_TESTING,
    title: "shipped code imports no ./testing entry, a package's own src/testing included",
    cases: [
      [`${CLI}/src/workflow/fixture.ts`, `${ENGINE_CORE}/testing`, [NO_TESTING]],
      [`${ENGINE_CONNECTOR}/src/lib/composites.ts`, `${ENGINE_CORE}/testing`, [NO_TESTING]],
      [ENGINE_CONNECTOR_SRC, `${ENGINE_CORE}/testing`, [NO_TESTING]],
      // pulse-ui/testing reads files and parses TypeScript: no shipped module imports it.
      [`${SHELL}/src/ui/brand.ts`, "@miragon/pulse-ui/testing", [NO_TESTING]],
      [`${SERVER}/src/ui/brand.ts`, "@miragon/pulse-ui/testing", [NO_TESTING]],
      [`${AN_CONNECTOR}/src/widgets/brand.ts`, "@miragon/pulse-ui/testing", [NO_TESTING]],
      [`${EXT}/src/brand.ts`, "@miragon/pulse-ui/testing", [NO_TESTING]],
      // A package's own testing tree, by relative path.
      [ENGINE_SRC, "./testing/fixture.ts", [NO_TESTING]],
      [`${ENGINE}/src/inspect.ts`, "./testing/fixture.ts", [NO_TESTING], "type"],
      [`${UI}/src/kit/scan.ts`, "../testing/glyphs.ts", [NO_TESTING]],
      // test-support may import ./testing, so shipped code may not import test-support.
      [`${CLI}/src/workflow/support.ts`, "./test-support/fixture.ts", [NO_TESTING]],
      [`${ENGINE_CONNECTOR}/src/lib/x.ts`, "../tools/test-support/fake-engine.ts", [NO_TESTING]],
      [`${SHELL}/src/boot.ts`, "./composition.test-support.ts", [NO_TESTING]],
      [`${CLI}/src/workflow/test-support/fixture.ts`, `${ENGINE_CORE}/testing`, []],
      // A test file of its own tree is cli-not-to-test's.
      [`${ENGINE}/src/to-test.ts`, "./a.test.ts", [CLI_NOT_TEST]],
      // Anchored: a look-alike subpath is no ./testing entry.
      [`${SHELL}/src/ui/kit.ts`, "@miragon/pulse-ui/testing-kit", []],
      // Allowed: tests, their test-support, test/ trees and a ./testing entry itself.
      [`${CLI}/test/support/fixture.ts`, `${ENGINE_CORE}/testing`, []],
      [`${ENGINE_CONNECTOR}/src/lib/composites.wire.test.ts`, `${ENGINE_CORE}/testing`, []],
      [`${ENGINE_CONNECTOR}/src/tools/test-support/fake-engine.ts`, `${ENGINE_CORE}/testing`, []],
      [`${SHELL}/src/testing/glossary.ts`, "@miragon/pulse-ui/testing", []],
      [`${SHELL}/src/composition.test-support.ts`, "@miragon/pulse-ui/testing", []],
      [`${SERVER}/src/brand.test.ts`, "@miragon/pulse-ui/testing", []],
      [`${UI}/src/testing/index.ts`, "./glyphs.ts", []],
      [`${ENGINE}/src/testing/routes.ts`, "./fixture.ts", []],
      [`${ENGINE}/src/testing/port.ts`, "../lib.ts", []],
      [`${ENGINE}/src/b.test.ts`, "./testing/fixture.ts", []],
    ],
  },
  {
    rule: APP_APP,
    title: "an app never imports an app",
    cases: [
      [CLI_SRC, "@miragon/pulse-mcp-server", [APP_APP, HEADLESS]],
      [EXT_SRC, "@miragon/pulse-mcp-server/src/setup", [APP_APP]],
      [`${CLI}/src/escape-app.ts`, "../../mcp-server/src/target.ts", [APP_APP, DEEP]],
      // Its own npm name is no way around the rule either: import own modules relatively.
      [`${SERVER}/src/self.ts`, "@miragon/pulse-mcp-server", [APP_APP]],
      [`${EXT}/src/self.ts`, "pulse-cockpit", [APP_APP]],
      [`${CLI}/src/self.ts`, "@miragon/pulse-cli/commands", [APP_APP, HEADLESS]],
      // The MCP server's composition stays legal.
      [SERVER_SRC, "@miragon/pulse-widget-shell", []],
      [SERVER_SRC, "@miragon/pulse-widget-shell/server", []],
      [SERVER_SRC, "@miragon/pulse-engine-connector", []],
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
      // The app rules own every edge into an app: core, pulse-ui and the clients name none.
      [SHELL_SRC, "@miragon/pulse-mcp-server", [NO_APP]],
      [`${SHELL}/src/escape-app.ts`, "../../../../apps/mcp-server/src/target.ts", [NO_APP, DEEP]],
      [`${UI}/src/escape-app.ts`, "../../../../apps/mcp-server/src/target.ts", [NO_APP, DEEP]],
      [
        `${ENGINE_CLIENT}/src/escape-app.ts`,
        "../../../../../apps/mcp-server/src/target.ts",
        [NO_APP, DEEP],
      ],
      [SHELL_SRC, "pulse-cockpit", [NO_APP]],
      [UI_SRC, "pulse-cockpit", [NO_APP]],
      [ENGINE_CLIENT_SRC, "pulse-cockpit", [NO_APP]],
      [ENGINE_CLIENT_SRC, "@miragon/pulse-mcp-server", [CLIENT_LEAF, NO_APP]],
      [ENGINE_CONNECTOR_SRC, "@miragon/pulse-mcp-server", [NO_APP]],
      [ENGINE_CONNECTOR_SRC, "@miragon/pulse-cli", [NO_APP]],
      [ENGINE_CONNECTOR_SRC, "pulse-cockpit", [NO_APP]],
      // A package named like the server is no app.
      [ENGINE_CONNECTOR_SRC, "@miragon/pulse-mcp-server-kit", []],
    ],
  },
  {
    rule: CORE,
    title: "packages/core reaches up into no connector, client or app",
    cases: [
      [SHELL_SRC, "@miragon/pulse-engine-connector", [CORE]],
      [SHELL_SRC, "@miragon/pulse-analytics-client", [CORE]],
      [SHELL_SRC, "react", []],
      [SHELL_SRC, "zod", []],
      [SHELL_SRC, "mcp-use", []],
      [SHELL_SRC, "@miragon/pulse-ui", []],
      [SHELL_SRC, "@miragon/pulse-mcp-server-kit", []],
    ],
  },
  {
    rule: UI_LEAF,
    title: "pulse-ui imports no workspace package and nothing of the MCP stack",
    cases: [
      [UI_SRC, "@miragon/pulse-widget-shell", [UI_LEAF]],
      [UI_SRC, "@miragon/pulse-widget-shell/widgets", [UI_LEAF]],
      [UI_SRC, "@miragon/pulse-engine-connector", [CORE, UI_LEAF]],
      [UI_SRC, "@miragon/pulse-analytics-client", [CORE, UI_LEAF]],
      // A scoped app name is a workspace package name as well: the leaf rule bites with the app rule.
      [UI_SRC, "@miragon/pulse-mcp-server", [NO_APP, UI_LEAF]],
      ...[
        "mcp-use",
        "mcp-use/react",
        "@tanstack/react-query",
        "zod",
        "@modelcontextprotocol/sdk/server",
        "prom-client",
        "bpmn-js",
      ].map((spec) => [UI_SRC, spec, [UI_LEAF]]),
      [`${UI}/src/escape.ts`, "../../widget-shell/src/target.ts", [UI_LEAF, DEEP]],
      // Allowed: React, Lucide, its own modules; every Pulse package may import it.
      [UI_SRC, "react", []],
      [UI_SRC, "react-dom/client", []],
      [UI_SRC, "lucide-react", []],
      [UI_SRC, "./lib.ts", []],
      [ENGINE_CONNECTOR_SRC, "@miragon/pulse-ui", []],
      [SERVER_SRC, "@miragon/pulse-ui", []],
    ],
  },
  {
    rule: PEERS,
    title: "connectors never import each other, also through their own node_modules",
    cases: [
      [ENGINE_CONNECTOR_SRC, "@miragon/pulse-analytics-connector", [PEERS]],
      [ENGINE_CONNECTOR_SRC, "@miragon/pulse-analytics-connector/widgets", [PEERS]],
      // The old pattern's reach stays: a client folder named like a connector is still caught.
      [
        `${ENGINE_CONNECTOR}/src/escape.ts`,
        "../../engine-client/src/x-connector/y.ts",
        [PEERS, DEEP],
      ],
      [ENGINE_CONNECTOR_SRC, "@miragon/pulse-engine-client", []],
      [ENGINE_CONNECTOR_SRC, "@miragon/pulse-widget-shell", []],
      [ENGINE_CONNECTOR_SRC, "react", []],
      [ENGINE_CONNECTOR_SRC, "zod", []],
      [ENGINE_CONNECTOR_SRC, "node:fs", []],
    ],
  },
  {
    rule: OWN_FAMILY,
    title: "a connector depends on its own family's client and core only",
    cases: [
      [ENGINE_CONNECTOR_SRC, "@miragon/pulse-analytics-client", [OWN_FAMILY]],
      [AN_CONNECTOR_SRC, "@miragon/pulse-engine-client/sdk", [OWN_FAMILY]],
      [AN_CONNECTOR_SRC, "@miragon/pulse-engine-client", [OWN_FAMILY]],
      [AN_CONNECTOR_SRC, `${ENGINE_CORE}/testing`, [OWN_FAMILY, NO_TESTING]],
      [
        `${AN_CONNECTOR}/src/escape-core.ts`,
        "../../../engine/engine-core/src/target.ts",
        [OWN_FAMILY, DEEP],
      ],
      [AN_CONNECTOR_SRC, "@miragon/pulse-analytics-client", []],
    ],
  },
  {
    rule: CLIENT_LEAF,
    title: "clients are leaves, also for workspace packages in their own node_modules",
    cases: [
      [ENGINE_CLIENT_SRC, "@miragon/pulse-widget-shell", [CLIENT_LEAF]],
      [ENGINE_CLIENT_SRC, "@miragon/pulse-analytics-client", [CLIENT_LEAF]],
      [ENGINE_CLIENT_SRC, "@miragon/pulse-engine-connector/widgets", [CLIENT_LEAF]],
      [
        `${ENGINE_CLIENT}/src/escape.ts`,
        "../../../../core/widget-shell/src/target.ts",
        [CLIENT_LEAF, DEEP],
      ],
      [ENGINE_CLIENT_SRC, "zod", []],
      [ENGINE_CLIENT_SRC, "./lib.ts", []],
    ],
  },
  {
    rule: DEEP,
    title: "no relative escape into a sibling package",
    cases: [
      [
        `${ENGINE_CONNECTOR}/src/escape-shell.ts`,
        "../../../../core/widget-shell/src/target.ts",
        [DEEP],
      ],
      [
        `${SERVER}/src/escape-package.ts`,
        "../../../packages/core/widget-shell/src/target.ts",
        [DEEP],
      ],
      [`${SHELL}/src/escape-ui.ts`, "../../ui/src/target.ts", [DEEP]],
      // The engine connector may import engine-core, but only by its name, never by a path.
      [`${ENGINE_CONNECTOR}/src/escape-core.ts`, "../../engine-core/src/target.ts", [DEEP]],
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
  {
    rule: CLI_CYCLE,
    title: "the CLI and the core it bundles have no import cycle, a type-only one included",
    cases: [
      [`${CLI}/src/cycle-a.ts`, "./cycle-b.ts", [CIRCULAR, CLI_CYCLE]],
      [`${CLI}/src/cycle-b.ts`, "./cycle-a.ts", [CIRCULAR, CLI_CYCLE]],
      [`${CLI}/src/type-cycle-a.ts`, "./type-cycle-b.ts", [CLI_CYCLE], "type"],
      [`${CLI}/src/type-cycle-b.ts`, "./type-cycle-a.ts", [CLI_CYCLE], "type"],
      // The workflow domain the CLI bundles is held to the same rule.
      [`${ENGINE}/src/cycle-a.ts`, "./cycle-b.ts", [CIRCULAR, CLI_CYCLE]],
      [`${ENGINE}/src/cycle-b.ts`, "./cycle-a.ts", [CIRCULAR, CLI_CYCLE]],
      [`${ENGINE}/src/type-cycle-a.ts`, "./type-cycle-b.ts", [CLI_CYCLE], "type"],
      [`${ENGINE}/src/type-cycle-b.ts`, "./type-cycle-a.ts", [CLI_CYCLE], "type"],
      // A core the CLI does not bundle is out of the CLI's rules: no-circular tolerates the type.
      [`${AN_CORE}/src/type-cycle-a.ts`, "./type-cycle-b.ts", [], "type"],
      [`${AN_CORE}/src/type-cycle-b.ts`, "./type-cycle-a.ts", [], "type"],
    ],
  },
  {
    rule: CLI_DEPRECATED,
    title: "the CLI imports no deprecated Node built-in",
    cases: [
      [`${CLI}/src/bin/punycode.ts`, "node:punycode", [CLI_DEPRECATED]],
      [`${CLI}/src/bin/node-fs.ts`, "node:fs", []],
    ],
  },
  {
    rule: CLI_NOT_TEST,
    title: "nothing in the CLI or the core it bundles imports a test file of its own",
    cases: [
      [`${CLI}/src/b.test.ts`, "./a.test.ts", [CLI_NOT_TEST]],
      [`${CLI}/src/c.test.ts`, "./target.ts", []],
      [`${ENGINE}/src/testing/to-test.ts`, "../a.test.ts", [CLI_NOT_TEST]],
      [`${ENGINE}/src/c.test.ts`, "./a.test.ts", [CLI_NOT_TEST]],
      // A core the CLI does not bundle is out of the CLI's rules.
      [`${AN_CORE}/src/to-test.ts`, "./a.test.ts", []],
      // Each package's own tests only: the CLI's rule never reaches into the core's tree.
      [
        `${CLI}/src/to-engine-test.ts`,
        "../../../packages/connectors/engine/engine-core/src/a.test.ts",
        [HEADLESS, DEEP],
      ],
    ],
  },
  {
    rule: CLI_SRC_SCRIPTS,
    title: "the CLI's shipped code imports neither its scripts nor its test code",
    cases: [
      [`${CLI}/src/to-scripts.ts`, "../scripts/target.ts", [CLI_SRC_SCRIPTS]],
      [`${CLI}/src/to-test.ts`, "../test/support/fake.ts", [CLI_SRC_SCRIPTS, CLI_SUPPORT]],
      [`${CLI}/src/d.test.ts`, "../scripts/target.ts", []],
    ],
  },
  {
    rule: CLI_SUPPORT,
    title: "only test code imports the CLI's test/support",
    cases: [
      [`${CLI}/scripts/to-support.ts`, "../test/support/fake.ts", [CLI_SUPPORT]],
      [`${CLI}/src/e.test.ts`, "../test/support/fake.ts", []],
      [`${CLI}/test/integration/x.it.test.ts`, "../support/fake.ts", []],
    ],
  },
  {
    rule: CLI_LAYER_BIN,
    title: "only the entry point imports the command layer",
    cases: [
      [`${CLI}/src/docs/to-cli.ts`, "../cli/target.ts", [CLI_DOCS, CLI_LAYER_BIN]],
      [`${CLI}/test/support/to-cli.ts`, "../../src/cli/target.ts", [CLI_LAYER_BIN]],
      [`${CLI}/src/bin/entry.ts`, "../cli/target.ts", []],
    ],
  },
  {
    rule: CLI_COMMANDER,
    title: "only the command layer imports commander",
    cases: [
      [`${CLI}/src/workflow/commander.ts`, "commander", [CLI_COMMANDER]],
      [`${CLI}/scripts/commander.ts`, "commander", [CLI_COMMANDER]],
      [`${CLI}/src/cli/commands/x.ts`, "commander", []],
    ],
  },
  {
    rule: CLI_PURE,
    title: "the CLI's pure layers import no Node built-in",
    cases: [
      ...["api/rest", "auth", "catalog", "docs", "engines/a", "output", "workflow"].map((layer) => [
        `${CLI}/src/${layer}/fs.ts`,
        "node:fs",
        [CLI_PURE],
      ]),
      [`${CLI}/src/engine-port/fs.ts`, "node:fs", [CLI_PORT_TYPES, CLI_PURE]],
      [`${CLI}/src/util.ts`, "node:os", [CLI_PURE]],
      [`${CLI}/src/workflow/fs.test.ts`, "node:fs", []],
      [`${CLI}/src/config/fs.ts`, "node:fs", []],
    ],
  },
  {
    rule: CLI_OPERATION_PATH,
    title: "the CLI's operation layer imports node:path and no other built-in",
    cases: [
      [`${CLI}/src/operation/fs.ts`, "node:fs", [CLI_OPERATION_PATH]],
      [`${CLI}/src/operation/path.ts`, "node:path", []],
    ],
  },
  {
    rule: CLI_DOCS,
    title: "the CLI's docs layer imports only catalog, errors and util",
    cases: [
      [`${CLI}/src/docs/to-output.ts`, "../output/target.ts", [CLI_DOCS]],
      [`${CLI}/src/docs/to-catalog.ts`, "../catalog/target.ts", []],
      [`${CLI}/src/docs/to-errors.ts`, "../errors.ts", []],
    ],
  },
  {
    rule: CLI_AUTH,
    title: "the CLI's auth layer imports only auth, config, the http client and the base modules",
    cases: [
      [`${CLI}/src/auth/to-output.ts`, "../output/target.ts", [CLI_AUTH]],
      [`${CLI}/src/auth/to-http.ts`, "../http/target.ts", [CLI_AUTH]],
      [`${CLI}/src/auth/to-config.ts`, "../config/target.ts", []],
      [`${CLI}/src/auth/to-client.ts`, "../http/client.ts", []],
      [`${CLI}/src/auth/to-runtime.ts`, "../runtime.ts", []],
    ],
  },
  {
    rule: CLI_CONFIG_AUTH,
    title: "the CLI's config layer never imports auth",
    cases: [
      [`${CLI}/src/config/to-auth.ts`, "../auth/target.ts", [CLI_CONFIG_AUTH]],
      [`${CLI}/src/config/auth.test.ts`, "../auth/target.ts", []],
    ],
  },
  {
    rule: CLI_LOGIN,
    title: "only the auth command starts an interactive login",
    cases: [
      [`${CLI}/src/cli/commands/ping.ts`, "../../auth/oauth/login.ts", [CLI_LOGIN]],
      [`${CLI}/src/cli/commands/auth.ts`, "../../auth/oauth/login.ts", []],
      [`${CLI}/src/cli/login.test.ts`, "../auth/oauth/login.ts", []],
    ],
  },
  {
    rule: CLI_WORKFLOW_DEPS,
    title: "the workflow commands build on neither cli, config, auth nor bin",
    cases: [
      [`${CLI}/src/workflow/to-config.ts`, "../config/target.ts", [CLI_WORKFLOW_DEPS]],
      [`${CLI}/src/workflow/to-cli.ts`, "../cli/target.ts", [CLI_LAYER_BIN, CLI_WORKFLOW_DEPS]],
      [`${CLI}/src/workflow/to-output.ts`, "../output/target.ts", []],
    ],
  },
  {
    rule: CLI_WORKFLOW_USERS,
    title: "only the command layer and the APIs use the workflow commands",
    cases: [
      [`${CLI}/src/output/to-workflow.ts`, "../workflow/target.ts", [CLI_WORKFLOW_USERS]],
      [`${CLI}/src/cli/to-workflow.ts`, "../workflow/target.ts", []],
    ],
  },
  {
    rule: CLI_API_ENGINE,
    title: "an API uses only the workflow engine module",
    cases: [
      [`${CLI}/src/api/rest/to-workflow.ts`, "../../workflow/target.ts", [CLI_API_ENGINE]],
      [`${CLI}/src/api/rest/to-engine.ts`, "../../workflow/engine.ts", []],
    ],
  },
  {
    rule: CLI_WORKFLOW_PORT,
    title: "the workflow commands know the engine port, never an adapter or an API",
    cases: [
      [`${CLI}/src/workflow/to-engines.ts`, "../engines/b/target.ts", [CLI_WORKFLOW_PORT]],
      [
        `${CLI}/src/workflow/to-api.ts`,
        "../api/rest/target.ts",
        [CLI_API_ADAPTERS, CLI_WORKFLOW_PORT],
      ],
      [`${CLI}/src/workflow/to-port.ts`, "../engine-port/target.ts", [], "type"],
    ],
  },
  {
    rule: CLI_PORT_TYPES,
    title: "the engine port imports types only",
    cases: [
      [`${CLI}/src/engine-port/value.ts`, "../catalog/types.ts", [CLI_PORT_TYPES]],
      [`${CLI}/src/engine-port/types.ts`, "../catalog/target.ts", [], "type"],
    ],
  },
  {
    rule: CLI_API_ADAPTERS,
    title: "only the engine adapters use an API",
    cases: [
      [`${CLI}/src/cli/to-api.ts`, "../api/rest/target.ts", [CLI_API_ADAPTERS]],
      [`${CLI}/src/engines/a/adapter.ts`, "../../api/rest/target.ts", []],
    ],
  },
  {
    rule: CLI_API_API,
    title: "an API never imports another API",
    cases: [
      [`${CLI}/src/api/rest/to-other.ts`, "../other/target.ts", [CLI_API_API]],
      [`${CLI}/src/api/rest/to-own.ts`, "./target.ts", []],
    ],
  },
  {
    rule: CLI_ENGINES,
    title: "an engine adapter never imports another one",
    cases: [[`${CLI}/src/engines/a/to-b.ts`, "../b/target.ts", [CLI_ENGINES]]],
  },
  {
    rule: CLI_HTTP,
    title: "the CLI's HTTP layer depends on neither config, cli nor operation",
    cases: [
      [`${CLI}/src/http/to-operation.ts`, "../operation/target.ts", [CLI_HTTP]],
      [`${CLI}/src/http/to-errors.ts`, "../errors.ts", []],
    ],
  },
  {
    rule: CLI_GENERATED,
    title: "only catalog.ts and the engine adapters read the generated catalog",
    cases: [
      [`${CLI}/src/output/to-catalog.ts`, "../generated/catalog.a.json", [CLI_GENERATED]],
      [
        `${CLI}/scripts/to-catalog.ts`,
        "../src/generated/catalog.a.json",
        [CLI_GENERATED, CLI_SCRIPTS],
      ],
      [`${CLI}/src/engines/a/adapter.ts`, "../../generated/catalog.a.json", []],
    ],
  },
  {
    rule: CLI_OUTPUT,
    title: "the CLI's output layer imports only the operation result",
    cases: [
      [`${CLI}/src/output/to-operation.ts`, "../operation/target.ts", [CLI_OUTPUT]],
      [`${CLI}/src/output/to-result.ts`, "../operation/result.ts", [], "type"],
    ],
  },
  {
    rule: CLI_OUTPUT_TYPES,
    title: "the CLI's output layer imports the operation result as types only",
    cases: [[`${CLI}/src/output/result-value.ts`, "../operation/result.ts", [CLI_OUTPUT_TYPES]]],
  },
  {
    rule: CLI_SCRIPTS,
    title: "the catalog generator imports only the catalog types, schema and rules",
    cases: [
      [`${CLI}/scripts/to-output.ts`, "../src/output/target.ts", [CLI_SCRIPTS]],
      [`${CLI}/scripts/to-types.ts`, "../src/catalog/types.ts", []],
      [`${CLI}/scripts/x.test.ts`, "../src/output/target.ts", []],
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
    { from: `${ENGINE_CONNECTOR}/src/sync-${dir}.ts`, spec, rule: NO_APP, app: name },
    { from: `${otherApp}/src/sync-${dir}.ts`, spec, rule: APP_APP, app: name },
  ])
})

/** The root scripts that cruise with .dependency-cruiser.cjs, both chained into `pnpm lint`. */
const ARCHITECTURE_SCRIPTS = ["lint:architecture", "lint:architecture:cli"]

/** The path arguments of the pinned `pnpm lint:architecture` and `lint:architecture:cli` commands. */
function lintArchitecturePaths() {
  const rootPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"))
  return ARCHITECTURE_SCRIPTS.flatMap((script) => {
    const words = rootPackage.scripts[script].trim().split(/\s+/)
    const configAt = words.indexOf("--config")
    assert.equal(words[0], "depcruise", `${script} no longer runs depcruise`)
    assert.equal(
      words[configAt + 1],
      ".dependency-cruiser.cjs",
      `${script} no longer reads .dependency-cruiser.cjs; point this self-test at its config`,
    )
    return words.slice(1, configAt)
  })
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
  plant(`${CLI}/src/catalog/catalog.ts`, "../generated/commands.json")
  plant(ENGINE_CLIENT_SRC, "./generated/sdk.gen.ts")
  plant(ENGINE_CONNECTOR_SRC, "./generated/catalog.ts")

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
      sources.has(`${ENGINE_CONNECTOR}/src/generated/catalog.ts`),
      "connector generated dropped",
    )
    assert.deepEqual(
      edgeOf(`${CLI}/src/catalog/catalog.ts`, "../generated/commands.json").rules,
      [],
    )
  })

  it("excludes engine-client/src/generated", () => {
    const generated = `${ENGINE_CLIENT}/src/generated/`
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

  it("the connector-family roles the rules key on are the naming gate's", () => {
    const roles = new Set(
      config.forbidden
        .flatMap((rule) => [rule.from.path ?? []].flat())
        .map((pattern) => /^\^packages\/connectors\/.*-([a-z]+)\/(?:src\/)?$/.exec(pattern)?.[1])
        .filter(Boolean),
    )
    assert.deepEqual([...roles].sort(), [...CONNECTOR_ROLES].sort())
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
      .filter((dir) => !CONNECTOR_ROLES.some((role) => dir.endsWith(`-${role}`)))
    assert.deepEqual(offenders, [], "a package without a role suffix falls out of every rule")
  })
})
