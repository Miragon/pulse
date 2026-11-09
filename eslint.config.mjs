import js from "@eslint/js"
import tseslint from "typescript-eslint"
import reactHooks from "eslint-plugin-react-hooks"
import globals from "globals"

// The widget trees: every tree of React views an MCP host renders (the host bundle's src/ui,
// widget-shell's view half, the connector's widgets). They are excluded from their package's
// tsconfig.json and typed by the browser-only tsconfig.widgets.json / tsconfig.ui.json projects
// instead, and the date and number gates (invariant 6) hold all of them, and the runtime view's
// core and webview too (their blocks below carry them in their unions).
const CONNECTOR_WIDGETS = ["packages/connectors/engine/engine-connector/src/widgets/**/*.{ts,tsx}"]
const WIDGET_TREES = [
  "apps/mcp-server/src/ui/**/*.{ts,tsx}",
  "packages/core/widget-shell/src/ui/**/*.{ts,tsx}",
  ...CONNECTOR_WIDGETS,
]

// Server tests (and the Playwright host simulation) live outside src/ (not
// part of the build tsconfig) and get their type information from the
// dedicated tsconfig.test.json project.
const serverTestFiles = ["apps/mcp-server/test/**/*.ts", "apps/mcp-server/test-host/**/*.ts"]

// Standalone config files that are not part of any tsconfig, so they are typed by
// typescript-eslint's default project. No package's lint script reaches them: `pnpm lint:configs`
// lints exactly this list, the pre-commit hook whichever of them a commit stages.
export const DEFAULT_PROJECT_FILES = [
  "vitest.shared.ts",
  "apps/mcp-server/vite.config.ts",
  "apps/mcp-server/vitest.config.ts",
  "packages/connectors/c7/c7-client/vitest.config.ts",
  "packages/connectors/c7/c7-client/openapi-ts.config.ts",
  "packages/connectors/c7/c7-core/vitest.config.ts",
  "packages/connectors/c7/c7-core/vitest.stryker.config.ts",
  "packages/connectors/engine/engine-connector/vitest.config.ts",
  "packages/connectors/engine/engine-core/vitest.config.ts",
  "packages/connectors/engine/engine-core/vitest.stryker.config.ts",
  "packages/core/http/vitest.config.ts",
  "packages/core/http/vitest.stryker.config.ts",
  "packages/core/profile/vitest.config.ts",
  "packages/core/profile/vitest.stryker.config.ts",
  "packages/core/ui/vitest.config.ts",
  "packages/core/widget-shell/vitest.config.ts",
  "docs/.vitepress/config.ts",
  "docs/.vitepress/theme/index.ts",
]

// What only a browser has, which the transport (packages/core/http) never reaches for: its
// tsconfig types the web platform's globals through lib DOM, which brings them along.
export const HTTP_BROWSER_GLOBALS = [
  "window",
  "document",
  "navigator",
  "location",
  "history",
  "self",
  "top",
  "parent",
  "frames",
  "opener",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "caches",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "alert",
  "confirm",
  "prompt",
  "open",
  "close",
  "print",
  "HTMLElement",
  "Element",
]

// The editor hosts and the runtime view they share keep the VS Code extension's house rules.
const RUNTIME_VIEW = "packages/core/runtime-view"
const C7_ADAPTER = "packages/connectors/c7/c7-adapter"
const EDITOR_TREES = `{apps/vscode,apps/orca,${RUNTIME_VIEW},${C7_ADAPTER}}`

// The runtime probes (<package>/test/<layer>/runtime.boundary.ts) expect the globals of their
// layer to be missing, so the package's tsconfig.json (the union the editor and the project
// service use) leaves them out; each is typed by its layer's tsconfig instead.
const editorBoundaryProbes = [`${EDITOR_TREES}/test/*/runtime.boundary.ts`]

// ── Pattern-gate selectors (`no-restricted-syntax`) ─────────────────────────

