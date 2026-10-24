/**
 * Architecture fitness functions: the dependency half of the CLAUDE.md
 * "Architecture invariants" made executable. Runs as `pnpm lint:architecture`
 * (chained into the root `pnpm lint`, so CI's quality job enforces it).
 *
 * Rule comments are written for the (human or AI) contributor who trips them:
 * each says what is forbidden and names the house path to use instead.
 *
 * Layout + naming carry the layer semantics. A connector family under
 * `packages/connectors/<family>/` has three roles, keyed by the directory suffix
 * and the npm name `@miragon/pulse-<name>-<role>`:
 *   - `<name>-connector`: the MCP module (tools, widgets, pipeline steps);
 *   - `<name>-client`: its SDK leaf (generated REST SDK or PromQL queries + Zod schemas);
 *   - `<name>-domain`: the pure use-case leaf that the MCP server, the CLI and the
 *     VS Code extension share (no other workspace package, no zod, no Node built-ins
 *     outside its tests).
 * The foundation packages live under `packages/core/` (npm names without a role
 * suffix, e.g. `@miragon/pulse-widget-shell`). The apps under `apps/` sit ON TOP of
 * the packages: the MCP server (`@miragon/pulse-mcp-server-camunda7`) composes the
 * connectors; the two interface apps, the CLI (apps/cli, `@miragon/pulse-cli`) and the
 * VS Code extension (apps/vscode, the unscoped `pulse-vscode`, because vsce rejects
 * scoped names), reach the engine through a `-domain` package only. No package and no
 * app imports an app. APP_PACKAGES below names every app's npm name; the self-test
 * fails when a real app's name is missing there. The rules key on exactly these
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
 *      `mcp-use/react`: dependency-cruiser reads no exports map) and every undeclared
 *      dependency (`react` where the importer does not list it).
 * `npm()` builds the shape 2 and shape 3 patterns for a list of npm names. Never exempt
 * a package's own directory wholesale in a `pathNot`: its node_modules holds the very
 * shape 2 imports the rule is about. Exempt by lookahead instead (see clients-are-leaves).
 *
 * Every rule has planted violations and allowed neighbours in
 * scripts/dependency-cruiser-gates.test.mjs, which cruises a generated fixture tree
 * (with an apps/cli, an apps/vscode and -domain packages) with THIS config. A new or
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
const SERVER_PACKAGE = "@miragon/pulse-mcp-server-camunda7"
const CLI_PACKAGE = "@miragon/pulse-cli"
const EXTENSION_PACKAGE = "pulse-vscode"
const APP_PACKAGES = [SERVER_PACKAGE, CLI_PACKAGE, EXTENSION_PACKAGE]
const APP_NAMES = APP_PACKAGES.map(escapeRegExp).join("|")

/**
 * What makes a package an MCP host or a widget: the UI runtime, the MCP framework and
 * protocol SDK, the toolkit, the server's HTTP, persistence and metrics stack, zod and
 * the generated REST SDK's runtime. The interface apps and the -domain packages import
 * none of it.
 */
const MCP_STACK = [
  "react",
  "react-dom",
  "lucide-react",
  "@tanstack/[^/]+",
  "mcp-use",
  "@modelcontextprotocol/[^/]+",
  "@miragon/mcp-toolkit-[^/]+",
  "hono",
  "postgres",
  "prom-client",
  "zod",
  "@hey-api/[^/]+",
].join("|")

/** Any `@miragon/pulse-*` name except a -domain package (any subpath of one stays open). */
const PULSE_EXCEPT_DOMAIN = "@miragon/pulse-(?![^/]+-domain(?:/|$))"

