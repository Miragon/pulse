/**
 * Architecture fitness functions: the dependency half of the CLAUDE.md
 * "Architecture invariants" made executable. Runs as `pnpm lint:architecture`
 * (chained into the root `pnpm lint`, so CI's quality job enforces it).
 *
 * Rule comments are written for the (human or AI) contributor who trips them:
 * each says what is forbidden and names the house path to use instead.
 *
 * Layout + naming carry the layer semantics. A family under `packages/connectors/<family>/` is
 * one source the MCP server reads, an engine API family (a dialect; today `c7`, the Camunda 7
 * REST API) or another source (a metrics store, say), or `engine`, the neutral family above the
 * dialects: the one module that serves every dialect and the core every dialect implements. Its
 * packages are named `<family>-<role>` (npm
 * `@miragon/pulse-<family>-<role>`; the naming gate holds the family name), keyed by the role
 * suffix:
 *   - `<family>-connector`: the MCP module (tools and their input schemas, widget tools,
 *     widgets); a dialect brings none;
 *   - `<family>-client`: its SDK leaf (the generated REST SDK, say; c7-client);
 *   - `<family>-core`, when the family's interfaces share a pure domain: a leaf that the
 *     family's connector (for a dialect's core the engine module) and the interface apps that
 *     bundle it import (c7-core); a dialect's core has one edge out of its own tree, the main
 *     entry of the engine family's core (family-core-is-a-leaf, engine-core-consumers).
 * The engine family is the neutral layer. Its module
 * (`packages/connectors/engine/engine-connector`) is the one MCP module of every dialect and
 * imports the clients and cores of the dialect families ENGINE_DIALECTS names
 * (engine-connector-spans-the-dialects; the self-test holds each entry to a family of the tree
 * that brings no connector of its own). Its core
 * (`packages/connectors/engine/engine-core`, `@miragon/pulse-engine-core`, ENGINE_CORE) is the
 * contract every dialect implements, imported only where a dialect is implemented: a dialect
 * core's src and Pulse for VS Code's contract barrel (engine-core-consumers).
 * The foundation packages every family builds on live under `packages/core/` (npm names
 * without a role suffix, e.g. `@miragon/pulse-widget-shell`), never one family's code; two of
 * them are leaves only their consumers import: the profile format (`@miragon/pulse-profile`,
 * PROFILE), read where a surface reads its profiles, and the transport (`@miragon/pulse-http`,
 * HTTP), used where a surface sends its engine requests. The apps under `apps/` sit ON TOP of
 * the packages: the MCP server (`@miragon/pulse-mcp-server`) composes the
 * connectors; of the two interface apps, the CLI (apps/cli, `@miragon/pulse-cli`) imports no
 * workspace package but the ones CLI_BUNDLES names, which tsdown inlines (its family core, with
 * the main entry of engine-core that core imports, the profile format for its config layer and
 * the transport for its http layer), and the VS Code
 * extension (apps/vscode, the unscoped `pulse-cockpit`, because vsce rejects scoped names)
 * imports c7-core in its C7 adapter alone (apps/vscode/src/adapters/c7) and engine-core in its
 * contract barrel alone (apps/vscode/src/contract), both bundled by esbuild.
 * No package and no app imports an app
 * (the extension's own closed-world rules live in apps/vscode/.dependency-cruiser.cjs).
 * APP_PACKAGES below names every app's npm name; the
 * self-test fails when a real app's name is missing there. These rules see IMPORTS only: a
 * require.resolve, an import.meta.resolve, a bin or a spawned process records no edge.
 * Under pnpm each of those needs the app declared in a package.json, and
 * scripts/check-package-naming.mjs fails on any package.json but the app's own that
 * declares one. The rules key on exactly these
 * conventions (scripts/check-package-naming.mjs holds the repo to them): a new package
 * that follows them is covered without touching this file; one that breaks them falls
 * OUT of the rules, so don't.
 *
 * An import reaches a rule in one of THREE shapes, and the patterns name all three:
 *   1. a relative escape into another package's tree: `packages/...` or `apps/...`;
 *   2. a declared dependency imported at its root, resolved through the importer's own
 *      pnpm symlink: `<importer-dir>/node_modules/@miragon/pulse-x/dist/index.js`
 *      (`preserveSymlinks: true` below keeps that path instead of the sibling's real
 *      path, so a package entry stays distinguishable from a relative escape);
 *   3. a bare, unresolved specifier: every subpath import (`@miragon/pulse-widget-shell/server`,
 *      `@modelcontextprotocol/ext-apps/react`: dependency-cruiser reads no exports map) and every undeclared
 *      dependency (`react` where the importer does not list it).
 * `npm()` builds the shape 2 and shape 3 patterns for a list of npm names. Never exempt
 * a package's own directory wholesale in a `pathNot`: its node_modules holds the very
 * shape 2 imports the rule is about. Exempt by lookahead instead (see clients-are-leaves).
 *
 * Every rule has planted violations and allowed neighbours in
 * scripts/dependency-cruiser-gates.test.mjs, which cruises a generated fixture tree
 * (with an apps/cli and an apps/vscode) with THIS config. A new or
 * changed rule adds its cases there (`pnpm test:scripts`).
 */

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Shape 2 (resolved under any node_modules) and shape 3 (bare) for `names`, an alternation. */
const npm = (names) => [`(?:^|/)node_modules/(?:${names})(?:/|$)`, `^(?:${names})(?:/|$)`]

/**
 * The npm name of every app under apps/. A new app adds its name here, or the
 * self-test's sync case fails: packages-never-import-the-app and apps-never-import-apps
 * read this list.
 */
const SERVER_PACKAGE = "@miragon/pulse-mcp-server"
const CLI_PACKAGE = "@miragon/pulse-cli"
const EXTENSION_PACKAGE = "pulse-cockpit"
const APP_PACKAGES = [SERVER_PACKAGE, CLI_PACKAGE, EXTENSION_PACKAGE]
const APP_NAMES = APP_PACKAGES.map(escapeRegExp).join("|")

/** The root of a workspace package: an app, a foundation package or a family's package. */
const PACKAGE_ROOT = "(?:apps/[^/]+|packages/core/[^/]+|packages/connectors/[^/]+/[^/]+)"

/**
 * A family core, `packages/connectors/<family>/<family>-core` (npm
 * `@miragon/pulse-<family>-core`): the family's pure domain. Its rules key on the role, never on
 * one package's name.
 */
const FAMILY_CORE = "@miragon/pulse-[^/]+-core"
const FAMILY_CORE_TREE = "^packages/connectors/[^/]+/[^/]+-core/"

/**
 * The engine module, `packages/connectors/engine/engine-connector` (npm
 * `@miragon/pulse-engine-connector`): one MCP server and one module, engine, for every dialect
 * (owner decisions 2026-11-07 and 2026-11-08). It imports the clients and cores of the dialect
 * families ENGINE_DIALECTS names, and the rule lets it import those of its own family, which has
 * no client and whose core, engine-core, engine-core-consumers keeps out until the module serves
 * a second dialect (engine-connector-spans-the-dialects); every other connector keeps to its own
 * family (connectors-own-their-family). A dialect joins ENGINE_DIALECTS in the commit that first
 * imports it from the engine module.
 */
