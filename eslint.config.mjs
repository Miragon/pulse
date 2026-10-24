import js from "@eslint/js"
import tseslint from "typescript-eslint"
import reactHooks from "eslint-plugin-react-hooks"

// Widget/UI sources are excluded from the package tsconfigs (they are
// compiled by Vite/the bundler) and get their type information from the
// dedicated tsconfig.widgets.json / tsconfig.ui.json projects instead.
const bundledUiFiles = [
  "apps/mcp-server-camunda7/src/ui/**/*.{ts,tsx}",
  "packages/connectors/analytics/analytics-connector/src/widgets/**/*.{ts,tsx}",
  "packages/connectors/camunda/camunda7-connector/src/widgets/**/*.{ts,tsx}",
]

// Server tests (and the Playwright host simulation) live outside src/ (not
// part of the build tsconfig) and get their type information from the
// dedicated tsconfig.test.json project.
const serverTestFiles = [
  "apps/mcp-server-camunda7/test/**/*.ts",
  "apps/mcp-server-camunda7/test-host/**/*.ts",
]

// Ratchet debt: frozen high-water marks from the 2026-08-07 baseline
// measurement. Shrink-only lists — refactor a file below the global target
// (complexity 15 / 400 effective lines), then DELETE its entry. Never raise
// a value, never add an entry; new code gets the global budget.
export const complexityRatchet = {}

// Frozen at current length rounded up to the next 10 lines.
export const maxLinesRatchet = {}

// ── Pattern-gate selectors (`no-restricted-syntax`) ─────────────────────────

const TOOL_MEMBER = "/^(tool|registerTool)$/"
const REGISTRAR_MESSAGE =
  "Operations tools are registered through createToolRegistrar in src/tools/ (see .claude/skills/add-bpm-feature); raw server.tool() — also via a computed key, .call/.bind/.apply, destructuring or Reflect.get — is reserved for the widget-tools files."

// Invariant 1. Not just the canonical `x.tool(...)`: every syntactic route
// to the member that names it literally (an agent "working around" the gate
// reaches for exactly these). A key computed at runtime stays out of any
// selector's reach — that is review's job. Parameter destructuring and object
// literals stay allowed — test fakes build `{ tool } as unknown as MCPServer`.
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
      "Use formatTimestamp/formatDate/formatTime from @miragon/pulse-widget-shell/widgets — the single source for timestamp rendering (CLAUDE.md invariant 6).",
  },
  {
    selector: "CallExpression[callee.property.name='toLocaleDateString']",
    message:
      "Use formatDate from @miragon/pulse-widget-shell/widgets instead of Date#toLocaleDateString (CLAUDE.md invariant 6).",
  },
  {
    selector: "CallExpression[callee.property.name='toLocaleTimeString']",
    message:
      "Use formatTime from @miragon/pulse-widget-shell/widgets instead of Date#toLocaleTimeString (CLAUDE.md invariant 6).",
  },
]

// Invariant 6: numbers in widget code render through the kit formatters
// (formatNumber/formatPercent/formatPercentPoints/formatPeriod/formatDuration),
// which read the view's locale. Number#toFixed formats in no locale; a
// toLocaleString() without a locale (no argument, `undefined`, `null`, `[]`)
// in the browser's; a hand-built Intl.NumberFormat bypasses the formatters
// (only the kit's format.ts builds one — see its block below).
const NUMBER_FORMAT_SELECTOR =
  ":matches(NewExpression, CallExpression)[callee.object.name='Intl'][callee.property.name='NumberFormat']"