// Every syntactic route to a member that names it literally (an agent "working around" a gate
// reaches for exactly these). A key concatenated or computed at runtime stays out of any
// selector's reach: that is review's job. Object literals stay allowed: test fakes build
// `{ registerTool } as unknown as ModuleServer`. A parameter's own destructuring stays allowed
// too, a carve-out from when the gated member was the common name `tool`; no source under the
// gates destructures one of these names. Inline `eslint-disable` of this rule (or of
// complexity/max-lines) is caught by scripts/check-ratchets.mjs, not here: a directive could
// disable a rule that polices directives. The string selectors at the end also match what the
// narrower ones above them match, so such a hit reports twice: check-ratchets.mjs never lets this
// list shrink.
/** The parents of a string that sits in a type, which reads nothing. */
const TYPE_PARENTS = "TSLiteralType, TSPropertySignature, TSMethodSignature"
const registrationGate = (member, message) =>
  [
    // x.registerTool(...), x?.registerTool(...), .call/bind/apply(...), const t = x.registerTool,
    // apps.registerAppTool(...) through a namespace import
    `MemberExpression[computed=false][property.name=${member}]`,
    // x["registerTool"], x[`registerTool`]
    `MemberExpression[computed=true][property.value=${member}]`,
    `MemberExpression[computed=true] > TemplateLiteral.property > TemplateElement[value.raw=${member}]`,
    // A pattern at any depth: const { a: { registerTool } } = x, const { "registerTool": t } = x,
    // ({ registerTool } = x), const [{ registerTool }] = xs, for-of, catch, ({ registerTool } = x) => …
    `ObjectPattern:not(:function > ObjectPattern) > Property[key.name=${member}]`,
    `ObjectPattern:not(:function > ObjectPattern) > Property[key.value=${member}]`,
    // import(x).then(({ registerAppTool }) => …): a parameter, yet how a promised import or server
    // destructures, so any .then
    `CallExpression[callee.property.name='then'] > :function > ObjectPattern > Property[key.name=${member}]`,
    // Reflect.get(x, "registerTool"), Reflect.get(x, `registerTool`)
    `CallExpression[callee.object.name='Reflect'][callee.property.name='get'] > Literal.arguments[value=${member}]`,
    `CallExpression[callee.object.name='Reflect'][callee.property.name='get'] > TemplateLiteral.arguments > TemplateElement[value.raw=${member}]`,
    // import { registerAppTool } from "@modelcontextprotocol/ext-apps/server", renamed or by a
    // string name, and export { registerAppTool } from …; import app = apps.registerAppTool
    `ImportSpecifier[imported.name=${member}]`,
    `ImportSpecifier[imported.value=${member}]`,
    `ExportSpecifier[local.name=${member}]`,
    `ExportSpecifier[local.value=${member}]`,
    `TSImportEqualsDeclaration > TSQualifiedName[right.name=${member}]`,
    // The name as a string, whatever reads it: Reflect["get"](x, "registerTool"),
    // Object.getOwnPropertyDescriptor(x, "registerTool"), Object.entries(x).find(([k]) => k ===
    // "registerTool"), const key = `registerTool`. Only the whole string, cooked (an escape in it
    // changes nothing), and no type's: a literal type (Pick<ModuleServer, "registerTool">) or a
    // member's key in an interface or a type literal ({ "registerTool": Register }).
    `:not(${TYPE_PARENTS}) > Literal[value=${member}]`,
    `:not(${TYPE_PARENTS}) > TemplateLiteral > TemplateElement[value.cooked=${member}]`,
  ].map((selector) => ({ selector, message }))

// Every extension of a source in a connector's src: tsc builds .mts and .cts too, ESLint's defaults
// lint .js, .mjs and .cjs, and only a block's `files` makes it read .jsx. Only the registration
// gates' two blocks take it.
const CONNECTOR_SOURCE = "*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"

// Invariant 1: the SDK's method and ext-apps' `registerAppTool`.
const registrarGate = registrationGate(
  "/^(registerTool|registerAppTool)$/",
  "Operations tools are registered through createToolRegistrar (@miragon/pulse-widget-shell/server) in src/tools/ (see .claude/skills/add-bpm-feature); a raw server.registerTool() or ext-apps' registerAppTool() (also via an import, a computed key, .call/.bind/.apply, destructuring or a string that names it) is reserved for the widget-tools files.",
)

// Invariant 3: a customer's module may bring a finished HTML view of its own; the engine
// module's views stay in the host bundle, where the kit, the view host and the design system
// hold them. Everywhere in a connector, the widget-tools files too.
const connectorResourceGate = registrationGate(
  "/^(registerResource|registerAppResource)$/",
  "A connector registers no resource of its own (CLAUDE.md invariant 3): its views belong in the host bundle, which the boot serves under ui://views/<tool>.html (showToolBinding), so they stay on the kit and the view host. A finished HTML view is for a customer's module.",
)

// Invariant 6: dates and times render through pulse-ui's formatters (`@miragon/pulse-ui`, or
// `@miragon/pulse-ui/format` where no React runs: the VS Code extension's TimeLabels).
const widgetDateGate = [
  {
    selector:
      ":matches(NewExpression, CallExpression)[callee.object.name='Intl'][callee.property.name='DateTimeFormat']",
    message:
      "Use formatTimestamp/formatDate/formatTime/formatClock/formatInstant from @miragon/pulse-ui (/format outside React), the single source for timestamp rendering (CLAUDE.md invariant 6).",
  },
  {
    selector:
      ":matches(NewExpression, CallExpression)[callee.object.name='Intl'][callee.property.name='RelativeTimeFormat']",
    message:
      "Use formatRelativeTime from @miragon/pulse-ui (/format outside React) instead of a hand-built Intl.RelativeTimeFormat (CLAUDE.md invariant 6).",
  },
  {
    selector: "CallExpression[callee.property.name='toLocaleDateString']",
    message:
      "Use formatDate from @miragon/pulse-ui instead of Date#toLocaleDateString (CLAUDE.md invariant 6).",
  },
  {
    selector: "CallExpression[callee.property.name='toLocaleTimeString']",
    message:
      "Use formatTime from @miragon/pulse-ui instead of Date#toLocaleTimeString (CLAUDE.md invariant 6).",
  },
]