const ENGINE_CONNECTOR_TREE = "^packages/connectors/engine/engine-connector/"
const ENGINE_DIALECTS = ["c7"]
const ENGINE_MODULE_FAMILIES = ["engine", ...ENGINE_DIALECTS]

/**
 * The interface apps (or the one part of an app) that bundle a family core (tsdown or esbuild
 * inlines it), each with the one core it bundles. The keys are, with the family's own connector
 * (for a dialect's core the engine module), the only importers of a family core
 * (family-core-consumers; engine-core-consumers narrows who imports engine-core). This config
 * reads the name and tree of the CLI's entry only: the CLI's rules below hold the core it
 * bundles as part of the CLI, which gets engine-core only inlined through c7-core and never
 * imports it (cli-is-headless). The extension's entries document its two cores here; its own
 * config (apps/vscode/.dependency-cruiser.cjs) holds the C7 adapter to c7-core's main entry
 * (c7-core-only-in-the-c7-adapter) and the contract barrel to engine-core's, and keeps both
 * cores out of every other layer.
 */
const CORE_BUNDLES = {
  "^apps/cli/": {
    name: "@miragon/pulse-c7-core",
    tree: "packages/connectors/c7/c7-core",
  },
  "^apps/vscode/src/adapters/c7/": {
    name: "@miragon/pulse-c7-core",
    tree: "packages/connectors/c7/c7-core",
  },
  "^apps/vscode/src/contract/": {
    name: "@miragon/pulse-engine-core",
    tree: "packages/connectors/engine/engine-core",
  },
}
const CORE_BUNDLERS = Object.keys(CORE_BUNDLES)
const CLI_CORE = escapeRegExp(CORE_BUNDLES["^apps/cli/"].name)

/**
 * The profile format (packages/core/profile, npm `@miragon/pulse-profile`): the one parser of the
 * profile files of the CLI, Pulse for VS Code and the MCP server. A foundation package, not a
 * family core, so it stays out of CORE_BUNDLES (whose keys loosen family-core-consumers): its own
 * rules are profile-is-a-leaf and profile-consumers.
 */
const PROFILE = { name: "@miragon/pulse-profile", tree: "packages/core/profile" }

/**
 * Where a surface reads its profiles, the only shipped importers of PROFILE: the CLI's config
 * layer, Pulse for VS Code's connections (its closed world, apps/vscode/.dependency-cruiser.cjs,
 * admits the edge on its own) and the engine connector's configuration (its module definition,
 * the profiles it builds from the environment, the provider port that names the flavors). Tests
 * import it anywhere.
 */
const PROFILE_READERS = [
  "^apps/cli/src/config/",
  "^apps/vscode/src/host/connections/",
  "^packages/connectors/engine/engine-connector/src/(?:module|engine-profiles|engine-provider)[.]ts$",
]

/**
 * The transport (packages/core/http, npm `@miragon/pulse-http`): one HTTP client over an
 * injected fetch for the MCP server's engine connector, the CLI and Pulse for VS Code's adapters.
 * A foundation package and a leaf, so it stays out of CORE_BUNDLES too: its own rules are
 * http-is-a-leaf and http-consumers.
 */
const HTTP = { name: "@miragon/pulse-http", tree: "packages/core/http" }

/**
 * The transport's one module with Node built-ins: the loopback engine of its conformance cases
 * (`@miragon/pulse-http/testing/loopback`), on real sockets, which every wiring of the transport
 * runs the cases against instead of a copy of its own. The named exception of http-is-a-leaf,
 * held to its sockets by http-loopback-only-its-sockets; shipped-code-not-to-testing keeps it out
 * of shipped code.
 */
const HTTP_LOOPBACK = `^${escapeRegExp(HTTP.tree)}/src/testing/loopback/`

/**
 * Where a surface sends its engine requests, the only shipped importers of HTTP: the CLI's
 * http, auth and operation layers, the adapters of Pulse for VS Code (one folder per dialect
 * under src/adapters; its closed world, apps/vscode/.dependency-cruiser.cjs, admits the edge on
 * its own) and a connector (keyed by the role, so a new family's connector inherits it; its
 * widgets stay browser code, connector-widgets-are-browser-code). Never the MCP server app's
 * shipped code: it composes connectors. Tests import it anywhere, as they do the profile format.
 */
const HTTP_USERS = [
  "^apps/cli/src/(?:http|auth|operation)/",
  "^apps/vscode/src/adapters/[^/]+/",
  "^packages/connectors/[^/]+/[^/]+-connector/(?:src|test)/",
]

/**
 * The workspace packages the CLI may bundle (tsdown inlines what it imports, so the published CLI
 * depends on none of them): its family core, CORE_BUNDLES' entry for apps/cli, the profile
 * format, admitted for the config layer before the CLI reads its profiles with it, and the
 * transport, admitted for the http, auth and operation layers before the CLI sends with it. The
 * only workspace packages cli-is-headless lets the CLI import; cli-no-circular and
 * cli-not-to-test hold their trees as part of the CLI.
 */
const CLI_BUNDLES = [CORE_BUNDLES["^apps/cli/"], PROFILE, HTTP]
const CLI_BUNDLE_NAMES = CLI_BUNDLES.map(({ name }) => escapeRegExp(name)).join("|")
const CLI_BUNDLE_TREES = CLI_BUNDLES.map(({ tree }) => escapeRegExp(tree)).join("|")

/**
 * The engine family's core (packages/connectors/engine/engine-core, npm
 * `@miragon/pulse-engine-core`): the contract every dialect implements, the ports, read models,
 * queries and failure kinds a process engine answers in, whatever its dialect, the rules every
 * dialect shares (RootCauses), and in ./testing the conformance kit and the fake (owner
 * decisions 2026-11-08 and 2026-11-09: the engine family is the neutral layer, c7 and later c8
 * the dialect families below it). A family core, so family-core-is-a-leaf holds it as it holds
 * every core; engine-core-consumers holds who imports it.
 */
const ENGINE_CORE = {
  name: "@miragon/pulse-engine-core",
  tree: "packages/connectors/engine/engine-core",
}

/**
 * Where a dialect is implemented, the only shipped importers of ENGINE_CORE: the src of a
 * dialect's core (a family ENGINE_DIALECTS names), never its ./testing entry (src/testing/, the
 * dialect's fixtures, which ship on npm), and Pulse for VS Code's contract barrel, which
 * re-exports it to the extension's core, adapters and host. The extension's tests and dev host
 * import it too, but this config never cruises apps/vscode/test or apps/vscode/dev: its closed
 * world (apps/vscode/.dependency-cruiser.cjs) holds them and the barrel's edge to the main entry.
 * Test files import it anywhere. The engine connector (although engine-core is its own family's
 * core, which engine-connector-spans-the-dialects admits) and the CLI do not, until they serve a
 * second dialect (owner decision 2026-11-09): they reach it through c7-core's causeOf.
 */
const ENGINE_CORE_IMPLEMENTERS = [
  `^packages/connectors/(?:${ENGINE_DIALECTS.join("|")})/[^/]+-core/src/(?!testing/)`,
  "^apps/vscode/src/contract/",
]

