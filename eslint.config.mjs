import js from "@eslint/js"
import tseslint from "typescript-eslint"
import reactHooks from "eslint-plugin-react-hooks"
import globals from "globals"

// The widget trees: every tree of React views an MCP host renders (the host bundle's src/ui,
// widget-shell's view half, both connectors' widgets). They are excluded from their package's
// tsconfig.json and typed by the browser-only tsconfig.widgets.json / tsconfig.ui.json projects
// instead, and the date and number gates (invariant 6) hold all of them.
const CONNECTOR_WIDGETS = [
  "packages/connectors/analytics/analytics-connector/src/widgets/**/*.{ts,tsx}",
  "packages/connectors/engine/engine-connector/src/widgets/**/*.{ts,tsx}",
]
const WIDGET_TREES = [
  "apps/mcp-server/src/ui/**/*.{ts,tsx}",
  "packages/core/widget-shell/src/ui/**/*.{ts,tsx}",
  ...CONNECTOR_WIDGETS,
]

// Server tests (and the Playwright host simulation) live outside src/ (not
// part of the build tsconfig) and get their type information from the
// dedicated tsconfig.test.json project.
const serverTestFiles = ["apps/mcp-server/test/**/*.ts", "apps/mcp-server/test-host/**/*.ts"]

// The VS Code extension's runtime probes (apps/vscode/test/<layer>/runtime.boundary.ts)
// expect the globals of their layer to be missing, so apps/vscode/tsconfig.json (the
// union the editor and the project service use) leaves them out; each is typed by its
// layer's tsconfig instead.
const vscodeBoundaryProbes = ["apps/vscode/test/*/runtime.boundary.ts"]

// ── Pattern-gate selectors (`no-restricted-syntax`) ─────────────────────────

const TOOL_MEMBER = "/^(tool|registerTool)$/"
const REGISTRAR_MESSAGE =
  "Operations tools are registered through createToolRegistrar (@miragon/pulse-widget-shell/server) in src/tools/ (see .claude/skills/add-bpm-feature); raw server.tool() (also via a computed key, .call/.bind/.apply, destructuring or Reflect.get) is reserved for the widget-tools files."

// Invariant 1. Not just the canonical `x.tool(...)`: every syntactic route
// to the member that names it literally (an agent "working around" the gate
// reaches for exactly these). A key computed at runtime stays out of any
// selector's reach: that is review's job. Parameter destructuring and object
// literals stay allowed: test fakes build `{ tool } as unknown as MCPServer`.
// Inline `eslint-disable` of this rule (or of complexity/max-lines) is caught
// by scripts/check-ratchets.mjs, not here: a directive could disable a rule
// that polices directives.
const registrarGate = [
  // x.tool(...), x?.tool(...), x.tool.call/bind/apply(...), const t = x.tool
  `MemberExpression[computed=false][property.name=${TOOL_MEMBER}]`,
  // x["tool"], x[`tool`]
  `MemberExpression[computed=true][property.value=${TOOL_MEMBER}]`,
  `MemberExpression[computed=true] > TemplateLiteral.property > TemplateElement[value.raw=${TOOL_MEMBER}]`,
  // const { tool } = x, const { "tool": t } = x, ({ tool } = x), ({ "tool": t } = x)
  `VariableDeclarator > ObjectPattern.id > Property[key.name=${TOOL_MEMBER}]`,
  `VariableDeclarator > ObjectPattern.id > Property[key.value=${TOOL_MEMBER}]`,
  `AssignmentExpression > ObjectPattern.left > Property[key.name=${TOOL_MEMBER}]`,
  `AssignmentExpression > ObjectPattern.left > Property[key.value=${TOOL_MEMBER}]`,
  // Reflect.get(x, "tool"), Reflect.get(x, `tool`)
  `CallExpression[callee.object.name='Reflect'][callee.property.name='get'] > Literal.arguments[value=${TOOL_MEMBER}]`,
  `CallExpression[callee.object.name='Reflect'][callee.property.name='get'] > TemplateLiteral.arguments > TemplateElement[value.raw=${TOOL_MEMBER}]`,
].map((selector) => ({ selector, message: REGISTRAR_MESSAGE }))