// Invariant 6: numbers in widget code render through pulse-ui's formatters
// (formatNumber/formatCount/formatCompactCount/formatPercent/formatPercentPoints/formatPeriod/
// formatDuration),
// which read the view's locale. Number#toFixed formats in no locale; a
// toLocaleString() without a locale (no argument, `undefined`, `null`, `[]`)
// in the browser's; a hand-built Intl.NumberFormat bypasses the formatters
// (only pulse-ui's two formatters build one: see their block below).
const NUMBER_FORMAT_SELECTOR =
  ":matches(NewExpression, CallExpression)[callee.object.name='Intl'][callee.property.name='NumberFormat']"
const widgetNumberGate = [
  {
    selector: "CallExpression[callee.property.name='toFixed']",
    message:
      "Use formatNumber/formatPercent/formatPercentPoints from the pulse-ui kit instead of Number#toFixed: it ignores the view's locale (CLAUDE.md invariant 6).",
  },
  {
    // Each alternative pins the node type: esquery compares String(value), so
    // a bare [arguments.0.name='undefined'] also matches every argument that
    // has no `name` (a string literal, `current?.locale`).
    selector:
      "CallExpression[callee.property.name='toLocaleString']:matches([arguments.length=0], [arguments.0.type='Identifier'][arguments.0.name='undefined'], [arguments.0.type='Literal'][arguments.0.raw='null'], [arguments.0.type='ArrayExpression'][arguments.0.elements.length=0])",
    message:
      "Use formatNumber from the pulse-ui kit instead of toLocaleString() without a locale: it formats in the browser's locale, not the view's (CLAUDE.md invariant 6).",
  },
  {
    selector: NUMBER_FORMAT_SELECTOR,
    message:
      "Use formatNumber/formatCount/formatCompactCount/formatPercent/formatPercentPoints from the pulse-ui kit instead of a hand-built Intl.NumberFormat: they read the view's locale (CLAUDE.md invariant 6).",
  },
]
// The kit's formatters themselves: the same gate minus Intl.NumberFormat.
const widgetNumberGateForFormatters = widgetNumberGate.filter(
  (gate) => gate.selector !== NUMBER_FORMAT_SELECTOR,
)

// Invariant 6: widgets reach the host only through widget-shell's view host (`useViewHost`,
// `HostModelContext`) and query hooks, never the MCP Apps runtime of `@modelcontextprotocol/ext-apps`
// itself (its `App`, its React hooks, its app bridge, its types): a widget that speaks to the
// host directly renders neither under `TestViewHost` nor in another host (a web app, a VS Code
// webview) that brings an adapter of its own. The ONE adapter is widget-shell's
// EXT_APPS_HOST_ADAPTER. ext-apps' `/server` is the server half (`registerAppTool`, the view
// resource's MIME type), no host runtime: invariant 1's registrar gate keeps `registerAppTool` to
// the widget-tools files. (The AI sparkle is banned by pulse-ui's scanGlyphs, which every widget
// tree runs in its brand-gates test.)
const EXT_APPS_HOST_ADAPTER = [
  "packages/core/widget-shell/src/ui/view-runtime.ts",
  "packages/core/widget-shell/src/ui/ext-apps-host.tsx",
  "packages/core/widget-shell/src/ui/view-root.tsx",
]
const extAppsRuntimeGate = {
  patterns: [
    {
      // The root and every subpath but `/server` (a `group` cannot re-include a subpath of an
      // excluded root: gitignore semantics).
      regex: "^@modelcontextprotocol/ext-apps(?:/(?!server$).*)?$",
      message:
        "Only widget-shell's host adapter (view-runtime.ts, ext-apps-host.tsx, view-root.tsx) imports the MCP Apps runtime of @modelcontextprotocol/ext-apps; a widget uses the view host (useViewHost) and renders under TestViewHost in tests (CLAUDE.md invariant 6).",
    },
  ],
}

// Invariant 6 / CI U4, the other half: ONE hand-off vocabulary across the
// product. A connector widget renders a chat hand-off only through widget-shell's
// HandOffButton, whose function table (HAND_OFF_ACTIONS + kitLabels().handOff)
// gives every function one Lucide icon and one label in every module; an
// AskAiButton with a hand-picked icon and verb let the same function drift
// apart between two modules ("Ursache im Chat klären" next to
// "Ursache im Chat suchen", FileSearch for two functions). The import (also
// renamed) and the element (also through a namespace) are both banned in a
// connector's widgets.
const HAND_OFF_MESSAGE =
  "Render a chat hand-off with widget-shell's HandOffButton (`action` from HAND_OFF_ACTIONS: one Lucide icon and one verb that names the chat per function, in every module), not AskAiButton (CI U4, CLAUDE.md invariant 6)."
const widgetHandOffGate = [
  "ImportSpecifier[imported.name='AskAiButton']",
  "JSXOpeningElement[name.name='AskAiButton']",
  "JSXOpeningElement[name.property.name='AskAiButton']",
].map((selector) => ({ selector, message: HAND_OFF_MESSAGE }))

