/**
 * Architecture fitness functions: the dependency half of the CLAUDE.md
 * "Architecture invariants" made executable. Runs as `pnpm lint:architecture`
 * (chained into the root `pnpm lint`, so CI's quality job enforces it).
 *
 * Rule comments are written for the (human or AI) contributor who trips them:
 * each says what is forbidden and names the house path to use instead.
 *
 * Layout + naming carry the layer semantics. A family under `packages/connectors/<family>/` is one
 * source the MCP server reads, an engine API family (a dialect; today `c7`, the Camunda 7 REST API,
 * and `c8`, Camunda 8's Orchestration Cluster REST API, which the editor hosts read and the MCP
 * server reads through its own wire in the engine module's src/lib/engine) or another source (a
 * metrics store, say), or `engine`, the neutral
 * family above the dialects: the one module that serves every dialect and the core every dialect
 * implements. Its packages are named `<family>-<role>` (npm `@miragon/pulse-<family>-<role>`; the
 * naming gate holds the family name), keyed by the role suffix:
 *   - `<family>-connector`: the MCP module (tools and their input schemas, widget tools,
 *     widgets); a dialect brings none;
 *   - `<family>-client`: its SDK leaf (the generated REST SDK, say; c7-client), which only the
 *     family's connector (for a dialect's client the engine module) and tests import
 *     (client-consumers), never the family's adapter or an app;
 *   - `<family>-core`, when the family's interfaces share a pure domain: a leaf that the family's
 *     connector (for a dialect's core the engine module) and adapter and the interface apps that
 *     bundle it import (c7-core; c8-core, which the C8 adapter runs and the engine module in its
 *     src/lib/engine alone, engine-connector-c8-core-in-its-engine-layer); a dialect's core (a
 *     family DIALECT_FAMILIES names) has one edge out of its own
 *     tree, the main entry of the engine family's core (family-core-is-a-leaf,
 *     engine-core-consumers);
 *   - `<family>-adapter`: the family's adapter of the runtime view (packages/core/runtime-view): it
 *     implements the engine contract of engine-core for the editor hosts, which bundle it
 *     (c7-adapter, the C7 adapter, which runs c7-core; c8-adapter, the C8 adapter, which runs
 *     c8-core); it sends through its family's core and the transport, never through a client
 *     (client-consumers; another family's client trips adapters-own-their-family too,
 *     adapter-tests-own-their-family in the adapter's tests).
 * The engine family is the neutral layer. Its module
 * (`packages/connectors/engine/engine-connector`) is the one MCP module of every dialect and
 * imports the clients and cores of the dialect families ENGINE_DIALECTS names
 * (engine-connector-spans-the-dialects; the self-test holds each entry to a family of the tree
 * that brings no connector of its own). Its core
 * (`packages/connectors/engine/engine-core`, `@miragon/pulse-engine-core`, ENGINE_CORE) is the
 * contract every dialect implements, imported only where a dialect is implemented (a dialect
 * core's src, a family's adapter), where the runtime view of the editor hosts reads its answers
 * and where the engine module runs it, its server layers src/lib/engine, src/lib/core-adapter
 * and src/data, by its main entry (engine-core-consumers,
 * engine-connector-contract-by-its-main-entry).
 * The foundation packages every family builds on live under `packages/core/` (npm names
 * without a role suffix, e.g. `@miragon/pulse-widget-shell`), never one family's code; some of
 * them are leaves only their consumers import: the profile format (`@miragon/pulse-profile`,
 * PROFILE), read where a surface reads its profiles, the board format (`@miragon/pulse-board`,
 * BOARD), read where a surface reads its board files, the screens' format
 * (`@miragon/pulse-screens`, SCREENS), read where a surface builds or reads a shared screen, the
 * migration plan format (`@miragon/pulse-migration-plan`, MIGRATION_PLAN), read where the CLI
 * writes a plan file and the runtime view previews one, and
 * the transport (`@miragon/pulse-http`, HTTP), used where a surface sends its engine requests; the
 * building blocks
 * (`@miragon/pulse-blocks`, BLOCKS) are React on pulse-ui that only the surfaces rendering them
 * import. The apps under `apps/` sit ON TOP of
 * the packages: the MCP server (`@miragon/pulse-mcp-server`) composes the
 * connectors, and the web app (apps/web, `@miragon/pulse-web`) shows their views on pages of the
 * server (web-is-a-page); of the interface apps, the CLI (apps/cli, `@miragon/pulse-cli`) imports no
 * workspace package but the ones CLI_BUNDLES names, which tsdown inlines (its family core, with
 * the main entry of engine-core that core imports, the profile format for its config layer, the
 * transport for its http layer and the migration plan format for its workflow commands), and the
 * two editor hosts, the VS Code extension
 * (apps/vscode, the unscoped `pulse-cockpit`, because vsce rejects scoped names) and the Orca
 * plugin (apps/orca, `@miragon/pulse-orca`), compose the runtime view (packages/core/runtime-view)
 * with the family adapters (c7-adapter, c8-adapter) and read the contract's ids and read models
 * from engine-core's main entry, all of which esbuild bundles; the runtime view's host kit reads
 * the project files with the profile format, its core and Pulse for VS Code's Boards view the
 * board files with the board format, and its core the migration plan files with the migration
 * plan format. No package and no app imports an app (the closed-world
 * rules of the editor hosts and of the two packages they share live in each one's own
 * .dependency-cruiser.cjs).
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
 * (with an apps/cli, the editor hosts and the packages they share) with THIS config. A new or
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
const ORCA_PACKAGE = "@miragon/pulse-orca"
const WEB_PACKAGE = "@miragon/pulse-web"
const APP_PACKAGES = [SERVER_PACKAGE, CLI_PACKAGE, EXTENSION_PACKAGE, ORCA_PACKAGE, WEB_PACKAGE]
const APP_NAMES = APP_PACKAGES.map(escapeRegExp).join("|")

/**
 * The web app (apps/web, `@miragon/pulse-web`): the page a Pulse server serves under /app, the MCP
 * views on a page of their own and its own screens (owner decision D10 of 2026-11-19). What its
 * src may import (web-is-a-page): its own modules, the rendering libraries, pulse-ui by its root,
 * its BPMN entry and its stylesheet, the view runtime's view half, the engine module's views, the building
 * blocks its screens compose and the screens' format, whose JSON forms its screens name by type
 * alone (web-names-screens-by-type), each by its entry. As an import reaches the blocks and the
 * screens: resolved through the app's node_modules to the build (or the src of a package without
 * one) or bare.
 */
const WEB_SRC = "^apps/web/src/"
const WEB_IMPORTS = [
  WEB_SRC,
  ...npm("react|react-dom|lucide-react"),
  "(?:^|/)node_modules/@miragon/pulse-ui/",
  "^@miragon/pulse-ui(?:/(?:bpmn|theme[.]css))?$",
  "^@miragon/pulse-widget-shell/widgets$",
  "^@miragon/pulse-engine-connector/widgets$",
  "(?:^|/)node_modules/@miragon/pulse-blocks/(?:dist|src)/index[.](?:js|d[.]ts|tsx?)$",
  "^@miragon/pulse-blocks$",
  "(?:^|/)node_modules/@miragon/pulse-screens/(?:dist|src)/index[.](?:js|d[.]ts|ts)$",
  "^@miragon/pulse-screens$",
]

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
 * A family's client, `packages/connectors/<family>/<family>-client` (npm
 * `@miragon/pulse-<family>-client`, e.g. c7-client with its ./sdk): the wire the family's
 * connector sends through. Its rules key on the role, so a new dialect's client inherits them.
 */
const FAMILY_CLIENT = "@miragon/pulse-[^/]+-client"
const FAMILY_CLIENT_TREE = "^packages/connectors/[^/]+/[^/]+-client/"

/**
 * The engine module, `packages/connectors/engine/engine-connector` (npm
 * `@miragon/pulse-engine-connector`): one MCP server and one module, engine, for every dialect
 * (owner decisions 2026-11-07 and 2026-11-08). It imports the clients and cores of the dialect
 * families ENGINE_DIALECTS names, and the rule lets it import those of its own family, which has
 * no client and whose core, engine-core, it runs in its server layers alone, by the main entry
 * (ENGINE_CONNECTOR_CONTRACT_READERS; engine-connector-spans-the-dialects,
 * engine-core-consumers); every other connector keeps to its own family
 * (connectors-own-their-family). A dialect joins ENGINE_DIALECTS in the commit that first imports
 * it from the engine module.
 */
const ENGINE_CONNECTOR_TREE = "^packages/connectors/engine/engine-connector/"
const ENGINE_DIALECTS = ["c7", "c8"]
const ENGINE_MODULE_FAMILIES = ["engine", ...ENGINE_DIALECTS]

/**
 * The c8 family's core (packages/connectors/c8/c8-core, npm `@miragon/pulse-c8-core`): C8Runtime,
 * the contract's reads of a Camunda 8 cluster over a transport port, and C8Failures, the kind of
 * each failure. Of the engine module's shipped code only src/lib/engine imports it, where the
 * server's own Camunda 8 wire and its words live (c8-connection.ts, c8-errors.ts) and the runtime
 * of each call is built (engine-runtime.ts), by its main entry alone
 * (engine-connector-c8-core-in-its-engine-layer); its tests import it anywhere.
 */
const C8_CORE = { name: "@miragon/pulse-c8-core", tree: "packages/connectors/c8/c8-core" }
const C8_CORE_ANY = [`^${escapeRegExp(C8_CORE.tree)}/`, ...npm(escapeRegExp(C8_CORE.name))]
const C8_CORE_ENTRY = [
  `(^|/)node_modules/${escapeRegExp(C8_CORE.name)}/dist/index[.](js|d[.]ts)$`,
  `^${escapeRegExp(C8_CORE.name)}$`,
]
const ENGINE_CONNECTOR_ENGINE_LAYER = `${ENGINE_CONNECTOR_TREE}src/lib/engine/`