const widgetNumberGate = [
  {
    selector: "CallExpression[callee.property.name='toFixed']",
    message:
      "Use formatNumber/formatPercent/formatPercentPoints from the widget-shell kit instead of Number#toFixed: it ignores the view's locale (CLAUDE.md invariant 6).",
  },
  {
    // Each alternative pins the node type: esquery compares String(value), so
    // a bare [arguments.0.name='undefined'] also matches every argument that
    // has no `name` (a string literal, `current?.locale`).
    selector:
      "CallExpression[callee.property.name='toLocaleString']:matches([arguments.length=0], [arguments.0.type='Identifier'][arguments.0.name='undefined'], [arguments.0.type='Literal'][arguments.0.raw='null'], [arguments.0.type='ArrayExpression'][arguments.0.elements.length=0])",
    message:
      "Use formatNumber from the widget-shell kit instead of toLocaleString() without a locale: it formats in the browser's locale, not the view's (CLAUDE.md invariant 6).",
  },
  {
    selector: NUMBER_FORMAT_SELECTOR,
    message:
      "Use formatNumber/formatPercent/formatPercentPoints from the widget-shell kit instead of a hand-built Intl.NumberFormat: they read the view's locale (CLAUDE.md invariant 6).",
  },
]
// The kit's formatters themselves: the same gate minus Intl.NumberFormat.
const widgetNumberGateForFormatters = widgetNumberGate.filter(
  (gate) => gate.selector !== NUMBER_FORMAT_SELECTOR,
)

// Invariant 6 / CI U4: the AI affordance is the Lucide icon of the concrete
// function plus a verb that names the chat, never a sparkle. Every export
// spelling of lucide-react's sparkle icons, and their deep imports. (The kit's
// scanGlyphs checks the same imports for packages outside this config.)
const SPARKLE_MESSAGE =
  "No Sparkles/WandSparkles as the AI affordance (CI U4): use the Lucide icon of the concrete function (e.g. FileSearch) and a verb that names the chat (CLAUDE.md invariant 6)."
const widgetSparkleGate = {
  paths: [
    {
      name: "lucide-react",
      importNames: ["Sparkle", "Sparkles", "WandSparkles", "Wand2"].flatMap((icon) => [
        icon,
        `${icon}Icon`,
        `Lucide${icon}`,
      ]),
      message: SPARKLE_MESSAGE,
    },
  ],
  patterns: [
    {
      regex: "^lucide-react/(?:.*/)?(?:sparkles?|wand-sparkles|wand-2)(?:\\.js)?$",
      message: SPARKLE_MESSAGE,
    },
  ],
}

// Invariant 6 / CI U4, the other half: ONE hand-off vocabulary across the
// product. A connector widget renders a chat hand-off only through the kit's
// HandOffButton, whose function table (HAND_OFF_ACTIONS + kitLabels().handOff)
// gives every function one Lucide icon and one label in every module; an
// AskAiButton with a hand-picked icon and verb let the same function drift
// apart between camunda7 and analytics ("Ursache im Chat klären" next to
// "Ursache im Chat suchen", FileSearch for two functions). The import (also
// renamed) and the element (also through a namespace) are both banned in both
// connectors' widgets.
const HAND_OFF_MESSAGE =
  "Render a chat hand-off with the kit's HandOffButton (`action` from HAND_OFF_ACTIONS: one Lucide icon and one verb that names the chat per function, in every module), not AskAiButton (CI U4, CLAUDE.md invariant 6)."
const widgetHandOffGate = [
  "ImportSpecifier[imported.name='AskAiButton']",
  "JSXOpeningElement[name.name='AskAiButton']",
  "JSXOpeningElement[name.property.name='AskAiButton']",
].map((selector) => ({ selector, message: HAND_OFF_MESSAGE }))