// ── The editor hosts (apps/vscode, apps/orca) and the runtime view they share ──
// Pulse for VS Code, Pulse for Orca, the runtime view (packages/core/runtime-view) and the
// Camunda 7 family's adapter (packages/connectors/c7/c7-adapter) keep the stricter
// rules the extension was built with (apps/vscode/CLAUDE.md,
// apps/vscode/docs/adr/guardrails.md): no comments (the inline rule below, never
// switched off inline: noInlineConfig), behaviour in classes, one class per file,
// budgets (complexity 10, 300 lines, 60 per function, 4 parameters, 20 statements),
// no engine words in the contract, the core and the webview, no --vscode-* colour in
// the webview, dates and numbers in the runtime view's core and webview through pulse-ui's
// formatters (the date and number gates of the widget trees).
// apps/vscode/test/architecture/lint-rules.test.ts lints a probe per rule. Their
// no-restricted-syntax blocks name these trees only, so they never replace a selector of the MCP
// gates above, but for the family packages under packages/connectors/*/*/src, whose blocks carry
// the connector resource gate in their union. The engine family's neutral core, the contract
// every dialect implements (packages/connectors/engine/engine-core), which left the extension's
// contract layer for a package of its own, keeps every one of these rules: each block that held it
// names the package's path next to the editor trees (ENGINE_CORE_SRC, ENGINE_CORE_TESTS, and its
// config files as the editor trees' own: ENGINE_CORE_CONFIGS). As a package of a family its src
// also sits under the connector resource gate of the MCP blocks above (packages/connectors/*/*/src),
// so its no-restricted-syntax blocks carry that gate in their union (no-restricted-syntax is ONE
// rule: a later block replaces an earlier one's selectors), as the C7 adapter's do; its engine
// words say where they belong in its own terms (ENGINE_CORE_WORDS_MESSAGE), since the package is
// not the editor hosts'. Its src glob names every TypeScript extension, so no file there steps out
// of the rules by its name.
const ENGINE_CORE_SRC = "packages/connectors/engine/engine-core/src/**/*.{ts,mts,cts,tsx}"
const ENGINE_CORE_TESTS = "packages/connectors/engine/engine-core/test/**/*.ts"
const ENGINE_CORE_CONFIGS = "packages/connectors/engine/engine-core/*.ts"
const ENGINE_CORE_PROBE = "packages/connectors/engine/engine-core/test/runtime.boundary.ts"
const vscodeNoComments = {
  meta: {
    type: "suggestion",
    messages: {
      comment:
        "Comments are not allowed. Express the intent with a well-named function, variable or type instead, and keep the scope small.",
    },
    schema: [],
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          context.report({ loc: comment.loc, messageId: "comment" })
        }
      },
    }
  },
}

const VSCODE_ENGINE_WORDS =
  "camunda|zeebe|operaton|cib ?seven|processDefinitionKey|processInstanceKey|activityId|\\bc[78]\\b"
const VSCODE_ENGINE_WORDS_MESSAGE =
  "Engine vocabulary belongs in packages/connectors/<family>/<family>-adapter and the composition roots. Use the neutral words of the contract here (elementId, definitionId, bpmnProcessId, instanceId)."
const ENGINE_CORE_WORDS_MESSAGE =
  "Engine vocabulary belongs in a dialect's implementation (its engine adapter, its core), never in the engine family's neutral core, the contract every dialect implements. Use the contract's neutral words (elementId, definitionId, bpmnProcessId, instanceId)."
const VSCODE_HOST_COLOUR_MESSAGE =
  "The webview takes no colour from VS Code. Use a Miragon token (--cd-*) from packages/core/runtime-view/src/webview/theme instead of a --vscode-* variable."
const VSCODE_CLASS_MESSAGE =
  "Put behaviour in a class: a method of the class that owns the job, or a static method of a utility class named after its topic. See apps/vscode/docs/adr/code-structure.md."

const vscodeForbiddenWords = (words, message) =>
  [
    "Identifier[name",
    "JSXIdentifier[name",
    "Literal[value",
    "TemplateElement[value.raw",
    "JSXText[value",
  ].map((attribute) => ({ selector: `${attribute}=/${words}/i]`, message }))

const vscodeModuleFunctions = (allowedNames) => {
  const allowed = allowedNames === undefined ? "" : `:not([id.name=${allowedNames}])`
  return [
    `Program > FunctionDeclaration${allowed}`,
    `Program > ExportNamedDeclaration > FunctionDeclaration${allowed}`,
    "Program > ExportDefaultDeclaration > FunctionDeclaration",
    `Program > VariableDeclaration > VariableDeclarator${allowed} > :matches(ArrowFunctionExpression, FunctionExpression)`,
    `Program > ExportNamedDeclaration > VariableDeclaration > VariableDeclarator${allowed} > :matches(ArrowFunctionExpression, FunctionExpression)`,
  ].map((selector) => ({ selector, message: VSCODE_CLASS_MESSAGE }))
}