/**
 * The dialect families: the engine API families below the engine family, each of which implements
 * the engine contract in its core or its adapter (c7, Camunda 7's REST API; c8, Camunda 8's
 * Orchestration Cluster REST API). They key who implements engine-core (ENGINE_CORE_IMPLEMENTERS,
 * a dialect core's src) and whose core's test tree reads it (ENGINE_CORE_TESTS), so a family
 * core of another source (a metrics store, say) never imports the contract. A dialect joins here
 * with its core, before the engine module serves it; ENGINE_DIALECTS, the dialects the engine
 * module serves, names a subset (the self-test holds that).
 */
const DIALECT_FAMILIES = ["c7", "c8"]
const DIALECT_CORE_TREE = `^packages/connectors/(?:${DIALECT_FAMILIES.join("|")})/[^/]+-core/`

/**
 * The interface apps (or the part of an app) that bundle a family core (tsdown or esbuild inlines
 * it), each with the one core it bundles. The keys are, with the family's own connector (for a
 * dialect's core the engine module) and adapter, the only importers of a family core
 * (family-core-consumers; engine-core-consumers narrows who imports engine-core). This config
 * reads the name and tree of the CLI's entry only: the CLI's rules below hold the core it
 * bundles as part of the CLI, which gets engine-core only inlined through c7-core and never
 * imports it (cli-is-headless). The editor hosts are no bundler of a family core: they import
 * engine-core's main entry for the contract's ids and read models (engine-core-consumers,
 * editor-hosts-reach-dialects-through-adapters; their closed worlds hold them to that entry) and
 * reach a dialect's core (c7-core) only through the family adapter their composition root wires.
 */
const CORE_BUNDLES = {
  "^apps/cli/": {
    name: "@miragon/pulse-c7-core",
    tree: "packages/connectors/c7/c7-core",
  },
}

/**
 * The runtime view (packages/core/runtime-view) and a family's adapter of its contract
 * (packages/connectors/<family>/<family>-adapter): what the editor hosts compose, and only they.
 */
const RUNTIME_VIEW = "@miragon/pulse-runtime-view"
const RUNTIME_VIEW_TREE = "^packages/core/runtime-view/"
const FAMILY_ADAPTER = "@miragon/pulse-[^/]+-adapter"
const FAMILY_ADAPTER_TREE = "^packages/connectors/[^/]+/[^/]+-adapter/"
const EDITOR_HOSTS = ["^apps/vscode/", "^apps/orca/"]
const EDITOR_HOST_SOURCES = EDITOR_HOSTS.map((host) => `${host}src/`)

const CORE_BUNDLERS = Object.keys(CORE_BUNDLES)
const CLI_CORE = escapeRegExp(CORE_BUNDLES["^apps/cli/"].name)

/**
 * c7-core's ./runtime entry as its tree (src/runtime/): the reads of the engine contract and what
 * they build on, which a family's adapter runs and the CLI never carries
 * (cli-without-the-c7-runtime).
 */
const C7_RUNTIME_TREE = `^${escapeRegExp(CORE_BUNDLES["^apps/cli/"].tree)}/src/runtime/`

/**
 * The profile format (packages/core/profile, npm `@miragon/pulse-profile`): the one parser of the
 * profile files of the CLI, Pulse for VS Code and the MCP server. A foundation package, not a
 * family core, so it stays out of CORE_BUNDLES (whose keys loosen family-core-consumers): its own
 * rules are profile-is-a-leaf and profile-consumers.
 */
const PROFILE = { name: "@miragon/pulse-profile", tree: "packages/core/profile" }

/**
 * Where a surface reads its profiles, the only shipped importers of PROFILE: the CLI's config
 * layer, the connections of the runtime view's host kit, where Pulse for VS Code and Pulse for Orca
 * parse their project files (its closed world, packages/core/runtime-view/.dependency-cruiser.cjs,
 * admits the edge on its own) and the engine connector's configuration (its module definition,
 * the profiles it builds from the environment, the provider port that names the flavors). Tests
 * import it anywhere.
 */
const PROFILE_READERS = [
  "^apps/cli/src/config/",
  "^packages/core/runtime-view/src/host-kit/connections/",
  "^packages/connectors/engine/engine-connector/src/(?:module|engine-profiles|engine-profile-auth|engine-profile-words|engine-provider)[.]ts$",
]

/**
 * The board format (packages/core/board, npm `@miragon/pulse-board`): the one parser of the board
 * files (`.pulse/boards/*.board.json`) and their vocabulary, for every surface that shows a board.
 * A foundation package and a leaf like the profile format, so it stays out of CORE_BUNDLES too:
 * its own rules are board-format-is-a-leaf and board-consumers.
 */
const BOARD = { name: "@miragon/pulse-board", tree: "packages/core/board" }

/**
 * The engine connector's view models (src/view-models.ts and its siblings src/view-models.*.ts):
 * the shapes its data builders hand its widgets, which the widgets read by type.
 */
const ENGINE_CONNECTOR_VIEW_MODELS = `${ENGINE_CONNECTOR_TREE}src/view-models[.\\w-]*[.]ts$`

/**
 * Where the engine connector reads its board files and builds them (with boards in the MCP
 * server, owner decision 2026-11-16): the files of ENGINE_BOARDS_DIR at configuration
 * (src/engine-boards.ts, and src/board-files.ts, the files as its parts hand them on) and the
 * board feed's builder (src/data). Its view models name a built board's JSON form by type only
 * (connector-view-models-board-types-only); its widgets, tools and widget tools never import it.
 */
const ENGINE_CONNECTOR_BOARD_READERS = [
  `${ENGINE_CONNECTOR_TREE}src/(?:engine-boards|board-files)[.]ts$`,
  `${ENGINE_CONNECTOR_TREE}src/data/`,
  ENGINE_CONNECTOR_VIEW_MODELS,
]

/**
 * Pulse's building blocks (packages/core/blocks, npm `@miragon/pulse-blocks`): the React pieces
 * more than one surface renders over the same data (owner decision D8 of 2026-11-12, executed for
 * a board's tiles on 2026-11-16), props, callbacks and the slots a surface brings, no host and no
 * React context. A foundation package with its own rules: blocks-are-building-blocks and
 * blocks-consumers.
 */
const BLOCKS = { name: "@miragon/pulse-blocks", tree: "packages/core/blocks" }
const BLOCKS_SRC = `^${escapeRegExp(BLOCKS.tree)}/src/`

/**
 * What the blocks' shipped code imports: its own modules, React, Lucide, pulse-ui's root and its
 * framework-free ./format and ./tones, the board format's main entry, for the types of a built
 * board's JSON form, and the screens' main entry (the screens' format, owner decision D10 of
 * 2026-11-19), for the JSON forms of the shared screens and the rules a surface applies to them in
 * the browser (a process list's filter); never the screens' ./builder or ./testing. As an import
 * reaches pulse-ui, the board format and the screens: resolved through the importer's node_modules
 * (to the build in the repository, to the src of a package without one) or bare.
 */
const BLOCKS_IMPORTS = [
  BLOCKS_SRC,
  ...npm("react|react-dom|lucide-react"),
  "(?:^|/)node_modules/@miragon/pulse-ui/(?:dist|src)/(?:(?:format|tones)/)?index[.](?:js|d[.]ts|tsx?)$",
  "^@miragon/pulse-ui(?:/(?:format|tones))?$",
  `(?:^|/)node_modules/${escapeRegExp(BOARD.name)}/(?:dist|src)/index[.](?:js|d[.]ts|ts)$`,
  `^${escapeRegExp(BOARD.name)}$`,
  `(?:^|/)node_modules/@miragon/pulse-screens/(?:dist|src)/index[.](?:js|d[.]ts|ts)$`,
  `^@miragon/pulse-screens$`,
]

/**
 * Where a surface renders the blocks, their only shipped importers: the runtime view's webview
 * (a board's tiles and the engine tab's process list in Pulse for VS Code and Pulse for Orca; its
 * closed world holds it to the main entry), the engine connector's widgets (the cockpit's board
 * route, which brings its own table, id and diagram as the slots) and the web app's src (its own
 * screens, owner decision D10 of 2026-11-19, by the main entry: web-is-a-page). Tests import them
 * anywhere.
 */
const BLOCKS_RENDERERS = [
  `${RUNTIME_VIEW_TREE}src/webview/`,
  `${ENGINE_CONNECTOR_TREE}src/widgets/`,
  WEB_SRC,
]

/**
 * Where a surface reads its board files, the only shipped importers of BOARD's main entry: the
 * runtime view's core (the board panel both editor hosts open; its closed world admits the edge on
 * its own and keeps the protocol free of it), the src of the editor hosts (Pulse for VS Code's
 * Boards view), the engine connector's board layers (ENGINE_CONNECTOR_BOARD_READERS) and the
 * building blocks, which render a built board's JSON form (BLOCKS_IMPORTS: its main entry alone).
 * Tests import it anywhere.
 */
const BOARD_READERS = [
  `${RUNTIME_VIEW_TREE}src/core/`,
  ...EDITOR_HOST_SOURCES,
  ...ENGINE_CONNECTOR_BOARD_READERS,
  BLOCKS_SRC,
]

/**
 * The board builder (`@miragon/pulse-board/builder`, the package's src/builder/): a board's
 * numbers over the seven board reads of the engine contract, a model of no text, and the roll-up
 * onto collapsed sub-processes. The package's named exception, written like the runtime view's:
 * it builds on the main entry of engine-core (board-builder-builds-on-the-engine-contract), the
 * format stays a leaf. As an import reaches it: a relative escape into its tree, resolved through
 * an importer's node_modules to its build (shape 2) or bare (shape 3).
 */
const BOARD_BUILDER_TREE = `^${escapeRegExp(BOARD.tree)}/src/builder/`
const BOARD_BUILDER = [
  BOARD_BUILDER_TREE,
  `(?:^|/)node_modules/${escapeRegExp(BOARD.name)}/dist/builder/`,
  `^${escapeRegExp(BOARD.name)}/builder(?:/|$)`,
]

/**
 * The board builder's main entry as the screens' builder reaches it: resolved through its
 * node_modules to the build, or bare. Never a file of its tree by path, ./testing or the format.
 */
const BOARD_BUILDER_ENTRY = [
  `(?:^|/)node_modules/${escapeRegExp(BOARD.name)}/dist/builder/index[.](?:js|d[.]ts)$`,
  `^${escapeRegExp(BOARD.name)}/builder$`,
]