// Invariant 6.
const widgetDateGate = [
  {
    selector:
      ":matches(NewExpression, CallExpression)[callee.object.name='Intl'][callee.property.name='DateTimeFormat']",
    message:
      "Use formatTimestamp/formatDate/formatTime from @miragon/pulse-ui, the single source for timestamp rendering (CLAUDE.md invariant 6).",
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
// (formatNumber/formatPercent/formatPercentPoints/formatPeriod/formatDuration),
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
      "Use formatNumber/formatPercent/formatPercentPoints from the pulse-ui kit instead of a hand-built Intl.NumberFormat: they read the view's locale (CLAUDE.md invariant 6).",
  },
]
// The kit's formatters themselves: the same gate minus Intl.NumberFormat.
const widgetNumberGateForFormatters = widgetNumberGate.filter(
  (gate) => gate.selector !== NUMBER_FORMAT_SELECTOR,
)

// Invariant 6: widgets reach the host only through widget-shell's view host (`useViewHost`,
// `HostModelContext`) and query hooks, never `mcp-use/react` itself: its hooks throw outside
// `bootstrapView`, so a widget importing it could not render under `TestViewHost`. The ONE
// adapter is widget-shell's `mcp-use-host.tsx` + `view-root.tsx`. (The AI sparkle is banned by
// pulse-ui's scanGlyphs, which every widget tree runs in its brand-gates test.)
const mcpUseReactGate = {
  paths: [
    {
      name: "mcp-use/react",
      message:
        "Only widget-shell's view root (view-root.tsx, mcp-use-host.tsx) imports mcp-use/react; a widget uses the view host (useViewHost) and renders under TestViewHost in tests (CLAUDE.md invariant 6).",
    },
  ],
}

// Invariant 6 / CI U4, the other half: ONE hand-off vocabulary across the
// product. A connector widget renders a chat hand-off only through widget-shell's
// HandOffButton, whose function table (HAND_OFF_ACTIONS + kitLabels().handOff)
// gives every function one Lucide icon and one label in every module; an
// AskAiButton with a hand-picked icon and verb let the same function drift
// apart between engine and analytics ("Ursache im Chat klären" next to
// "Ursache im Chat suchen", FileSearch for two functions). The import (also
// renamed) and the element (also through a namespace) are both banned in both
// connectors' widgets.
const HAND_OFF_MESSAGE =
  "Render a chat hand-off with widget-shell's HandOffButton (`action` from HAND_OFF_ACTIONS: one Lucide icon and one verb that names the chat per function, in every module), not AskAiButton (CI U4, CLAUDE.md invariant 6)."
const widgetHandOffGate = [
  "ImportSpecifier[imported.name='AskAiButton']",
  "JSXOpeningElement[name.name='AskAiButton']",
  "JSXOpeningElement[name.property.name='AskAiButton']",
].map((selector) => ({ selector, message: HAND_OFF_MESSAGE }))

// ── The VS Code extension (apps/vscode): its own house rules ───────────────
// The extension keeps the stricter rules it was built with (apps/vscode/CLAUDE.md,
// apps/vscode/docs/adr/guardrails.md): no comments (the inline rule below, never
// switched off inline: noInlineConfig), behaviour in classes, one class per file,
// budgets (complexity 10, 300 lines, 60 per function, 4 parameters, 20 statements),
// no engine words in the contract, the core and the webview, no --vscode-* colour in
// the webview. apps/vscode/test/architecture/lint-rules.test.ts lints a probe per rule.
// Its no-restricted-syntax blocks name apps/vscode paths only, so they never replace
// a selector of the MCP gates above (and none of those reaches apps/vscode).
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
  "Engine vocabulary belongs in apps/vscode/src/adapters/<engine> and the composition root. Use the neutral words of the contract here (elementId, definitionId, bpmnProcessId, instanceId)."