const vscodeNeutralCode = vscodeForbiddenWords(VSCODE_ENGINE_WORDS, VSCODE_ENGINE_WORDS_MESSAGE)
const engineCoreNeutralCode = vscodeForbiddenWords(VSCODE_ENGINE_WORDS, ENGINE_CORE_WORDS_MESSAGE)
const vscodeHostColours = vscodeForbiddenWords("--vscode-", VSCODE_HOST_COLOUR_MESSAGE)
const vscodeHostEngineWords = vscodeForbiddenWords(
  `${VSCODE_ENGINE_WORDS}|\\bengine-cli\\b`,
  VSCODE_ENGINE_WORDS_MESSAGE,
)
const vscodeModuleFunctionGate = vscodeModuleFunctions()
const vscodeComponentFunctionGate = vscodeModuleFunctions("/^(use)?[A-Z]/")
const vscodeEntryFunctionGate = vscodeModuleFunctions("/^(activate|deactivate)$/")

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/generated/**",
      // Widget-bundle stand-in read (never executed) by the in-process e2e
      // boots: data, not code; not part of any tsconfig project.
      "apps/mcp-server/test/fixtures/**",
      // Standalone customer-facing workspace, outside the root pnpm workspace
      // and its tsconfig projects, verified by scripts/test-template.sh
      // (build + typecheck + tests) instead of the repo's typed linting.
      "templates/**",
      // The Miragon docs kit, vendored byte for byte from
      // Miragon/corporate-identity and linted there; check.mjs pins the copy.
      "docs/.vitepress/miragon/**",
      // Orca's plugin typings, as `orca plugin types` writes them for the Orca release the
      // plugin is checked against (apps/orca/CLAUDE.md); never edited by hand.
      "apps/orca/types/**",
    ],
  },

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,

  // Typed linting via the project service for everything the package tsconfigs cover
  {
    ignores: [...WIDGET_TREES, ...serverTestFiles, ...editorBoundaryProbes],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: DEFAULT_PROJECT_FILES,
          // Without it typescript-eslint refuses a ninth match in one ESLint run: a commit staging
          // more of them would fail the pre-commit hook, and so would `pnpm lint:configs`.
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING:
            DEFAULT_PROJECT_FILES.length,
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // The widget trees: typed via their dedicated tsconfig projects
  {
    files: WIDGET_TREES,
    languageOptions: {
      parserOptions: {
        project: [
          "apps/mcp-server/tsconfig.ui.json",
          "packages/core/widget-shell/tsconfig.widgets.json",
          "packages/connectors/engine/engine-connector/tsconfig.widgets.json",
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Server test files: typed via the dedicated test tsconfig project
  {
    files: serverTestFiles,
    languageOptions: {
      parserOptions: {
        project: ["apps/mcp-server/tsconfig.test.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // The runtime probes of the editor hosts' layers: typed via their layer's tsconfig
  {
    files: editorBoundaryProbes,
    languageOptions: {
      parserOptions: {
        project: [
          `${RUNTIME_VIEW}/tsconfig.ports.json`,
          `${RUNTIME_VIEW}/tsconfig.core.json`,
          `${RUNTIME_VIEW}/tsconfig.webview.json`,
          "apps/vscode/tsconfig.host.json",
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  {
    rules: {
      // The type-safety rules (no-explicit-any, no-unsafe-*, no-base-to-string) stay at the
      // recommendedTypeChecked level, error. require-await is off everywhere but the CLI,
      // c7-core and the VS Code extension, whose blocks below set it at error again: in the
      // MCP trees an async function without await is how they satisfy a Promise-returning
      // signature (the SDK's tool, prompt and resource callbacks, the health probes and the fetch
      // stubs of the tests), where the rule only asks for a Promise.resolve
      // wrapper.
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },

  // React hooks for all UI/widget code
  {
    files: ["apps/mcp-server/src/**/*.{ts,tsx}", "packages/**/src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs["recommended-latest"].rules,
  },

  // ── Architecture pattern gates ──────────────────────────────────────────
  // The AST-checkable slices of the CLAUDE.md invariants; the dependency
  // rules live in .dependency-cruiser.cjs (`pnpm lint:architecture`).

  // `no-restricted-syntax` is ONE rule: in flat config a later block REPLACES
  // an earlier block's options for every file both match; selector lists
  // are never merged. Each gate's selectors therefore live in a constant
  // (top of file), and a glob two gates share gets ONE block carrying the
  // union (the connector widgets below). scripts/eslint-gates.test.mjs pins
  // the effective options per path and lints known-bad spellings.

  // Invariant 3: no connector registers a resource: its views belong in the host bundle. Every
  // family's package, whose next blocks carry this gate in their union.
  {
    files: [`packages/connectors/*/*/src/**/${CONNECTOR_SOURCE}`],
    rules: { "no-restricted-syntax": ["error", ...connectorResourceGate] },
  },

  // Invariant 1: operations tools go through createToolRegistrar. A raw
  // server.registerTool() or registerAppTool() is reserved for the
  // widget-tools path (the view tools and *_data feeds), exactly the ignores
  // list below. The union with the resource gate of the block above.
  {
    files: [`packages/connectors/engine/engine-connector/src/**/${CONNECTOR_SOURCE}`],
    ignores: [
      "packages/connectors/engine/engine-connector/src/widget-tools.ts",
      "packages/connectors/engine/engine-connector/src/widget-tools/**",
    ],
    rules: { "no-restricted-syntax": ["error", ...registrarGate, ...connectorResourceGate] },
  },

  // Invariant 6: every widget tree renders dates and numbers through pulse-ui's
  // formatters, so every module renders them the same way in the view's locale (date
  // and number gates). After the registrar block, whose options it replaces for the
  // connector widgets: they get the union in the next block.
  {
    files: WIDGET_TREES,
    rules: { "no-restricted-syntax": ["error", ...widgetDateGate, ...widgetNumberGate] },
  },
  // Connector widgets sit under the registrar, resource, date and number gates and render every
  // hand-off through widget-shell's HandOffButton (hand-off gate): one block with the union,
  // after the registrar and WIDGET_TREES blocks (whose options it replaces for these files).
  {
    files: CONNECTOR_WIDGETS,
    rules: {
      "no-restricted-syntax": [
        "error",
        ...registrarGate,
        ...connectorResourceGate,
        ...widgetDateGate,
        ...widgetNumberGate,
        ...widgetHandOffGate,
      ],
    },
  },
  // Invariant 6, numbers: pulse-ui's code too (the kit, not a widget tree: it builds the
  // date formatters the date gate points at).
  {
    files: ["packages/core/ui/src/**/*.{ts,tsx}"],
    rules: { "no-restricted-syntax": ["error", ...widgetNumberGate] },
  },
  // The kit's two number formatters: `format/numbers.ts` (the view's locale, set by LocaleGate
  // or the VS Code extension) and `formatCountIn` in `ui-messages.ts` (the components' own
  // locale). After the general pulse-ui block: a later block replaces `no-restricted-syntax` for
  // both files.
  {
    files: ["packages/core/ui/src/format/numbers.ts", "packages/core/ui/src/locale/ui-messages.ts"],
    rules: { "no-restricted-syntax": ["error", ...widgetNumberGateForFormatters] },
  },
  // Invariant 6, imports: no MCP Apps runtime (`@modelcontextprotocol/ext-apps` but its
  // `/server`) in any MCP source or test but widget-shell's host adapter. Its own rule
  // (`no-restricted-imports` is ONE rule too: a glob two import gates share gets their union), so
  // it never collides with the no-restricted-syntax unions above.
  {
    files: [
      "apps/mcp-server/{src,test,test-host}/**/*.{ts,tsx}",
      "packages/core/ui/src/**/*.{ts,tsx}",
      "packages/core/widget-shell/src/**/*.{ts,tsx}",
      "packages/connectors/*/*/src/**/*.{ts,tsx}",
    ],
    rules: { "no-restricted-imports": ["error", extAppsRuntimeGate] },
  },
  {
    files: EXT_APPS_HOST_ADAPTER,
    rules: { "no-restricted-imports": "off" },
  },
  // ── Ratchet metrics: complexity + file-length budgets ───────────────────
  // Global targets for all source code; scripts/check-ratchets.mjs keeps them
  // from loosening.
  {
    files: [
      "apps/*/src/**/*.{ts,tsx}",
      "packages/core/*/src/**/*.{ts,tsx}",
      "packages/connectors/*/*/src/**/*.{ts,tsx}",
    ],
    rules: {
      complexity: ["error", 15],
      "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }],
    },
  },
  // i18n message catalogs are data, not code: no length budget.
  {
    files: ["packages/connectors/*/*/src/messages/*.sweep.ts"],
    rules: { "max-lines": "off" },
  },
  // ── The CLI (apps/cli) ───────────────────────────────────────────────────
  // Brought along from the operate repository, where the CLI grew up: typescript-eslint's
  // strict and stylistic type-checked sets for every CLI file (src, scripts, test, the configs),
  // which set the type-safety rules and require-await (off in the global block above) at error,
  // and budgets stricter than the global ones: complexity 10 (global 15) and 300 effective
  // lines per file (global 400) for the shipped code and the scripts, plus depth, parameter,
  // nesting, function length and statement budgets. No `ignores` and no no-restricted-syntax
  // here: the tests get their own block below, and a no-restricted-syntax setting would REPLACE
  // the pattern gates. The CLI's workflow domain, @miragon/pulse-c7-core
  // (packages/connectors/c7/c7-core, the core of the Camunda 7 REST dialect family), keeps these
  // budgets, and so do the profile format and the transport the CLI bundles too,
  // @miragon/pulse-profile (packages/core/profile) and @miragon/pulse-http (packages/core/http).
  {
    files: [
      "apps/cli/**/*.ts",
      "packages/connectors/c7/c7-core/**/*.ts",
      "packages/core/profile/**/*.ts",
      "packages/core/http/**/*.ts",
    ],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    rules: {
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "no-console": "error",
      eqeqeq: ["error", "always"],
      "prefer-const": "error",
      complexity: ["error", 10],
      "max-depth": ["error", 3],
      "max-params": ["error", 4],
      "max-nested-callbacks": ["error", 3],
      "max-lines": ["error", { max: 300, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 60, skipBlankLines: true, skipComments: true }],
      "max-statements": ["error", 20],
    },
  },
  // The CLI's tests (colocated *.test.ts, test/ with its fakes and the engine suites): the
  // global test budget of 400 effective lines, also for the tests and fakes outside src/ (the
  // global budget block reads apps/*/src only), and none of the per-function budgets; the
  // non-null assertion and the unsafe assignment/member access that fixtures need stay allowed.
  // The same for c7-core's, the profile format's and the transport's tests (the transport's
  // fakes under its test/ too). Their ./testing exports (fixtures, the fake port, the
  // conformance cases, the transport's loopback engine under src/testing/loopback) ship on npm
  // and keep the budgets of shipped code.
  {
    files: [
      "apps/cli/**/*.test.ts",
      "apps/cli/test/**/*.ts",
      "packages/connectors/c7/c7-core/**/*.test.ts",
      "packages/core/profile/**/*.test.ts",
      "packages/core/http/test/**/*.ts",
    ],
    rules: {
      "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": "off",
      "max-statements": "off",
      "max-nested-callbacks": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
    },
  },
  // The transport (packages/core/http) runs over the fetch it is handed, in Node, in the VS Code
  // extension host and wherever else fetch exists: its tsconfig types the web platform's globals
  // (lib DOM) and no Node, and this keeps out what only a browser has (HTTP_BROWSER_GLOBALS:
  // the window, the page, the browser's own requests and sockets, its dialogs and storage).
  {
    files: ["packages/core/http/src/**/*.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        ...HTTP_BROWSER_GLOBALS.map((name) => ({
          name,
          message: "The transport runs outside a browser: only fetch's globals.",
        })),
      ],
    },
  },
  // The CLI's build and catalog scripts report on the console.
  {
    files: ["apps/cli/scripts/**/*.ts"],
    rules: { "no-console": "off" },
  },
  // ── The editor hosts (apps/vscode, apps/orca) and the runtime view they share ──
  {
    files: [
      `${EDITOR_TREES}/**/*.{ts,tsx}`,
      ENGINE_CORE_SRC,
      ENGINE_CORE_TESTS,
      ENGINE_CORE_CONFIGS,
    ],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
  },
  // The JS files keep the strict and stylistic rules that need no types. Only their rule
  // sets: the configs' eslint-recommended part switches core checks such as no-undef off,
  // which TypeScript does for TS files but nothing does for JS.
  {
    files: [`${EDITOR_TREES}/**/*.{js,mjs,cjs}`],
    extends: [
      tseslint.configs.strict.find(({ name }) => name === "typescript-eslint/strict"),
      tseslint.configs.stylistic.find(({ name }) => name === "typescript-eslint/stylistic"),
    ],
  },
  {
    files: [
      `${EDITOR_TREES}/**/*.{ts,tsx,js,mjs,cjs}`,
      ENGINE_CORE_SRC,
      ENGINE_CORE_TESTS,
      ENGINE_CORE_CONFIGS,
    ],
    plugins: { "pulse-vscode": { rules: { "no-comments": vscodeNoComments } } },
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "error" },
    rules: {
      "pulse-vscode/no-comments": "error",
      complexity: ["error", 10],
      "max-depth": ["error", 3],
      "max-params": ["error", 4],
      "no-console": ["error", {}],
      eqeqeq: ["error", "always"],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "@typescript-eslint/no-extraneous-class": ["error", { allowStaticOnly: true }],
    },
  },
  {
    files: [
      "apps/vscode/{src,dev,scripts,sandbox}/**/*.{ts,tsx,js,mjs,cjs}",
      "apps/orca/{src,scripts}/**/*.{ts,tsx,js,mjs,cjs}",
      `${RUNTIME_VIEW}/{src,dev,scripts}/**/*.{ts,tsx,js,mjs,cjs}`,
      `${C7_ADAPTER}/src/**/*.{ts,tsx,js,mjs,cjs}`,
      `${RUNTIME_VIEW}/test/webview/harness.tsx`,
      "apps/vscode/test/smoke/*.cjs",
      ENGINE_CORE_SRC,
    ],
    rules: {
      "max-lines": ["error", { max: 300, skipBlankLines: true }],
      "max-lines-per-function": ["error", { max: 60, skipBlankLines: true }],
      "max-statements": ["error", 20],
      "max-nested-callbacks": ["error", 3],
    },
  },
  {
    files: [
      `${EDITOR_TREES}/test/**/*.ts`,
      `${EDITOR_TREES}/test/**/*.test.tsx`,
      ENGINE_CORE_TESTS,
    ],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },
  // engine-core's tests and config files keep the budgets their paths held before the package
  // took them, as the CLI's and c7-core's have them: 300 effective lines for a config file and a
  // test support module, 400 for a test file (the extension's tests and configs have none).
  {
    files: [ENGINE_CORE_TESTS, ENGINE_CORE_CONFIGS],
    rules: { "max-lines": ["error", { max: 300, skipBlankLines: true, skipComments: true }] },
  },
  {
    files: ["packages/connectors/engine/engine-core/test/**/*.test.ts"],
    rules: { "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }] },
  },
  {
    files: [...editorBoundaryProbes, ENGINE_CORE_PROBE],
    rules: { "pulse-vscode/no-comments": "off" },
  },
  {
    files: [`${EDITOR_TREES}/dev/**/*.{ts,tsx}`],
    rules: { "no-console": "off" },
  },
  {
    files: [`${EDITOR_TREES}/**/*.{js,mjs}`],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
    rules: { "no-console": "off" },
  },
  {
    files: [`${EDITOR_TREES}/**/*.cjs`],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { ...globals.node, ...globals.mocha }, sourceType: "commonjs" },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  // Every layer of the runtime view is engine-neutral and keeps behaviour in classes (its ports
  // take exactly this); the blocks of the core, the model reader, the webview and the host kit
  // below replace it with their own unions.
  {
    files: [`${RUNTIME_VIEW}/src/**/*.ts`],
    rules: { "no-restricted-syntax": ["error", ...vscodeNeutralCode, ...vscodeModuleFunctionGate] },
  },
  // engine-core's src: its engine words and module functions, with the connector resource gate
  // of every family's package in the union (the block that set it is replaced here).
  {
    files: [ENGINE_CORE_SRC],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...engineCoreNeutralCode,
        ...vscodeModuleFunctionGate,
        ...connectorResourceGate,
      ],
    },
  },
  // The branded id constructors are module functions by design: this block replaces the
  // package's selectors for the one file (flat config never merges a rule's options), the
  // resource gate kept in the union.
  {
    files: ["packages/connectors/engine/engine-core/src/model/ids.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...engineCoreNeutralCode, ...connectorResourceGate],
    },
  },
  {
    files: [`${RUNTIME_VIEW}/src/model/**/*.ts`],
    rules: { "no-restricted-syntax": ["error", ...vscodeModuleFunctionGate] },
  },
  // The C7 adapter is a package of a family: the connector resource gate stays in its union.
  {
    files: [`${C7_ADAPTER}/src/**/*.ts`],
    rules: {
      "no-restricted-syntax": ["error", ...vscodeModuleFunctionGate, ...connectorResourceGate],
    },
  },
  // The core and the webview format dates and numbers through pulse-ui's foundation
  // (`@miragon/pulse-ui/format`, behind TimeLabels, CountLabels and Labels): the date and number
  // gates of the widget trees join each block's union.
  {
    files: [`${RUNTIME_VIEW}/src/core/**/*.ts`],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...vscodeNeutralCode,
        ...vscodeModuleFunctionGate,
        ...widgetDateGate,
        ...widgetNumberGate,
      ],
    },
  },
  {
    files: [`${RUNTIME_VIEW}/src/webview/**/*.ts`],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...vscodeNeutralCode,
        ...vscodeHostColours,
        ...vscodeModuleFunctionGate,
        ...widgetDateGate,
        ...widgetNumberGate,
      ],
    },
  },
  {
    files: [`${RUNTIME_VIEW}/src/webview/**/*.tsx`],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...vscodeNeutralCode,
        ...vscodeHostColours,
        ...vscodeComponentFunctionGate,
        ...widgetDateGate,
        ...widgetNumberGate,
      ],
    },
  },
  {
    files: [
      "apps/vscode/src/host/**/*.ts",
      `${RUNTIME_VIEW}/src/host-kit/**/*.ts`,
      "apps/orca/src/**/*.ts",
    ],
    rules: {
      "no-restricted-syntax": ["error", ...vscodeHostEngineWords, ...vscodeModuleFunctionGate],
    },
  },
  {
    files: [
      "apps/vscode/src/host/composition-root.ts",
      "apps/vscode/src/host/connections/**",
      `${RUNTIME_VIEW}/src/host-kit/connections/**`,
      "apps/orca/src/worker/composition-root.ts",
    ],
    rules: { "no-restricted-syntax": ["error", ...vscodeModuleFunctionGate] },
  },
  {
    files: ["apps/vscode/src/host/extension.ts", "apps/orca/src/worker/main.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...vscodeHostEngineWords, ...vscodeEntryFunctionGate],
    },
  },
  {
    files: [`${EDITOR_TREES}/src/**/*.{ts,tsx}`, ENGINE_CORE_SRC],
    rules: {
      "max-classes-per-file": ["error", 1],
      "@typescript-eslint/member-ordering": [
        "error",
        {
          default: [
            "signature",
            "field",
            "constructor",
            "public-method",
            "protected-method",
            "private-method",
          ],
        },
      ],
    },
  },
  // The Preact webview follows the rules of hooks (Preact's hooks have React's call-order
  // contract). The React Compiler rules of recommended-latest stay off here: they read
  // Preact's mutable refs and diagram handles as React state.
  {
    files: [`${EDITOR_TREES}/**/*.{ts,tsx}`],
    plugins: { "react-hooks": reactHooks },
    rules: Object.fromEntries(
      Object.keys(reactHooks.configs["recommended-latest"].rules).map((rule) => [rule, "off"]),
    ),
  },
  {
    files: [`${RUNTIME_VIEW}/{src,test}/webview/**/*.{ts,tsx}`],
    plugins: { "react-hooks": reactHooks },
    rules: { "react-hooks/rules-of-hooks": "error" },
  },
)