/**
 * Where a surface builds a board's numbers, the only shipped importers of the builder: the runtime
 * view's core (the board panel and the definition and instance views, which draw the same roll-up), the engine
 * connector's data builders (src/data: the board feed, with boards in the MCP server) and the
 * screens' builder (packages/core/screens/src/builder: the instance screen's markers roll up onto
 * collapsed sub-processes with the board's CollapsedShapes, so no third copy of the XML tag
 * reader; owner decision D8 as amended on 2026-11-19). Tests import it anywhere.
 */
const BOARD_BUILDERS = [
  `${RUNTIME_VIEW_TREE}src/core/`,
  `${ENGINE_CONNECTOR_TREE}src/data/`,
  `^packages/core/screens/src/builder/`,
]

/**
 * The board package's tests that read the engine contract its builder builds on: its test tree and
 * the builder's own test files. core-is-foundation leaves them out, since they import engine-core
 * and its ./testing entry (the kit's fake and world); board-tests-build-on-the-engine-contract
 * keeps every other family's package out of them. The format's own tests stay under
 * core-is-foundation.
 */
const BOARD_TEST_TREE = `^${escapeRegExp(BOARD.tree)}/test/`
const BOARD_TESTS = [BOARD_TEST_TREE, `${BOARD_BUILDER_TREE}.+[.]test[.]ts$`]

/**
 * The screens (packages/core/screens, npm `@miragon/pulse-screens`; owner decision D8 as amended on
 * 2026-11-19, apps/vscode/docs/adr/ui-foundation.md): the JSON forms of the screens the web app and
 * the editors share, their codes, the targets a screen opens and the pure rules a surface applies
 * to them (the main entry and ./testing, a leaf: screens-format-is-a-leaf), and in ./builder each
 * screen's numbers over the engine contract, a model of no text, the package's named exception
 * written like the board builder's (screens-builder-builds-on-the-engine-contract). A foundation
 * package, so it stays out of CORE_BUNDLES: who imports it is screens-format-consumers' and
 * screens-builder-consumers'. As an import reaches the builder: a relative escape into its tree,
 * resolved through an importer's node_modules to its build (shape 2) or bare (shape 3).
 */
const SCREENS = { name: "@miragon/pulse-screens", tree: "packages/core/screens" }
const SCREENS_BUILDER_TREE = `^${escapeRegExp(SCREENS.tree)}/src/builder/`
const SCREENS_BUILDER = [
  SCREENS_BUILDER_TREE,
  `(?:^|/)node_modules/${escapeRegExp(SCREENS.name)}/dist/builder/`,
  `^${escapeRegExp(SCREENS.name)}/builder(?:/|$)`,
]

/**
 * Where a surface builds a shared screen's numbers and applies its rules, the only shipped
 * importers of the screens' builder: the runtime view's core (the engine panel of both editor
 * hosts) and the engine connector's data builders (src/data, where the screen feeds of the web app
 * build them). The format's readers are these, the building blocks (BLOCKS_SRC, held to the
 * format's main entry by blocks-are-building-blocks), which render a screen's JSON form and apply
 * its rules in the browser (owner decision D10 of 2026-11-19), and the web app's src, which names
 * a screen's JSON form by type alone (web-names-screens-by-type) and renders it with the blocks.
 * Tests import them anywhere.
 */
const SCREENS_BUILDERS = [`${RUNTIME_VIEW_TREE}src/core/`, `${ENGINE_CONNECTOR_TREE}src/data/`]
const SCREENS_READERS = [...SCREENS_BUILDERS, BLOCKS_SRC, WEB_SRC]

/**
 * The screens package's tests that read the engine contract its builder builds on: its test tree
 * and the builder's own test files, which core-is-foundation leaves out, as the board package's;
 * screens-tests-build-on-the-engine-contract keeps every other family's package out of them.
 */