module.exports = {
  forbidden: [
    {
      name: "connectors-are-peers",
      severity: "error",
      comment:
        "Connector modules are self-contained peers and never import each other (CLAUDE.md invariant 8). " +
        "Cross-module needs go through the composition root: shared server data via SharedResources " +
        "(apps/mcp-server-camunda7/src/module-contract.ts), cross-module UI via shell:* widgets " +
        "(props.dataKey) or raw tool-name strings with graceful degradation.",
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
      name: "connectors-own-their-client",
      severity: "error",
      comment:
        "A connector may only depend on its own client package (analytics-connector → " +
        "analytics-client). Engine data a foreign module needs arrives as an injected port on " +
        "SharedResources: the pattern is fetchBpmnXml, which feeds the analytics heatmap without " +
        "giving the analytics connector an engine-SDK dependency (CLAUDE.md invariant 8).",
      from: { path: "^packages/connectors/[^/]+/([^/]+)-connector/" },
      to: {
        path: ["^packages/connectors/.+-client/", "@miragon/pulse-[^/]+-client(/|$)"],
        pathNot: ["^packages/connectors/[^/]+/$1-client/", "@miragon/pulse-$1-client(/|$)"],
      },
    },
    {
      name: "connectors-own-their-domain",
      severity: "error",
      comment:
        "A connector may only depend on its own -domain package (camunda7-connector → " +
        "camunda7-domain), never on a foreign family's. Engine data a foreign module needs " +
        "arrives as an injected port on SharedResources " +
        "(apps/mcp-server-camunda7/src/module-contract.ts), as for the client SDKs.",
      from: { path: "^packages/connectors/[^/]+/([^/]+)-connector/" },
      to: {
        // Lookaheads instead of a pathNot: a connector-internal folder named `*-domain/`
        // is no domain, and an own-dir pathNot would also exempt a foreign domain declared
        // in the own node_modules (shape 2).
        path: [
          "^packages/connectors/[^/]+/(?!$1-domain/)[^/]+-domain/",
          "@miragon/pulse-(?!$1-domain(?:/|$))[^/]+-domain(?:/|$)",
        ],
      },
    },
    {
      name: "clients-are-leaves",
      severity: "error",
      comment:
        "*-client packages are SDK leaves (generated REST SDK / PromQL queries + Zod schemas): " +
        "they never import connectors, -domain packages, the core packages, sibling clients, or " +
        "an app. Shared logic that grows here belongs in the connector layer, a -domain package " +
        "or a core package, not in a client.",
      from: { path: "^packages/connectors/[^/]+/([^/]+)-client/" },
      to: {
        path: ["^packages/(core|connectors)/", "^apps/", "@miragon/pulse-"],
        // The own tree (src, own third-party node_modules such as zod) stays exempt
        // EXCEPT any @miragon/pulse-* package declared in its own node_modules (shape 2).
        pathNot: [
          "^packages/connectors/[^/]+/$1-client/(?!node_modules/@miragon/pulse-)",
          "@miragon/pulse-$1-client(/|$)",
        ],
      },
    },
    {
      name: "domains-are-leaves",
      severity: "error",
      comment:
        "A -domain package (packages/connectors/<family>/<name>-domain) is a pure leaf: use cases " +
        "over a transport port, returning typed results without words. It imports no other " +
        "workspace package (no client SDK, not even its own client, no connector, no core " +
        "package, no app), no zod (the CLI and the extension bundle it), no @hey-api, nothing of " +
        "the MCP/UI stack (react, mcp-use, the toolkit, TanStack, hono, postgres, prom-client), " +
        "no vscode and no commander. The interfaces adapt it; it adapts to nothing. Should it " +
        "need its client's wire contract, that client first grows a zod-free, SDK-free subpath " +
        "and this rule opens exactly that subpath.",
      from: { path: "^packages/connectors/([^/]+)/([^/]+)-domain/" },
      to: {
        // No pathNot on purpose: the lookahead exempts only the own tree from the
        // relative-escape pattern, so the own node_modules/zod still matches npm().
        path: [
          "^packages/(?!connectors/$1/$2-domain/)",
          "^apps/",
          "@miragon/pulse-",
          ...npm(`${MCP_STACK}|vscode|commander|${APP_NAMES}`),
        ],
      },
    },
    {
      name: "domains-are-pure",
      severity: "error",
      comment:
        "A -domain package runs unchanged in the MCP server, the CLI and the VS Code extension " +
        "host, so it imports no Node built-in module (node:fs, node:crypto, node:path ...) outside " +
        "its *.test.ts and *.test-support.ts files, type-only imports included. Use the web " +
        "globals (fetch, AbortSignal, URL, crypto.subtle, timers) or take the capability through " +
        "the port the interface implements.",
      from: {
        path: "^packages/connectors/[^/]+/[^/]+-domain/",
        pathNot: "[.]test(?:-support)?[.]tsx?$",
      },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "core-is-foundation",
      severity: "error",
      comment:
        "packages/core/* is the shared foundation underneath every connector: it depends on the " +
        "toolkit (and core siblings) only, never on a connector, a client, a -domain package or " +
        "an app. When a connector needs something a sibling already has, extract it INTO a core " +
        "package (on the second concrete consumer), never make core reach up into a connector.",
      from: { path: "^packages/core/" },
      to: {
        path: [
          "^packages/connectors/",
          "^apps/",
          "@miragon/pulse-[^/]+-(connector|client|domain)(/|$)",
          "@miragon/pulse-mcp-server-camunda7",
        ],
      },
    },
    {
      name: "packages-never-import-the-app",
      severity: "error",
      comment:
        "Every app is a composition root or an interface ON TOP of the packages (CLAUDE.md " +
        "invariant 8): the MCP server, the CLI and the VS Code extension. Anything a package " +
        "needs from an app must be inverted into an injected port; see SharedResources in " +
        "apps/mcp-server-camunda7/src/module-contract.ts.",
      from: { path: "^packages/" },
      to: { path: ["^apps/", "@miragon/pulse-mcp-server-camunda7", ...npm(APP_NAMES)] },
    },
    {
      name: "apps-never-import-apps",
      severity: "error",
      comment:
        "An app never imports another app, by npm name or by relative path, and never itself " +
        "by its own npm name (import its own modules by relative path). Behaviour two apps " +
        "share moves into a package: engine use cases into a -domain package, MCP plumbing " +
        "into packages/core.",
      from: { path: "^apps/([^/]+)/" },
      to: { path: ["^apps/(?!$1/)", ...npm(APP_NAMES)] },
    },
    {
      name: "cli-is-headless",
      severity: "error",
      comment:
        "The CLI (apps/cli) is a terminal interface, not an MCP host: it never imports the " +
        "server app, widget-shell or another core package, a connector or a client, nor the " +
        "MCP/UI/server stack (react, react-dom, lucide-react, preact, bpmn-js, diagram-js, " +
        "mcp-use, @modelcontextprotocol, the toolkit, TanStack, hono, postgres, prom-client, " +
        "zod, @hey-api, vscode, @miragon/modeler-shell). Engine behaviour it shares with the " +
        "MCP server lives in a -domain package (packages/connectors/<family>/<name>-domain), " +
        "the only @miragon/pulse-* package it imports (any subpath of one).",
      from: { path: "^apps/cli/" },
      to: {
        path: [
          "^packages/",
          "^apps/(?!cli/)",
          PULSE_EXCEPT_DOMAIN,
          ...npm(
            `${MCP_STACK}|preact|bpmn-js|diagram-js|@miragon/modeler-shell|vscode|${escapeRegExp(EXTENSION_PACKAGE)}`,
          ),
        ],
      },
    },
    {
      name: "nothing-imports-the-cli",
      severity: "error",
      comment:
        "Nothing imports the CLI (@miragon/pulse-cli): not the MCP server (no CLI inside the " +
        "MCP server via argv), not a package, not the extension. Behaviour two interfaces " +
        "share moves into the -domain package both call.",
      // No own-dir pathNot on `to`: see the header (shape 2).
      from: { pathNot: "^apps/cli/" },
      to: { path: ["^apps/cli/", `${escapeRegExp(CLI_PACKAGE)}(?:/|$)`] },
    },
    {
      name: "extension-is-not-an-mcp-host",
      severity: "error",
      comment:
        "The VS Code extension (apps/vscode, npm name pulse-vscode: unscoped, since vsce " +
        "rejects scoped names) is an interface, not an MCP host: it never imports another " +
        "app, widget-shell or another core package, a connector or a client, nor the MCP/UI " +
        "stack (react, react-dom, lucide-react, mcp-use, @modelcontextprotocol, the toolkit, " +
        "TanStack, hono, postgres, prom-client, zod, @hey-api). Its own UI stays preact, " +
        "bpmn-js and @miragon/modeler-shell; engine behaviour it shares with the MCP server " +
        "lives in a -domain package, the only @miragon/pulse-* package it imports.",
      from: { path: "^apps/vscode/" },
      to: { path: ["^packages/", "^apps/(?!vscode/)", PULSE_EXCEPT_DOMAIN, ...npm(MCP_STACK)] },
    },
    {
      name: "nothing-imports-the-extension",
      severity: "error",
      comment:
        "Nothing imports the VS Code extension (pulse-vscode): it ships as a .vsix on its own. " +
        "Behaviour it shares with the MCP server or the CLI moves into the -domain package " +
        "they all call.",
      from: { pathNot: "^apps/vscode/" },
      // Anchored (npm()), since the name is unscoped: a third-party pulse-vscode-tools
      // is not the extension.
      to: { path: ["^apps/vscode/", ...npm(escapeRegExp(EXTENSION_PACKAGE))] },
    },
    {
      name: "no-cross-package-deep-imports",
      severity: "error",
      comment:
        "Never reach into a sibling package's source tree by relative path: import its public " +
        "entry (@miragon/pulse-<pkg>, or a subpath like @miragon/pulse-widget-shell/widgets) so the " +
        "exports map stays the contract between packages.",
      from: { path: "^(apps/[^/]+|packages/core/[^/]+|packages/connectors/[^/]+/[^/]+)/" },
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
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    // The hey-api SDK is regenerated from the CIB seven OpenAPI spec (`pnpm generate`)
    // and never edited by hand, so it is the one tree kept out of the graph. Any other
    // generated tree (a command catalog, say) is cruised like hand-written code: list
    // nothing else here.
    exclude: { path: ["^packages/connectors/camunda/camunda7-client/src/generated/"] },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    // Keep workspace imports as node_modules/@miragon/pulse-* paths instead of
    // resolving the pnpm symlink to the sibling package's real path: the rules
    // above rely on the shapes staying distinguishable (see the header).
    preserveSymlinks: true,
  },
}