// Invariant 8, domain packages: why a -domain package uses no Node global (the
// block near the end of this file names each global with its replacement).
const DOMAIN_GLOBAL_REASON =
  "A -domain package runs unchanged in the MCP server, the CLI and the VS Code extension host, so it uses no Node global"

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/generated/**",
      "vendor/**",
      // Widget-bundle stand-in read (never executed) by the in-process e2e
      // boots — data, not code; not part of any tsconfig project.
      "apps/mcp-server-camunda7/test/fixtures/**",
      // Standalone customer-facing workspace, outside the root pnpm workspace
      // and its tsconfig projects — verified by scripts/test-template.sh
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
    ignores: [...bundledUiFiles, ...serverTestFiles],
    languageOptions: {
      parserOptions: {
        projectService: {
          // Standalone config files that are not part of any tsconfig
          allowDefaultProject: [
            "vitest.shared.ts",
            "apps/mcp-server-camunda7/vite.config.ts",
            "apps/mcp-server-camunda7/vitest.config.ts",
            "packages/connectors/analytics/analytics-connector/vitest.config.ts",
            "packages/connectors/analytics/analytics-connector/vitest.stryker.config.ts",
            "packages/connectors/camunda/camunda7-connector/vitest.config.ts",
            "packages/connectors/camunda/camunda7-connector/vitest.stryker.config.ts",
            "packages/connectors/analytics/analytics-client/vitest.config.ts",
            "packages/connectors/analytics/analytics-client/vitest.stryker.config.ts",
            "packages/connectors/camunda/camunda7-client/vitest.config.ts",
            "packages/connectors/camunda/camunda7-client/vitest.stryker.config.ts",
            "packages/connectors/camunda/camunda7-client/openapi-ts.config.ts",
            "packages/core/widget-shell/vitest.config.ts",
            "packages/core/widget-shell/vitest.stryker.config.ts",
            "docs/.vitepress/config.ts",
            "docs/.vitepress/theme/index.ts",
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Widget/UI files: typed via their dedicated tsconfig projects
  {
    files: bundledUiFiles,
    languageOptions: {
      parserOptions: {
        project: [
          "apps/mcp-server-camunda7/tsconfig.ui.json",
          "packages/connectors/analytics/analytics-connector/tsconfig.widgets.json",
          "packages/connectors/camunda/camunda7-connector/tsconfig.widgets.json",
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
        project: ["apps/mcp-server-camunda7/tsconfig.test.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      // Downgraded to warn: mcp-use has poor type coverage (Phase 1)
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      "@typescript-eslint/require-await": "warn",
      "@typescript-eslint/no-base-to-string": "warn",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },

  // React hooks for all UI/widget code
  {
    files: ["apps/mcp-server-camunda7/src/**/*.{ts,tsx}", "packages/**/src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs["recommended-latest"].rules,
  },

  // ── Architecture pattern gates ──────────────────────────────────────────
  // The AST-checkable slices of the CLAUDE.md invariants; the dependency
  // rules live in .dependency-cruiser.cjs (`pnpm lint:architecture`).

  // `no-restricted-syntax` is ONE rule: in flat config a later block REPLACES
  // an earlier block's options for every file both match — selector lists
  // are never merged. Each gate's selectors therefore live in a constant
  // (top of file), and a glob two gates share gets ONE block carrying the
  // union (the connector widgets below). scripts/eslint-gates.test.mjs pins
  // the effective options per path and lints known-bad spellings.

  // Invariant 1: operations tools go through createToolRegistrar. Raw
  // server.tool() is reserved for the widget-tools path (show_* / *_data
  // feeds + module settings) — exactly the ignores list below. A durable
  // write registered there must gate itself against the module's toolset.
  {
    files: [
      "packages/connectors/analytics/analytics-connector/src/**/*.{ts,tsx}",
      "packages/connectors/camunda/camunda7-connector/src/**/*.{ts,tsx}",
    ],
    ignores: [
      "packages/connectors/analytics/analytics-connector/src/widget-tools.ts",
      "packages/connectors/analytics/analytics-connector/src/widget-tools/**",
      "packages/connectors/analytics/analytics-connector/src/settings-tools.ts",
      "packages/connectors/camunda/camunda7-connector/src/widget-tools.ts",
      "packages/connectors/camunda/camunda7-connector/src/widget-tools/**",
      "packages/connectors/camunda/camunda7-connector/src/tools/user-profile.ts",
    ],
    rules: { "no-restricted-syntax": ["error", ...registrarGate] },
  },

  // Invariant 6: all date/time rendering in widgets goes through the
  // widget-shell format helpers so every module renders timestamps the same
  // way. Number#toLocaleString (thousands separators) is deliberately allowed.
  {
    files: ["apps/mcp-server-camunda7/src/ui/**/*.{ts,tsx}"],
    rules: { "no-restricted-syntax": ["error", ...widgetDateGate] },
  },
  // Connector widgets sit under the registrar AND date gates, render every
  // number through the kit formatters (number gate) and every hand-off through
  // the kit's HandOffButton (hand-off gate) — one block per connector, each with the union,
  // after the registrar block (whose options it replaces for these files).
  {
    files: ["packages/connectors/camunda/camunda7-connector/src/widgets/**/*.{ts,tsx}"],
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
  {
    files: ["packages/connectors/analytics/analytics-connector/src/widgets/**/*.{ts,tsx}"],
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
  // Invariant 6, numbers: the kit's own widget code, and both connectors'
  // widgets in their union blocks above.
  {
    files: ["packages/core/widget-shell/src/ui/**/*.{ts,tsx}"],
    rules: { "no-restricted-syntax": ["error", ...widgetNumberGate] },
  },
  {
    files: ["packages/core/widget-shell/src/ui/format.ts"],
    rules: { "no-restricted-syntax": ["error", ...widgetNumberGateForFormatters] },
  },
  // Invariant 6, AI affordance: no sparkle icon in any widget tree (its own
  // rule, so it never collides with the no-restricted-syntax unions above).
  {
    files: [
      "apps/mcp-server-camunda7/src/ui/**/*.{ts,tsx}",
      "packages/core/widget-shell/src/ui/**/*.{ts,tsx}",
      "packages/connectors/analytics/analytics-connector/src/widgets/**/*.{ts,tsx}",
      "packages/connectors/camunda/camunda7-connector/src/widgets/**/*.{ts,tsx}",
    ],
    rules: { "no-restricted-imports": ["error", widgetSparkleGate] },
  },
  // Invariant 8, domain packages: a packages/connectors/<family>/<name>-domain
  // package holds pure use cases that run unchanged in the MCP server, the CLI
  // and the VS Code extension host (and possibly a webview). The dependency
  // rules (.dependency-cruiser.cjs: domains-are-leaves, domains-are-pure) see
  // only imports, while the base tsconfig puts Node's globals into every
  // package, so this block bans the Node globals a domain could use without
  // an import. Take the capability through the port the caller passes in, or
  // use the web-standard global named in each message. `globalThis.process`
  // and friends are caught too (checkGlobalObject). Its own rule, so it never
  // collides with the no-restricted-syntax unions above; no later block sets it.
  {
    files: [
      "packages/connectors/*/*-domain/src/**/*.ts",
      "packages/connectors/*/*-domain/src/**/*.tsx",
    ],
    rules: {
      "no-restricted-globals": [
        "error",
        {
          checkGlobalObject: true,
          globals: [
            {
              name: "process",
              message: `${DOMAIN_GLOBAL_REASON}: take configuration, the environment and the clock through the port the caller passes in.`,
            },
            {
              name: "Buffer",
              message: `${DOMAIN_GLOBAL_REASON}: use Uint8Array, TextEncoder/TextDecoder or atob/btoa.`,
            },
            {
              name: "__dirname",
              message: `${DOMAIN_GLOBAL_REASON}: a domain reads no files; take the content through the port.`,
            },
            {
              name: "__filename",
              message: `${DOMAIN_GLOBAL_REASON}: a domain reads no files; take the content through the port.`,
            },
            {
              name: "require",
              message: `${DOMAIN_GLOBAL_REASON}: use an ESM import of another module of the same package.`,
            },
            {
              name: "module",
              message: `${DOMAIN_GLOBAL_REASON}: use ESM export, not CommonJS module.exports.`,
            },
            {
              name: "exports",
              message: `${DOMAIN_GLOBAL_REASON}: use ESM export, not CommonJS exports.`,
            },
            {
              name: "global",
              message: `${DOMAIN_GLOBAL_REASON}: take the capability through the port; a web-standard global needs no global object.`,
            },
            {
              name: "setImmediate",
              message: `${DOMAIN_GLOBAL_REASON}: use queueMicrotask or setTimeout.`,
            },
            {
              name: "clearImmediate",
              message: `${DOMAIN_GLOBAL_REASON}: use clearTimeout with setTimeout.`,
            },
          ],
        },
      ],
    },
  },

  // ── Ratchet metrics: complexity + file-length budgets ───────────────────
  // Global targets for all source code; the ratchet lists above freeze
  // today's offenders at their high-water mark.
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
  // i18n message catalogs are data, not code — no length budget.
  {
    files: ["packages/connectors/*/*/src/messages/*.sweep.ts"],
    rules: { "max-lines": "off" },
  },
  ...Object.entries(complexityRatchet).map(([file, max]) => ({
    files: [file],
    rules: { complexity: ["error", max] },
  })),
  ...Object.entries(maxLinesRatchet).map(([file, max]) => ({
    files: [file],
    rules: { "max-lines": ["error", { max, skipBlankLines: true, skipComments: true }] },
  })),
)