/**
 * engine-core's main entry as an import reaches it: resolved through the importer's
 * node_modules to the build (shape 2) or bare and unresolved before a build (shape 3). Never
 * another subpath (./testing ships the kit, dist/model/… is a second way in), never a relative
 * escape into its tree. The patterns read the resolved path, so a specifier that names the entry's
 * own file (…/dist/index.js) is that entry; TypeScript refuses it through the exports map.
 */
const ENGINE_CORE_ENTRY = [
  `(^|/)node_modules/${escapeRegExp(ENGINE_CORE.name)}/dist/index[.](js|d[.]ts)$`,
  `^${escapeRegExp(ENGINE_CORE.name)}$`,
]

/** Test-support modules: helpers of the tests, never shipped. */
const TEST_SUPPORT = ["[.]test-support[.]tsx?$", "/test-support/"]

/**
 * Test code in a package's src/: its tests, their test-support and its own ./testing entry
 * (src/testing/). Everything else under src/ ships, in a package entry or in a bundle.
 */
const SRC_TEST_CODE = ["[.]test[.]tsx?$", ...TEST_SUPPORT, `^${PACKAGE_ROOT}/src/testing/`]

/**
 * What makes a package an MCP host or a widget: the UI runtime, the official MCP SDK (server,
 * Node adapter, MCP Apps), the HTTP framework and the token verifier the server runs on, the
 * server's metrics, zod and the generated REST SDK's runtime. The CLI imports none of it.
 */
const MCP_STACK = [
  "react",
  "react-dom",
  "lucide-react",
  "@tanstack/[^/]+",
  "@modelcontextprotocol/[^/]+",
  "hono",
  "@hono/[^/]+",
  "jose",
  "prom-client",
  "zod",
  "@hey-api/[^/]+",
].join("|")

/**
 * The MCP Apps runtime: `@modelcontextprotocol/ext-apps` and every subpath but its server half
 * (`/server`: `registerAppTool`, the view resource's MIME type), which is server code. Only
 * widget-shell's host adapter (EXT_APPS_HOST_ADAPTER) imports it (ext-apps-runtime-in-the-adapter).
 */
const EXT_APPS_RUNTIME = "@modelcontextprotocol/ext-apps(?!/server(?:/|$))"

/**
 * widget-shell's host adapter: the one place that speaks to an MCP Apps host (ESLint's
 * EXT_APPS_HOST_ADAPTER in eslint.config.mjs names the same files).
 */
const EXT_APPS_HOST_ADAPTER = [
  "^packages/core/widget-shell/src/ui/view-runtime[.]ts$",
  "^packages/core/widget-shell/src/ui/ext-apps-host[.]tsx$",
  "^packages/core/widget-shell/src/ui/view-root[.]tsx$",
]

/**
 * The view stack: React and what builds on it (Lucide, TanStack Query, the design kit, the MCP
 * Apps runtime, which only widget-shell's host adapter imports, and the BPMN viewer). The only
 * npm packages widget-shell's view half and (with widget-shell's `/widgets`) a connector's
 * widgets import, and none of them is widget-shell's server half's. The server stack (the SDK's
 * server and Node packages, ext-apps' `/server`, hono, jose, prom-client, zod) and Node built-ins
 * are not among them.
 */
const VIEW_STACK = `react|react-dom|lucide-react|@tanstack/[^/]+|@miragon/pulse-ui|${EXT_APPS_RUNTIME}|bpmn-js|diagram-js`

/**
 * pulse-ui's framework-free entries, one folder each under src/ (`./format`, `./tones`): the UI
 * foundation every Pulse UI shares at runtime, the VS Code extension's core and webview included.
 * The group names the folder, so an entry imports only its own
 * (ui-foundation-entries-import-nothing).
 */
const UI_FOUNDATION_ENTRIES = "^packages/core/ui/src/(format|tones)/"

/** widget-shell's two halves and the protocol modules both import (see the seam rules). */
const SHELL_SRC = "^packages/core/widget-shell/src/"
const SHELL_VIEWS = `${SHELL_SRC}ui/`
const SHELL_PROTOCOL = `${SHELL_SRC}protocol/`

/** The CLI's test code: colocated unit tests, and test/ with its fakes and engine suites. */
const CLI_TEST_CODE = ["[.]test[.]ts$", "^apps/cli/test/"]

/** The CLI's pure layers (no Node built-ins; WebCrypto and timers are globals). */
const CLI_PURE_LAYERS =
  "^apps/cli/src/(?:api|auth|catalog|docs|engine-port|engines|output|workflow)/|^apps/cli/src/(?:errors|util)[.]ts$"

/** The CLI's interactive OAuth login: loopback server, browser, callback pages. */
const CLI_INTERACTIVE_LOGIN = "^apps/cli/src/auth/oauth/(?:login|callback|pages)[.]ts$"