const VSCODE_HOST_COLOUR_MESSAGE =
  "The webview takes no colour from VS Code. Use a Miragon token (--cd-*) from apps/vscode/src/webview/theme instead of a --vscode-* variable."
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
    ],
  },

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,

  // Typed linting via the project service for everything the package tsconfigs cover
  {
    ignores: [...WIDGET_TREES, ...serverTestFiles, ...vscodeBoundaryProbes],
    languageOptions: {
      parserOptions: {
        projectService: {
          // Standalone config files that are not part of any tsconfig
          allowDefaultProject: [
            "vitest.shared.ts",
            "apps/mcp-server/vite.config.ts",
            "apps/mcp-server/vitest.config.ts",
            "packages/connectors/analytics/analytics-connector/vitest.config.ts",
            "packages/connectors/engine/engine-connector/vitest.config.ts",
            "packages/connectors/analytics/analytics-client/vitest.config.ts",
            "packages/connectors/engine/engine-client/vitest.config.ts",
            "packages/connectors/engine/engine-client/openapi-ts.config.ts",
            "packages/connectors/engine/engine-core/vitest.config.ts",
            "packages/connectors/engine/engine-core/vitest.stryker.config.ts",
            "packages/core/ui/vitest.config.ts",
            "packages/core/widget-shell/vitest.config.ts",
            "docs/.vitepress/config.ts",
            "docs/.vitepress/theme/index.ts",
          ],
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
          "packages/connectors/analytics/analytics-connector/tsconfig.widgets.json",
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

  // The VS Code extension's runtime probes: typed via their layer's tsconfig
  {
    files: vscodeBoundaryProbes,
    languageOptions: {
      parserOptions: {
        project: [
          "apps/vscode/tsconfig.contract.json",
          "apps/vscode/tsconfig.core.json",
          "apps/vscode/tsconfig.webview.json",
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
      // engine-core and the VS Code extension, whose blocks below set it at error again: in the
      // MCP trees an async function without await is how they satisfy a Promise-returning
      // signature (mcp-use's tool, prompt and resource callbacks, the health probes, fetch stubs
      // and the Prometheus fakes of the tests), where the rule only asks for a Promise.resolve
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

  // Invariant 1: operations tools go through createToolRegistrar. Raw
  // server.tool() is reserved for the widget-tools path (show_* / *_data
  // feeds), exactly the ignores list below.
  {
    files: [
      "packages/connectors/analytics/analytics-connector/src/**/*.{ts,tsx}",
      "packages/connectors/engine/engine-connector/src/**/*.{ts,tsx}",
    ],
    ignores: [
      "packages/connectors/analytics/analytics-connector/src/widget-tools.ts",
      "packages/connectors/analytics/analytics-connector/src/widget-tools/**",
      "packages/connectors/engine/engine-connector/src/widget-tools.ts",
      "packages/connectors/engine/engine-connector/src/widget-tools/**",
    ],
    rules: { "no-restricted-syntax": ["error", ...registrarGate] },
  },

  // Invariant 6: every widget tree renders dates and numbers through pulse-ui's
  // formatters, so every module renders them the same way in the view's locale (date
  // and number gates). After the registrar block, whose options it replaces for the
  // connector widgets: they get the union in the next block.
  {
    files: WIDGET_TREES,
    rules: { "no-restricted-syntax": ["error", ...widgetDateGate, ...widgetNumberGate] },
  },
  // Connector widgets sit under the registrar, date and number gates and render every
  // hand-off through widget-shell's HandOffButton (hand-off gate): one block with the union,
  // after the registrar and WIDGET_TREES blocks (whose options it replaces for these files).
  {
    files: CONNECTOR_WIDGETS,
    rules: {
      "no-restricted-syntax": [
        "error",
        ...registrarGate,
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
  // The kit's two number formatters: `format.ts` (the view's locale, set by LocaleGate)
  // and `formatCount` in `ui-messages.ts` (the components' own locale). After the
  // general pulse-ui block: a later block replaces `no-restricted-syntax` for both files.
  {
    files: ["packages/core/ui/src/kit/format.ts", "packages/core/ui/src/locale/ui-messages.ts"],
    rules: { "no-restricted-syntax": ["error", ...widgetNumberGateForFormatters] },
  },
  // Invariant 6, imports: no `mcp-use/react` in any MCP source or test but widget-shell's
  // adapter. Its own rule (`no-restricted-imports` is ONE rule too: a glob two import gates
  // share gets their union), so it never collides with the no-restricted-syntax unions above.
  {
    files: [
      "apps/mcp-server/{src,test,test-host}/**/*.{ts,tsx}",
      "packages/core/ui/src/**/*.{ts,tsx}",
      "packages/core/widget-shell/src/**/*.{ts,tsx}",
      "packages/connectors/*/*/src/**/*.{ts,tsx}",
    ],
    rules: { "no-restricted-imports": ["error", mcpUseReactGate] },
  },
  {
    files: [
      "packages/core/widget-shell/src/ui/mcp-use-host.tsx",
      "packages/core/widget-shell/src/ui/view-root.tsx",
      "packages/core/widget-shell/src/ui/view-root.test.tsx",
    ],
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
  // nesting, function length and statement budgets. No `ignores` and no no-restricted-syntax here: the tests get their own
  // block below, and a no-restricted-syntax setting would REPLACE the pattern gates. The CLI's
  // workflow domain, @miragon/pulse-engine-core (packages/connectors/engine/engine-core), keeps these budgets.
  {
    files: ["apps/cli/**/*.ts", "packages/connectors/engine/engine-core/**/*.ts"],
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
  // The same for engine-core's tests. Its ./testing export (fixtures, the fake port) ships on npm
  // and keeps the budgets of shipped code.
  {
    files: [
      "apps/cli/**/*.test.ts",
      "apps/cli/test/**/*.ts",
      "packages/connectors/engine/engine-core/**/*.test.ts",
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
  // The CLI's build and catalog scripts report on the console.
  {
    files: ["apps/cli/scripts/**/*.ts"],
    rules: { "no-console": "off" },
  },
  // ── The VS Code extension (apps/vscode) ─────────────────────────────────
  {
    files: ["apps/vscode/**/*.{ts,tsx}"],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
  },
  // The JS files keep the strict and stylistic rules that need no types. Only their rule
  // sets: the configs' eslint-recommended part switches core checks such as no-undef off,
  // which TypeScript does for TS files but nothing does for JS.
  {
    files: ["apps/vscode/**/*.{js,mjs,cjs}"],
    extends: [
      tseslint.configs.strict.find(({ name }) => name === "typescript-eslint/strict"),
      tseslint.configs.stylistic.find(({ name }) => name === "typescript-eslint/stylistic"),
    ],
  },
  {
    files: ["apps/vscode/**/*.{ts,tsx,js,mjs,cjs}"],
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
      "apps/vscode/test/webview/harness.tsx",
      "apps/vscode/test/smoke/*.cjs",
    ],
    rules: {
      "max-lines": ["error", { max: 300, skipBlankLines: true }],
      "max-lines-per-function": ["error", { max: 60, skipBlankLines: true }],
      "max-statements": ["error", 20],
      "max-nested-callbacks": ["error", 3],
    },
  },
  {
    files: ["apps/vscode/test/**/*.ts", "apps/vscode/test/**/*.test.tsx"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },
  {
    files: ["apps/vscode/test/*/runtime.boundary.ts"],
    rules: { "pulse-vscode/no-comments": "off" },
  },
  {
    files: ["apps/vscode/dev/**/*.{ts,tsx}"],
    rules: { "no-console": "off" },
  },
  {
    files: ["apps/vscode/**/*.{js,mjs}"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
    rules: { "no-console": "off" },
  },
  {
    files: ["apps/vscode/**/*.cjs"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { ...globals.node, ...globals.mocha }, sourceType: "commonjs" },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    files: ["apps/vscode/src/contract/**/*.ts"],
    rules: { "no-restricted-syntax": ["error", ...vscodeNeutralCode, ...vscodeModuleFunctionGate] },
  },
  // The branded id constructors are module functions by design: this block replaces the
  // contract's selectors for the one file (flat config never merges a rule's options).
  {
    files: ["apps/vscode/src/contract/model/ids.ts"],
    rules: { "no-restricted-syntax": ["error", ...vscodeNeutralCode] },
  },
  {
    files: ["apps/vscode/src/adapters/**/*.ts", "apps/vscode/src/model/**/*.ts"],
    rules: { "no-restricted-syntax": ["error", ...vscodeModuleFunctionGate] },
  },
  {
    files: ["apps/vscode/src/core/**/*.ts"],
    rules: { "no-restricted-syntax": ["error", ...vscodeNeutralCode, ...vscodeModuleFunctionGate] },
  },
  {
    files: ["apps/vscode/src/webview/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...vscodeNeutralCode,
        ...vscodeHostColours,
        ...vscodeModuleFunctionGate,
      ],
    },
  },
  {
    files: ["apps/vscode/src/webview/**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...vscodeNeutralCode,
        ...vscodeHostColours,
        ...vscodeComponentFunctionGate,
      ],
    },
  },
  {
    files: ["apps/vscode/src/host/**/*.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...vscodeHostEngineWords, ...vscodeModuleFunctionGate],
    },
  },
  {
    files: ["apps/vscode/src/host/composition-root.ts", "apps/vscode/src/host/connections/**"],
    rules: { "no-restricted-syntax": ["error", ...vscodeModuleFunctionGate] },
  },
  {
    files: ["apps/vscode/src/host/extension.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...vscodeHostEngineWords, ...vscodeEntryFunctionGate],
    },
  },
  {
    files: ["apps/vscode/src/**/*.{ts,tsx}"],
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
    files: ["apps/vscode/src/webview/**/*.{ts,tsx}", "apps/vscode/test/webview/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: { "react-hooks/rules-of-hooks": "error" },
  },
)
