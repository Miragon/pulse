import assert from "node:assert/strict"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { after, before, describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { cruise, format } from "dependency-cruiser"
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
// src/index.ts, so nothing needs a build, but engine-core's: its main is its build, as in the repo,
// so a dialect core's import of it resolves to the one shape family-core-is-a-leaf admits.
const SERVER = "apps/mcp-server"
const CLI = "apps/cli"
const EXT = "apps/vscode"
const ORCA = "apps/orca"
const RUNTIME_VIEW = "packages/core/runtime-view"
const ENGINE_ADAPTER = "packages/connectors/engine/engine-adapter"
const SHELL = "packages/core/widget-shell"
const UI = "packages/core/ui"
const PROFILE = "packages/core/profile"
const HTTP = "packages/core/http"
const ENGINE_CORE = "packages/connectors/engine/engine-core"
const C7 = "packages/connectors/c7/c7-core"
const C7_CLIENT = "packages/connectors/c7/c7-client"
const ENGINE_CONNECTOR = "packages/connectors/engine/engine-connector"
// No such family exists: a second family's client, connector and core prove the family rules
// key on the roles.
const BILLING_CLIENT = "packages/connectors/billing/billing-client"
const BILLING_CONNECTOR = "packages/connectors/billing/billing-connector"
const BILLING_CORE = "packages/connectors/billing/billing-core"
// No such package exists: a second family's adapter proves the adapter rules key on the role.
const BILLING_ADAPTER = "packages/connectors/billing/billing-adapter"

const WORKSPACE = {
  [SERVER]: { name: "@miragon/pulse-mcp-server", private: true },
  [CLI]: { name: "@miragon/pulse-cli" },
  [EXT]: { name: "pulse-cockpit", engines: { vscode: "^1.101.0" } },
  [ORCA]: { name: "@miragon/pulse-orca", private: true },
  [RUNTIME_VIEW]: { name: "@miragon/pulse-runtime-view", private: true },
  [ENGINE_ADAPTER]: { name: "@miragon/pulse-engine-adapter", private: true },
  [SHELL]: { name: "@miragon/pulse-widget-shell" },
  [UI]: { name: "@miragon/pulse-ui" },
  [PROFILE]: { name: "@miragon/pulse-profile" },
  [HTTP]: { name: "@miragon/pulse-http" },
  [ENGINE_CORE]: { name: "@miragon/pulse-engine-core", main: "dist/index.js" },
  [C7]: { name: "@miragon/pulse-c7-core" },
  [C7_CLIENT]: { name: "@miragon/pulse-c7-client" },
  [ENGINE_CONNECTOR]: { name: "@miragon/pulse-engine-connector" },
  [BILLING_CLIENT]: { name: "@miragon/pulse-billing-client" },
  [BILLING_CONNECTOR]: { name: "@miragon/pulse-billing-connector" },
  [BILLING_CORE]: { name: "@miragon/pulse-billing-core" },
  [BILLING_ADAPTER]: { name: "@miragon/pulse-billing-adapter", private: true },
}

// The links the fixture leaves out, importer directory -> package name: the billing core imports
// engine-core as a tree before its build does, bare and unresolved (shape 3), where c7-core's
// import resolves to the build (shape 2), so family-core-is-a-leaf meets both.
const UNLINKED = new Map([[BILLING_CORE, WORKSPACE[ENGINE_CORE].name]])

// Third-party stubs installed into every importer's own node_modules. `vscode` is left out
// on purpose: the extension host provides it at runtime, so it stays a bare specifier.
// `reactive`, `pulse-tools` and `@miragon/pulse-mcp-server-kit` prove the name patterns are
// anchored (the last is no app, only a package whose name starts like the server's).
const THIRD_PARTY = [
  "react",
  "react-dom",
  "lucide-react",
  "@tanstack/react-query",
  "@modelcontextprotocol/server",
  "@modelcontextprotocol/node",
  "@modelcontextprotocol/ext-apps",
  "@modelcontextprotocol/ext-apps-extra",
  "hono",
  "jose",
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
const SPANS = "engine-connector-spans-the-dialects"
const CLIENT_LEAF = "clients-are-leaves"
const CORE = "core-is-foundation"
const UI_LEAF = "ui-is-a-leaf"
const UI_FOUNDATION = "ui-foundation-entries-import-nothing"
const SHELL_VIEWS = "widget-shell-views-browser-only"
const SHELL_HEADLESS = "widget-shell-server-headless"
const SHELL_PROTOCOL = "widget-shell-protocol-is-a-leaf"
const EXT_APPS = "ext-apps-runtime-in-the-adapter"
const WIDGETS_BROWSER = "connector-widgets-are-browser-code"
const WIDGETS_SHARED_LIB = "connector-widgets-only-shared-lib"
const POINT_DOWN = "connector-data-and-lib-point-down"
const NO_APP = "packages-never-import-the-app"
const APP_APP = "apps-never-import-apps"
const HEADLESS = "cli-is-headless"
const CORE_LEAF = "family-core-is-a-leaf"
const PROFILE_LEAF = "profile-is-a-leaf"
const PROFILE_USERS = "profile-consumers"
const HTTP_LEAF = "http-is-a-leaf"
const HTTP_USERS = "http-consumers"
const HTTP_LOOPBACK = "http-loopback-only-its-sockets"
const ENGINE_CORE_USERS = "engine-core-consumers"
const CORE_USERS = "family-core-consumers"
const ADAPTER_FAMILY = "adapters-own-their-family"
const ENGINE_ADAPTER_DIALECT = "engine-adapter-runs-the-c7-dialect"
const VIEW_USERS = "runtime-view-consumers"
const VIEW_ENGINE = "runtime-view-builds-on-the-engine-contract"
const ADAPTER_USERS = "adapter-consumers"
const HOSTS = "editor-hosts-reach-dialects-through-adapters"
const CLI_CORE_LAYERS = "cli-family-core-only-in-named-layers"
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
const ORCA_SRC = `${ORCA}/src/worker/main.ts`
const VIEW_SRC = `${RUNTIME_VIEW}/src/index.ts`
const ADAPTER_SRC = `${ENGINE_ADAPTER}/src/index.ts`
const BILLING_ADAPTER_SRC = `${BILLING_ADAPTER}/src/index.ts`
const VIEW = "@miragon/pulse-runtime-view"
const ADAPTER = "@miragon/pulse-engine-adapter"
const SHELL_SRC = `${SHELL}/src/index.ts`
const UI_SRC = `${UI}/src/index.ts`
const C7_SRC = `${C7}/src/index.ts`
const C7_CORE = "@miragon/pulse-c7-core"
const BILLING_CORE_NAME = "@miragon/pulse-billing-core"
const PROFILE_NAME = "@miragon/pulse-profile"
const PROFILE_SRC = `${PROFILE}/src/index.ts`
const HTTP_NAME = "@miragon/pulse-http"
const HTTP_SRC = `${HTTP}/src/index.ts`
const ENGINE_CORE_NAME = "@miragon/pulse-engine-core"
const ENGINE_CORE_SRC = `${ENGINE_CORE}/src/index.ts`
const BILLING_CORE_SRC = `${BILLING_CORE}/src/index.ts`
const C7_CLIENT_SRC = `${C7_CLIENT}/src/index.ts`
const ENGINE_CONNECTOR_SRC = `${ENGINE_CONNECTOR}/src/index.ts`
const BILLING_CONNECTOR_SRC = `${BILLING_CONNECTOR}/src/index.ts`

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
  `${UI}/src/tones/situations.ts`,
  `${UI}/src/format/numbers.ts`,
  `${C7}/src/target.ts`,
  `${C7}/src/lib.ts`,
  `${C7}/src/testing/fixture.ts`,
  `${PROFILE}/src/target.ts`,
  `${PROFILE}/src/lib.ts`,
  `${HTTP}/src/target.ts`,
  `${HTTP}/src/lib.ts`,
  `${ENGINE_CORE}/src/target.ts`,
  `${ENGINE_CORE}/src/lib.ts`,
  `${ENGINE_CORE}/dist/index.js`,
  `${ENGINE_CORE}/dist/testing/index.js`,
  `${ENGINE_CORE}/dist/model/root-causes.js`,
  `${BILLING_CORE}/src/lib.ts`,
  `${BILLING_CORE}/src/a.test.ts`,
  `${C7_CLIENT}/src/target.ts`,
  `${C7_CLIENT}/src/lib.ts`,
  `${C7_CLIENT}/src/x-connector/y.ts`,
  `${C7_CLIENT}/src/generated/sdk.gen.ts`,
  `${ENGINE_CONNECTOR}/src/generated/catalog.ts`,
  `${SHELL}/src/composed-server.ts`,
  `${SHELL}/src/tool-registrar.ts`,
  `${SHELL}/src/ui/lib.ts`,
  `${SHELL}/src/ui/target.ts`,
  `${SHELL}/src/protocol/tool-result.ts`,
  `${SHELL}/src/protocol/view-name.ts`,
  `${ENGINE_CONNECTOR}/src/tools/target.ts`,
  `${ENGINE_CONNECTOR}/src/data/target.ts`,
  `${ENGINE_CONNECTOR}/src/lib/engine/with-engine.ts`,
  `${ENGINE_CONNECTOR}/src/lib/mcp/toolsets.ts`,
  `${ENGINE_CONNECTOR}/src/lib/shared/environments.ts`,
  `${ENGINE_CONNECTOR}/src/lib/shared/task-completion.ts`,
  `${ENGINE_CONNECTOR}/src/lib/shared-server/target.ts`,
  `${ENGINE_CONNECTOR}/src/widget-tools/target.ts`,
  `${ENGINE_CONNECTOR}/src/widget-tools.ts`,
  `${ENGINE_CONNECTOR}/src/plugin.ts`,
  `${ENGINE_CONNECTOR}/src/module.ts`,
  `${ENGINE_CONNECTOR}/src/plugin-names.ts`,
  `${ENGINE_CONNECTOR}/src/feed-contracts.ts`,
  `${ENGINE_CONNECTOR}/src/instructions.ts`,
  `${ENGINE_CONNECTOR}/src/engine-provider.ts`,
  `${ENGINE_CONNECTOR}/src/providers/target.ts`,
  `${ENGINE_CONNECTOR}/src/view-models.ts`,
  `${ENGINE_CONNECTOR}/src/view-models.health.ts`,
  `${ENGINE_CONNECTOR}/src/tool-names.ts`,
  `${ENGINE_CONNECTOR}/src/messages/use-t.ts`,
  `${ENGINE_CONNECTOR}/src/widgets/lib/engine-action.ts`,
  `${BILLING_CONNECTOR}/src/tools/target.ts`,
  `${BILLING_CONNECTOR}/src/bpmn-names.ts`,
  `${BILLING_CONNECTOR}/src/instructions.ts`,
  `${BILLING_CONNECTOR}/src/summary.ts`,
  `${BILLING_CONNECTOR}/src/lib/engine/target.ts`,
  `${BILLING_CONNECTOR}/src/widget-tools.ts`,
  `${BILLING_CONNECTOR}/src/plugin.ts`,
  `${BILLING_CONNECTOR}/src/lib/shared/environments.ts`,
]
const JSON_LEAVES = [
  `${CLI}/src/generated/commands.json`,
  `${CLI}/src/generated/catalog.a.json`,
  `${PROFILE}/src/testing/fixtures.json`,
]

/**
 * One suite per rule: [importer, specifier, exact rules, form?]. `form` "type" plants an
 * `import type`, "dynamic" an `import()`, the default a side-effect `import`.
 */
const SUITES = [
  {
    rule: HEADLESS,
    title: "the CLI imports no workspace package but the ones it bundles, nor the MCP/UI stack",
    cases: [
      ...[
        "@miragon/pulse-widget-shell",
        "@miragon/pulse-widget-shell/server",
        "@miragon/pulse-engine-connector",
        "@miragon/pulse-c7-client",
        "@miragon/pulse-c7-client/sdk",
        "@miragon/pulse-c7-client/routes",
        "react",
        "react-dom/client",
        "lucide-react",
        "@tanstack/react-query",
        "@modelcontextprotocol/server",
        "@modelcontextprotocol/node",
        "@modelcontextprotocol/ext-apps/server",
        "@modelcontextprotocol/client",
        "hono",
        "hono/cors",
        "@hono/node-server",
        "jose",
        "prom-client",
        "zod",
        "@hey-api/client-fetch",
        "preact",
        "bpmn-js",
        "diagram-js",
        "@miragon/modeler-shell",
        "vscode",
      ].map((spec) => [CLI_SRC, spec, [HEADLESS]]),
      // The MCP Apps runtime is the host adapter's rule as well.
      ...["@modelcontextprotocol/ext-apps", "@modelcontextprotocol/ext-apps/react"].map((spec) => [
        CLI_SRC,
        spec,
        [HEADLESS, EXT_APPS],
      ]),
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
      [`${CLI}/src/workflow/x.ts`, "@miragon/pulse-c7-corex", [HEADLESS]],
      [
        `${CLI}/src/workflow/escape-core.ts`,
        "../../../../packages/connectors/c7/c7-core/src/target.ts",
        [HEADLESS, DEEP],
      ],
      // It names the one core the CLI bundles: another family's core stays a violation.
      [`${CLI}/src/workflow/other-core.ts`, BILLING_CORE_NAME, [HEADLESS]],
      // The profile format is bundled too (CLI_BUNDLES): its name is exempt, anchored, and its
      // tree is not (profile-consumers decides where in the CLI it is read).
      [`${CLI}/src/config/profile-x.ts`, "@miragon/pulse-profilex", [HEADLESS]],
      [
        `${CLI}/src/config/escape-profile.ts`,
        "../../../../packages/core/profile/src/target.ts",
        [HEADLESS, DEEP],
      ],
      // So is the transport (CLI_BUNDLES): its name is exempt, anchored, and its tree is not
      // (http-consumers decides where in the CLI it is used).
      [`${CLI}/src/http/http-x.ts`, "@miragon/pulse-httpx", [HEADLESS]],
      [
        `${CLI}/src/http/escape-http.ts`,
        "../../../../packages/core/http/src/target.ts",
        [HEADLESS, DEEP],
      ],
    ],
  },
  {
    rule: PROFILE_LEAF,
    title:
      "the profile format imports only its own modules: no package, no npm module, no built-in",
    cases: [
      // Not even a sibling of packages/core: core-is-foundation lets the others import one.
      [PROFILE_SRC, "@miragon/pulse-ui", [PROFILE_LEAF]],
      [PROFILE_SRC, "@miragon/pulse-widget-shell/server", [PROFILE_LEAF]],
      [PROFILE_SRC, C7_CORE, [CORE, PROFILE_LEAF]],
      [PROFILE_SRC, "@miragon/pulse-c7-client", [CORE, PROFILE_LEAF]],
      [PROFILE_SRC, "@miragon/pulse-cli", [NO_APP, PROFILE_LEAF]],
      ...["zod", "react", "commander", "reactive", "node:fs"].map((spec) => [
        PROFILE_SRC,
        spec,
        [PROFILE_LEAF],
      ]),
      [`${PROFILE}/src/url.ts`, "url", [PROFILE_LEAF]],
      [`${PROFILE}/src/escape.ts`, "../../ui/src/target.ts", [PROFILE_LEAF, DEEP]],
      // The shipped ./testing export is no test file: it loads its fixtures as JSON, no vitest.
      [`${PROFILE}/src/testing/index.ts`, "vitest", [PROFILE_LEAF]],
      [`${PROFILE}/src/testing/fixtures.ts`, "./fixtures.json", []],
      [`${PROFILE}/src/testing/types.ts`, "../lib.ts", []],
      [`${PROFILE}/src/parse.ts`, "./lib.ts", []],
      [`${PROFILE}/src/a.test.ts`, "vitest", []],
    ],
  },
  {
    rule: PROFILE_USERS,
    title: "the profile format is read where a surface reads its profiles, and in tests",
    cases: [
      [SERVER_SRC, PROFILE_NAME, [PROFILE_USERS]],
      [SHELL_SRC, PROFILE_NAME, [PROFILE_USERS]],
      [UI_SRC, PROFILE_NAME, [UI_LEAF, PROFILE_USERS]],
      [C7_SRC, PROFILE_NAME, [CORE_LEAF, PROFILE_USERS]],
      [C7_CLIENT_SRC, PROFILE_NAME, [CLIENT_LEAF, PROFILE_USERS]],
      [ENGINE_CONNECTOR_SRC, PROFILE_NAME, [PROFILE_USERS]],
      [
        `${ENGINE_CONNECTOR}/src/widgets/profile.ts`,
        PROFILE_NAME,
        [WIDGETS_BROWSER, PROFILE_USERS],
      ],
      [`${ENGINE_CONNECTOR}/src/tools/profile.ts`, PROFILE_NAME, [PROFILE_USERS]],
      // The readers are named files: a look-alike or a deeper module.ts is none.
      [`${ENGINE_CONNECTOR}/src/engine-profiles-x.ts`, PROFILE_NAME, [PROFILE_USERS]],
      [`${ENGINE_CONNECTOR}/src/lib/engine/module.ts`, PROFILE_NAME, [PROFILE_USERS]],
      // Another family's module reads no engine profiles.
      [`${BILLING_CONNECTOR}/src/engine-profiles.ts`, PROFILE_NAME, [PROFILE_USERS]],
      [`${CLI}/src/workflow/profile.ts`, PROFILE_NAME, [PROFILE_USERS]],
      [`${CLI}/src/configx/profile.ts`, PROFILE_NAME, [PROFILE_USERS]],
      // The editor hosts parse their project files in the runtime view's host kit, never
      // themselves: their own connections read no profile.
      [`${EXT}/src/host/connections/profile.ts`, PROFILE_NAME, [PROFILE_USERS]],
      [`${ORCA}/src/worker/profile.ts`, PROFILE_NAME, [PROFILE_USERS]],
      [`${RUNTIME_VIEW}/src/core/profile.ts`, PROFILE_NAME, [PROFILE_USERS]],
      [`${RUNTIME_VIEW}/src/host-kit/panels/profile.ts`, PROFILE_NAME, [PROFILE_USERS]],
      [ADAPTER_SRC, PROFILE_NAME, [ENGINE_ADAPTER_DIALECT, PROFILE_USERS]],
      [
        `${SERVER}/src/escape-profile.ts`,
        "../../../packages/core/profile/src/target.ts",
        [PROFILE_USERS, DEEP],
      ],
      // Unresolved subpaths (shape 3: dependency-cruiser reads no exports map).
      [`${SHELL}/src/profile-sub.ts`, `${PROFILE_NAME}/sub`, [PROFILE_USERS]],
      [`${SERVER}/src/profile-testing.ts`, `${PROFILE_NAME}/testing`, [PROFILE_USERS, NO_TESTING]],
      // A reader's shipped code reaches no ./testing entry either.
      [`${CLI}/src/config/fixtures.ts`, `${PROFILE_NAME}/testing`, [NO_TESTING]],
      // Allowed: the readers, and tests anywhere.
      [`${CLI}/src/config/profiles.ts`, PROFILE_NAME, []],
      [`${RUNTIME_VIEW}/src/host-kit/connections/profiles.ts`, PROFILE_NAME, []],
      [`${RUNTIME_VIEW}/test/host-kit/fixtures.test.ts`, `${PROFILE_NAME}/testing`, []],
      [`${ENGINE_CONNECTOR}/src/engine-profiles.ts`, PROFILE_NAME, []],
      [`${ENGINE_CONNECTOR}/src/module.test.ts`, `${PROFILE_NAME}/testing`, []],
      [`${SHELL}/src/profile.test.ts`, PROFILE_NAME, []],
      [`${CLI}/test/support/profiles.ts`, `${PROFILE_NAME}/testing`, []],
    ],
  },
  {
    rule: HTTP_LEAF,
    title: "the transport imports only its own modules: no package, no npm module, no built-in",
    cases: [
      // Not even a sibling of packages/core: core-is-foundation lets the others import one.
      [HTTP_SRC, "@miragon/pulse-ui", [HTTP_LEAF]],
      [HTTP_SRC, "@miragon/pulse-widget-shell/server", [HTTP_LEAF]],
      [HTTP_SRC, PROFILE_NAME, [HTTP_LEAF, PROFILE_USERS]],
      [HTTP_SRC, C7_CORE, [CORE, HTTP_LEAF]],
      [HTTP_SRC, "@miragon/pulse-c7-client", [CORE, HTTP_LEAF]],
      [HTTP_SRC, "@miragon/pulse-cli", [NO_APP, HTTP_LEAF]],
      // No HTTP library under the injected fetch, no token verifier, no schema, no UI.
      ...["undici", "jose", "zod", "react", "reactive", "node:http"].map((spec) => [
        HTTP_SRC,
        spec,
        [HTTP_LEAF],
      ]),
      [`${HTTP}/src/url.ts`, "url", [HTTP_LEAF]],
      [`${HTTP}/src/escape.ts`, "../../ui/src/target.ts", [HTTP_LEAF, DEEP]],
      // The shipped ./testing export is no test file: its conformance cases are data, no vitest.
      [`${HTTP}/src/testing/index.ts`, "vitest", [HTTP_LEAF]],
      [`${HTTP}/src/testing/cases.ts`, "../lib.ts", []],
      [`${HTTP}/src/http.ts`, "./lib.ts", []],
      [`${HTTP}/src/a.test.ts`, "vitest", []],
      // Its Node sockets live in the loopback engine alone, and no other testing module gets them.
      [`${HTTP}/src/testing/parts.ts`, "node:http", [HTTP_LEAF]],
      [`${HTTP}/src/testing/loopback/server.ts`, "node:http", []],
      // No other module of the package reaches the loopback engine, so neither the ./testing
      // entry nor the transport itself takes its sockets in.
      [`${HTTP}/src/testing/index.ts`, "./loopback/index.ts", [HTTP_LEAF]],
      [`${HTTP}/src/http.ts`, "./testing/loopback/index.ts", [HTTP_LEAF, NO_TESTING]],
      [`${HTTP}/src/testing/loopback/index.ts`, "./server.ts", []],
    ],
  },
  {
    rule: HTTP_LOOPBACK,
    title: "the loopback engine of the conformance cases imports its sockets and nothing else",
    cases: [
      [`${HTTP}/src/testing/loopback/plain.ts`, "node:http", []],
      [`${HTTP}/src/testing/loopback/tls.ts`, "node:https", []],
      [`${HTTP}/src/testing/loopback/certificate.ts`, "node:crypto", []],
      [`${HTTP}/src/testing/loopback/types.ts`, "../../lib.ts", []],
      [`${HTTP}/src/testing/loopback/files.ts`, "node:fs", [HTTP_LOOPBACK]],
      [`${HTTP}/src/testing/loopback/spawn.ts`, "node:child_process", [HTTP_LOOPBACK]],
      [`${HTTP}/src/testing/loopback/agent.ts`, "undici", [HTTP_LOOPBACK]],
      [`${HTTP}/src/testing/loopback/ui.ts`, "@miragon/pulse-ui", [HTTP_LOOPBACK]],
      [
        `${HTTP}/src/testing/loopback/escape.ts`,
        "../../../../ui/src/target.ts",
        [HTTP_LOOPBACK, DEEP],
      ],
      // A wiring's test runs the cases against it; shipped code never reaches it.
      [`${ENGINE_CONNECTOR}/src/lib/engine/cases.test.ts`, `${HTTP_NAME}/testing/loopback`, []],
      [
        `${ENGINE_CONNECTOR}/src/lib/engine/cases.ts`,
        `${HTTP_NAME}/testing/loopback`,
        [NO_TESTING],
      ],
    ],
  },
  {
    rule: HTTP_USERS,
    title: "the transport is used where a surface sends its engine requests, and in tests",
    cases: [
      [SERVER_SRC, HTTP_NAME, [HTTP_USERS]],
      [SHELL_SRC, HTTP_NAME, [HTTP_USERS]],
      [UI_SRC, HTTP_NAME, [UI_LEAF, HTTP_USERS]],
      [PROFILE_SRC, HTTP_NAME, [PROFILE_LEAF, HTTP_USERS]],
      [C7_SRC, HTTP_NAME, [CORE_LEAF, HTTP_USERS]],
      [C7_CLIENT_SRC, HTTP_NAME, [CLIENT_LEAF, HTTP_USERS]],
      // A connector's src/lib/engine may, its widgets may not: they are browser code.
      [`${ENGINE_CONNECTOR}/src/widgets/http.ts`, HTTP_NAME, [WIDGETS_BROWSER, HTTP_USERS]],
      // Nor its tools, data builders or root: they reach an engine through resolveEngine.
      [`${ENGINE_CONNECTOR}/src/tools/http.ts`, HTTP_NAME, [HTTP_USERS]],
      [`${ENGINE_CONNECTOR}/src/data/http.ts`, HTTP_NAME, [HTTP_USERS]],
      [`${ENGINE_CONNECTOR}/src/http.ts`, HTTP_NAME, [HTTP_USERS]],
      [`${BILLING_CONNECTOR}/src/http.ts`, HTTP_NAME, [HTTP_USERS]],
      [`${CLI}/src/workflow/http.ts`, HTTP_NAME, [HTTP_USERS]],
      [`${CLI}/src/config/http.ts`, HTTP_NAME, [HTTP_USERS]],
      [`${CLI}/src/httpx/client.ts`, HTTP_NAME, [HTTP_USERS]],
      // The editor hosts and the runtime view send nothing: the family adapters do.
      [`${EXT}/src/host/http.ts`, HTTP_NAME, [HTTP_USERS]],
      [`${ORCA}/src/worker/http.ts`, HTTP_NAME, [HTTP_USERS]],
      [`${RUNTIME_VIEW}/src/core/http.ts`, HTTP_NAME, [HTTP_USERS]],
      [`${RUNTIME_VIEW}/src/host-kit/http.ts`, HTTP_NAME, [HTTP_USERS]],
      [
        `${SERVER}/src/escape-http.ts`,
        "../../../packages/core/http/src/target.ts",
        [HTTP_USERS, DEEP],
      ],
      // Unresolved subpaths (shape 3: dependency-cruiser reads no exports map).
      [`${SHELL}/src/http-sub.ts`, `${HTTP_NAME}/oauth`, [HTTP_USERS]],
      [`${SERVER}/src/http-testing.ts`, `${HTTP_NAME}/testing`, [HTTP_USERS, NO_TESTING]],
      // A user's shipped code reaches no ./testing entry either.
      [`${CLI}/src/http/cases.ts`, `${HTTP_NAME}/testing`, [NO_TESTING]],
      // Allowed: the layers that send, a connector of any family, and tests anywhere.
      [`${CLI}/src/http/transport.ts`, HTTP_NAME, []],
      [`${CLI}/src/auth/http.ts`, HTTP_NAME, []],
      [`${CLI}/src/operation/http.ts`, HTTP_NAME, []],
      [`${ENGINE_ADAPTER}/src/http.ts`, HTTP_NAME, []],
      [`${BILLING_ADAPTER}/src/http.ts`, `${HTTP_NAME}/oauth`, []],
      [`${ENGINE_CONNECTOR}/src/lib/engine/http.ts`, HTTP_NAME, []],
      [`${BILLING_CONNECTOR}/src/lib/engine/http.ts`, HTTP_NAME, []],
      [`${ENGINE_CONNECTOR}/src/tools/http.test.ts`, HTTP_NAME, []],
      [`${ENGINE_CONNECTOR}/src/http.test.ts`, `${HTTP_NAME}/testing`, []],
      [`${SHELL}/src/http.test.ts`, HTTP_NAME, []],
      [`${CLI}/test/support/http.ts`, `${HTTP_NAME}/testing`, []],
      [`${ENGINE_ADAPTER}/src/http.test.ts`, `${HTTP_NAME}/testing`, []],
      [`${SERVER}/src/http.test.ts`, HTTP_NAME, []],
    ],
  },
  {
    rule: ENGINE_CORE_USERS,
    title:
      "engine-core is imported where a dialect is implemented, where the runtime view reads " +
      "its answers, and in tests",
    cases: [
      [SERVER_SRC, ENGINE_CORE_NAME, [CORE_USERS, ENGINE_CORE_USERS]],
      [SHELL_SRC, ENGINE_CORE_NAME, [CORE, ENGINE_CORE_USERS]],
      [UI_SRC, ENGINE_CORE_NAME, [UI_LEAF, CORE, ENGINE_CORE_USERS]],
      [PROFILE_SRC, ENGINE_CORE_NAME, [PROFILE_LEAF, CORE, ENGINE_CORE_USERS]],
      [HTTP_SRC, ENGINE_CORE_NAME, [HTTP_LEAF, CORE, ENGINE_CORE_USERS]],
      [C7_CLIENT_SRC, ENGINE_CORE_NAME, [CLIENT_LEAF, ENGINE_CORE_USERS]],
      // The engine connector: engine-core is its own family's core, which
      // engine-connector-spans-the-dialects lets through, but it reaches the contract through a
      // dialect's core (c7-core's causeOf) until it serves a second dialect (owner decision
      // 2026-11-09). In all three shapes: resolved, bare (a subpath) and a relative escape.
      [ENGINE_CONNECTOR_SRC, ENGINE_CORE_NAME, [ENGINE_CORE_USERS]],
      [
        `${ENGINE_CONNECTOR}/src/lib/core-adapter/contract.ts`,
        ENGINE_CORE_NAME,
        [ENGINE_CORE_USERS],
      ],
      [`${ENGINE_CONNECTOR}/src/core-model.ts`, `${ENGINE_CORE_NAME}/model`, [ENGINE_CORE_USERS]],
      [
        `${ENGINE_CONNECTOR}/src/escape-engine-core.ts`,
        "../../engine-core/src/target.ts",
        [ENGINE_CORE_USERS, DEEP],
      ],
      [BILLING_CONNECTOR_SRC, ENGINE_CORE_NAME, [OWN_FAMILY, ENGINE_CORE_USERS]],
      // The CLI gets it inlined through c7-core and never imports it, until it serves a second
      // dialect.
      [`${CLI}/src/workflow/contract.ts`, ENGINE_CORE_NAME, [HEADLESS, ENGINE_CORE_USERS]],
      [
        `${CLI}/test/support/contract.ts`,
        `${ENGINE_CORE_NAME}/testing`,
        [HEADLESS, ENGINE_CORE_USERS],
      ],
      [
        `${CLI}/src/workflow/escape-engine-core.ts`,
        "../../../../packages/connectors/engine/engine-core/src/target.ts",
        [HEADLESS, ENGINE_CORE_USERS, DEEP],
      ],
      // A package's ./testing entry ships on npm: no test file, so the rule holds it too.
      [`${ENGINE_CONNECTOR}/src/testing/contract.ts`, ENGINE_CORE_NAME, [ENGINE_CORE_USERS]],
      [`${SHELL}/src/testing/contract.ts`, ENGINE_CORE_NAME, [CORE, ENGINE_CORE_USERS]],
      [`${CLI}/src/testing/contract.ts`, ENGINE_CORE_NAME, [HEADLESS, ENGINE_CORE_USERS]],
      // The runtime view: the layers that speak the contract, never its webview, which renders
      // protocol view models, nor a folder beside the layers.
      [`${RUNTIME_VIEW}/src/webview/contract.ts`, ENGINE_CORE_NAME, [ENGINE_CORE_USERS]],
      [`${RUNTIME_VIEW}/src/contract/index.ts`, ENGINE_CORE_NAME, [ENGINE_CORE_USERS]],
      [`${RUNTIME_VIEW}/src/corex/contract.ts`, ENGINE_CORE_NAME, [ENGINE_CORE_USERS]],
      [
        `${RUNTIME_VIEW}/src/webview/escape-contract.ts`,
        "../../../../connectors/engine/engine-core/src/target.ts",
        [VIEW_ENGINE, ENGINE_CORE_USERS, DEEP],
      ],
      // A reader imports the package, never its tree, and no ./testing entry in shipped code.
      [
        `${RUNTIME_VIEW}/src/core/escape-contract.ts`,
        "../../../../connectors/engine/engine-core/src/target.ts",
        [VIEW_ENGINE, DEEP],
      ],
      [`${RUNTIME_VIEW}/src/core/kit.ts`, `${ENGINE_CORE_NAME}/testing`, [NO_TESTING]],
      [`${EXT}/src/host/kit.ts`, `${ENGINE_CORE_NAME}/testing`, [NO_TESTING]],
      [`${ENGINE_ADAPTER}/src/kit.ts`, `${ENGINE_CORE_NAME}/testing`, [NO_TESTING]],
      // Unresolved subpaths (shape 3: dependency-cruiser reads no exports map).
      [
        `${RUNTIME_VIEW}/src/webview/contract-sub.ts`,
        `${ENGINE_CORE_NAME}/model`,
        [ENGINE_CORE_USERS],
      ],
      // Unresolved subpaths (shape 3: dependency-cruiser reads no exports map).
      [`${SHELL}/src/contract-sub.ts`, `${ENGINE_CORE_NAME}/model`, [CORE, ENGINE_CORE_USERS]],
      // Only the test trees of the runtime view and the adapters import it from a module that
      // is no test file: another package's test support reaches it as its src would.
      [`${HTTP}/test/support/contract.ts`, ENGINE_CORE_NAME, [CORE, ENGINE_CORE_USERS]],
      [
        `${ENGINE_CONNECTOR}/test/support/contract.ts`,
        `${ENGINE_CORE_NAME}/testing`,
        [ENGINE_CORE_USERS],
      ],
      [
        `${SERVER}/src/contract-testing.ts`,
        `${ENGINE_CORE_NAME}/testing`,
        [CORE_USERS, ENGINE_CORE_USERS, NO_TESTING],
      ],
      // Allowed: a dialect core's src (family-core-is-a-leaf holds it to the main entry), a
      // family adapter's src, the runtime view's layers that speak the contract, the editor
      // hosts' src (their closed worlds hold them to the main entry), the package's own modules,
      // tests anywhere, and the test trees of the runtime view and the adapters.
      [C7_SRC, ENGINE_CORE_NAME, []],
      [`${ENGINE_ADAPTER}/src/contract.ts`, ENGINE_CORE_NAME, []],
      [`${BILLING_ADAPTER}/src/contract.ts`, ENGINE_CORE_NAME, [], "type"],
      [`${RUNTIME_VIEW}/src/ports/engine-adapter.ts`, ENGINE_CORE_NAME, [], "type"],
      [`${RUNTIME_VIEW}/src/core/contract.ts`, ENGINE_CORE_NAME, []],
      [`${RUNTIME_VIEW}/src/model/contract.ts`, ENGINE_CORE_NAME, []],
      [`${RUNTIME_VIEW}/src/host-kit/contract.ts`, ENGINE_CORE_NAME, []],
      [`${EXT}/src/host/ids.ts`, ENGINE_CORE_NAME, []],
      [`${ORCA}/src/worker/ids.ts`, ENGINE_CORE_NAME, []],
      [`${RUNTIME_VIEW}/test/core/support/fake.ts`, `${ENGINE_CORE_NAME}/testing`, []],
      [`${ENGINE_ADAPTER}/test/support/world.ts`, `${ENGINE_CORE_NAME}/testing`, []],
      [`${BILLING_ADAPTER}/test/support/world.ts`, `${ENGINE_CORE_NAME}/testing`, []],
      [`${ENGINE_CONNECTOR}/src/core-adapter.test.ts`, `${ENGINE_CORE_NAME}/testing`, []],
      [`${C7}/src/cause.test.ts`, `${ENGINE_CORE_NAME}/testing`, []],
      [`${ENGINE_CONNECTOR}/src/contract.test-support.ts`, `${ENGINE_CORE_NAME}/testing`, []],
      [`${ENGINE_CORE}/src/testing/kit.ts`, "../ports.ts", []],
    ],
  },
  {
    rule: CORE_LEAF,
    title:
      "a family core imports only its own modules and engine-core's main entry: no other " +
      "package, no npm module, no built-in",
    cases: [
      [C7_SRC, "@miragon/pulse-c7-client", [CORE_LEAF]],
      // The engine module imports the core, never the other way round.
      [C7_SRC, "@miragon/pulse-engine-connector", [CORE_LEAF]],
      [C7_SRC, BILLING_CORE_NAME, [CORE_LEAF]],
      [C7_SRC, "@miragon/pulse-ui", [CORE_LEAF]],
      [C7_SRC, "@miragon/pulse-widget-shell/server", [CORE_LEAF]],
      [C7_SRC, "@miragon/pulse-cli", [NO_APP, CORE_LEAF]],
      ...[
        "zod",
        "@modelcontextprotocol/server",
        "react",
        "commander",
        "reactive",
        "node:fs",
        "path",
      ].map((spec) => [C7_SRC, spec, [CORE_LEAF]]),
      [`${C7}/src/escape.ts`, "../../../../core/ui/src/target.ts", [CORE_LEAF, DEEP]],
      [`${C7}/src/escape-client.ts`, "../../c7-client/src/target.ts", [CORE_LEAF, DEEP]],
      // The shipped ./testing export is no test file: only *.test.ts may import vitest.
      [`${C7}/src/testing/index.ts`, "vitest", [CORE_LEAF]],
      // Its one edge out: engine-core's main entry, resolved to the build (c7-core) or bare
      // before a build (the billing core, UNLINKED). Never another subpath, its ./testing entry
      // least of all, unresolved or resolved into the build, never a relative escape into its
      // sources or its build, never a look-alike name. A specifier naming the entry's own file is
      // that entry. The dialect core's own ./testing entry ships its fixtures, so
      // engine-core-consumers keeps engine-core out of it, its main entry too.
      [`${C7}/src/cause.ts`, ENGINE_CORE_NAME, []],
      [`${C7}/src/testing/contract.ts`, ENGINE_CORE_NAME, [ENGINE_CORE_USERS]],
      [`${C7}/src/entry-file.ts`, `${ENGINE_CORE_NAME}/dist/index.js`, []],
      [`${C7}/src/kit.ts`, `${ENGINE_CORE_NAME}/testing`, [CORE_LEAF, NO_TESTING]],
      [`${C7}/src/testing/kit.ts`, `${ENGINE_CORE_NAME}/testing`, [CORE_LEAF, ENGINE_CORE_USERS]],
      [`${C7}/src/contract-model.ts`, `${ENGINE_CORE_NAME}/model`, [CORE_LEAF]],
      [
        `${C7}/src/testing/deep-kit.ts`,
        `${ENGINE_CORE_NAME}/dist/testing/index.js`,
        [CORE_LEAF, ENGINE_CORE_USERS],
      ],
      [`${C7}/src/deep-model.ts`, `${ENGINE_CORE_NAME}/dist/model/root-causes.js`, [CORE_LEAF]],
      [`${C7}/src/contract-x.ts`, `${ENGINE_CORE_NAME}x`, [CORE_LEAF]],
      [
        `${C7}/src/escape-contract.ts`,
        "../../../engine/engine-core/src/target.ts",
        [CORE_LEAF, DEEP],
      ],
      [
        `${C7}/src/escape-contract-build.ts`,
        "../../../engine/engine-core/dist/index.js",
        [CORE_LEAF, DEEP],
      ],
      [C7_SRC, "./lib.ts", []],
      [`${C7}/src/a.test.ts`, "vitest", []],
      // Keyed on the role: any family's core is a leaf, by the layout alone. The main entry of
      // engine-core passes the leaf rule here too (bare, shape 3), but only a dialect's core may
      // import it (engine-core-consumers).
      [BILLING_CORE_SRC, "@miragon/pulse-billing-client", [CORE_LEAF]],
      [BILLING_CORE_SRC, "zod", [CORE_LEAF]],
      [BILLING_CORE_SRC, ENGINE_CORE_NAME, [ENGINE_CORE_USERS]],
      [BILLING_CORE_SRC, "./lib.ts", []],
      // engine-core is a family core like any other: no package, no npm module, no built-in.
      [ENGINE_CORE_SRC, "@miragon/pulse-ui", [CORE_LEAF]],
      [ENGINE_CORE_SRC, "@miragon/pulse-widget-shell/server", [CORE_LEAF]],
      [ENGINE_CORE_SRC, PROFILE_NAME, [CORE_LEAF, PROFILE_USERS]],
      [ENGINE_CORE_SRC, HTTP_NAME, [CORE_LEAF, HTTP_USERS]],
      // No dialect below it: a dialect's core implements engine-core, never the other way round.
      [ENGINE_CORE_SRC, C7_CORE, [CORE_LEAF]],
      [ENGINE_CORE_SRC, "@miragon/pulse-c7-client", [CORE_LEAF]],
      [ENGINE_CORE_SRC, "pulse-cockpit", [NO_APP, CORE_LEAF]],
      ...["zod", "react", "preact", "reactive", "node:fs"].map((spec) => [
        ENGINE_CORE_SRC,
        spec,
        [CORE_LEAF],
      ]),
      [`${ENGINE_CORE}/src/escape.ts`, "../../../../core/ui/src/target.ts", [CORE_LEAF, DEEP]],
      // The shipped ./testing export (kit, world, fake) is no test file: no vitest in it.
      [`${ENGINE_CORE}/src/testing/index.ts`, "vitest", [CORE_LEAF]],
      [`${ENGINE_CORE}/src/testing/fake.ts`, "../lib.ts", []],
      [`${ENGINE_CORE}/src/ports.ts`, "./lib.ts", []],
      [`${ENGINE_CORE}/src/a.test.ts`, "vitest", []],
    ],
  },
  {
    rule: CORE_USERS,
    title: "a family core is imported by its family's connector and the apps that bundle it",
    cases: [
      [SERVER_SRC, C7_CORE, [CORE_USERS]],
      [SERVER_SRC, BILLING_CORE_NAME, [CORE_USERS]],
      [
        `${SERVER}/src/escape-core.ts`,
        "../../../packages/connectors/c7/c7-core/src/target.ts",
        [CORE_USERS, DEEP],
      ],
      // The other packages answer to their own rule, each edge to exactly one.
      [BILLING_CONNECTOR_SRC, C7_CORE, [OWN_FAMILY]],
      [ENGINE_CONNECTOR_SRC, BILLING_CORE_NAME, [SPANS]],
      [SHELL_SRC, C7_CORE, [CORE]],
      [SHELL_SRC, BILLING_CORE_NAME, [CORE]],
      [UI_SRC, C7_CORE, [CORE, UI_LEAF]],
      [C7_CLIENT_SRC, C7_CORE, [CLIENT_LEAF]],
      [C7_CLIENT_SRC, `${C7_CORE}/testing`, [CLIENT_LEAF, NO_TESTING]],
      [`${RUNTIME_VIEW}/src/core/c7.ts`, C7_CORE, [VIEW_ENGINE]],
      [EXT_SRC, C7_CORE, [HOSTS]],
      [`${ORCA}/src/worker/a.ts`, C7_CORE, [HOSTS]],
      // The C7 adapter, which still lives in the engine family, runs c7-core (its own
      // node_modules), and its shipped code reaches no ./testing entry.
      [`${ENGINE_ADAPTER}/src/testing.ts`, `${C7_CORE}/testing`, [NO_TESTING]],
      [
        `${ENGINE_ADAPTER}/src/escape-core.ts`,
        "../../../c7/c7-core/src/target.ts",
        [ENGINE_ADAPTER_DIALECT, DEEP],
      ],
      // Allowed: the engine module, which spans the dialect families, the CLI, which bundles
      // c7-core, and the C7 adapter.
      [`${ENGINE_ADAPTER}/src/inspect.ts`, C7_CORE, []],
      [`${ENGINE_ADAPTER}/src/engine-rest/inspect/port.ts`, C7_CORE, [], "type"],
      [ENGINE_CONNECTOR_SRC, C7_CORE, []],
      [BILLING_CONNECTOR_SRC, BILLING_CORE_NAME, []],
      [`${CLI}/src/workflow/inspect.ts`, C7_CORE, []],
      [`${CLI}/src/engine-port/port.ts`, C7_CORE, [], "type"],
      // The types-only rule of the engine port still bites on the new package.
      [`${CLI}/src/engine-port/value.ts`, C7_CORE, [CLI_PORT_TYPES]],
    ],
  },
  {
    rule: ADAPTER_FAMILY,
    title:
      "a family's adapter imports its own family's core and client, engine-core, the runtime " +
      "view and the transport",
    cases: [
      [BILLING_ADAPTER_SRC, "@miragon/pulse-billing-connector", [ADAPTER_FAMILY]],
      [BILLING_ADAPTER_SRC, C7_CORE, [ADAPTER_FAMILY]],
      [BILLING_ADAPTER_SRC, "@miragon/pulse-c7-client", [ADAPTER_FAMILY]],
      [BILLING_ADAPTER_SRC, "@miragon/pulse-widget-shell", [ADAPTER_FAMILY]],
      [BILLING_ADAPTER_SRC, ADAPTER, [ADAPTER_FAMILY]],
      [`${BILLING_ADAPTER}/src/c7-sub.ts`, `${C7_CORE}/routes`, [ADAPTER_FAMILY]],
      [
        `${BILLING_ADAPTER}/src/escape-view.ts`,
        "../../../../core/runtime-view/src/index.ts",
        [ADAPTER_FAMILY, DEEP],
      ],
      // Allowed: its own modules and family, engine-core (the contract it implements), the
      // runtime view (whose ports name the plug it provides), the transport and third-party
      // libraries.
      [BILLING_ADAPTER_SRC, BILLING_CORE_NAME, []],
      [BILLING_ADAPTER_SRC, "@miragon/pulse-billing-client", []],
      [BILLING_ADAPTER_SRC, ENGINE_CORE_NAME, []],
      [`${BILLING_ADAPTER}/src/view.ts`, VIEW, [], "type"],
      [BILLING_ADAPTER_SRC, "./lib.ts", []],
      [BILLING_ADAPTER_SRC, "reactive", []],
    ],
  },
  {
    rule: ENGINE_ADAPTER_DIALECT,
    title:
      "the C7 adapter, still in the engine family, runs c7-core besides what every adapter imports",
    cases: [
      [ADAPTER_SRC, "@miragon/pulse-engine-connector", [ENGINE_ADAPTER_DIALECT]],
      [ADAPTER_SRC, BILLING_CORE_NAME, [ENGINE_ADAPTER_DIALECT]],
      [ADAPTER_SRC, "@miragon/pulse-c7-client", [ENGINE_ADAPTER_DIALECT]],
      [
        `${ENGINE_ADAPTER}/src/client-sub.ts`,
        "@miragon/pulse-c7-client/sdk",
        [ENGINE_ADAPTER_DIALECT],
      ],
      [ADAPTER_SRC, "@miragon/pulse-widget-shell", [ENGINE_ADAPTER_DIALECT]],
      [ADAPTER_SRC, "@miragon/pulse-ui", [ENGINE_ADAPTER_DIALECT]],
      [ADAPTER_SRC, "@miragon/pulse-billing-adapter", [ENGINE_ADAPTER_DIALECT]],
      [
        `${ENGINE_ADAPTER}/src/escape-view.ts`,
        "../../../../core/runtime-view/src/index.ts",
        [ENGINE_ADAPTER_DIALECT, DEEP],
      ],
      // Allowed: its own modules and family, c7-core in every shape a package entry takes (its
      // closed world holds its src to the main entry), engine-core, the runtime view, the
      // transport and third-party libraries.
      [`${ENGINE_ADAPTER}/src/a.ts`, ENGINE_CORE_NAME, []],
      [`${ENGINE_ADAPTER}/src/c7.ts`, C7_CORE, []],
      [`${ENGINE_ADAPTER}/src/routes.ts`, `${C7_CORE}/routes`, []],
      [`${ENGINE_ADAPTER}/test/support/inspect.ts`, `${C7_CORE}/testing`, []],
      [`${ENGINE_ADAPTER}/src/ports.ts`, `${VIEW}/ports`, [], "type"],
      [ADAPTER_SRC, "./lib.ts", []],
      [ADAPTER_SRC, "reactive", []],
    ],
  },
  {
    rule: VIEW_USERS,
    title:
      "the runtime view is composed by the editor hosts and implemented by the family adapters",
    cases: [
      [SERVER_SRC, VIEW, [VIEW_USERS]],
      [CLI_SRC, `${VIEW}/ports`, [HEADLESS, VIEW_USERS]],
      [ENGINE_CONNECTOR_SRC, VIEW, [VIEW_USERS]],
      [SHELL_SRC, VIEW, [VIEW_USERS]],
      [
        `${SERVER}/src/escape-view.ts`,
        "../../../packages/core/runtime-view/src/index.ts",
        [VIEW_USERS, DEEP],
      ],
      [
        `${EXT}/src/host/escape-view.ts`,
        "../../../../packages/core/runtime-view/src/index.ts",
        [DEEP],
      ],
      // Allowed: the editor hosts, the adapters and the runtime view's own modules.
      [`${EXT}/src/host/b.ts`, `${VIEW}/core`, []],
      [ORCA_SRC, `${VIEW}/host-kit`, []],
      [`${BILLING_ADAPTER}/src/ports.ts`, `${VIEW}/ports`, [], "type"],
      [VIEW_SRC, "./lib.ts", []],
    ],
  },
  {
    rule: ADAPTER_USERS,
    title: "a family's adapter is bundled by the editor hosts alone",
    cases: [
      [SERVER_SRC, ADAPTER, [ADAPTER_USERS]],
      [`${CLI}/src/workflow/adapter.ts`, ADAPTER, [HEADLESS, ADAPTER_USERS]],
      [ENGINE_CONNECTOR_SRC, ADAPTER, [ADAPTER_USERS]],
      [VIEW_SRC, ADAPTER, [VIEW_ENGINE, ADAPTER_USERS]],
      [`${SERVER}/src/adapter-sub.ts`, `${ADAPTER}/sub`, [ADAPTER_USERS]],
      [
        `${SERVER}/src/escape-adapter.ts`,
        "../../../packages/connectors/engine/engine-adapter/src/index.ts",
        [ADAPTER_USERS, DEEP],
      ],
      [
        `${ORCA}/src/worker/escape-adapter.ts`,
        "../../../../packages/connectors/engine/engine-adapter/src/index.ts",
        [DEEP],
      ],
      // Allowed: the editor hosts' composition roots.
      [`${EXT}/src/host/composition-root.ts`, ADAPTER, []],
      [`${ORCA}/src/worker/composition-root.ts`, ADAPTER, []],
    ],
  },
  {
    rule: VIEW_ENGINE,
    title:
      "the runtime view builds on the engine contract: engine-core by its entries, no other " +
      "family's package",
    cases: [
      [VIEW_SRC, "@miragon/pulse-engine-connector", [VIEW_ENGINE]],
      [VIEW_SRC, "@miragon/pulse-c7-client", [VIEW_ENGINE]],
      [`${RUNTIME_VIEW}/src/core/billing.ts`, BILLING_CORE_NAME, [VIEW_ENGINE]],
      [`${RUNTIME_VIEW}/src/host-kit/c7-sub.ts`, `${C7_CORE}/routes`, [VIEW_ENGINE]],
      [
        `${RUNTIME_VIEW}/src/core/escape-c7.ts`,
        "../../../../connectors/c7/c7-core/src/target.ts",
        [VIEW_ENGINE, DEEP],
      ],
      [
        `${RUNTIME_VIEW}/src/model/escape-build.ts`,
        "../../../../connectors/engine/engine-core/dist/index.js",
        [VIEW_ENGINE, DEEP],
      ],
      // Allowed: engine-core's main entry in a layer that speaks it, its ./testing entry in the
      // tests, and the foundation siblings.
      [`${RUNTIME_VIEW}/src/host-kit/engine.ts`, ENGINE_CORE_NAME, [], "type"],
      [`${RUNTIME_VIEW}/test/core/kit.ts`, `${ENGINE_CORE_NAME}/testing`, []],
      [`${RUNTIME_VIEW}/src/core/tones.ts`, "@miragon/pulse-ui/tones", [], "type"],
    ],
  },
  {
    rule: HOSTS,
    title:
      "the editor hosts import engine-core alone of the family cores, and reach a dialect " +
      "through its adapter",
    cases: [
      [`${ORCA}/src/worker/billing.ts`, BILLING_CORE_NAME, [HOSTS]],
      [`${EXT}/src/host/c7-sub.ts`, `${C7_CORE}/routes`, [HOSTS]],
      [
        `${EXT}/src/host/escape-core.ts`,
        "../../../../packages/connectors/c7/c7-core/src/target.ts",
        [HOSTS, DEEP],
      ],
      // Not engine-core by path either: its package entry only.
      [
        `${ORCA}/src/worker/escape-contract.ts`,
        "../../../../packages/connectors/engine/engine-core/src/target.ts",
        [HOSTS, DEEP],
      ],
      // Allowed: engine-core's entry, and the adapter in the composition root.
      [`${ORCA}/src/worker/contract.ts`, ENGINE_CORE_NAME, [], "type"],
      [`${EXT}/src/host/contract-sub.ts`, `${ENGINE_CORE_NAME}/model`, []],
    ],
  },
  {
    rule: CLI_CORE_LAYERS,
    title:
      "in the CLI only the workflow and engine-port layers, the two rule modules of operation (and tests) import the core",
    cases: [
      [CLI_SRC, C7_CORE, [CLI_CORE_LAYERS]],
      // operation/ applies the core's date reading and auto typing in exactly two modules.
      [`${CLI}/src/operation/dates.ts`, C7_CORE, []],
      [`${CLI}/src/operation/variables.ts`, C7_CORE, []],
      [`${CLI}/src/operation/values.ts`, C7_CORE, [CLI_CORE_LAYERS]],
      [`${CLI}/src/operation/dates.test-support.ts`, C7_CORE, [CLI_CORE_LAYERS]],
      [`${CLI}/src/operation/dates-other.ts`, C7_CORE, [CLI_CORE_LAYERS]],
      [`${CLI}/src/operation/sub/dates.ts`, C7_CORE, [CLI_CORE_LAYERS]],
      [`${CLI}/src/cli/target-core.ts`, C7_CORE, [CLI_CORE_LAYERS]],
      [`${CLI}/scripts/core.ts`, C7_CORE, [CLI_CORE_LAYERS]],
      [CLI_SRC, `${C7_CORE}/testing`, [CLI_CORE_LAYERS, NO_TESTING]],
      // Another family's core is cli-is-headless's alone.
      [`${CLI}/src/cli/other-core.ts`, BILLING_CORE_NAME, [HEADLESS]],
      [`${CLI}/src/f.test.ts`, C7_CORE, []],
    ],
  },
  {
    rule: NO_TESTING,
    title: "shipped code imports no ./testing entry, a package's own src/testing included",
    cases: [
      [`${CLI}/src/workflow/fixture.ts`, `${C7_CORE}/testing`, [NO_TESTING]],
      [
        `${ENGINE_CONNECTOR}/src/lib/core-adapter/composites.ts`,
        `${C7_CORE}/testing`,
        [NO_TESTING],
      ],
      [ENGINE_CONNECTOR_SRC, `${C7_CORE}/testing`, [NO_TESTING]],
      // pulse-ui/testing reads files and parses TypeScript: no shipped module imports it.
      [`${SHELL}/src/ui/brand.ts`, "@miragon/pulse-ui/testing", [NO_TESTING]],
      [`${SERVER}/src/ui/brand.ts`, "@miragon/pulse-ui/testing", [NO_TESTING]],
      [`${BILLING_CONNECTOR}/src/widgets/brand.ts`, "@miragon/pulse-ui/testing", [NO_TESTING]],
      [`${EXT}/src/brand.ts`, "@miragon/pulse-ui/testing", [NO_TESTING]],
      // A package's own testing tree, by relative path.
      [C7_SRC, "./testing/fixture.ts", [NO_TESTING]],
      [`${C7}/src/inspect.ts`, "./testing/fixture.ts", [NO_TESTING], "type"],
      [`${UI}/src/kit/scan.ts`, "../testing/glyphs.ts", [NO_TESTING]],
      // test-support may import ./testing, so shipped code may not import test-support.
      [`${CLI}/src/workflow/support.ts`, "./test-support/fixture.ts", [NO_TESTING]],
      // From a lib folder it is an edge up into src/tools as well.
      [
        `${ENGINE_CONNECTOR}/src/lib/engine/x.ts`,
        "../../tools/test-support/fake-engine.ts",
        [NO_TESTING, POINT_DOWN],
      ],
      [`${SHELL}/src/boot.ts`, "./composition.test-support.ts", [NO_TESTING]],
      [`${CLI}/src/workflow/test-support/fixture.ts`, `${C7_CORE}/testing`, []],
      // A test file of its own tree is cli-not-to-test's.
      [`${C7}/src/to-test.ts`, "./a.test.ts", [CLI_NOT_TEST]],
      // Anchored: a look-alike subpath is no ./testing entry.
      [`${SHELL}/src/ui/kit.ts`, "@miragon/pulse-ui/testing-kit", []],
      // Allowed: tests, their test-support, test/ trees and a ./testing entry itself.
      [`${CLI}/test/support/fixture.ts`, `${C7_CORE}/testing`, []],
      [
        `${ENGINE_CONNECTOR}/src/lib/core-adapter/composites.wire.test.ts`,
        `${C7_CORE}/testing`,
        [],
      ],
      [`${ENGINE_CONNECTOR}/src/tools/test-support/fake-engine.ts`, `${C7_CORE}/testing`, []],
      [`${SHELL}/src/testing/glossary.ts`, "@miragon/pulse-ui/testing", []],
      [`${SHELL}/src/composition.test-support.ts`, "@miragon/pulse-ui/testing", []],
      [`${SERVER}/src/brand.test.ts`, "@miragon/pulse-ui/testing", []],
      [`${UI}/src/testing/index.ts`, "./glyphs.ts", []],
      [`${C7}/src/testing/routes.ts`, "./fixture.ts", []],
      [`${C7}/src/testing/port.ts`, "../lib.ts", []],
      [`${C7}/src/b.test.ts`, "./testing/fixture.ts", []],
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
      [SERVER_SRC, "@miragon/pulse-billing-connector", []],
      [SERVER_SRC, "react", []],
      [SERVER_SRC, "zod", []],
      [SERVER_SRC, "@modelcontextprotocol/server", []],
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
        `${C7_CLIENT}/src/escape-app.ts`,
        "../../../../../apps/mcp-server/src/target.ts",
        [NO_APP, DEEP],
      ],
      [SHELL_SRC, "pulse-cockpit", [NO_APP]],
      [UI_SRC, "pulse-cockpit", [NO_APP]],
      [C7_CLIENT_SRC, "pulse-cockpit", [NO_APP]],
      [C7_CLIENT_SRC, "@miragon/pulse-mcp-server", [CLIENT_LEAF, NO_APP]],
      [ENGINE_CONNECTOR_SRC, "@miragon/pulse-mcp-server", [NO_APP]],
      [ENGINE_CONNECTOR_SRC, "@miragon/pulse-cli", [NO_APP]],
      [ENGINE_CONNECTOR_SRC, "pulse-cockpit", [NO_APP]],
      // A package named like the server is no app.
      [ENGINE_CONNECTOR_SRC, "@miragon/pulse-mcp-server-kit", []],
      // A package's tests (its test/ folder, cruised since engine-core's left the extension's
      // closed world) reach no app and no other package's sources either; their own package's
      // sources, its ./testing tree and their runner are theirs.
      [
        `${ENGINE_CORE}/test/escape-app.test.ts`,
        "../../../../../apps/mcp-server/src/target.ts",
        [NO_APP, DEEP],
      ],
      [`${ENGINE_CORE}/test/support/escape.ts`, "../../../../c7/c7-core/src/target.ts", [DEEP]],
      [`${ENGINE_CORE}/test/kit.test.ts`, "../src/index.ts", []],
      [`${ENGINE_CORE}/test/support/harness.ts`, "../../src/testing/index.ts", []],
      [`${ENGINE_CORE}/test/support/harness.ts`, "vitest", []],
      [`${HTTP}/test/escape-app.ts`, "../../../../apps/mcp-server/src/target.ts", [NO_APP, DEEP]],
      [`${PROFILE}/test/escape.test.ts`, "../../ui/src/target.ts", [DEEP]],
      // A connector package's scripts/ (c7-core's spec and route generator) likewise: no app,
      // no other package's sources, its own package's sources are its own.
      [`${C7}/scripts/escape-app.ts`, "../../../../../apps/cli/scripts/target.ts", [NO_APP, DEEP]],
      [`${C7}/scripts/escape.ts`, "../../c7-client/src/target.ts", [DEEP]],
      [`${C7}/scripts/generate.ts`, "../src/target.ts", []],
    ],
  },
  {
    rule: CORE,
    title: "packages/core reaches up into no connector, client or app",
    cases: [
      [SHELL_SRC, "@miragon/pulse-engine-connector", [CORE]],
      [SHELL_SRC, "@miragon/pulse-billing-client", [CORE]],
      // React and the kit are the view half's (the server half is widget-shell-server-headless's).
      [`${SHELL}/src/ui/view.ts`, "react", []],
      [SHELL_SRC, "zod", []],
      [SHELL_SRC, "@modelcontextprotocol/server", []],
      [SHELL_SRC, "hono", []],
      [`${SHELL}/src/ui/view.ts`, "@miragon/pulse-ui", []],
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
      [UI_SRC, "@miragon/pulse-billing-client", [CORE, UI_LEAF]],
      // A scoped app name is a workspace package name as well: the leaf rule bites with the app rule.
      [UI_SRC, "@miragon/pulse-mcp-server", [NO_APP, UI_LEAF]],
      ...[
        "@modelcontextprotocol/server",
        "@modelcontextprotocol/ext-apps/server",
        "hono",
        "jose",
        "@tanstack/react-query",
        "zod",
        "prom-client",
        "bpmn-js",
      ].map((spec) => [UI_SRC, spec, [UI_LEAF]]),
      // The MCP Apps runtime is the host adapter's rule as well.
      [UI_SRC, "@modelcontextprotocol/ext-apps", [UI_LEAF, EXT_APPS]],
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
    rule: UI_FOUNDATION,
    title: "pulse-ui's framework-free entries import only their own folder",
    cases: [
      // React and the kit's own libraries are the kit's, never its foundation's; nor a built-in.
      ...["react", "lucide-react", "radix-ui", "tailwind-merge", "node:fs"].map((spec) => [
        `${UI}/src/tones/to-npm.ts`,
        spec,
        [UI_FOUNDATION],
      ]),
      // Another file of the kit, at runtime or for a type, its ./testing tree too.
      [`${UI}/src/tones/to-kit.ts`, "../lib.ts", [UI_FOUNDATION]],
      [`${UI}/src/tones/to-kit-type.ts`, "../lib.ts", [UI_FOUNDATION], "type"],
      [`${UI}/src/tones/to-testing.ts`, "../testing/glyphs.ts", [NO_TESTING, UI_FOUNDATION]],
      // Each entry only its own folder: the formatters never reach into the tones, nor back.
      [`${UI}/src/format/to-tones.ts`, "../tones/situations.ts", [UI_FOUNDATION]],
      [`${UI}/src/tones/to-format.ts`, "../format/numbers.ts", [UI_FOUNDATION]],
      [`${UI}/src/format/to-kit.ts`, "../lib.ts", [UI_FOUNDATION]],
      ...["react", "node:fs"].map((spec) => [`${UI}/src/format/to-npm.ts`, spec, [UI_FOUNDATION]]),
      // A workspace package: the leaf rule bites as well.
      [`${UI}/src/tones/to-shell.ts`, "@miragon/pulse-widget-shell", [UI_FOUNDATION, UI_LEAF]],
      [
        `${UI}/src/tones/escape.ts`,
        "../../../widget-shell/src/target.ts",
        [DEEP, UI_FOUNDATION, UI_LEAF],
      ],
      // Allowed: its own folder, its tests; the kit imports it, and so does the extension.
      [`${UI}/src/tones/index.ts`, "./situations.ts", []],
      [`${UI}/src/tones/situations.test.ts`, "vitest", []],
      [`${UI}/src/lib/tone-utils.ts`, "../tones/situations.ts", []],
      [UI_SRC, "./tones/situations.ts", []],
      [`${RUNTIME_VIEW}/src/webview/tone.ts`, "@miragon/pulse-ui/tones", []],
      [`${RUNTIME_VIEW}/src/core/tone.ts`, "@miragon/pulse-ui/tones", [], "type"],
      [`${UI}/src/format/duration.ts`, "./numbers.ts", []],
      [`${UI}/src/format/format.test.ts`, "vitest", []],
      [`${UI}/src/kit/log-text.tsx`, "../format/numbers.ts", []],
      [UI_SRC, "./format/numbers.ts", []],
      [`${RUNTIME_VIEW}/src/webview/format/time-labels.ts`, "@miragon/pulse-ui/format", []],
      [`${RUNTIME_VIEW}/src/core/views/labels.ts`, "@miragon/pulse-ui/format", []],
    ],
  },
  {
    rule: SHELL_VIEWS,
    title: "widget-shell's view half imports only itself, the protocol and the view stack",
    cases: [
      // The server half, by path, at runtime or for a type.
      [`${SHELL}/src/ui/to-server.ts`, "../composed-server.ts", [SHELL_VIEWS]],
      [`${SHELL}/src/ui/to-server-type.ts`, "../tool-registrar.ts", [SHELL_VIEWS], "type"],
      [`${SHELL}/src/ui/to-server-dynamic.ts`, "../composed-server.ts", [SHELL_VIEWS], "dynamic"],
      [`${SHELL}/src/ui/deep/to-server.ts`, "../../tool-registrar.ts", [SHELL_VIEWS]],
      // Its own `/server` entry, Node built-ins and the server packages.
      ...[
        "@miragon/pulse-widget-shell/server",
        "node:fs",
        "@modelcontextprotocol/server",
        "@modelcontextprotocol/node",
        // ext-apps' server half is server code, not the view stack's runtime.
        "@modelcontextprotocol/ext-apps/server",
        "hono",
        "jose",
        "prom-client",
        "zod",
        "commander",
        // Anchored: a look-alike of an allowed name is no view-stack package.
        "reactive",
      ].map((spec) => [`${SHELL}/src/ui/server-stack.ts`, spec, [SHELL_VIEWS]]),
      [`${SHELL}/src/ui/to-connector.ts`, "@miragon/pulse-engine-connector", [CORE, SHELL_VIEWS]],
      [`${SHELL}/src/ui/to-testing.ts`, "../testing/glossary.ts", [NO_TESTING, SHELL_VIEWS]],
      // Allowed: its own modules, the protocol and the view stack.
      [`${SHELL}/src/ui/view.ts`, "./lib.ts", []],
      [`${SHELL}/src/ui/view.ts`, "../protocol/tool-result.ts", []],
      [`${SHELL}/src/ui/view-type.ts`, "../protocol/view-name.ts", [], "type"],
      ...[
        "react-dom/client",
        "lucide-react",
        "@tanstack/react-query",
        "bpmn-js/lib/NavigatedViewer",
        "diagram-js",
      ].map((spec) => [`${SHELL}/src/ui/view.ts`, spec, []]),
      // The MCP Apps runtime is view stack, in the host adapter alone.
      [`${SHELL}/src/ui/view-runtime.ts`, "@modelcontextprotocol/ext-apps", []],
      // Tests and test-support run in Node: exempt.
      [`${SHELL}/src/ui/brand.test.ts`, "node:fs", []],
      [`${SHELL}/src/ui/view.test.tsx`, "../composed-server.ts", []],
      [`${SHELL}/src/ui/host.test-support.ts`, "@modelcontextprotocol/server", []],
    ],
  },
  {
    rule: SHELL_HEADLESS,
    title: "widget-shell's server half never imports the view half or React",
    cases: [
      [`${SHELL}/src/boot.ts`, "./ui/target.ts", [SHELL_HEADLESS]],
      [`${SHELL}/src/boot-type.ts`, "./ui/lib.ts", [SHELL_HEADLESS], "type"],
      [`${SHELL}/src/boot-dynamic.ts`, "./ui/target.ts", [SHELL_HEADLESS], "dynamic"],
      [`${SHELL}/src/testing-free/nested.ts`, "../ui/target.ts", [SHELL_HEADLESS]],
      ...[
        "react",
        "react-dom/server",
        "lucide-react",
        "@tanstack/react-query",
        "@miragon/pulse-ui",
        "bpmn-js",
        "diagram-js",
      ].map((spec) => [`${SHELL}/src/view-stack.ts`, spec, [SHELL_HEADLESS]]),
      // The MCP Apps runtime is view stack (and the host adapter's rule).
      ...[
        "@modelcontextprotocol/ext-apps",
        "@modelcontextprotocol/ext-apps/react",
        "@modelcontextprotocol/ext-apps/app-bridge",
      ].map((spec) => [`${SHELL}/src/view-stack.ts`, spec, [SHELL_HEADLESS, EXT_APPS]]),
      [`${SHELL}/src/view-stack.ts`, "@miragon/pulse-ui/testing", [NO_TESTING, SHELL_HEADLESS]],
      // Allowed: the protocol, the server stack, Node built-ins; the server's own modules.
      [`${SHELL}/src/server-entry.ts`, "./protocol/tool-result.ts", []],
      [`${SHELL}/src/server-entry.ts`, "./composed-server.ts", []],
      ...[
        "@modelcontextprotocol/server",
        "@modelcontextprotocol/node",
        "@modelcontextprotocol/ext-apps/server",
        "hono",
        "jose",
      ].map((spec) => [`${SHELL}/src/server-entry.ts`, spec, []]),
      [`${SHELL}/src/server-entry.ts`, "prom-client", []],
      [`${SHELL}/src/server-entry.ts`, "node:http", []],
      // Look-alikes of the view stack are none of it.
      [`${SHELL}/src/server-entry.ts`, "reactive", []],
      // Tests, test-support and the ./testing entry are exempt.
      [`${SHELL}/src/fonts.test.ts`, "@miragon/pulse-ui", []],
      [`${SHELL}/src/brand.test.ts`, "./ui/target.ts", []],
      [`${SHELL}/src/composition.test-support.ts`, "react", []],
      [`${SHELL}/src/testing/glossary.ts`, "react", []],
    ],
  },
  {
    rule: SHELL_PROTOCOL,
    title: "widget-shell's protocol imports nothing but itself",
    cases: [
      // Either half, by path, at runtime or for a type.
      [`${SHELL}/src/protocol/to-server.ts`, "../composed-server.ts", [SHELL_PROTOCOL]],
      [`${SHELL}/src/protocol/to-views.ts`, "../ui/target.ts", [SHELL_PROTOCOL]],
      [`${SHELL}/src/protocol/to-views-type.ts`, "../ui/lib.ts", [SHELL_PROTOCOL], "type"],
      // Any npm package (the view stack and the server stack alike) and any Node built-in.
      ...["react", "@miragon/pulse-ui", "@modelcontextprotocol/server", "zod", "node:crypto"].map(
        (spec) => [`${SHELL}/src/protocol/to-npm.ts`, spec, [SHELL_PROTOCOL]],
      ),
      // Neither half's rule fires on the protocol: each rule has one subject.
      [`${SHELL}/src/protocol/to-mcp-server.ts`, "@modelcontextprotocol/server", [SHELL_PROTOCOL]],
      // Allowed: another protocol module.
      [`${SHELL}/src/protocol/tool-result-reader.ts`, "./view-name.ts", []],
      // Its tests run in Node: exempt.
      [`${SHELL}/src/protocol/tool-result.test.ts`, "node:fs", []],
    ],
  },
  {
    rule: EXT_APPS,
    title: "only widget-shell's host adapter imports the MCP Apps runtime, in any form",
    cases: [
      // A connector's widgets: the view-stack allowlist lets the runtime through, this rule not.
      ...[
        "@modelcontextprotocol/ext-apps",
        "@modelcontextprotocol/ext-apps/react",
        "@modelcontextprotocol/ext-apps/app-bridge",
      ].map((spec) => [`${ENGINE_CONNECTOR}/src/widgets/host.tsx`, spec, [EXT_APPS]]),
      // What ESLint's no-restricted-imports does not see: a dynamic import(); and a type alone.
      [
        `${BILLING_CONNECTOR}/src/widgets/dynamic-host.tsx`,
        "@modelcontextprotocol/ext-apps",
        [EXT_APPS],
        "dynamic",
      ],
      [
        `${BILLING_CONNECTOR}/src/widgets/host-type.ts`,
        "@modelcontextprotocol/ext-apps",
        [EXT_APPS],
        "type",
      ],
      // The rest of widget-shell's view half, its tests and the server app's host bundle.
      [`${SHELL}/src/ui/view-host.tsx`, "@modelcontextprotocol/ext-apps", [EXT_APPS]],
      [`${SHELL}/src/ui/view-root.test.tsx`, "@modelcontextprotocol/ext-apps", [EXT_APPS]],
      [`${SERVER}/src/ui/main.tsx`, "@modelcontextprotocol/ext-apps/react", [EXT_APPS]],
      // Allowed: the adapter, in any form.
      [`${SHELL}/src/ui/view-runtime.ts`, "@modelcontextprotocol/ext-apps/app-with-deps", []],
      [`${SHELL}/src/ui/ext-apps-host.tsx`, "@modelcontextprotocol/ext-apps", [], "type"],
      [`${SHELL}/src/ui/view-root.tsx`, "@modelcontextprotocol/ext-apps", [], "dynamic"],
      // Allowed: ext-apps' server half where server code runs, and a look-alike package.
      [
        `${ENGINE_CONNECTOR}/src/widget-tools/cockpit.ts`,
        "@modelcontextprotocol/ext-apps/server",
        [],
      ],
      [`${SHELL}/src/view-resource.ts`, "@modelcontextprotocol/ext-apps/server", []],
      [SERVER_SRC, "@modelcontextprotocol/ext-apps-extra", []],
    ],
  },
  {
    rule: WIDGETS_BROWSER,
    title:
      "a connector's widgets and its src/lib/shared import only browser code at runtime (an allowlist)",
    cases: [
      ...[
        "../tools/target.ts",
        "../data/target.ts",
        "../widget-tools/target.ts",
        "../widget-tools.ts",
        "../plugin.ts",
        "../module.ts",
        "../feed-contracts.ts",
        // Server modules no directory names: the package root, the instructions, the providers.
        "../index.ts",
        "../instructions.ts",
        "../engine-provider.ts",
        "../providers/target.ts",
        "@miragon/pulse-c7-client",
        "@miragon/pulse-c7-client/sdk",
        "@miragon/pulse-widget-shell/server",
        // Server packages and Node built-ins.
        "@modelcontextprotocol/server",
        "@modelcontextprotocol/ext-apps/server",
        "hono",
        "zod",
        "node:fs",
        // Anchored: a look-alike of an allowed name is no view-stack package.
        "reactive",
      ].map((spec) => [`${ENGINE_CONNECTOR}/src/widgets/server-code.tsx`, spec, [WIDGETS_BROWSER]]),
      [`${ENGINE_CONNECTOR}/src/widgets/nested/deep.ts`, "../../data/target.ts", [WIDGETS_BROWSER]],
      [
        `${ENGINE_CONNECTOR}/src/widgets/dynamic.ts`,
        "../tools/target.ts",
        [WIDGETS_BROWSER],
        "dynamic",
      ],
      [
        `${ENGINE_CONNECTOR}/src/widgets/escape-client.ts`,
        "../../../../c7/c7-client/src/target.ts",
        [DEEP, WIDGETS_BROWSER],
      ],
      [
        `${ENGINE_CONNECTOR}/src/widgets/escape-shell.ts`,
        "../../../../../core/widget-shell/src/composed-server.ts",
        [DEEP, WIDGETS_BROWSER],
      ],
      [`${BILLING_CONNECTOR}/src/widgets/server-code.tsx`, "../tools/target.ts", [WIDGETS_BROWSER]],
      [
        `${BILLING_CONNECTOR}/src/widgets/server-code.tsx`,
        "@miragon/pulse-billing-client",
        [WIDGETS_BROWSER],
      ],
      [`${BILLING_CONNECTOR}/src/widgets/server-code.tsx`, "../instructions.ts", [WIDGETS_BROWSER]],
      [`${BILLING_CONNECTOR}/src/widgets/server-code.tsx`, "../summary.ts", [WIDGETS_BROWSER]],
      // No file is exempt by name any more: the shared folder is every connector's, by role.
      [`${BILLING_CONNECTOR}/src/widgets/view.tsx`, "../lib/shared/environments.ts", []],
      // Another family's client is no browser code either (and connectors-own-their-family's).
      [
        `${BILLING_CONNECTOR}/src/widgets/engine-sdk.ts`,
        "@miragon/pulse-c7-client",
        [OWN_FAMILY, WIDGETS_BROWSER],
      ],
      // Allowed: type-only edges to the server side (view-model and feed types).
      ...[
        "../tools/target.ts",
        "../data/target.ts",
        "../feed-contracts.ts",
        "@miragon/pulse-c7-client",
      ].map((spec) => [`${ENGINE_CONNECTOR}/src/widgets/types.ts`, spec, [], "type"]),
      [`${BILLING_CONNECTOR}/src/widgets/types.ts`, "@miragon/pulse-billing-client", [], "type"],
      // Allowed at runtime: the widgets' own modules, the shared words, names and view models, the
      // shared lib folder, widget-shell's view half and the view stack.
      ...[
        "./lib/engine-action.ts",
        "../view-models.ts",
        "../view-models.health.ts",
        "../tool-names.ts",
        "../messages/use-t.ts",
        "../lib/shared/environments.ts",
        "@miragon/pulse-widget-shell/widgets",
        "@miragon/pulse-ui",
        "react",
        "react-dom/client",
        "lucide-react",
        "@tanstack/react-query",
      ].map((spec) => [`${ENGINE_CONNECTOR}/src/widgets/view.tsx`, spec, []]),
      [`${BILLING_CONNECTOR}/src/widgets/view.tsx`, "../bpmn-names.ts", []],
      // Tests and their test-support boot the plugin and fake the engine: exempt.
      [`${ENGINE_CONNECTOR}/src/widgets/views.test.tsx`, "../plugin.ts", []],
      [
        `${ENGINE_CONNECTOR}/src/widgets/lib/hand-off.test-support.ts`,
        "../../tools/test-support/fake-engine.ts",
        [],
      ],
      // src/lib/shared is held to the same allowlist: what it imports reaches every view bundle.
      ...[
        "../engine/with-engine.ts",
        "../../data/target.ts",
        "@miragon/pulse-c7-client",
        "@miragon/pulse-widget-shell/server",
        "zod",
        "node:fs",
      ].map((spec) => [`${ENGINE_CONNECTOR}/src/lib/shared/leak.ts`, spec, [WIDGETS_BROWSER]]),
      // The connector's root is server code above the lib folders: both rules.
      [
        `${ENGINE_CONNECTOR}/src/lib/shared/leak.ts`,
        "../../plugin.ts",
        [POINT_DOWN, WIDGETS_BROWSER],
      ],
      [`${ENGINE_CONNECTOR}/src/lib/shared/types.ts`, "../engine/with-engine.ts", [], "type"],
      ...[
        "./task-completion.ts",
        "../../tool-names.ts",
        "../../messages/use-t.ts",
        "@miragon/pulse-widget-shell/widgets",
        "react",
      ].map((spec) => [`${ENGINE_CONNECTOR}/src/lib/shared/fine.ts`, spec, []]),
      [`${ENGINE_CONNECTOR}/src/lib/shared/environments.test.ts`, "vitest", []],
      // The server side imports its own server code freely.
      [`${ENGINE_CONNECTOR}/src/widget-tools/cockpit.ts`, "../data/target.ts", []],
      [`${ENGINE_CONNECTOR}/src/tools/engines.ts`, "../lib/shared/environments.ts", []],
    ],
  },
  {
    rule: WIDGETS_SHARED_LIB,
    title: "of a connector's lib folders its widgets import only src/lib/shared, types included",
    cases: [
      ...[
        "../lib/engine/with-engine.ts",
        "../lib/mcp/toolsets.ts",
        "../lib/core-adapter/composites.ts",
      ].map((spec) => [
        `${ENGINE_CONNECTOR}/src/widgets/server-types.ts`,
        spec,
        [WIDGETS_SHARED_LIB],
        "type",
      ]),
      // At runtime it is server code as well.
      [
        `${ENGINE_CONNECTOR}/src/widgets/server-lib.ts`,
        "../lib/engine/with-engine.ts",
        [WIDGETS_BROWSER, WIDGETS_SHARED_LIB],
      ],
      [
        `${ENGINE_CONNECTOR}/src/widgets/nested/deep-lib.ts`,
        "../../lib/mcp/toolsets.ts",
        [WIDGETS_BROWSER, WIDGETS_SHARED_LIB],
        "dynamic",
      ],
      // Anchored on the folder: a look-alike of shared/ is no shared folder.
      [
        `${ENGINE_CONNECTOR}/src/widgets/look-alike.ts`,
        "../lib/shared-server/target.ts",
        [WIDGETS_BROWSER, WIDGETS_SHARED_LIB],
      ],
      // Keyed on the role: any connector's widgets.
      [
        `${BILLING_CONNECTOR}/src/widgets/server-lib.ts`,
        "../lib/engine/target.ts",
        [WIDGETS_BROWSER, WIDGETS_SHARED_LIB],
      ],
      // Allowed: the shared folder, at runtime and as a type.
      [
        `${ENGINE_CONNECTOR}/src/widgets/shared-types.ts`,
        "../lib/shared/task-completion.ts",
        [],
        "type",
      ],
      [`${ENGINE_CONNECTOR}/src/widgets/shared-lib.ts`, "../lib/shared/environments.ts", []],
      // Tests and their test-support read the toolsets to render each surface: exempt.
      [`${ENGINE_CONNECTOR}/src/widgets/remediation.test.ts`, "../lib/mcp/toolsets.ts", [], "type"],
      [
        `${ENGINE_CONNECTOR}/src/widgets/lib/hand-off.test-support.ts`,
        "../../lib/mcp/toolsets.ts",
        [],
        "type",
      ],
    ],
  },
  {
    rule: POINT_DOWN,
    title:
      "a connector's data builders and lib folders never import its tools, widget tools or widgets",
    cases: [
      ...[
        "../tools/target.ts",
        "../widget-tools/target.ts",
        "../widget-tools.ts",
        "../widgets/lib/engine-action.ts",
      ].map((spec) => [`${ENGINE_CONNECTOR}/src/data/up.ts`, spec, [POINT_DOWN]]),
      ...["../../tools/target.ts", "../../widget-tools/target.ts", "../../widget-tools.ts"].map(
        (spec) => [`${ENGINE_CONNECTOR}/src/lib/bpmn/up.ts`, spec, [POINT_DOWN]],
      ),
      // A type is an edge up too, and so is a lazy import.
      [`${ENGINE_CONNECTOR}/src/data/up-types.ts`, "../tools/target.ts", [POINT_DOWN], "type"],
      [`${ENGINE_CONNECTOR}/src/data/up-lazy.ts`, "../tools/target.ts", [POINT_DOWN], "dynamic"],
      [
        `${ENGINE_CONNECTOR}/src/lib/shared/up.ts`,
        "../../widgets/lib/engine-action.ts",
        [POINT_DOWN],
      ],
      // Its root registers every tool: by relative path ...
      [`${ENGINE_CONNECTOR}/src/data/root-up.ts`, "../plugin.ts", [POINT_DOWN]],
      [`${ENGINE_CONNECTOR}/src/data/root-up.ts`, "../module.ts", [POINT_DOWN]],
      [`${ENGINE_CONNECTOR}/src/lib/engine/root-up.ts`, "../../index.ts", [POINT_DOWN]],
      [`${BILLING_CONNECTOR}/src/lib/engine/root-up.ts`, "../../plugin.ts", [POINT_DOWN]],
      // ... and by the connector's own npm name, which reaches its root and its widgets.
      [`${ENGINE_CONNECTOR}/src/data/self.ts`, "@miragon/pulse-engine-connector", [POINT_DOWN]],
      [
        `${ENGINE_CONNECTOR}/src/lib/mcp/self.ts`,
        "@miragon/pulse-engine-connector/widgets",
        [POINT_DOWN],
      ],
      // Keyed on the role: any connector's data and lib.
      [`${BILLING_CONNECTOR}/src/data/up.ts`, "../tools/target.ts", [POINT_DOWN]],
      [`${BILLING_CONNECTOR}/src/lib/engine/up.ts`, "../../widget-tools.ts", [POINT_DOWN]],
      // Allowed: down and sideways, and every layer above may import these.
      [`${ENGINE_CONNECTOR}/src/data/down.ts`, "../lib/engine/with-engine.ts", []],
      [`${ENGINE_CONNECTOR}/src/data/down.ts`, "../view-models.ts", []],
      [`${ENGINE_CONNECTOR}/src/lib/bpmn/down.ts`, "../engine/with-engine.ts", []],
      [`${ENGINE_CONNECTOR}/src/lib/bpmn/down.ts`, "../../tool-names.ts", []],
      // Root files that register nothing stay below: only index, plugin and module are the root.
      [`${ENGINE_CONNECTOR}/src/data/down.ts`, "../plugin-names.ts", []],
      [`${ENGINE_CONNECTOR}/src/lib/engine/down.ts`, "../../engine-provider.ts", []],
      [`${ENGINE_CONNECTOR}/src/tools/up.ts`, "../data/target.ts", []],
      [`${ENGINE_CONNECTOR}/src/tools/up.ts`, "../lib/engine/with-engine.ts", []],
      [`${ENGINE_CONNECTOR}/src/widget-tools/up.ts`, "../lib/mcp/toolsets.ts", []],
      // Tests and their test-support boot the plugin and its tools: exempt.
      [`${ENGINE_CONNECTOR}/src/data/cockpit-start.test.ts`, "../widget-tools/target.ts", []],
      [`${ENGINE_CONNECTOR}/src/lib/mcp/toolsets.test.ts`, "../../tools/target.ts", []],
      [`${ENGINE_CONNECTOR}/src/lib/engine/fake.test-support.ts`, "../../tools/target.ts", []],
    ],
  },
  {
    rule: PEERS,
    title: "connectors never import each other, also through their own node_modules",
    cases: [
      [ENGINE_CONNECTOR_SRC, "@miragon/pulse-billing-connector", [PEERS]],
      [ENGINE_CONNECTOR_SRC, "@miragon/pulse-billing-connector/widgets", [PEERS]],
      // The old pattern's reach stays: a client folder named like a connector is still caught.
      [
        `${ENGINE_CONNECTOR}/src/escape.ts`,
        "../../../c7/c7-client/src/x-connector/y.ts",
        [PEERS, DEEP],
      ],
      [ENGINE_CONNECTOR_SRC, "@miragon/pulse-c7-client", []],
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
      [BILLING_CONNECTOR_SRC, "@miragon/pulse-c7-client/sdk", [OWN_FAMILY]],
      [BILLING_CONNECTOR_SRC, "@miragon/pulse-c7-client", [OWN_FAMILY]],
      [BILLING_CONNECTOR_SRC, `${C7_CORE}/testing`, [OWN_FAMILY, NO_TESTING]],
      [
        `${BILLING_CONNECTOR}/src/escape-core.ts`,
        "../../../c7/c7-core/src/target.ts",
        [OWN_FAMILY, DEEP],
      ],
      [BILLING_CONNECTOR_SRC, "@miragon/pulse-billing-client", []],
    ],
  },
  {
    rule: SPANS,
    title: "the engine module imports the clients and cores of its family and the dialects only",
    cases: [
      [ENGINE_CONNECTOR_SRC, "@miragon/pulse-billing-client", [SPANS]],
      [
        `${ENGINE_CONNECTOR}/src/lib/engine/billing.ts`,
        "@miragon/pulse-billing-client/sdk",
        [SPANS],
      ],
      [
        `${ENGINE_CONNECTOR}/src/escape-billing.ts`,
        "../../../billing/billing-core/src/lib.ts",
        [SPANS, DEEP],
      ],
      // A dialect joins ENGINE_DIALECTS with its first import: until then it is another family.
      [`${ENGINE_CONNECTOR}/src/lib/engine/c8.ts`, "@miragon/pulse-c8-core", [SPANS]],
      // Anchored: a family whose name starts like a dialect's is no dialect.
      [`${ENGINE_CONNECTOR}/src/lib/engine/c70.ts`, "@miragon/pulse-c70-core", [SPANS]],
      // Allowed: the dialect family c7 (its core and its client, a subpath too) and tests. The
      // engine family has no client or core of its own since 0.28; that the rule still exempts
      // it is held by the ENGINE_DIALECTS suite below.
      [`${ENGINE_CONNECTOR}/src/lib/core-adapter/port.ts`, C7_CORE, []],
      [`${ENGINE_CONNECTOR}/src/lib/core-adapter/types.ts`, C7_CORE, [], "type"],
      [`${ENGINE_CONNECTOR}/src/lib/engine/c7.ts`, "@miragon/pulse-c7-client", []],
      [`${ENGINE_CONNECTOR}/src/lib/engine/sdk.ts`, "@miragon/pulse-c7-client/sdk", []],
      [`${ENGINE_CONNECTOR}/src/tools/core.test.ts`, `${C7_CORE}/testing`, []],
    ],
  },
  {
    rule: CLIENT_LEAF,
    title: "clients are leaves, also for workspace packages in their own node_modules",
    cases: [
      [C7_CLIENT_SRC, "@miragon/pulse-widget-shell", [CLIENT_LEAF]],
      [C7_CLIENT_SRC, "@miragon/pulse-billing-client", [CLIENT_LEAF]],
      [C7_CLIENT_SRC, "@miragon/pulse-engine-connector/widgets", [CLIENT_LEAF]],
      [
        `${C7_CLIENT}/src/escape.ts`,
        "../../../../core/widget-shell/src/target.ts",
        [CLIENT_LEAF, DEEP],
      ],
      [C7_CLIENT_SRC, "zod", []],
      [C7_CLIENT_SRC, "./lib.ts", []],
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
      // pulse-ui by path: the server half never imports the view stack at all.
      [`${SHELL}/src/escape-ui.ts`, "../../ui/src/target.ts", [DEEP, SHELL_HEADLESS]],
      [`${SHELL}/src/ui/escape-ui.ts`, "../../../ui/src/target.ts", [DEEP, SHELL_VIEWS]],
      // The engine connector may import c7-core, but only by its name, never by a path.
      [`${ENGINE_CONNECTOR}/src/escape-core.ts`, "../../../c7/c7-core/src/target.ts", [DEEP]],
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
    title: "the CLI and the packages it bundles have no import cycle, a type-only one included",
    cases: [
      [`${CLI}/src/cycle-a.ts`, "./cycle-b.ts", [CIRCULAR, CLI_CYCLE]],
      [`${CLI}/src/cycle-b.ts`, "./cycle-a.ts", [CIRCULAR, CLI_CYCLE]],
      [`${CLI}/src/type-cycle-a.ts`, "./type-cycle-b.ts", [CLI_CYCLE], "type"],
      [`${CLI}/src/type-cycle-b.ts`, "./type-cycle-a.ts", [CLI_CYCLE], "type"],
      // The workflow domain the CLI bundles is held to the same rule.
      [`${C7}/src/cycle-a.ts`, "./cycle-b.ts", [CIRCULAR, CLI_CYCLE]],
      [`${C7}/src/cycle-b.ts`, "./cycle-a.ts", [CIRCULAR, CLI_CYCLE]],
      [`${C7}/src/type-cycle-a.ts`, "./type-cycle-b.ts", [CLI_CYCLE], "type"],
      [`${C7}/src/type-cycle-b.ts`, "./type-cycle-a.ts", [CLI_CYCLE], "type"],
      // So is the profile format, which the CLI bundles as well.
      [`${PROFILE}/src/type-cycle-a.ts`, "./type-cycle-b.ts", [CLI_CYCLE], "type"],
      [`${PROFILE}/src/type-cycle-b.ts`, "./type-cycle-a.ts", [CLI_CYCLE], "type"],
      // And the transport.
      [`${HTTP}/src/type-cycle-a.ts`, "./type-cycle-b.ts", [CLI_CYCLE], "type"],
      [`${HTTP}/src/type-cycle-b.ts`, "./type-cycle-a.ts", [CLI_CYCLE], "type"],
      // A core the CLI does not bundle is out of the CLI's rules: no-circular tolerates the type.
      [`${BILLING_CORE}/src/type-cycle-a.ts`, "./type-cycle-b.ts", [], "type"],
      [`${BILLING_CORE}/src/type-cycle-b.ts`, "./type-cycle-a.ts", [], "type"],
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
    title: "nothing in the CLI or the packages it bundles imports a test file of its own",
    cases: [
      [`${CLI}/src/b.test.ts`, "./a.test.ts", [CLI_NOT_TEST]],
      [`${CLI}/src/c.test.ts`, "./target.ts", []],
      [`${C7}/src/testing/to-test.ts`, "../a.test.ts", [CLI_NOT_TEST]],
      [`${C7}/src/c.test.ts`, "./a.test.ts", [CLI_NOT_TEST]],
      [`${PROFILE}/src/c.test.ts`, "./a.test.ts", [CLI_NOT_TEST]],
      [`${HTTP}/src/c.test.ts`, "./a.test.ts", [CLI_NOT_TEST]],
      // A core the CLI does not bundle is out of the CLI's rules.
      [`${BILLING_CORE}/src/to-test.ts`, "./a.test.ts", []],
      // Each package's own tests only: the CLI's rule never reaches into the core's tree.
      [
        `${CLI}/src/to-engine-test.ts`,
        "../../../packages/connectors/c7/c7-core/src/a.test.ts",
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
    write(`${dir}/package.json`, JSON.stringify({ main: "src/index.ts", ...extras, dependencies }))
    // pnpm's shape of a declared workspace dependency: a relative directory symlink.
    for (const [otherDir, other] of Object.entries(WORKSPACE)) {
      if (otherDir === dir || UNLINKED.get(dir) === other.name) continue
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
  plant(C7_CLIENT_SRC, "./generated/sdk.gen.ts")
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

describe("the fixture plants a family core's edges to engine-core in their shapes", () => {
  const link = `${C7}/node_modules/${ENGINE_CORE_NAME}`
  it("resolves c7-core's to the build, its main entry and the deep files (shape 2)", () => {
    assert.equal(edgeOf(`${C7}/src/cause.ts`, ENGINE_CORE_NAME).resolved, `${link}/dist/index.js`)
    assert.equal(
      edgeOf(`${C7}/src/testing/deep-kit.ts`, `${ENGINE_CORE_NAME}/dist/testing/index.js`).resolved,
      `${link}/dist/testing/index.js`,
    )
    assert.equal(
      edgeOf(`${C7}/src/deep-model.ts`, `${ENGINE_CORE_NAME}/dist/model/root-causes.js`).resolved,
      `${link}/dist/model/root-causes.js`,
    )
  })

  it("resolves the engine connector's to the build too: its own family's core (shape 2)", () => {
    assert.equal(
      edgeOf(ENGINE_CONNECTOR_SRC, ENGINE_CORE_NAME).resolved,
      `${ENGINE_CONNECTOR}/node_modules/${ENGINE_CORE_NAME}/dist/index.js`,
    )
  })

  it("leaves the billing core's bare and unresolved (shape 3)", () => {
    assert.equal(edgeOf(BILLING_CORE_SRC, ENGINE_CORE_NAME).resolved, ENGINE_CORE_NAME)
  })
})

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

  it("excludes c7-client/src/generated", () => {
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

/**
 * The families engine-connector-spans-the-dialects exempts, per half of its `pathNot`: the
 * relative-escape patterns, one family each, and the npm patterns (node_modules and the bare
 * name), one alternation each.
 */
function spannedFamilyHalves({ pathNot }) {
  const relative = []
  const npm = []
  for (const pattern of pathNot) {
    const tree = /^\^packages\/connectors\/([^/]+)\/\1-\(\?:client\|core\)\/$/.exec(pattern)
    if (tree) relative.push(tree[1])
    const name = /@miragon\/pulse-\(\?:([^)]+)\)-\(\?:client\|core\)/.exec(pattern)
    if (name) npm.push(name[1].split("|"))
  }
  return { relative, npm }
}

/**
 * The families engine-connector-spans-the-dialects lets the engine module import, read from the
 * relative-escape exemptions it builds (the own family engine and ENGINE_DIALECTS).
 */
function spannedFamilies(config) {
  const { to } = config.forbidden.find((rule) => rule.name === SPANS)
  return spannedFamilyHalves(to).relative
}

/**
 * Where the npm half of the exemptions names other families than the relative half. The planted
 * cases reach the engine family's core by its npm name only where engine-core-consumers fires as
 * well, and none reaches its client (old-names bans the name), so this check holds that half of
 * the exemption.
 */
function spannedHalfFindings(to) {
  const { relative, npm } = spannedFamilyHalves(to)
  const want = [...relative].sort().join(", ")
  if (npm.length !== 2) {
    return [`${SPANS} has ${npm.length} npm exemptions, not 2 (node_modules and the bare name)`]
  }
  return npm.flatMap((families) => {
    const got = [...families].sort().join(", ")
    return got === want ? [] : [`${SPANS} exempts the npm names of ${got}, its paths ${want}`]
  })
}

/**
 * What the tree under `connectorsDir` says against ENGINE_DIALECTS: a dialect that is no family
 * with a client or a core, and a connector a dialect brings (one module, engine, serves them all).
 */
function dialectFindings(dialects, connectorsDir) {
  return dialects.flatMap((dialect) => {
    const familyDir = path.join(connectorsDir, dialect)
    const packages = fs.existsSync(familyDir)
      ? fs
          .readdirSync(familyDir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
      : []
    if (!packages.some((name) => [`${dialect}-client`, `${dialect}-core`].includes(name))) {
      return [
        `ENGINE_DIALECTS names ${dialect}, but packages/connectors/${dialect}/ holds no ` +
          `${dialect}-client or ${dialect}-core: a dialect joins with its first import`,
      ]
    }
    return packages
      .filter((name) => name.endsWith("-connector"))
      .map(
        (name) =>
          `packages/connectors/${dialect}/${name} is a connector of the dialect ${dialect}: the ` +
          "engine module serves every dialect, so its tools go into the engine connector",
      )
  })
}

describe("ENGINE_DIALECTS names dialect families of the tree, none with a connector", () => {
  const config = createRequire(import.meta.url)(CONFIG)
  const dialects = spannedFamilies(config).filter((family) => family !== "engine")

  it("reads the engine family and at least one dialect from the rule", () => {
    assert.ok(spannedFamilies(config).includes("engine"), "the engine family is not exempt")
    assert.ok(dialects.length > 0, `no dialect read from ${SPANS}`)
  })

  it("exempts the same families by path and by npm name", () => {
    const { to } = config.forbidden.find((rule) => rule.name === SPANS)
    assert.deepEqual(spannedHalfFindings(to), [])
  })

  it("fails on an npm exemption that names other families than the paths", () => {
    const paths = ["engine", "c7"].map(
      (family) => `^packages/connectors/${family}/${family}-(?:client|core)/`,
    )
    const names = (families) => `@miragon/pulse-(?:${families})-(?:client|core)`
    assert.deepEqual(
      spannedHalfFindings({
        pathNot: [
          ...paths,
          `(?:^|/)node_modules/(?:${names("c7")})(?:/|$)`,
          `^(?:${names("c7|engine")})(?:/|$)`,
        ],
      }),
      [`${SPANS} exempts the npm names of c7, its paths c7, engine`],
    )
    assert.deepEqual(spannedHalfFindings({ pathNot: paths }), [
      `${SPANS} has 0 npm exemptions, not 2 (node_modules and the bare name)`,
    ])
  })

  it("holds the real tree", () => {
    assert.deepEqual(dialectFindings(dialects, path.join(repoRoot, "packages/connectors")), [])
  })

  it("fails on a dialect without packages, a missing one and a dialect's connector", () => {
    const planted = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "engine-dialects-")))
    try {
      for (const dir of ["c7/c7-core", "c8", "c9/c9-core", "c9/c9-connector"]) {
        fs.mkdirSync(path.join(planted, dir), { recursive: true })
      }
      assert.deepEqual(dialectFindings(["c7", "c8", "c9", "c10"], planted), [
        "ENGINE_DIALECTS names c8, but packages/connectors/c8/ holds no c8-client or c8-core: " +
          "a dialect joins with its first import",
        "packages/connectors/c9/c9-connector is a connector of the dialect c9: the engine " +
          "module serves every dialect, so its tools go into the engine connector",
        "ENGINE_DIALECTS names c10, but packages/connectors/c10/ holds no c10-client or " +
          "c10-core: a dialect joins with its first import",
      ])
    } finally {
      fs.rmSync(planted, { recursive: true, force: true })
    }
  })
})

describe("a failing cruise says the fix", () => {
  const config = createRequire(import.meta.url)(CONFIG)
  const { scripts } = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"))

  // The closed worlds of the editor hosts and of the two packages they share, each with its
  // own config and script.
  const CLOSED_WORLDS = {
    "lint:architecture:vscode": "apps/vscode/.dependency-cruiser.cjs",
    "lint:architecture:orca": "apps/orca/.dependency-cruiser.cjs",
    "lint:architecture:runtime-view": "packages/core/runtime-view/.dependency-cruiser.cjs",
    "lint:architecture:engine-adapter":
      "packages/connectors/engine/engine-adapter/.dependency-cruiser.cjs",
  }

  for (const script of [...ARCHITECTURE_SCRIPTS, ...Object.keys(CLOSED_WORLDS)]) {
    it(`${script} prints the comment of the rule that fired`, () => {
      assert.match(scripts[script], /--output-type err-long$/)
    })
  }

  for (const [script, file] of Object.entries(CLOSED_WORLDS)) {
    it(`${script} cruises with ${file} and is chained into pnpm lint`, () => {
      assert.ok(scripts[script].includes(`--config ${file}`), scripts[script])
      assert.ok(scripts.lint.includes(`pnpm ${script} `), scripts.lint)
    })
  }

  // Their configs too: each script prints its comments, and a closed world's `not-in-allowed`
  // takes the wording from the forbidden rule of that name.
  for (const file of [CONFIG, ...Object.values(CLOSED_WORLDS).map((f) => path.join(repoRoot, f))]) {
    it(`every rule of ${path.relative(repoRoot, file)} carries a comment to print`, () => {
      const { forbidden = [], required = [] } = createRequire(import.meta.url)(file)
      assert.ok(forbidden.length > 0, `${file} lists no forbidden rules`)
      assert.deepEqual(
        [...forbidden, ...required].filter((rule) => !rule.comment?.trim()).map((r) => r.name),
        [],
      )
    })
  }

  for (const file of Object.values(CLOSED_WORLDS)) {
    it(`the closed world of ${file} has the wording err-long prints for not-in-allowed`, () => {
      const { allowed, forbidden } = createRequire(import.meta.url)(path.join(repoRoot, file))
      assert.ok(allowed.length > 0, `${file} is no longer closed-world`)
      assert.ok(forbidden.some((rule) => rule.name === "not-in-allowed" && rule.comment?.trim()))
    })
  }

  it("the err-long reporter prints it under a planted violation, and fails the run", async () => {
    const { output: report, exitCode } = await format(output, { outputType: "err-long" })
    const { comment } = config.forbidden.find((rule) => rule.name === CLIENT_LEAF)
    assert.ok(exitCode > 0, "err-long no longer fails the gate")
    assert.ok(
      report.replace(/\s+/g, " ").includes(comment.replace(/\s+/g, " ")),
      `no comment of ${CLIENT_LEAF} in the report`,
    )
  })
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