const SCREENS_TEST_TREE = `^${escapeRegExp(SCREENS.tree)}/test/`
const SCREENS_TESTS = [SCREENS_TEST_TREE, `${SCREENS_BUILDER_TREE}.+[.]test[.]ts$`]

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
 * Where a surface sends its engine requests or signs a person in, the only shipped importers of
 * HTTP: the CLI's http, auth and operation layers, the family adapters of the runtime view that
 * Pulse for VS Code and Pulse for Orca bundle (packages/connectors/<family>/<family>-adapter/src;
 * its closed world narrows the edge: the C7 adapter's to its wire, src/engine-rest/http, and the
 * transport's main entry), a connector's src/lib/engine, where it builds each engine's transport
 * once at boot behind resolveEngine/withEngine (keyed by the role, so a new family's connector
 * inherits it), and in widget-shell the MCP server's web sign-in (src/web) and the one discovery
 * of the server's own identity provider (src/oauth-discovery.ts), which run the OAuth client
 * protocol of ./oauth against that provider (widget-shell-oauth-by-the-oauth-entry narrows both to
 * that entry). Not a connector's tools, data builders or widgets: a transport built there would
 * bypass the routing and the credential of invariant 2. Never the MCP server app's shipped code: it
 * composes connectors. Tests import it anywhere, as they do the profile format.
 */
const SHELL_OAUTH = [
  "^packages/core/widget-shell/src/web/",
  "^packages/core/widget-shell/src/oauth-discovery[.]ts$",
]
const HTTP_USERS = [
  "^apps/cli/src/(?:http|auth|operation)/",
  "^packages/connectors/[^/]+/[^/]+-adapter/src/",
  "^packages/connectors/[^/]+/[^/]+-connector/src/lib/engine/",
  ...SHELL_OAUTH,
]

/**
 * The transport's two entries as an import reaches them: resolved through the importer's
 * node_modules to the build (shape 2) or bare and unresolved (shape 3). widget-shell's web
 * sign-in and its provider's discovery import ./oauth and the main entry's types alone.
 */
const HTTP_OAUTH_ENTRY = [
  `(^|/)node_modules/${escapeRegExp(HTTP.name)}/dist/oauth/index[.](js|d[.]ts)$`,
  `^${escapeRegExp(HTTP.name)}/oauth$`,
]
const HTTP_MAIN_ENTRY = [
  `(^|/)node_modules/${escapeRegExp(HTTP.name)}/dist/index[.](js|d[.]ts)$`,
  `^${escapeRegExp(HTTP.name)}$`,
]
const HTTP_ANY = [`^${escapeRegExp(HTTP.tree)}/`, ...npm(escapeRegExp(HTTP.name))]

/**
 * The migration plan format (packages/core/migration-plan, npm `@miragon/pulse-migration-plan`,
 * private): the one parser and writer of the migration plan files
 * (`.pulse/migrations/*.migration.json`) that `pulse plan-migration` writes and the runtime view
 * previews, their words, file names and id and version rules. A foundation package and a leaf
 * like the board format, so it stays out of CORE_BUNDLES too: its own rules are
 * migration-plan-is-a-leaf and migration-plan-consumers.
 */
const MIGRATION_PLAN = {
  name: "@miragon/pulse-migration-plan",
  tree: "packages/core/migration-plan",
}

/**
 * Where a surface reads or writes its plan files, the only shipped importers of MIGRATION_PLAN:
 * the CLI's workflow commands (`pulse plan-migration` writes a plan file) and the runtime view's
 * migration plan editor (src/core/plans, which Pulse for VS Code opens; its closed world admits
 * the edge from the core). Tests import it anywhere.
 */
const MIGRATION_PLAN_READERS = [
  "^apps/cli/src/workflow/",
  "^packages/core/runtime-view/src/core/plans/",
]

/**
 * The workspace packages the CLI may bundle (tsdown inlines what it imports, so the published CLI
 * depends on none of them): its family core, CORE_BUNDLES' entry for apps/cli, the profile
 * format, which its config layer reads the profiles with, the transport, which its http,
 * auth and operation layers send the engine requests with, and the migration plan format, which
 * its workflow commands write a plan file with. The
 * only workspace packages cli-is-headless lets the CLI import; cli-no-circular and
 * cli-not-to-test hold their trees as part of the CLI.
 */
const CLI_BUNDLES = [CORE_BUNDLES["^apps/cli/"], PROFILE, HTTP, MIGRATION_PLAN]
const CLI_BUNDLE_NAMES = CLI_BUNDLES.map(({ name }) => escapeRegExp(name)).join("|")
const CLI_BUNDLE_TREES = CLI_BUNDLES.map(({ tree }) => escapeRegExp(tree)).join("|")

/**
 * The engine family's core (packages/connectors/engine/engine-core, npm
 * `@miragon/pulse-engine-core`): the contract every dialect implements, the ports, read models,
 * queries and failure kinds a process engine answers in, whatever its dialect, the rules every
 * dialect shares (RootCauses), and in ./testing the conformance kit and the fake (owner
 * decisions 2026-11-08 and 2026-11-09: the engine family is the neutral layer, c7 and c8 the
 * dialect families below it). A family core, so family-core-is-a-leaf holds it as it holds
 * every core; engine-core-consumers holds who imports it.
 */
const ENGINE_CORE = {
  name: "@miragon/pulse-engine-core",
  tree: "packages/connectors/engine/engine-core",
}

/**
 * Where a dialect is implemented, shipped importers of ENGINE_CORE: the src of a dialect's core
 * (a family DIALECT_FAMILIES names), never its ./testing entry (src/testing/, the dialect's
 * fixtures, which ship on npm), and the src of a family's adapter of the runtime view, which
 * implements the contract for the editor hosts.
 */
const ENGINE_CORE_IMPLEMENTERS = [
  `${DIALECT_CORE_TREE}src/(?!testing/)`,
  `${FAMILY_ADAPTER_TREE}src/`,
]

/**
 * Where the runtime view reads the contract's answers, the other shipped importers of
 * ENGINE_CORE (owner decision 2026-11-09 on #585: the runtime view's contract layer became
 * engine-core, one home of the contract): the runtime view's layers that speak it (src/ports, the
 * ports an editor host and an engine family plug in; src/core; src/model; src/host-kit), never its
 * webview, which renders protocol view models, and the editor hosts' src, which wire them and
 * name ids. Their closed worlds hold each to engine-core's main entry. The board builder
 * (`@miragon/pulse-board/builder`, BOARD_BUILDER_TREE) reads the seven board reads through it too,
 * held to the main entry by board-builder-builds-on-the-engine-contract, and so does the screens'
 * builder (`@miragon/pulse-screens/builder`, SCREENS_BUILDER_TREE), held by
 * screens-builder-builds-on-the-engine-contract. The engine connector
 * reads it in its server layers (ENGINE_CONNECTOR_CONTRACT_READERS, below). The CLI does not
 * until it serves a second dialect (owner decision 2026-11-09): it reaches the contract's rules
 * through c7-core's causeOf. Test files and test-support import it anywhere, the test trees of the
 * runtime view, the adapters, the dialect cores, the board package and the screens package too
 * (ENGINE_CORE_TESTS).
 */
const ENGINE_CORE_READERS = [
  `${RUNTIME_VIEW_TREE}src/(?:ports|core|model|host-kit)/`,
  ...EDITOR_HOST_SOURCES,
  BOARD_BUILDER_TREE,
  SCREENS_BUILDER_TREE,
]

/**
 * Where the engine module runs the engine contract, the connector's shipped importers of
 * ENGINE_CORE (owner decision 2026-11-16 with boards in the MCP server, the case #488 names: a
 * second interface needs the same use case with the same rules): src/lib/engine (the runtime of
 * each dialect it serves, runtimeOf, and the mapping of its engine errors onto RuntimeError),
 * src/lib/core-adapter (a dialect's port the runtime reads over) and src/data (the builders of
 * the views). engine-connector-contract-by-its-main-entry holds them to the main entry. Its view
 * models, widgets, src/lib/shared and tools stay out, as the CLI does.
 */
const ENGINE_CONNECTOR_CONTRACT_READERS = [
  `${ENGINE_CONNECTOR_TREE}src/(?:lib/(?:engine|core-adapter)|data)/`,
]

/**
 * The test trees of the packages that run the contract, the runtime view's, the family adapters',
 * the dialect cores', the board package's and the screens package's, whose builders read it (their support modules, fakes
 * and worlds, which are no *.test.ts): they import engine-core and its ./testing entry. Another
 * package's test tree imports it only from a test file or test-support, as its src does. The editor
 * hosts' test trees answer to their closed worlds; the CLI's are cli-is-headless's.
 */
const ENGINE_CORE_TESTS = [
  `${RUNTIME_VIEW_TREE}test/`,
  `${FAMILY_ADAPTER_TREE}test/`,
  `${DIALECT_CORE_TREE}test/`,
  BOARD_TEST_TREE,
  SCREENS_TEST_TREE,
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

/**
 * What a family's adapter of the runtime view imports of the workspace beside its own family's
 * core: the contract it implements (engine-core), the runtime view, whose ./ports name the plug it
 * provides, and the transport it sends with (HTTP_USERS). The adapter rules key on the role.
 */
const ADAPTER_IMPORTS = [
  ...npm(escapeRegExp(ENGINE_CORE.name)),
  `${RUNTIME_VIEW}(/|$)`,
  ...npm(escapeRegExp(HTTP.name)),
]

/**
 * What a family's adapter's tests import beside ADAPTER_IMPORTS: the board format and its builder,
 * which build a board over the adapter's runtime, and the screens with their builder, which build
 * the shared screens over it, so a test holds the adapter to the numbers the other surfaces show
 * (c7-core's recorded board and screen engines). Only adapter-tests-own-their-family admits them:
 * adapters-own-their-family, board-consumers, board-builder-consumers,
 * screens-format-consumers, screens-builder-consumers and the adapter's closed world keep them
 * out of its src.
 */
const ADAPTER_TEST_IMPORTS = npm(`${escapeRegExp(BOARD.name)}|${escapeRegExp(SCREENS.name)}`)

/**
 * A family's adapter with its family as $1, the `from` of adapters-own-their-family, and its test
 * code (its test tree, its test files and their test-support), the `from` of
 * adapter-tests-own-their-family, which the first rule leaves out. Its src, its scripts and a
 * ./testing entry it ships are no test code.
 */
const FAMILY_ADAPTER_OWN = "^packages/connectors/[^/]+/([^/]+)-adapter/"
const FAMILY_ADAPTER_TEST_CODE = `${FAMILY_ADAPTER_OWN}(?:test/|test-support/|.*/test-support/|.*[.]test(?:-support)?[.]tsx?$)`

/**
 * The `to` of both adapter rules: any workspace package but the adapter's own modules, its
 * family's core, ADAPTER_IMPORTS and what the rule admits beside them. Its own family's client,
 * in each shape, is client-consumers', so that edge trips that rule alone; another family's
 * client stays the adapter rules' too, in the adapter's tests as well, where client-consumers
 * admits every client.
 */
const adapterFamilyTargets = (admitted) => ({
  path: ["^packages/(core|connectors)/", "@miragon/pulse-"],
  pathNot: [
    "^packages/connectors/[^/]+/$1-adapter/(?!node_modules/@miragon/pulse-)",
    "@miragon/pulse-$1-core(/|$)",
    ...ADAPTER_IMPORTS,
    ...admitted,
    "^packages/connectors/[^/]+/$1-client/",
    ...npm("@miragon/pulse-$1-client"),
  ],
})

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
 * pulse-ui's framework-free entries, one folder each under src/ (`./format`, `./tones`,
 * `./glossary`): the UI foundation every Pulse UI shares at runtime, the VS Code extension's core
 * and webview included, and a page that loads the glossary in a browser as it is. The group names
 * the folder, so an entry imports only its own (ui-foundation-entries-import-nothing).
 */
const UI_FOUNDATION_ENTRIES = "^packages/core/ui/src/(format|tones|glossary)/"

/**
 * pulse-ui's BPMN entry (`@miragon/pulse-ui/bpmn`, src/bpmn): the diagram for any page, the one
 * folder of the kit that imports bpmn-js (an optional peer). It reaches the rest of the kit
 * through the root entry alone (src/index.ts), so a bundle of the entry shares the kit's React
 * contexts with a bundle of the root, and the rest of the kit never imports it, so a page without
 * a diagram never resolves bpmn-js (ui-bpmn-in-its-entry-alone, ui-bpmn-reaches-the-kit-by-its-root).
 */
const UI_BPMN_ENTRY = "^packages/core/ui/src/bpmn/"
const UI_ROOT_ENTRY = "^packages/core/ui/src/index[.]ts$"

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
        "c7: @miragon/pulse-c7-client and @miragon/pulse-c7-core; c8: @miragon/pulse-c8-core, " +
        "in its src/lib/engine alone, engine-connector-c8-core-in-its-engine-layer), never " +
        "another family's. Its " +
        "own family engine has no client, and its core, engine-core, the contract every dialect " +
        "implements, it runs in its server layers src/lib/engine, src/lib/core-adapter and " +
        "src/data alone, by the main entry (engine-core-consumers, " +
        "engine-connector-contract-by-its-main-entry; admitted with boards, the case #488 names). " +
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
      name: "client-consumers",
      severity: "error",
      comment:
        "A family's client (packages/connectors/<family>/<family>-client, e.g. " +
        "@miragon/pulse-c7-client with its ./sdk) is the wire its family's connector sends " +
        "through: it is imported by that connector (connectors-own-their-family; the engine module " +
        "imports the clients of the dialects ENGINE_DIALECTS names, " +
        "engine-connector-spans-the-dialects) and by tests (a test file, test-support, a test " +
        "tree). No family's adapter imports one, its own family's included: an adapter of the " +
        "runtime view sends through its family's core and the transport, @miragon/pulse-http " +
        "(owner decision 2026-11-11). No app imports one: the MCP server composes connectors, not " +
        "their wire, and reaches an engine through resolveEngine/withEngine (CLAUDE.md invariant " +
        "2); the CLI sends through its own http layer, the editor hosts through a family's " +
        "adapter. No other package either: no foundation package, not the runtime view, no " +
        "family core (its scripts/ included), no shipped ./testing entry. A relative escape " +
        "into a client's tree, its generated SDK included, is a violation too.",
      from: {
        pathNot: [
          // A connector and a client answer to their own rules for a client:
          // connectors-own-their-family or engine-connector-spans-the-dialects, clients-are-leaves.
          // An adapter answers to this rule: adapters-own-their-family and, in its tests,
          // adapter-tests-own-their-family leave its own family's client to it and refuse another
          // family's client as well.
          "^packages/connectors/[^/]+/[^/]+-(?:connector|client)/",
          "[.]test[.]tsx?$",
          ...TEST_SUPPORT,
          `^${PACKAGE_ROOT}/(?:test|test-host)/`,
        ],
      },
      to: { path: [FAMILY_CLIENT_TREE, ...npm(FAMILY_CLIENT)] },
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
        "What every dialect implements lives in the engine family's core, engine-core, not here. " +
        "The runtime view answers to runtime-view-builds-on-the-engine-contract, the board " +
        "builder (packages/core/board/src/builder) to board-builder-builds-on-the-engine-contract " +
        "and the board package's tests that read the engine contract (its test tree, the " +
        "builder's own tests) to board-tests-build-on-the-engine-contract; the screens' builder " +
        "(packages/core/screens/src/builder) and tests answer to the screens' rules alike.",
      from: {
        path: "^packages/core/",
        pathNot: [
          RUNTIME_VIEW_TREE,
          BOARD_BUILDER_TREE,
          BOARD_TEST_TREE,
          SCREENS_BUILDER_TREE,
          SCREENS_TEST_TREE,
        ],
      },
      to: {
        path: [
          "^packages/connectors/",
          "@miragon/pulse-[^/]+-(connector|client|core|adapter)(/|$)",
        ],
      },
    },
    {
      name: "runtime-view-builds-on-the-engine-contract",
      severity: "error",
      comment:
        "The runtime view (packages/core/runtime-view, @miragon/pulse-runtime-view) is foundation " +
        "code like every package under packages/core, with one edge into a family, which the " +
        "owner accepted (decision 2026-11-09 on #585: the runtime view's contract layer became " +
        "@miragon/pulse-engine-core, the one home of the engine contract): engine-core by its " +
        "package entries, the main entry in the layers that speak the contract, ./testing in its " +
        "tests (engine-core-consumers and shipped-code-not-to-testing hold which). No connector, " +
        "client, adapter or other family core (a dialect's core such as c7-core stays with the " +
        "family's adapter), and no relative escape into engine-core's tree. A port only the " +
        "editor hosts need stays in the runtime view's src/ports.",
      from: { path: RUNTIME_VIEW_TREE },
      to: {
        path: [
          "^packages/connectors/",
          "@miragon/pulse-[^/]+-(connector|client|core|adapter)(/|$)",
        ],
        pathNot: npm(escapeRegExp(ENGINE_CORE.name)),
      },
    },
    {
      name: "ui-is-a-leaf",
      severity: "error",
      comment:
        "packages/core/ui (@miragon/pulse-ui) is the design kit every Pulse view and every customer UI " +
        "builds on: it imports no workspace package and nothing of the MCP, query, server or schema " +
        "stack (@modelcontextprotocol, hono, jose, TanStack, zod, prom-client, " +
        "@hey-api). What needs the host or a tool call belongs in widget-shell, which imports " +
        "pulse-ui, never the other way round (CLAUDE.md invariants 6 and 8); the BPMN diagram is " +
        "its own entry (ui-bpmn-in-its-entry-alone).",
      from: { path: "^packages/core/ui/" },
      to: {
        path: [
          "^packages/(?!core/ui/)",
          "@miragon/pulse-(?!ui(?:/|$))",
          ...npm(
            "@modelcontextprotocol/[^/]+|hono|@hono/[^/]+|jose|@tanstack/[^/]+|zod|prom-client|@hey-api/[^/]+",
          ),
        ],
      },
    },
    {
      name: "ui-bpmn-in-its-entry-alone",
      severity: "error",
      comment:
        "bpmn-js (and diagram-js under it) is an optional peer of pulse-ui that its BPMN entry " +
        "alone imports (src/bpmn, published as @miragon/pulse-ui/bpmn): the rest of the kit never " +
        "imports bpmn-js, diagram-js or a module of src/bpmn, so a page that renders no diagram " +
        "never resolves bpmn-js.",
      from: { path: "^packages/core/ui/", pathNot: UI_BPMN_ENTRY },
      to: { path: [UI_BPMN_ENTRY, ...npm("bpmn-js|diagram-js")] },
    },
    {
      name: "ui-bpmn-reaches-the-kit-by-its-root",
      severity: "error",
      comment:
        "pulse-ui's BPMN entry (src/bpmn) imports its own folder, the kit's root entry " +
        "(src/index.ts, never another file of the kit), React, Lucide and bpmn-js: a bundle of the " +
        "entry (the browser bundle's pulse-ui-bpmn.js) then takes the kit from the root's bundle, " +
        "one React and one copy of every context (the locale, the toasts). Its tests are exempt.",
      from: { path: UI_BPMN_ENTRY, pathNot: SRC_TEST_CODE },
      to: {
        pathNot: [
          UI_BPMN_ENTRY,
          UI_ROOT_ENTRY,
          ...npm("react|react-dom|lucide-react|bpmn-js|diagram-js"),
        ],
      },
    },
    {
      name: "ui-foundation-entries-import-nothing",
      severity: "error",
      comment:
        "pulse-ui's framework-free entries (src/format, src/tones and src/glossary, published as " +
        "@miragon/pulse-ui/format, @miragon/pulse-ui/tones and @miragon/pulse-ui/glossary) " +
        "import only their own folder: no React, no Radix, no tailwind-merge, no other file of " +
        "the kit, no Node built-in. Framework-free code (the runtime view's core, which Pulse " +
        "for VS Code and Pulse for Orca run outside the webview) bundles them, and a page loads " +
        "the glossary in a browser as it is, so what needs React, a class map, typescript or " +
        "node:fs stays in the kit's root or its ./testing, which may import them, never the " +
        "other way round.",
      from: { path: UI_FOUNDATION_ENTRIES, pathNot: SRC_TEST_CODE },
      to: { pathNot: "^packages/core/ui/src/$1/" },
    },
    // ── The browser/server seams: widget-shell's halves and connector widgets (review P7) ──
    // widget-shell stays ONE package (`/server` and `/widgets`) because its halves share one wire
    // protocol, src/protocol/ (tool results, the view name, the served fonts, the translator, the
    // BPMN-name reader, the web app's paths, codes and CSRF header). Three rules keep the parts
    // apart, so a later split is a path move: the view half (src/ui) imports only itself, the
    // protocol and the view stack; the server half (the rest of src/) never imports the view half
    // or the view stack; the protocol imports nothing but itself. tsconfig.widgets.json (DOM, no
    // Node types) and tsconfig.json (Node types, no DOM) hold the same seam for types; the
    // protocol is typed under both.
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
        "(src/bpmn-names.ts), widget-shell's `/widgets`, the view stack (VIEW_STACK) and the " +
        "building blocks (@miragon/pulse-blocks, which blocks-consumers holds to the widgets). Nothing " +
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
          ...npm(`${VIEW_STACK}|@miragon/pulse-widget-shell/widgets|${escapeRegExp(BLOCKS.name)}`),
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
        "@miragon/pulse-profile, the profile format, @miragon/pulse-http, the transport, and " +
        "@miragon/pulse-migration-plan, the migration plan format), " +
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
        "its profiles (PROFILE_READERS): the CLI's config layer (apps/cli/src/config), the " +
        "connections of the runtime view's host kit " +
        "(packages/core/runtime-view/src/host-kit/connections, where Pulse for VS Code and " +
        "Pulse for Orca parse their project files) and the engine " +
        "connector's configuration (src/module.ts, src/engine-profiles.ts with its " +
        "src/engine-profile-auth.ts and src/engine-profile-words.ts, src/engine-provider.ts), and " +
        "by tests anywhere. No widget, no other module, no other " +
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
      name: "board-format-is-a-leaf",
      severity: "error",
      comment:
        "The board format (packages/core/board, @miragon/pulse-board, its main entry and " +
        "./testing) has no runtime dependency: its shipped code imports only its own modules, " +
        "never the builder (src/builder), no workspace package, no npm package and no Node " +
        "built-in. It parses the text of a board file a reader hands it: finding and reading " +
        "the file, the engines a board names and every word a person reads around its problems " +
        "stay with the reader (the runtime view's board panel, Pulse for VS Code's Boards view); " +
        "the reads of its numbers are the builder's. Its tests may import vitest.",
      from: {
        path: `^${escapeRegExp(BOARD.tree)}/src/`,
        pathNot: ["[.]test[.]ts$", BOARD_BUILDER_TREE],
      },
      to: { pathNot: `^${escapeRegExp(BOARD.tree)}/src/(?!builder/)` },
    },
    {
      name: "board-builder-builds-on-the-engine-contract",
      severity: "error",
      comment:
        "The board builder (packages/core/board/src/builder, @miragon/pulse-board/builder) is the " +
        "board package's one edge into a family, the named exception written like the runtime " +
        "view's (decided with the package's home on 2026-11-15): it builds a board's numbers " +
        "over the seven board reads of the engine contract, so it imports its own modules, the " +
        "board format (src/format) and the main entry of @miragon/pulse-engine-core (an optional " +
        "peer of the package), nothing else: no other subpath of engine-core (./testing ships " +
        "the kit), no relative escape into its tree, no other workspace package, no npm package " +
        "and no Node built-in. Every word, format and navigation stays with the surface that " +
        "renders the model (the runtime view's BoardViews). Its tests may import vitest and the " +
        "kit.",
      from: { path: BOARD_BUILDER_TREE, pathNot: ["[.]test[.]ts$"] },
      to: {
        pathNot: [`^${escapeRegExp(BOARD.tree)}/src/(?:builder|format)/`, ...ENGINE_CORE_ENTRY],
      },
    },
    {
      name: "board-tests-build-on-the-engine-contract",
      severity: "error",
      comment:
        "The board package's tests that read the engine contract its builder builds on, its " +
        "test tree (packages/core/board/test) and the builder's own tests " +
        "(packages/core/board/src/builder/*.test.ts), which core-is-foundation leaves out, import " +
        "of the families only @miragon/pulse-engine-core, by its package entries: the main entry " +
        "and ./testing, the kit's fake and world (engine-core-consumers admits both). No " +
        "connector, client, adapter or other family core (a dialect's core such as c7-core stays " +
        "with its family's adapter; a board test reads the contract over the kit's fake), and no " +
        "relative escape into engine-core's tree. The format's own tests answer to " +
        "core-is-foundation.",
      from: { path: BOARD_TESTS },
      to: {
        path: [
          "^packages/connectors/",
          "@miragon/pulse-[^/]+-(connector|client|core|adapter)(/|$)",
        ],
        pathNot: npm(escapeRegExp(ENGINE_CORE.name)),
      },
    },
    {
      name: "board-consumers",
      severity: "error",
      comment:
        "The board format (@miragon/pulse-board) may be imported only where a surface reads its " +
        "board files (BOARD_READERS): the runtime view's core " +
        "(packages/core/runtime-view/src/core, the board panel both editor hosts open), the " +
        "src of the editor hosts (apps/vscode, apps/orca: the Boards view) and the engine " +
        "connector's board layers (src/engine-boards.ts and src/board-files.ts, which read " +
        "ENGINE_BOARDS_DIR, src/data, the board feed, and its view models by type, " +
        "connector-view-models-board-types-only) and the building blocks (packages/core/blocks/" +
        "src, the types of a built board's JSON form), and by tests anywhere. Not the runtime view's " +
        "other layers, not the connector's widgets, tools or widget tools, no other package and " +
        "no other app until it shows a board itself, through a rule change of its own. A " +
        "relative escape into packages/core/board is a violation too. Its builder answers to " +
        "board-builder-consumers.",
      from: {
        pathNot: [
          ...BOARD_READERS,
          `^${escapeRegExp(BOARD.tree)}/(?:src|test)/`,
          ...SRC_TEST_CODE,
          `^${PACKAGE_ROOT}/(?:test|test-host)/`,
        ],
      },
      to: {
        path: [`^${escapeRegExp(BOARD.tree)}/`, ...npm(escapeRegExp(BOARD.name))],
        pathNot: BOARD_BUILDER,
      },
    },
    {
      name: "board-builder-consumers",
      severity: "error",
      comment:
        "The board builder (@miragon/pulse-board/builder) may be imported only where a surface " +
        "builds a board's numbers (BOARD_BUILDERS): the runtime view's core " +
        "(packages/core/runtime-view/src/core: the board panel, and the definition and instance " +
        "views, which draw the same roll-up onto collapsed sub-processes), the engine " +
        "connector's data builders (src/data: the board feed) and the screens' builder " +
        "(packages/core/screens/src/builder, whose instance screen rolls its markers up the same " +
        "way, by the builder's entry: screens-builder-builds-on-the-engine-contract), and by " +
        "tests anywhere. Not the " +
        "editor hosts' src (they read board files, the runtime view builds their numbers), not " +
        "the runtime view's other layers, not the rest of the connector, no other package and no " +
        "other app until it shows a board itself, through a rule change of its own. A relative " +
        "escape into packages/core/board/src/builder is a violation too.",
      from: {
        pathNot: [
          ...BOARD_BUILDERS,
          `^${escapeRegExp(BOARD.tree)}/(?:src|test)/`,
          ...SRC_TEST_CODE,
          `^${PACKAGE_ROOT}/(?:test|test-host)/`,
        ],
      },
      to: { path: BOARD_BUILDER },
    },
    {
      name: "migration-plan-is-a-leaf",
      severity: "error",
      comment:
        "The migration plan format (packages/core/migration-plan, @miragon/pulse-migration-plan, " +
        "its main entry and ./testing) has no runtime dependency: its shipped code (the ./testing " +
        "export and its JSON fixtures included) imports only its own modules, no workspace " +
        "package, no npm package and no Node built-in. It parses and writes the text of a plan " +
        "file a reader hands it: finding, reading and writing the file, the engine a plan is " +
        "checked on and every engine request stay with the reader (the CLI's workflow commands, " +
        "the runtime view's migration plan editor). Its tests may import vitest and ajv.",
      from: { path: `^${escapeRegExp(MIGRATION_PLAN.tree)}/src/`, pathNot: ["[.]test[.]ts$"] },
      to: { pathNot: `^${escapeRegExp(MIGRATION_PLAN.tree)}/src/` },
    },
    {
      name: "migration-plan-consumers",
      severity: "error",
      comment:
        "The migration plan format (@miragon/pulse-migration-plan) may be imported only where a " +
        "surface writes or reads its plan files (MIGRATION_PLAN_READERS): the CLI's workflow " +
        "commands (apps/cli/src/workflow, pulse plan-migration) and the runtime view's migration " +
        "plan editor (packages/core/runtime-view/src/core/plans), and by tests anywhere. Not the " +
        "CLI's command layer or config, not the runtime view's other layers, not the editor " +
        "hosts' src (they hand the editor the file's text and write what it hands back), no " +
        "connector, no other package and " +
        "no other app until it reads a plan file itself, through a rule change of its own. A " +
        "relative escape into packages/core/migration-plan is a violation too.",
      from: {
        pathNot: [
          ...MIGRATION_PLAN_READERS,
          `^${escapeRegExp(MIGRATION_PLAN.tree)}/(?:src|test)/`,
          ...SRC_TEST_CODE,
          `^${PACKAGE_ROOT}/(?:test|test-host)/`,
        ],
      },
      to: {
        path: [`^${escapeRegExp(MIGRATION_PLAN.tree)}/`, ...npm(escapeRegExp(MIGRATION_PLAN.name))],
      },
    },
    {
      name: "screens-format-is-a-leaf",
      severity: "error",
      comment:
        "The screens' format (packages/core/screens, @miragon/pulse-screens, its main entry and " +
        "./testing) has no runtime dependency: its shipped code imports only its own modules, " +
        "never the builder (src/builder), no workspace package, no npm package and no Node " +
        "built-in. It holds the JSON forms of the shared screens, their codes, the targets a " +
        "screen opens and the pure rules a surface applies to them in the browser (a process " +
        "list's filter, the sums across engines); the reads of a screen's numbers are the " +
        "builder's and every word around them the surface's. Its tests may import vitest.",
      from: {
        path: `^${escapeRegExp(SCREENS.tree)}/src/`,
        pathNot: ["[.]test[.]ts$", SCREENS_BUILDER_TREE],
      },
      to: { pathNot: `^${escapeRegExp(SCREENS.tree)}/src/(?!builder/)` },
    },
    {
      name: "screens-builder-builds-on-the-engine-contract",
      severity: "error",
      comment:
        "The screens' builder (packages/core/screens/src/builder, @miragon/pulse-screens/builder) " +
        "is the screens package's one edge into a family, the named exception written like the " +
        "board builder's (owner decision D8 as amended on 2026-11-19): it builds each shared " +
        "screen's numbers over the reads of the engine contract, so it imports its own modules, " +
        "the format (src/format), the main entry of @miragon/pulse-engine-core and the board " +
        "builder's entry, @miragon/pulse-board/builder, whose CollapsedShapes rolls the instance " +
        "screen's markers up onto collapsed sub-processes (both optional peers of the package), " +
        "nothing else: no other subpath of engine-core (./testing ships the kit), not the board " +
        "format's main entry or ./testing, no relative escape into either tree, no other " +
        "workspace package, no npm package and no Node built-in. Every word, format and " +
        "navigation stays with the surface that renders the screen (the runtime view's core " +
        "words it in English). Its tests may import vitest and the kit.",
      from: { path: SCREENS_BUILDER_TREE, pathNot: ["[.]test[.]ts$"] },
      to: {
        pathNot: [
          `^${escapeRegExp(SCREENS.tree)}/src/(?:builder|format)/`,
          ...ENGINE_CORE_ENTRY,
          ...BOARD_BUILDER_ENTRY,
        ],
      },
    },
    {
      name: "screens-tests-build-on-the-engine-contract",
      severity: "error",
      comment:
        "The screens package's tests that read the engine contract its builder builds on, its " +
        "test tree (packages/core/screens/test) and the builder's own tests " +
        "(packages/core/screens/src/builder/*.test.ts), which core-is-foundation leaves out, " +
        "import of the families only @miragon/pulse-engine-core, by its package entries: the " +
        "main entry and ./testing, the kit's fake and world (engine-core-consumers admits both). " +
        "No connector, client, adapter or other family core (a dialect's recorded screens are " +
        "held by its family's adapter; a screens test reads the contract over the kit's fake), " +
        "and no relative escape into engine-core's tree.",
      from: { path: SCREENS_TESTS },
      to: {
        path: [
          "^packages/connectors/",
          "@miragon/pulse-[^/]+-(connector|client|core|adapter)(/|$)",
        ],
        pathNot: npm(escapeRegExp(ENGINE_CORE.name)),
      },
    },
    {
      name: "screens-format-consumers",
      severity: "error",
      comment:
        "The screens' format (@miragon/pulse-screens, its main entry; ./testing for tests " +
        "only, shipped-code-not-to-testing) may be imported only where a surface builds a " +
        "shared screen or applies its rules " +
        "(SCREENS_READERS): the runtime view's core (packages/core/runtime-view/src/core, the " +
        "engine panel both editor hosts open), the engine connector's data builders " +
        "(src/data, the screen feeds of the web app) and the building blocks " +
        "(packages/core/blocks/src, which render a screen's JSON form and filter a process list " +
        "in the browser), the web app's src (apps/web/src, whose screens name a screen's JSON " +
        "form by type alone, web-names-screens-by-type), and by tests anywhere. Not the runtime " +
        "view's protocol or other layers, not the rest of the connector, no other package and no " +
        "other app. A relative escape into packages/core/screens is a violation too. Its builder " +
        "answers to screens-builder-consumers.",
      from: {
        pathNot: [
          ...SCREENS_READERS,
          `^${escapeRegExp(SCREENS.tree)}/(?:src|test)/`,
          ...SRC_TEST_CODE,
          `^${PACKAGE_ROOT}/(?:test|test-host)/`,
        ],
      },
      to: {
        path: [`^${escapeRegExp(SCREENS.tree)}/`, ...npm(escapeRegExp(SCREENS.name))],
        pathNot: SCREENS_BUILDER,
      },
    },
    {
      name: "screens-builder-consumers",
      severity: "error",
      comment:
        "The screens' builder (@miragon/pulse-screens/builder) may be imported only where a " +
        "surface builds a shared screen's numbers (SCREENS_BUILDERS): the runtime view's core " +
        "(packages/core/runtime-view/src/core, whose engine panel delegates its numbers to it) " +
        "and the engine connector's data builders (src/data, the screen feeds of the web app), " +
        "and by tests anywhere. Not the editor hosts' src (the runtime view builds their " +
        "numbers), not the runtime view's other layers, not the rest of the connector, not the " +
        "building blocks or the web app (they render a screen's JSON form, never build it), no " +
        "other package and no other app. A relative escape into " +
        "packages/core/screens/src/builder is a violation too.",
      from: {
        pathNot: [
          ...SCREENS_BUILDERS,
          `^${escapeRegExp(SCREENS.tree)}/(?:src|test)/`,
          ...SRC_TEST_CODE,
          `^${PACKAGE_ROOT}/(?:test|test-host)/`,
        ],
      },
      to: { path: SCREENS_BUILDER },
    },
    {
      name: "blocks-are-building-blocks",
      severity: "error",
      comment:
        "Pulse's building blocks (packages/core/blocks, @miragon/pulse-blocks) are React on " +
        "@miragon/pulse-ui with props, callbacks and the slots a surface brings (its table, its " +
        "id, its diagram, its link): their shipped code imports only its own modules, react, " +
        "react-dom, lucide-react, pulse-ui's root, @miragon/pulse-ui/format and " +
        "@miragon/pulse-ui/tones, the board format's main entry (@miragon/pulse-board, the types " +
        "of a built board's JSON form) and the screens' main entry (@miragon/pulse-screens, the " +
        "JSON forms of the shared screens and the rules a surface applies to them in the " +
        "browser). Never widget-shell or ext-apps (a host's view runtime: the surface wires its " +
        "host through the slots), a family's package or engine-core, the board builder, the " +
        "screens' builder (a surface renders a screen's JSON form, never builds it), another " +
        "subpath, an npm package of the MCP stack or a Node built-in, and no relative escape. " +
        "Its tests may import vitest, Testing Library and the fixtures of the board and the " +
        "screens.",
      from: { path: BLOCKS_SRC, pathNot: SRC_TEST_CODE },
      to: { pathNot: BLOCKS_IMPORTS },
    },
    {
      name: "blocks-consumers",
      severity: "error",
      comment:
        "The building blocks (@miragon/pulse-blocks) may be imported only where a surface renders " +
        "them (BLOCKS_RENDERERS): the runtime view's webview (packages/core/runtime-view/src/" +
        "webview, a board's tiles and the engine tab in Pulse for VS Code and Pulse for Orca), " +
        "the engine connector's widgets (src/widgets, the cockpit's board route) and the web " +
        "app's src (apps/web/src, its own screens), and by tests anywhere. Not the runtime view's " +
        "other layers, not the rest of the connector (its data builders, tools, lib folders), no " +
        "other package and no other app until it renders them itself, through a rule change of " +
        "its own. A relative escape into packages/core/blocks is a violation too.",
      from: {
        pathNot: [
          ...BLOCKS_RENDERERS,
          `^${escapeRegExp(BLOCKS.tree)}/(?:src|test)/`,
          ...SRC_TEST_CODE,
          `^${PACKAGE_ROOT}/(?:test|test-host)/`,
        ],
      },
      to: { path: [`^${escapeRegExp(BLOCKS.tree)}/`, ...npm(escapeRegExp(BLOCKS.name))] },
    },
    {
      name: "connector-view-models-board-types-only",
      severity: "error",
      comment:
        "The engine connector's view models (src/view-models.ts, src/view-models.*.ts) are the " +
        "shapes its widgets read, compiled into every view bundle: they name a built board's " +
        "JSON form (BoardData of @miragon/pulse-board) by type only, never a value of the board " +
        "package, so no parser, builder or vocabulary reaches the widgets through them. A value " +
        "the widgets need of a board goes through the board feed's data.",
      from: { path: ENGINE_CONNECTOR_VIEW_MODELS },
      to: {
        path: [`^${escapeRegExp(BOARD.tree)}/`, ...npm(escapeRegExp(BOARD.name))],
        dependencyTypesNot: ["type-only"],
      },
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
        "engine requests or signs a person in (HTTP_USERS): the CLI's http, auth and operation " +
        "layers (apps/cli/src/http, src/auth, src/operation), the src of a family's adapter of " +
        "the runtime view (packages/connectors/<family>/<family>-adapter, which the editor hosts " +
        "bundle), a connector's src/lib/engine, where it builds " +
        "each engine's transport behind resolveEngine/withEngine, and in widget-shell src/web, " +
        "the web app's sign-in through the server's own provider, and src/oauth-discovery.ts, " +
        "that provider's one discovery (widget-shell-oauth-by-the-oauth-entry), and by tests " +
        "anywhere. Not a " +
        "connector's tools, data builders or widgets (they would bypass that routing), not the " +
        "MCP server app's shipped code (it composes connectors, which send), no other file of " +
        "widget-shell (its gate verifies tokens with jose, and what any of it needs of the " +
        "provider's discovery it reads through src/oauth-discovery.ts) and no " +
        "other foundation package, no " +
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
      name: "widget-shell-oauth-by-the-oauth-entry",
      severity: "error",
      comment:
        "widget-shell's web sign-in (src/web) and the one discovery of the server's own " +
        "identity provider (src/oauth-discovery.ts) run the OAuth client protocol of " +
        "@miragon/pulse-http/oauth (discovery, PKCE, the authorization request and its callback, " +
        "the token endpoint, revocation, the end of a session) and import the main entry by type " +
        "alone (Platform): they send nothing through the engine transport, so a server bundles no " +
        "more of the package than its OAuth client. Never ./testing, never a file of the " +
        "package by path. Their tests import anything.",
      from: { path: SHELL_OAUTH, pathNot: SRC_TEST_CODE },
      to: { path: HTTP_ANY, pathNot: HTTP_OAUTH_ENTRY, dependencyTypesNot: ["type-only"] },
    },
    {
      name: "widget-shell-oauth-by-the-oauth-entry",
      severity: "error",
      comment:
        "widget-shell's web sign-in (src/web) and its provider's discovery " +
        "(src/oauth-discovery.ts) reach @miragon/pulse-http by its ./oauth entry and, by type, " +
        "its main entry: not a type of another subpath or of a file of the package.",
      from: { path: SHELL_OAUTH, pathNot: SRC_TEST_CODE },
      to: {
        path: HTTP_ANY,
        pathNot: [...HTTP_OAUTH_ENTRY, ...HTTP_MAIN_ENTRY],
        dependencyTypes: ["type-only"],
      },
    },
    {
      name: "engine-core-consumers",
      severity: "error",
      comment:
        "The engine family's core (@miragon/pulse-engine-core, the contract every dialect " +
        "implements) is imported only where a dialect is implemented (ENGINE_CORE_IMPLEMENTERS): " +
        "the src of a dialect's core (a family DIALECT_FAMILIES names: c7, c8), never its " +
        "./testing entry (src/testing/, which ships on npm), and the src of a family's adapter " +
        "of the runtime view; and where the contract's answers are read (ENGINE_CORE_READERS): " +
        "the runtime view's layers src/ports, src/core, src/model and src/host-kit (never its " +
        "webview, which renders protocol view models), the src of the editor hosts, apps/vscode " +
        "and apps/orca, the board builder (packages/core/board/src/builder, held to the main " +
        "entry by board-builder-builds-on-the-engine-contract) and the screens' builder " +
        "(packages/core/screens/src/builder, held to it by " +
        "screens-builder-builds-on-the-engine-contract); where the engine module runs the " +
        "contract (ENGINE_CONNECTOR_CONTRACT_READERS, owner decision 2026-11-16 with boards in " +
        "the MCP server, the case #488 names): the connector's src/lib/engine, " +
        "src/lib/core-adapter and src/data, held to the main entry by " +
        "engine-connector-contract-by-its-main-entry; by test files and test-support anywhere " +
        "and in the test trees of the runtime view, the adapters, the dialect cores, the " +
        "board package and the screens package (ENGINE_CORE_TESTS). Not another family's core (a family core of another " +
        "source than a dialect included), not the rest of the engine connector (its view models, " +
        "widgets, src/lib/shared, tools and widget tools: they read what src/data builds), not " +
        "the CLI until it serves a second dialect (owner decision 2026-11-09: it reaches the " +
        "contract's rules through c7-core's causeOf), not the MCP server app and no other " +
        "package. A relative escape into packages/connectors/engine/engine-core is a violation " +
        "too.",
      from: {
        pathNot: [
          ...ENGINE_CORE_IMPLEMENTERS,
          ...ENGINE_CORE_READERS,
          ...ENGINE_CONNECTOR_CONTRACT_READERS,
          `^${escapeRegExp(ENGINE_CORE.tree)}/(?:src|test)/`,
          "[.]test[.]tsx?$",
          ...TEST_SUPPORT,
          ...ENGINE_CORE_TESTS,
        ],
      },
      to: { path: [`^${escapeRegExp(ENGINE_CORE.tree)}/`, ...npm(escapeRegExp(ENGINE_CORE.name))] },
    },
    {
      name: "engine-connector-contract-by-its-main-entry",
      severity: "error",
      comment:
        "The engine module's server layers that run the engine contract " +
        "(ENGINE_CONNECTOR_CONTRACT_READERS: src/lib/engine, src/lib/core-adapter and src/data of " +
        "packages/connectors/engine/engine-connector) import @miragon/pulse-engine-core by its " +
        "main entry alone: the ports, read models, failures and rules a dialect answers in. Never " +
        "./testing (the kit, the world and the fake ship for tests; shipped-code-not-to-testing " +
        "holds it too), never another subpath or a file of its build, never a relative escape " +
        "into its tree. Their tests and test-support import the kit.",
      from: { path: ENGINE_CONNECTOR_CONTRACT_READERS, pathNot: SRC_TEST_CODE },
      to: {
        path: [`^${escapeRegExp(ENGINE_CORE.tree)}/`, ...npm(escapeRegExp(ENGINE_CORE.name))],
        pathNot: ENGINE_CORE_ENTRY,
      },
    },
    {
      name: "engine-connector-c8-core-in-its-engine-layer",
      severity: "error",
      comment:
        "Of the engine module's shipped code only src/lib/engine imports the c8 family's core " +
        "(@miragon/pulse-c8-core): there the server builds its own Camunda 8 wire on " +
        "@miragon/pulse-http (c8-connection.ts), words its failures (c8-errors.ts) and runs " +
        "C8Runtime per call (engine-runtime.ts), behind resolveRuntimeEngine (CLAUDE.md " +
        "invariants 2 and 7). Its data builders, tools, providers, widget tools, widgets and " +
        "src/lib/shared read the engine contract's answers (engine-core's main entry, where " +
        "admitted), never the dialect's core. Read what you need through runtimeOf. Its tests " +
        "import it anywhere.",
      from: {
        path: `${ENGINE_CONNECTOR_TREE}src/`,
        pathNot: [ENGINE_CONNECTOR_ENGINE_LAYER, ...SRC_TEST_CODE],
      },
      to: { path: C8_CORE_ANY },
    },
    {
      name: "engine-connector-c8-core-in-its-engine-layer",
      severity: "error",
      comment:
        "The engine module's src/lib/engine imports @miragon/pulse-c8-core by its main entry " +
        "alone: C8Runtime, C8Failures and the port's types. Never ./testing (the recorded board " +
        "ships for tests; shipped-code-not-to-testing holds it too), never a file of its build, " +
        "never a relative escape into its tree.",
      from: { path: ENGINE_CONNECTOR_ENGINE_LAYER, pathNot: SRC_TEST_CODE },
      to: { path: C8_CORE_ANY, pathNot: C8_CORE_ENTRY },
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
      name: "adapters-own-their-family",
      severity: "error",
      comment:
        "A family's adapter (packages/connectors/<family>/<family>-adapter) maps its engines onto " +
        "the engine contract of @miragon/pulse-engine-core for the runtime view: it imports its " +
        "own family's core (the C7 adapter, @miragon/pulse-c7-adapter, runs " +
        "@miragon/pulse-c7-core; its closed world holds its src to the main entry and " +
        "./runtime, the engine contract's reads and what they build on) and " +
        "ADAPTER_IMPORTS (engine-core, the runtime view @miragon/pulse-runtime-view, whose " +
        "./ports name the plug it provides, and the transport @miragon/pulse-http, HTTP_USERS), " +
        "no other workspace package: no connector, another family's core or client, the board " +
        "format or the UI. " +
        "It sends through its family's core and the transport, never through a client, its own " +
        "family's included (owner decision 2026-11-11): client-consumers refuses its own " +
        "family's client, this rule leaves that edge to it. What two families' adapters share " +
        "belongs in engine-core, the contract, or in the runtime view. Its tests answer to " +
        "adapter-tests-own-their-family.",
      from: { path: FAMILY_ADAPTER_OWN, pathNot: FAMILY_ADAPTER_TEST_CODE },
      to: adapterFamilyTargets([]),
    },
    {
      name: "adapter-tests-own-their-family",
      severity: "error",
      comment:
        "A family's adapter's tests (its test tree, its test files and their test-support) " +
        "import what adapters-own-their-family admits its src and ADAPTER_TEST_IMPORTS, the " +
        "board format and its builder, which build a board over the adapter's runtime, and the " +
        "screens with their builder, which build the shared screens over it, so a test holds the " +
        "adapter to the numbers the other surfaces show. No other workspace package: " +
        "no connector, another family's core or client, or the UI; its own family's client is " +
        "client-consumers', which admits it in a test.",
      from: { path: FAMILY_ADAPTER_TEST_CODE },
      to: adapterFamilyTargets(ADAPTER_TEST_IMPORTS),
    },
    {
      name: "runtime-view-consumers",
      severity: "error",
      comment:
        "The runtime view (packages/core/runtime-view, @miragon/pulse-runtime-view) is what the " +
        "editor hosts share: Pulse for VS Code (apps/vscode) and Pulse for Orca (apps/orca) " +
        "compose it, a family's adapter implements its contract. Nothing else imports it: the MCP " +
        "server's views are widget-shell's and the connectors'.",
      from: {
        path: "^(?:apps|packages)/",
        pathNot: [...EDITOR_HOSTS, FAMILY_ADAPTER_TREE, RUNTIME_VIEW_TREE],
      },
      to: { path: [RUNTIME_VIEW_TREE, ...npm(escapeRegExp(RUNTIME_VIEW))] },
    },
    {
      name: "adapter-consumers",
      severity: "error",
      comment:
        "A family's adapter of the runtime view (packages/connectors/<family>/<family>-adapter) is " +
        "bundled by the editor hosts (apps/vscode, apps/orca) and imported by nothing else: the " +
        "MCP server and the CLI reach the engines through the connector and the family core.",
      from: { path: "^(?:apps|packages)/", pathNot: [...EDITOR_HOSTS, FAMILY_ADAPTER_TREE] },
      to: { path: [FAMILY_ADAPTER_TREE, ...npm(FAMILY_ADAPTER)] },
    },
    {
      name: "family-core-consumers",
      severity: "error",
      comment:
        "A family core is imported by its own family's connector (connectors-own-their-family) " +
        "and adapter (adapters-own-their-family), a dialect's core also by the engine module " +
        "(engine-connector-spans-the-dialects), and by the interface apps that bundle it " +
        "(CORE_BUNDLERS: the CLI bundles c7-core), by no other app: the MCP server composes " +
        "connectors, not their domain. The editor hosts " +
        "answer to editor-hosts-reach-dialects-through-adapters. The other " +
        "packages answer to their own rules: packages/core to core-is-foundation, a client to " +
        "clients-are-leaves, a family core to family-core-is-a-leaf.",
      from: { path: "^apps/", pathNot: [...CORE_BUNDLERS, ...EDITOR_HOST_SOURCES] },
      to: { path: [FAMILY_CORE_TREE, ...npm(FAMILY_CORE)] },
    },
    {
      name: "editor-hosts-reach-dialects-through-adapters",
      severity: "error",
      comment:
        "The editor hosts (apps/vscode, apps/orca) import of the family cores only the engine " +
        "family's core, @miragon/pulse-engine-core, by its package entry: the contract's ids and " +
        "read models they name (engine-core-consumers; their closed worlds hold them to the main " +
        "entry). A dialect's core (@miragon/pulse-c7-core) is its family adapter's " +
        "(packages/connectors/<family>/<family>-adapter), which the composition root wires; read " +
        "what you need through a port of the contract. A relative escape into a core's tree is " +
        "a violation too.",
      from: { path: EDITOR_HOST_SOURCES },
      to: {
        path: [FAMILY_CORE_TREE, ...npm(FAMILY_CORE)],
        pathNot: npm(escapeRegExp(ENGINE_CORE.name)),
      },
    },
    {
      name: "web-is-a-page",
      severity: "error",
      comment:
        "The web app (apps/web) is the page of the MCP views a Pulse server serves under /app: " +
        "its src imports only its own modules, react, react-dom and lucide-react, " +
        "@miragon/pulse-ui by its root, its BPMN diagram @miragon/pulse-ui/bpmn and its stylesheet " +
        "@miragon/pulse-ui/theme.css, the view " +
        "runtime's view half @miragon/pulse-widget-shell/widgets (mountApp, the page's client of " +
        "the web app's API), the engine module's views @miragon/pulse-engine-connector/widgets, " +
        "the building blocks its screens compose (@miragon/pulse-blocks) and the screens' format " +
        "(@miragon/pulse-screens, by type: web-names-screens-by-type), each by its main entry. " +
        "Nothing of a server (widget-shell's /server, a connector's root, the transport, zod, the " +
        "MCP SDK), no MCP Apps runtime (the page is no chat), no screen's builder or engine " +
        "contract (the server builds a screen, the page renders its JSON form), no ./testing " +
        "entry, no Node built-in and no file of another package by path: the page reaches the " +
        "engines through its server's call route alone. Its tests and the build's config " +
        "(vite.config.ts) may import more.",
      from: { path: WEB_SRC, pathNot: SRC_TEST_CODE },
      to: { pathNot: WEB_IMPORTS },
    },
    {
      name: "web-names-screens-by-type",
      severity: "error",
      comment:
        "The web app's src names the screens' JSON forms (@miragon/pulse-screens) by type alone: " +
        "a value of the format (ProcessFilter, FleetSums) reaches the page through the building " +
        "blocks that apply it (useProcessList of @miragon/pulse-blocks), so the page keeps no " +
        "rule of a screen of its own and the editors' engine tab and the page apply one. Use " +
        "`import type`, or the block that applies the rule.",
      from: { path: WEB_SRC, pathNot: SRC_TEST_CODE },
      to: {
        path: [`^${escapeRegExp(SCREENS.tree)}/`, ...npm(escapeRegExp(SCREENS.name))],
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "cli-family-core-only-in-named-layers",
      severity: "error",
      comment:
        "In the CLI only the workflow commands (apps/cli/src/workflow), the engine port " +
        "(apps/cli/src/engine-port), the two operation modules that apply the core's engine " +
        "REST rules to option values (operation/dates.ts: the date reading, operation/variables.ts: " +
        "the auto typing) and the mapping of HTTP errors (http/errors.ts: the wrong-root rule " +
        "isUnknownEndpoint, so the CLI keeps no copy of it) import the family core it bundles " +
        "(CLI_CORE); the command layer reaches it through the workflow modules, tests may import " +
        "it anywhere. Any other core is cli-is-headless's.",
      from: {
        path: "^apps/cli/",
        pathNot: [
          "^apps/cli/src/(?:workflow|engine-port)/",
          "^apps/cli/src/operation/(?:dates|variables)[.]ts$",
          "^apps/cli/src/http/errors[.]ts$",
          ...CLI_TEST_CODE,
        ],
      },
      to: { path: npm(CLI_CORE) },
    },
    {
      name: "cli-without-the-c7-runtime",
      severity: "error",
      comment:
        "The CLI (apps/cli) implements no engine contract, so it never imports c7-core's " +
        "./runtime entry (@miragon/pulse-c7-core/runtime: the reads of engine-core's " +
        "ProcessRuntime and what they build on, which a family's adapter runs), by its name or " +
        "by a relative escape into c7-core's src/runtime: tsdown would inline it into the npm " +
        "dist for nothing. The workflow commands read through the main entry's composites " +
        "(inspectInstance, readStatus) over the CLI's own engine port.",
      from: { path: "^apps/cli/" },
      to: { path: [...npm(`${CLI_CORE}/(?:runtime|dist/runtime)`), C7_RUNTIME_TREE] },
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
        "format, the transport, the migration plan format) have no import cycle at all, type-only " +
        "cycles included (stricter than " +
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
        "format, the transport, the migration plan format) imports a test file (*.test.ts) of its " +
        "own tree. Shared test helpers live in " +
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
        "http/{client,types}.ts, errors.ts, util.ts and runtime.ts.",
      from: { path: "^apps/cli/src/auth/", pathNot: CLI_TEST_CODE },
      to: {
        path: "^apps/cli/src/",
        pathNot:
          "^apps/cli/src/(?:auth|config)/|^apps/cli/src/http/(?:client|types)[.]ts$|^apps/cli/src/(?:errors|util|runtime)[.]ts$",
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
    // The hey-api SDK of the c7 family (c7-client) is regenerated from the one Camunda 7 REST
    // spec (c7-core's spec/api.json, `pnpm generate`) and never edited by hand, so it is the one
    // tree whose own imports are not followed. It stays in the graph as a target (doNotFollow,
    // never exclude, which would drop every edge into it), so a relative escape into the SDK's
    // sources (the files behind ./sdk and ./types) trips client-consumers like one into the
    // rest of the client. Any other generated tree (a command catalog, a route table, say) is
    // cruised like hand-written code: list nothing else here.
    doNotFollow: { path: ["node_modules", "^packages/connectors/c7/c7-client/src/generated/"] },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    // Keep workspace imports as node_modules/@miragon/pulse-* paths instead of
    // resolving the pnpm symlink to the sibling package's real path: the rules
    // above rely on the shapes staying distinguishable (see the header).
    preserveSymlinks: true,
  },
}