module.exports = {
  forbidden: [
    {
      name: "connectors-are-peers",
      severity: "error",
      comment:
        "Connector modules are self-contained peers and never import each other (CLAUDE.md invariant 8). " +
        "Cross-module needs go through the composition root: what the modules share via " +
        "SharedResources (apps/mcp-server/src/setup.ts; today the app hands nothing through).",
      from: { path: "^packages/connectors/[^/]+/([^/]+)-connector/" },
      to: {
        path: ["^packages/connectors/.+-connector/", "@miragon/pulse-[^/]+-connector(/|$)"],
        // The own tree stays exempt EXCEPT a foreign connector declared in its own
        // node_modules (shape 2), which is exactly the import this rule forbids.
        pathNot: [
          "^packages/connectors/[^/]+/$1-connector/(?!node_modules/@miragon/pulse-[^/]+-connector(?:/|$))",
          "@miragon/pulse-$1-connector(/|$)",
        ],
      },
    },
    {
      name: "connectors-own-their-family",
      severity: "error",
      comment:
        "A connector may only depend on its own family's client and core (<family>-connector → " +
        "<family>-client, <family>-core). Engine data a foreign module needs arrives as an injected " +
        "port on SharedResources, the composition root's wiring of what the modules share, never " +
        "as an engine-SDK dependency of that module (CLAUDE.md invariant 8). The engine module " +
        "spans the dialect families instead (engine-connector-spans-the-dialects).",
      from: {
        path: "^packages/connectors/[^/]+/([^/]+)-connector/",
        pathNot: ENGINE_CONNECTOR_TREE,
      },
      to: {
        path: [
          "^packages/connectors/.+-client/",
          FAMILY_CORE_TREE,
          "@miragon/pulse-[^/]+-(?:client|core)(/|$)",
        ],
        pathNot: [
          "^packages/connectors/[^/]+/$1-(?:client|core)/",
          "@miragon/pulse-$1-(?:client|core)(/|$)",
        ],
      },
    },
    {
      name: "engine-connector-spans-the-dialects",
      severity: "error",
      comment:
        "The engine module (packages/connectors/engine/engine-connector, " +
        "@miragon/pulse-engine-connector) is the one MCP module of every dialect: one MCP server " +
        "and one module, engine, for all dialects (owner decisions 2026-11-07 and 2026-11-08). " +
        "It imports the clients and cores of the dialect families ENGINE_DIALECTS names (today " +
        "c7: @miragon/pulse-c7-client and @miragon/pulse-c7-core), never another family's. Its " +
        "own family engine has no client, and its core, engine-core, the contract every dialect " +
        "implements, stays out until the module serves a second dialect (engine-core-consumers). " +
        "A dialect joins ENGINE_DIALECTS in the commit that first imports it from the engine " +
        "module (CLAUDE.md invariant 8).",
      from: { path: ENGINE_CONNECTOR_TREE },
      to: {
        path: [
          "^packages/connectors/[^/]+/[^/]+-(?:client|core)/",
          ...npm("@miragon/pulse-[^/]+-(?:client|core)"),
        ],
        pathNot: [
          ...ENGINE_MODULE_FAMILIES.map(
            (family) => `^packages/connectors/${family}/${family}-(?:client|core)/`,
          ),
          ...npm(`@miragon/pulse-(?:${ENGINE_MODULE_FAMILIES.join("|")})-(?:client|core)`),
        ],
      },
    },
    {
      name: "clients-are-leaves",
      severity: "error",
      comment:
        "*-client packages are SDK leaves (generated REST SDK / PromQL queries): " +
        "they never import connectors, family cores, the foundation packages or sibling clients. Shared " +
        "logic that grows here belongs in the connector layer or a core package, not in a client.",
      from: { path: "^packages/connectors/[^/]+/([^/]+)-client/" },
      to: {
        path: ["^packages/(core|connectors)/", "@miragon/pulse-"],
        // The own tree (src, own third-party node_modules such as vitest) stays exempt
        // EXCEPT any @miragon/pulse-* package declared in its own node_modules (shape 2).
        pathNot: [
          "^packages/connectors/[^/]+/$1-client/(?!node_modules/@miragon/pulse-)",
          "@miragon/pulse-$1-client(/|$)",
        ],
      },
    },
    {
      name: "core-is-foundation",
      severity: "error",
      comment:
        "packages/core/* is the foundation every family builds on: it depends " +
        "on core siblings and third-party libraries only (pulse-ui is the leaf among them), never " +
        "on a family package (a connector, a client or a family core). When connectors of two " +
        "families need the same thing, extract it INTO a core package (on the second concrete " +
        "consumer); what one family needs stays in that family (its -core), never in packages/core. " +
        "What every dialect implements lives in the engine family's core, engine-core, not here.",
      from: { path: "^packages/core/" },
      to: {
        path: ["^packages/connectors/", "@miragon/pulse-[^/]+-(connector|client|core)(/|$)"],
      },
    },
    {
      name: "ui-is-a-leaf",
      severity: "error",
      comment:
        "packages/core/ui (@miragon/pulse-ui) is the design kit every Pulse view and every customer UI " +
        "builds on: it imports no workspace package and nothing of the MCP, query, server or schema " +
        "stack (@modelcontextprotocol, hono, jose, TanStack, zod, prom-client, " +
        "@hey-api, bpmn-js, diagram-js). What needs the host, a tool call or BPMN belongs in widget-shell, " +
        "which imports pulse-ui, never the other way round (CLAUDE.md invariants 6 and 8).",
      from: { path: "^packages/core/ui/" },
      to: {
        path: [
          "^packages/(?!core/ui/)",
          "@miragon/pulse-(?!ui(?:/|$))",
          ...npm(
            "@modelcontextprotocol/[^/]+|hono|@hono/[^/]+|jose|@tanstack/[^/]+|zod|prom-client|@hey-api/[^/]+|bpmn-js|diagram-js",
          ),
        ],
      },
    },
    {
      name: "ui-foundation-entries-import-nothing",
      severity: "error",
      comment:
        "pulse-ui's framework-free entries (src/format and src/tones, published as " +
        "@miragon/pulse-ui/format and @miragon/pulse-ui/tones) " +
        "import only their own folder: no React, no Radix, no tailwind-merge, no other file of " +
        "the kit, no Node built-in. A UI on another framework (the VS Code webview on Preact) " +
        "bundles them, so what needs React or a class map stays in the kit's root, which may " +
        "import them, never the other way round.",
      from: { path: UI_FOUNDATION_ENTRIES, pathNot: SRC_TEST_CODE },
      to: { pathNot: "^packages/core/ui/src/$1/" },
    },
    // ── The browser/server seams: widget-shell's halves and connector widgets (review P7) ──
    // widget-shell stays ONE package (`/server` and `/widgets`) because its halves share one wire
    // protocol, src/protocol/ (tool results, the view name, the served fonts, the translator, the
    // BPMN-name reader). Three rules keep the parts apart, so a later split is a path move: the
    // view half (src/ui) imports only itself, the protocol and the view stack; the server half
    // (the rest of src/) never imports the view half or the view stack; the protocol imports
    // nothing but itself. tsconfig.widgets.json (DOM, no Node types) and tsconfig.json (Node
    // types, no DOM) hold the same seam for types; the protocol is typed under both.
    {
      name: "widget-shell-views-browser-only",
      severity: "error",
      comment:
        "widget-shell's view half (src/ui, the `/widgets` entry, in every view bundle) imports " +
        "only src/ui, src/protocol and the view stack (VIEW_STACK): no server module of " +
        "widget-shell, no Node built-in, no server package (the SDK's server, hono, jose, prom-client, " +
        "zod). What both " +
        "halves need moves into src/protocol, dependency-free.",
      from: { path: SHELL_VIEWS, pathNot: SRC_TEST_CODE },
      to: { pathNot: [SHELL_VIEWS, SHELL_PROTOCOL, ...npm(VIEW_STACK)] },
    },
    {
      name: "widget-shell-server-headless",
      severity: "error",
      comment:
        "widget-shell's server half (src/ without src/ui and src/protocol: the `/server` boot, " +
        "the module port, tool authoring) never imports the view half (src/ui) or the view stack " +
        "(VIEW_STACK): a server never loads React. What both halves need moves into src/protocol.",
      from: { path: SHELL_SRC, pathNot: [SHELL_VIEWS, SHELL_PROTOCOL, ...SRC_TEST_CODE] },
      // pulse-ui by relative escape too (no-cross-package-deep-imports bites there as well).
      to: { path: [SHELL_VIEWS, "^packages/core/ui/", ...npm(VIEW_STACK)] },
    },
    {
      name: "widget-shell-protocol-is-a-leaf",
      severity: "error",
      comment:
        "widget-shell's protocol modules (src/protocol: the wire both halves share) import only " +
        "each other: no npm package, no Node built-in, nothing of either half. They run in the " +
        "server and in every view bundle alike; what one half alone needs stays in that half.",
      from: { path: SHELL_PROTOCOL, pathNot: SRC_TEST_CODE },
      to: { pathNot: SHELL_PROTOCOL },
    },
    {
      name: "ext-apps-runtime-in-the-adapter",
      severity: "error",
      comment:
        "Only widget-shell's host adapter (src/ui/view-runtime.ts, ext-apps-host.tsx, " +
        "view-root.tsx) imports the MCP Apps runtime (@modelcontextprotocol/ext-apps but its " +
        "/server half): a widget reaches the host through widget-shell's view host and query " +
        "hooks, so it renders under TestViewHost and in another host (a web app, a VS Code " +
        "webview) that brings an adapter of its own (CLAUDE.md invariant 6). ESLint's " +
        "no-restricted-imports holds the static imports; this rule sees a dynamic import() too.",
      from: { pathNot: EXT_APPS_HOST_ADAPTER },
      to: { path: npm(EXT_APPS_RUNTIME) },
    },
    {
      name: "connector-widgets-are-browser-code",
      severity: "error",
      comment:
        "A connector's widgets (src/widgets, compiled into every view bundle) and the lib folder " +
        "they share with the server (src/lib/shared) import at runtime only browser code: the " +
        "widgets' own src/widgets, src/lib/shared, the shared words (src/messages), the tool " +
        "names (src/tool-names.ts), the view models (src/view-models*.ts), the BPMN-name reader " +
        "(src/bpmn-names.ts), widget-shell's `/widgets` and the view stack (VIEW_STACK). Nothing " +
        "else of the connector (tools, widget tools, data builders, the other lib folders, " +
        "providers, instructions, feed contracts, plugin, module, the package root), no client " +
        "SDK, no server package (the MCP SDK's server, zod), no Node built-in. Type-only imports stay allowed: " +
        "a widget reads the view models' and feeds' types. Data reaches a widget through its view " +
        "tool and `*_data` feeds; pure code the widgets and the server both run goes into " +
        "src/lib/shared.",
      from: {
        path: "^packages/connectors/[^/]+/([^/]+)-connector/src/(?:widgets|lib/shared)/",
        pathNot: SRC_TEST_CODE,
      },
      to: {
        dependencyTypesNot: ["type-only"],
        pathNot: [
          "^packages/connectors/[^/]+/$1-connector/src/(?:widgets|messages|lib/shared)/",
          "^packages/connectors/[^/]+/$1-connector/src/(?:tool-names|view-models[.\\w-]*|bpmn-names)[.]tsx?$",
          ...npm(`${VIEW_STACK}|@miragon/pulse-widget-shell/widgets`),
        ],
      },
    },
    {
      name: "connector-widgets-only-shared-lib",
      severity: "error",
      comment:
        "Of a connector's lib folders (src/lib/<job>: engine routing, the c7-core adapter, " +
        "BPMN reading, the MCP tool surface) its widgets import only src/lib/shared, not even " +
        "for a type: the other folders are server code, and a type a widget needs from the " +
        "server side is declared once in src/lib/shared (TaskCompletion) or in the view models.",
      from: {
        path: "^packages/connectors/[^/]+/([^/]+)-connector/src/widgets/",
        pathNot: SRC_TEST_CODE,
      },
      to: { path: "^packages/connectors/[^/]+/$1-connector/src/lib/(?!shared/)" },
    },
    {
      name: "connector-data-and-lib-point-down",
      severity: "error",
      comment:
        "Inside a connector the edges point one way: the tools (src/tools), the widget tools " +
        "(src/widget-tools.ts, src/widget-tools/) and the widgets (src/widgets) build on the data " +
        "builders (src/data) and the lib folders (src/lib/<job>), never the reverse. A helper a " +
        "builder or a lib module needs from a tool moves down into the lib folder of its job " +
        "(condenseStacktrace into src/lib/mcp, buildTaskFormSchema into src/lib/bpmn). Tests and " +
        "their test-support may boot the tools. Nor does such a module import the connector's " +
        "root (src/index, src/plugin, src/module, which register every tool) or the connector " +
        "by its own npm name: its root and `/widgets` entries sit above these layers.",
      from: {
        path: "^packages/connectors/[^/]+/([^/]+)-connector/src/(?:data|lib)/",
        pathNot: SRC_TEST_CODE,
      },
      to: {
        path: [
          "^packages/connectors/[^/]+/$1-connector/src/(?:(?:tools|widget-tools|widgets)/|(?:widget-tools|index|plugin|module)[.]tsx?$)",
          ...npm("@miragon/pulse-$1-connector"),
        ],
      },
    },
    {
      name: "packages-never-import-the-app",
      severity: "error",
      comment:
        "Every app is a composition root or an interface ON TOP of the packages (CLAUDE.md " +
        "invariant 8): the MCP server, the CLI and the VS Code extension. No package imports " +
        "one (this rule; that no package.json declares one is check-package-naming's). " +
        "Anything a package needs from an app must be inverted into an injected port; see " +
        "SharedResources in apps/mcp-server/src/setup.ts.",
      from: { path: "^packages/" },
      to: { path: ["^apps/", ...npm(APP_NAMES)] },
    },
    {
      name: "apps-never-import-apps",
      severity: "error",
      comment:
        "An app never imports another app, by npm name or by relative path, and never itself " +
        "by its own npm name (import its own modules by relative path). This rule sees imports; " +
        "that no app's package.json declares another app (what a require.resolve, a bin or a " +
        "spawned process needs) is check-package-naming's. Behaviour two apps share moves into " +
        "a package, extracted on its second consumer.",
      from: { path: "^apps/([^/]+)/" },
      to: { path: ["^apps/(?!$1/)", ...npm(APP_NAMES)] },
    },
    {
      name: "cli-is-headless",
      severity: "error",
      comment:
        "The CLI (apps/cli) is a terminal interface, not an MCP host: it imports no workspace " +
        "package except the ones CLI_BUNDLES names, which tsdown inlines (" +
        "@miragon/pulse-c7-core, the Camunda 7 REST family's core, " +
        "@miragon/pulse-profile, the profile format, and @miragon/pulse-http, the transport), " +
        "and nothing of the MCP/UI/server " +
        "stack (react, react-dom, lucide-react, preact, bpmn-js, diagram-js, " +
        "@modelcontextprotocol, hono, jose, TanStack, prom-client, " +
        "zod, @hey-api, vscode, @miragon/modeler-shell). A relative escape into a bundled " +
        "package's tree is still a violation: import the package.",
      from: { path: "^apps/cli/" },
      to: {
        path: [
          "^packages/",
          "@miragon/pulse-",
          ...npm(`${MCP_STACK}|preact|bpmn-js|diagram-js|@miragon/modeler-shell|vscode`),
        ],
        pathNot: npm(CLI_BUNDLE_NAMES),
      },
    },
    {
      name: "profile-is-a-leaf",
      severity: "error",
      comment:
        "The profile format (packages/core/profile, @miragon/pulse-profile) has no runtime " +
        "dependency: its shipped code (the ./testing export and its JSON fixtures included) " +
        "imports only its own modules, no workspace package, no npm package and no Node " +
        "built-in. It parses the text a reader hands it: finding and reading the file, the " +
        "environment and the secrets, and the wording of what follows, stay with the reader " +
        "(the CLI, Pulse for VS Code, the MCP server). Its tests may import vitest, fast-check " +
        "and ajv.",
      from: { path: `^${escapeRegExp(PROFILE.tree)}/src/`, pathNot: ["[.]test[.]ts$"] },
      to: { pathNot: `^${escapeRegExp(PROFILE.tree)}/src/` },
    },
    {
      name: "profile-consumers",
      severity: "error",
      comment:
        "The profile format (@miragon/pulse-profile) may be imported only where a surface reads " +
        "its profiles (PROFILE_READERS): the CLI's config layer (apps/cli/src/config), Pulse " +
        "for VS Code's connections (apps/vscode/src/host/connections) and the engine " +
        "connector's configuration (src/module.ts, src/engine-profiles.ts, " +
        "src/engine-provider.ts), and by tests anywhere. No widget, no other module, no other " +
        "foundation package and not the MCP server app: they get the engines the connector built " +
        "from the profiles, never the format. A relative escape into packages/core/profile is a " +
        "violation too.",
      from: {
        pathNot: [
          ...PROFILE_READERS,
          `^${escapeRegExp(PROFILE.tree)}/(?:src|test)/`,
          ...SRC_TEST_CODE,
          "^apps/[^/]+/(?:test|test-host)/",
        ],
      },
      to: { path: [`^${escapeRegExp(PROFILE.tree)}/`, ...npm(escapeRegExp(PROFILE.name))] },
    },
    {
      name: "http-is-a-leaf",
      severity: "error",
      comment:
        "The transport (packages/core/http, @miragon/pulse-http) has no runtime dependency: its " +
        "shipped code (the ./testing export included) imports only its own modules, no " +
        "workspace package, no npm package (no undici, jose, zod or react) and no Node " +
        "built-in. It runs over the fetch a surface hands it (Node's, the VS Code extension " +
        "host's with its proxy and certificates), on the web platform's globals alone; where " +
        "the secrets come from, how a request is built and every word a person reads stay with " +
        "the surface. Its tests (test/) may import vitest, fast-check and Node built-ins. The " +
        "named exception is the loopback engine of the conformance cases " +
        "(src/testing/loopback/, http-loopback-only-its-sockets), and no other module of the " +
        "package reaches it, so the ./testing entry stays free of Node built-ins as well.",
      from: { path: `^${escapeRegExp(HTTP.tree)}/src/`, pathNot: ["[.]test[.]ts$", HTTP_LOOPBACK] },
      to: { pathNot: `^${escapeRegExp(HTTP.tree)}/src/(?!testing/loopback/)` },
    },
    {
      name: "http-loopback-only-its-sockets",
      severity: "error",
      comment:
        "The loopback engine of the transport's conformance cases " +
        "(@miragon/pulse-http/testing/loopback, src/testing/loopback/) is the package's one " +
        "module with Node built-ins (a decision taken for the owner on 2026-11-09, who may " +
        "overturn it): node:http and node:https for its plain and TLS engines, node:crypto for " +
        "the self-signed certificate it makes at test time, and the package's own modules (the " +
        "case types). Nothing else: no npm package, no workspace package, no other built-in. It " +
        "ships for the consumers' tests, so every wiring runs the cases against one engine; " +
        "shipped-code-not-to-testing keeps it out of shipped code.",
      from: { path: HTTP_LOOPBACK, pathNot: ["[.]test[.]ts$"] },
      to: {
        pathNot: [`^${escapeRegExp(HTTP.tree)}/src/`, "^(?:node:)?(?:http|https|crypto)$"],
      },
    },
    {
      name: "http-consumers",
      severity: "error",
      comment:
        "The transport (@miragon/pulse-http) may be imported only where a surface sends its " +
        "engine requests (HTTP_USERS): the CLI's http, auth and operation layers " +
        "(apps/cli/src/http, src/auth, src/operation), the adapters of Pulse for VS Code " +
        "(apps/vscode/src/adapters/<dialect>) and a connector, and by tests anywhere. Not the " +
        "MCP server app's shipped code (it composes connectors, which send), no " +
        "other foundation package (widget-shell verifies the server's own OAuth with jose), no " +
        "client and no family core (leaves). A relative escape into packages/core/http is a " +
        "violation too.",
      from: {
        pathNot: [
          ...HTTP_USERS,
          `^${escapeRegExp(HTTP.tree)}/(?:src|test)/`,
          ...SRC_TEST_CODE,
          "^apps/[^/]+/(?:test|test-host)/",
        ],
      },
      to: { path: [`^${escapeRegExp(HTTP.tree)}/`, ...npm(escapeRegExp(HTTP.name))] },
    },
    {
      name: "engine-core-consumers",
      severity: "error",
      comment:
        "The engine family's core (@miragon/pulse-engine-core, the contract every dialect " +
        "implements) is imported only where a dialect is implemented (ENGINE_CORE_IMPLEMENTERS): " +
        "the src of a dialect's core (a family ENGINE_DIALECTS names), never its ./testing entry " +
        "(src/testing/, which ships on npm), and Pulse for VS Code's contract barrel " +
        "(apps/vscode/src/contract), and by test files and test-support anywhere. The " +
        "extension's core, adapters and host reach it through the barrel. Not another family's " +
        "core, not the engine connector (although engine-core is its own family's core) and not " +
        "the CLI, until they serve a second dialect (owner decision 2026-11-09: they reach it " +
        "through c7-core's causeOf), not the MCP server app and no other package. A relative " +
        "escape into packages/connectors/engine/engine-core is a violation too.",
      from: {
        pathNot: [
          ...ENGINE_CORE_IMPLEMENTERS,
          `^${escapeRegExp(ENGINE_CORE.tree)}/(?:src|test)/`,
          "[.]test[.]tsx?$",
          ...TEST_SUPPORT,
        ],
      },
      to: { path: [`^${escapeRegExp(ENGINE_CORE.tree)}/`, ...npm(escapeRegExp(ENGINE_CORE.name))] },
    },
    {
      name: "family-core-is-a-leaf",
      severity: "error",
      comment:
        "A family core (packages/connectors/<family>/<family>-core, e.g. @miragon/pulse-c7-core " +
        "or @miragon/pulse-engine-core) has no runtime dependency but the engine family's core: " +
        "its shipped code (the ./testing export included) imports only its own modules and the " +
        "main entry of @miragon/pulse-engine-core (the contract a dialect implements and the " +
        "rules every dialect shares, such as RootCauses; engine-core-consumers admits only a " +
        "dialect core's src, never its ./testing), no other workspace package, no subpath of " +
        "engine-core (./testing ships the kit), no relative escape into its tree, no npm package " +
        "and no Node built-in. The caller supplies every effect through a port (c7-core's " +
        "EngineTransport) and words the structured results.",
      from: { path: "^packages/connectors/([^/]+)/([^/]+)-core/src/", pathNot: ["[.]test[.]ts$"] },
      to: { pathNot: ["^packages/connectors/$1/$2-core/src/", ...ENGINE_CORE_ENTRY] },
    },
    {
      name: "family-core-consumers",
      severity: "error",
      comment:
        "A family core is imported by its own family's connector (connectors-own-their-family), " +
        "a dialect's core also by the engine module (engine-connector-spans-the-dialects), " +
        "and by the interface apps that bundle it (CORE_BUNDLERS: the CLI and the VS Code " +
        "extension's C7 adapter, apps/vscode/src/adapters/c7, bundle c7-core, the extension's " +
        "contract barrel, apps/vscode/src/contract, engine-core), " +
        "by no other app: the MCP server composes connectors, not their domain. The other " +
        "packages answer to their own rules: packages/core to core-is-foundation, a client to " +
        "clients-are-leaves, a family core to family-core-is-a-leaf.",
      from: { path: "^apps/", pathNot: CORE_BUNDLERS },
      to: { path: [FAMILY_CORE_TREE, ...npm(FAMILY_CORE)] },
    },
    {
      name: "cli-family-core-only-in-named-layers",
      severity: "error",
      comment:
        "In the CLI only the workflow commands (apps/cli/src/workflow), the engine port " +
        "(apps/cli/src/engine-port) and the two operation modules that apply the core's engine " +
        "REST rules to option values (operation/dates.ts: the date reading, operation/variables.ts: " +
        "the auto typing) import the family core it bundles (CLI_CORE); the command layer " +
        "reaches it through the workflow modules, tests may import it anywhere. Any other core " +
        "is cli-is-headless's.",
      from: {
        path: "^apps/cli/",
        pathNot: [
          "^apps/cli/src/(?:workflow|engine-port)/",
          "^apps/cli/src/operation/(?:dates|variables)[.]ts$",
          ...CLI_TEST_CODE,
        ],
      },
      to: { path: npm(CLI_CORE) },
    },
    {
      name: "shipped-code-not-to-testing",
      severity: "error",
      comment:
        "Shipped code (a package's or an app's src/ without its tests, their test-support and " +
        "its own ./testing entry) never imports a ./testing entry (no @miragon/pulse-*/testing, " +
        "no src/testing/ tree) nor a test-support module. They hold fixtures, fake ports and the " +
        "brand gates (pulse-ui/testing reads files with node:fs and parses with typescript), " +
        "which would ship in the package entry, in every server that composes it and in the " +
        "bundles. Tests, test-support and a ./testing entry import them. A ./testing entry is " +
        "published, but for the consumers' tests only, so it counts as test code here: as an " +
        "importer it is exempt, and no shipped module may reach it.",
      from: { path: `^${PACKAGE_ROOT}/src/`, pathNot: SRC_TEST_CODE },
      to: {
        path: [
          ...npm("@miragon/pulse-[^/]+/testing"),
          "/src/testing/",
          // test-support is exempt as an importer above, so shipped code may not reach it.
          ...TEST_SUPPORT,
        ],
      },
    },
    {
      name: "no-cross-package-deep-imports",
      severity: "error",
      comment:
        "Never reach into a sibling package's source tree by relative path: import its public " +
        "entry (@miragon/pulse-<pkg>, or a subpath like @miragon/pulse-widget-shell/widgets) so the " +
        "exports map stays the contract between packages.",
      from: { path: `^(${PACKAGE_ROOT})/` },
      to: { path: "^(packages|apps)/", pathNot: "^$1/" },
    },
    {
      name: "no-circular",
      severity: "error",
      comment:
        "Runtime import cycle: break it by extracting the shared piece into its own module " +
        "or by inverting the dependency (type-only cycles are tolerated).",
      from: {},
      to: { circular: true, viaOnly: { dependencyTypesNot: ["type-only"] } },
    },
    // ── The CLI (apps/cli): its own layers, the rules it brought from the operate repository ──
    {
      name: "cli-no-circular",
      severity: "error",
      comment:
        "The CLI (apps/cli) and the packages CLI_BUNDLES names (c7-core, the profile " +
        "format, the transport) have no import cycle at all, type-only cycles included (stricter than " +
        "no-circular above). Extract the shared part into its own module.",
      from: { path: `^(?:apps/cli|${CLI_BUNDLE_TREES})/` },
      to: { circular: true },
    },
    {
      name: "cli-no-deprecated-core",
      severity: "error",
      comment: "The CLI imports no deprecated Node built-in module.",
      from: { path: "^apps/cli/" },
      to: {
        dependencyTypes: ["core"],
        path: ["^(?:node:)?(?:punycode|domain|constants|sys|_linklist|_stream_wrap)$"],
      },
    },
    {
      name: "cli-not-to-test",
      severity: "error",
      comment:
        "Nothing in the CLI or in the packages CLI_BUNDLES names (c7-core, the profile " +
        "format, the transport) imports a test file (*.test.ts) of its own tree. Shared test helpers live in " +
        "apps/cli/test/support/ and in a bundled package's src/testing/.",
      from: { path: `^(apps/cli|${CLI_BUNDLE_TREES})/` },
      to: { path: "^$1/.*[.]test[.]ts$" },
    },
    {
      name: "cli-src-not-to-scripts-or-test",
      severity: "error",
      comment:
        "The CLI's shipped code (apps/cli/src, tests aside) never imports its generator and build " +
        "scripts (apps/cli/scripts) or its test code (apps/cli/test).",
      from: { path: "^apps/cli/src/", pathNot: CLI_TEST_CODE },
      to: { path: "^apps/cli/(?:scripts|test)/" },
    },
    {
      name: "cli-test-support-only-from-tests",
      severity: "error",
      comment: "apps/cli/test/support/ holds fakes for the CLI's tests; only test code imports it.",
      from: { path: "^apps/cli/", pathNot: CLI_TEST_CODE },
      to: { path: "^apps/cli/test/support/" },
    },
    {
      name: "cli-command-layer-only-from-bin",
      severity: "error",
      comment:
        "Only the entry point (apps/cli/src/bin) imports the command layer (apps/cli/src/cli).",
      from: { path: "^apps/cli/", pathNot: "^apps/cli/src/(?:bin|cli)/" },
      to: { path: "^apps/cli/src/cli/" },
    },
    {
      name: "cli-commander-only-in-command-layer",
      severity: "error",
      comment: "Only the CLI's command layer (apps/cli/src/cli) imports commander.",
      from: { path: "^apps/cli/", pathNot: "^apps/cli/src/cli/" },
      to: { path: npm("commander") },
    },
    {
      name: "cli-pure-layers-no-builtins",
      severity: "error",
      comment:
        "The CLI's pure layers (api, auth, catalog, docs, engine-port, engines, output, workflow, " +
        "errors.ts, util.ts) import no Node built-in module; WebCrypto and the timers are globals.",
      from: { path: CLI_PURE_LAYERS, pathNot: CLI_TEST_CODE },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "cli-operation-only-path-builtin",
      severity: "error",
      comment: "apps/cli/src/operation imports node:path and no other Node built-in module.",
      from: { path: "^apps/cli/src/operation/", pathNot: CLI_TEST_CODE },
      to: { dependencyTypes: ["core"], pathNot: "^(?:node:)?path(?:/(?:posix|win32))?$" },
    },
    {
      name: "cli-docs-only-catalog-errors-util",
      severity: "error",
      comment:
        "apps/cli/src/docs imports from the CLI's src only catalog/**, errors.ts and util.ts.",
      from: { path: "^apps/cli/src/docs/", pathNot: CLI_TEST_CODE },
      to: {
        path: "^apps/cli/src/",
        pathNot: "^apps/cli/src/(?:catalog|docs)/|^apps/cli/src/(?:errors|util)[.]ts$",
      },
    },
    {
      name: "cli-auth-allowed-imports",
      severity: "error",
      comment:
        "apps/cli/src/auth imports from the CLI's src only auth/**, config/**, " +
        "http/{client,status,types}.ts, errors.ts, util.ts and runtime.ts.",
      from: { path: "^apps/cli/src/auth/", pathNot: CLI_TEST_CODE },
      to: {
        path: "^apps/cli/src/",
        pathNot:
          "^apps/cli/src/(?:auth|config)/|^apps/cli/src/http/(?:client|status|types)[.]ts$|^apps/cli/src/(?:errors|util|runtime)[.]ts$",
      },
    },
    {
      name: "cli-config-not-to-auth",
      severity: "error",
      comment:
        "apps/cli/src/config never imports apps/cli/src/auth: authentication builds on the configuration.",
      from: { path: "^apps/cli/src/config/", pathNot: CLI_TEST_CODE },
      to: { path: "^apps/cli/src/auth/" },
    },
    {
      name: "cli-interactive-login-only-from-auth-command",
      severity: "error",
      comment:
        "Only the `auth login` command (apps/cli/src/cli/commands/auth.ts) may start a loopback " +
        "server or a browser; operation commands, api and ping never start an interactive login.",
      from: {
        path: "^apps/cli/",
        pathNot: [CLI_INTERACTIVE_LOGIN, "^apps/cli/src/cli/commands/auth[.]ts$", ...CLI_TEST_CODE],
      },
      to: { path: CLI_INTERACTIVE_LOGIN },
    },
    {
      name: "cli-workflow-not-to-cli-config-auth-bin",
      severity: "error",
      comment:
        "The workflow commands (apps/cli/src/workflow) build on catalog, operation, http, output, " +
        "errors and util; never on cli, config, auth or bin.",
      from: { path: "^apps/cli/src/workflow/", pathNot: CLI_TEST_CODE },
      to: { path: "^apps/cli/src/(?:cli|config|auth|bin)/" },
    },
    {
      name: "cli-workflow-only-from-command-layer",
      severity: "error",
      comment: "Only the command layer (apps/cli/src/cli) and the APIs use the workflow commands.",
      from: {
        path: "^apps/cli/src/",
        pathNot: ["^apps/cli/src/(?:cli|workflow|api)/", ...CLI_TEST_CODE],
      },
      to: { path: "^apps/cli/src/workflow/" },
    },
    {
      name: "cli-api-only-workflow-engine",
      severity: "error",
      comment:
        "An API (apps/cli/src/api) builds its engine port on apps/cli/src/workflow/engine.ts and " +
        "uses no other workflow module.",
      from: { path: "^apps/cli/src/api/", pathNot: CLI_TEST_CODE },
      to: { path: "^apps/cli/src/workflow/", pathNot: "^apps/cli/src/workflow/engine[.]ts$" },
    },
    {
      name: "cli-workflow-only-engine-port",
      severity: "error",
      comment:
        "The workflow commands know the engine port (apps/cli/src/engine-port), never an engine " +
        "adapter or an API.",
      from: { path: "^apps/cli/src/workflow/" },
      to: { path: "^apps/cli/src/(?:engines|api)/" },
    },
    {
      name: "cli-engine-port-types-only",
      severity: "error",
      comment: "apps/cli/src/engine-port holds interfaces only: it imports types, nothing else.",
      from: { path: "^apps/cli/src/engine-port/", pathNot: CLI_TEST_CODE },
      to: { dependencyTypesNot: ["type-only"] },
    },
    {
      name: "cli-api-only-from-adapters",
      severity: "error",
      comment:
        "Only the engine adapters (apps/cli/src/engines/<name>/adapter.ts) use an API (apps/cli/src/api).",
      from: {
        path: "^apps/cli/",
        pathNot: ["^apps/cli/src/api/", "^apps/cli/src/engines/[^/]+/adapter[.]ts$"],
      },
      to: { path: "^apps/cli/src/api/" },
    },
    {
      name: "cli-api-not-to-other-api",
      severity: "error",
      comment: "An API (apps/cli/src/api/<a>) never imports another API (apps/cli/src/api/<b>).",
      from: { path: "^apps/cli/src/api/([^/]+)/" },
      to: { path: "^apps/cli/src/api/", pathNot: "^apps/cli/src/api/$1/" },
    },
    {
      name: "cli-engines-not-to-each-other",
      severity: "error",
      comment:
        "An engine adapter (apps/cli/src/engines/<a>) never imports another one (apps/cli/src/engines/<b>).",
      from: { path: "^apps/cli/src/engines/([^/]+)/" },
      to: { path: "^apps/cli/src/engines/", pathNot: "^apps/cli/src/engines/$1/" },
    },
    {
      name: "cli-http-not-to-config-cli-operation",
      severity: "error",
      comment:
        "The CLI's HTTP layer (apps/cli/src/http) never depends on config, cli or operation.",
      from: { path: "^apps/cli/src/http/", pathNot: CLI_TEST_CODE },
      to: { path: "^apps/cli/src/(?:config|cli|operation)/" },
    },
    {
      name: "cli-generated-catalog-only-via-catalog-ts-or-adapters",
      severity: "error",
      comment:
        "The generated command catalog (apps/cli/src/generated) is read only by " +
        "apps/cli/src/catalog/catalog.ts and the engine adapters.",
      from: {
        path: "^apps/cli/",
        pathNot: [
          "^apps/cli/src/catalog/catalog[.]ts$",
          "^apps/cli/src/engines/[^/]+/adapter[.]ts$",
        ],
      },
      to: { path: "^apps/cli/src/generated/" },
    },
    {
      name: "cli-output-only-operation-result",
      severity: "error",
      comment: "apps/cli/src/output imports from apps/cli/src/operation only result.ts.",
      from: { path: "^apps/cli/src/output/", pathNot: CLI_TEST_CODE },
      to: { path: "^apps/cli/src/operation/", pathNot: "^apps/cli/src/operation/result[.]ts$" },
    },
    {
      name: "cli-output-operation-result-type-only",
      severity: "error",
      comment:
        "apps/cli/src/output imports only types from apps/cli/src/operation/result.ts (`import type`).",
      from: { path: "^apps/cli/src/output/", pathNot: CLI_TEST_CODE },
      to: { path: "^apps/cli/src/operation/result[.]ts$", dependencyTypesNot: ["type-only"] },
    },
    {
      name: "cli-scripts-only-catalog-types-and-schema",
      severity: "error",
      comment:
        "The catalog generator (apps/cli/scripts) imports from the CLI's src only " +
        "catalog/types.ts, schema.ts and rules.ts.",
      from: { path: "^apps/cli/scripts/", pathNot: CLI_TEST_CODE },
      to: { path: "^apps/cli/src/", pathNot: "^apps/cli/src/catalog/(?:types|schema|rules)[.]ts$" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    // The hey-api SDK of the c7 family (c7-client) is regenerated from the one Camunda 7 REST
    // spec (c7-core's spec/api.json, `pnpm generate`) and never edited by hand, so it is the one
    // tree kept out of the graph. Any other generated tree (a command catalog, a route table, say)
    // is cruised like hand-written code: list nothing else here.
    exclude: { path: ["^packages/connectors/c7/c7-client/src/generated/"] },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    // Keep workspace imports as node_modules/@miragon/pulse-* paths instead of
    // resolving the pnpm symlink to the sibling package's real path: the rules
    // above rely on the shapes staying distinguishable (see the header).
    preserveSymlinks: true,
  },
}
