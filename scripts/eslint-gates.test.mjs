import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { before, describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { ESLint, Linter } from "eslint"
import tseslint from "typescript-eslint"
import { DEFAULT_PROJECT_FILES } from "../eslint.config.mjs"

/**
 * Self-test of the architecture pattern gates in eslint.config.mjs (a gate
 * that has never been red is decoration). For each probe it asks the REAL
 * config which `no-restricted-syntax` options apply to a real path, so a
 * later block silently replacing an earlier block's selectors (flat config
 * does not merge one rule's options) turns this red. Then it lints known-bad
 * snippets with exactly those options.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const ENGINE_CONNECTOR_SRC_DIR = "packages/connectors/engine/engine-connector/src"
const AN = "packages/connectors/analytics/analytics-connector/src"

const eslint = new ESLint({ cwd: repoRoot })
const linter = new Linter({ configType: "flat" })

/** The effective options of `rule` for a repo path (null when off). */
async function ruleOptionsFor(rel, rule) {
  const config = await eslint.calculateConfigForFile(path.join(repoRoot, rel))
  const setting = config.rules?.[rule]
  return setting && setting[0] !== 0 && setting[0] !== "off" ? setting : null
}

/** Messages the effective `rule` options (default: the pattern gates) report for `code` at `rel`. */
async function gateMessages(rel, code, rule = "no-restricted-syntax") {
  const options = await ruleOptionsFor(rel, rule)
  if (!options) return []
  return linter
    .verify(
      code,
      [
        {
          files: ["**/*.ts", "**/*.tsx"],
          languageOptions: {
            parser: tseslint.parser,
            parserOptions: { ecmaFeatures: { jsx: true } },
          },
          rules: { [rule]: options },
        },
      ],
      { filename: path.join(repoRoot, rel) },
    )
    .map((m) => m.message)
}

const isRegistrarHit = (m) => m.includes("createToolRegistrar")
const isDateHit = (m) =>
  /^Use format(?:Timestamp|Date|Time)\b/.test(m) && m.includes("@miragon/pulse-ui")
const isNumberHit = (m) => m.includes("view's locale") || m.includes("browser's locale")

const WS = "packages/core/widget-shell/src/ui"
const UI = "packages/core/ui/src"
const APP_UI = "apps/mcp-server/src/ui"
/**
 * WIDGET_TREES of eslint.config.mjs: the host bundle's src/ui, widget-shell's view half and both
 * connectors' widgets, a .ts and a .tsx probe each. The date and number gates hold all of them.
 */
const WIDGET_TREE_PATHS = [
  APP_UI,
  WS,
  `${ENGINE_CONNECTOR_SRC_DIR}/widgets`,
  `${AN}/widgets`,
].flatMap((dir) => [`${dir}/__probe__.ts`, `${dir}/__probe__.tsx`])
/** The number gate's probes: pulse-ui's code and every widget tree. */
const NUMBER_PATHS = [`${UI}/__probe__.ts`, `${UI}/__probe__.tsx`, ...WIDGET_TREE_PATHS]

describe("date gate (invariant 6) in every widget tree", () => {
  it("catches Intl.DateTimeFormat (new and called), toLocaleDateString and toLocaleTimeString", async () => {
    const code = [
      'new Intl.DateTimeFormat("de", opts).format(d)',
      "Intl.DateTimeFormat(undefined).format(d)",
      "d.toLocaleDateString()",
      'd.toLocaleTimeString("de")',
    ].join("\n")
    for (const rel of WIDGET_TREE_PATHS) {
      const messages = await gateMessages(rel, code)
      assert.equal(messages.filter(isDateHit).length, 4, rel)
    }
  })

  it("leaves the server half of widget-shell and the kit's own date formatters alone", async () => {
    const code = 'new Intl.DateTimeFormat("de").format(d)\nd.toLocaleDateString()'
    for (const rel of [
      "packages/core/widget-shell/src/__probe__.ts",
      "packages/core/widget-shell/src/protocol/__probe__.ts",
      `${UI}/kit/format.ts`,
    ]) {
      const messages = await gateMessages(rel, code)
      assert.equal(messages.filter(isDateHit).length, 0, rel)
    }
  })
})

describe("number gate (invariant 6) in pulse-ui and every widget tree", () => {
  it("catches toFixed and an argument-less toLocaleString in .ts and .tsx", async () => {
    for (const rel of NUMBER_PATHS) {
      const messages = await gateMessages(
        rel,
        "const a = n.toFixed(1)\nconst b = n.toLocaleString()\nconst c = (x as number).toFixed()",
      )
      assert.equal(messages.filter(isNumberHit).length, 3, rel)
    }
  })

  it("catches the browser's locale spelled as undefined, null or [], and Intl.NumberFormat", async () => {
    const escapes = [
      "n.toLocaleString(undefined, { maximumFractionDigits: 1 })",
      "n.toLocaleString(undefined)",
      "n.toLocaleString(null, opts)",
      "n.toLocaleString([], opts)",
      "new Intl.NumberFormat(undefined, { style: 'percent' }).format(r)",
      'Intl.NumberFormat("de").format(n)',
    ]
    for (const rel of NUMBER_PATHS) {
      for (const code of escapes) {
        const messages = await gateMessages(rel, code)
        assert.equal(messages.filter(isNumberHit).length, 1, `${rel}: "${code}" passed the gate`)
      }
    }
  })

  it("leaves a locale-bound toLocaleString (the kit's own date helpers) alone", async () => {
    for (const rel of [`${UI}/__probe__.ts`, ...WIDGET_TREE_PATHS]) {
      const messages = await gateMessages(
        rel,
        'const a = d.toLocaleString(locale, opts)\nconst b = n.toLocaleString("de")\nconst c = d.toLocaleString(current?.locale, zoned())',
      )
      assert.deepEqual(messages, [], rel)
    }
  })

  it("lets exactly the kit's two formatters build an Intl.NumberFormat, toFixed stays banned there", async () => {
    for (const rel of [`${UI}/kit/format.ts`, `${UI}/locale/ui-messages.ts`]) {
      const messages = await gateMessages(
        rel,
        "new Intl.NumberFormat(current?.locale, options)\nconst a = n.toFixed(1)",
      )
      assert.equal(messages.filter(isNumberHit).length, 1, rel)
      assert.ok(
        messages.every((m) => !m.includes("Intl.NumberFormat")),
        rel,
      )
    }
  })
})

describe("mcp-use/react gate (invariant 6): only widget-shell's adapter imports it", () => {
  const isMcpUseReactHit = (m) => m.includes("imports mcp-use/react")
  const MCP_PATHS = [
    `${ENGINE_CONNECTOR_SRC_DIR}/widgets/__probe__.tsx`,
    `${AN}/widgets/__probe__.ts`,
    `${ENGINE_CONNECTOR_SRC_DIR}/widget-tools/__probe__.ts`,
    `${UI}/__probe__.tsx`,
    `${UI}/testing/__probe__.ts`,
    `${WS}/__probe__.tsx`,
    "packages/core/widget-shell/src/__probe__.ts",
    "apps/mcp-server/src/ui/__probe__.tsx",
    "apps/mcp-server/test/__probe__.test.ts",
    "apps/mcp-server/test-host/__probe__.spec.ts",
  ]

  it("bans mcp-use/react everywhere but widget-shell's adapter", async () => {
    const code = 'import { useCallTool, bootstrapView } from "mcp-use/react"'
    for (const rel of MCP_PATHS) {
      const messages = await gateMessages(rel, code, "no-restricted-imports")
      assert.equal(messages.filter(isMcpUseReactHit).length, 1, rel)
    }
    for (const rel of [
      `${WS}/mcp-use-host.tsx`,
      `${WS}/view-root.tsx`,
      `${WS}/view-root.test.tsx`,
    ]) {
      assert.deepEqual(await gateMessages(rel, code, "no-restricted-imports"), [], rel)
    }
  })

  it("leaves pulse-ui, the server package and widget-shell's entries alone", async () => {
    const code = [
      'import { Button, WidgetHeader, LocaleProvider, ToastProvider, type ToneVariant } from "@miragon/pulse-ui"',
      'import { scanColors, themeStylesheets } from "@miragon/pulse-ui/testing"',
      'import { MCPServer } from "mcp-use"',
      'import { useToolQuery, useViewHost, TestViewHost } from "@miragon/pulse-widget-shell/widgets"',
      'import { buildViewResult } from "@miragon/pulse-widget-shell/server"',
    ].join("\n")
    for (const rel of MCP_PATHS) {
      assert.deepEqual(await gateMessages(rel, code, "no-restricted-imports"), [], rel)
    }
  })
})

describe("hand-off gate (invariant 6, CI U4) in both connectors' widgets", () => {
  const isHandOffHit = (m) => m.includes("HandOffButton") && m.includes("not AskAiButton")
  const HAND_OFF_PATHS = [
    `${ENGINE_CONNECTOR_SRC_DIR}/widgets/__probe__.tsx`,
    `${AN}/widgets/__probe__.tsx`,
  ]
  const KIT = '"@miragon/pulse-widget-shell/widgets"'

  it("bans AskAiButton in every spelling: import, renamed import, element, namespace", async () => {
    const cases = [
      [`import { AskAiButton } from ${KIT}`, 1],
      [`import { AskAiButton as Ask } from ${KIT}`, 1],
      ['const el = <AskAiButton prompt={p} icon={Scale} label={t("x")} />', 1],
      ["const el = <AskAiButton prompt={p}>Ask</AskAiButton>", 1],
      ["const el = <W.AskAiButton prompt={p} />", 1],
    ]
    for (const rel of HAND_OFF_PATHS) {
      for (const [code, hits] of cases) {
        const messages = await gateMessages(rel, code)
        assert.equal(messages.filter(isHandOffHit).length, hits, `${rel}: ${code}`)
      }
    }
  })

  it("passes the kit's HandOffButton and leaves other components alone", async () => {
    const code = [
      `import { HandOffButton, type AskAiPrompt, type AskAiVariant } from ${KIT}`,
      'const a = <HandOffButton action="findCause" prompt={p} variant="icon" />',
      "const b = <Button prompt={p} />",
    ].join("\n")
    for (const rel of HAND_OFF_PATHS) {
      assert.deepEqual(await gateMessages(rel, code), [], rel)
    }
  })
})

const REGISTRAR_ESCAPES = {
  "direct call": 'server.tool("x", {}, handler)',
  "registerTool call": 'server.registerTool("x", {}, handler)',
  "optional call": 'server?.tool("x", {}, handler)',
  "computed string key": 'server["tool"]("x", {}, handler)',
  "computed template key": 'server[`tool`]("x", {}, handler)',
  ".call": 'server.tool.call(server, "x", {}, handler)',
  ".bind": 'server.tool.bind(server)("x", {}, handler)',
  ".apply": 'server.tool.apply(server, ["x", {}, handler])',
  "destructured declaration": 'const { tool } = server\ntool("x", {}, handler)',
  "destructured + renamed": 'const { registerTool: register } = server\nregister("x")',
  "destructured string key": 'const { "tool": t } = server\nt("x")',
  "destructuring assignment": 'let tool\n;({ tool } = server)\ntool("x")',
  "destructuring assignment, string key": 'let t\n;({ "tool": t } = server)\nt.call(server, "x")',
  "Reflect.get": 'Reflect.get(server, "tool")("x", {}, handler)',
  "Reflect.get, template key": 'Reflect.get(server, `tool`).call(server, "x")',
}

describe("registrar gate (invariant 1) catches every spelling", () => {
  for (const rel of [
    `${ENGINE_CONNECTOR_SRC_DIR}/tools/__probe__.ts`,
    `${AN}/tools/__probe__.tsx`,
  ]) {
    for (const [label, code] of Object.entries(REGISTRAR_ESCAPES)) {
      it(`${label} (${path.extname(rel)})`, async () => {
        const messages = await gateMessages(rel, code)
        assert.ok(messages.some(isRegistrarHit), `${rel}: "${code}" passed the registrar gate`)
      })
    }
  }

  it("stays quiet on test fakes, parameter destructuring and unrelated names", async () => {
    const code = [
      "const server = { tool } as unknown as MCPServer",
      "const fn = ({ tool, list }: Case) => [tool, list]",
      "const name = tool.name + toolName + obj.tools.length",
    ].join("\n")
    assert.deepEqual(
      await gateMessages(`${ENGINE_CONNECTOR_SRC_DIR}/tools/__probe__.test.ts`, code),
      [],
    )
  })

  it("exempts exactly the widget-tools path", async () => {
    for (const rel of [
      `${ENGINE_CONNECTOR_SRC_DIR}/widget-tools.ts`,
      `${ENGINE_CONNECTOR_SRC_DIR}/widget-tools/__probe__.ts`,
      `${AN}/widget-tools.ts`,
      `${AN}/widget-tools/__probe__.ts`,
    ]) {
      const messages = await gateMessages(rel, 'server.tool("x", {}, handler)')
      assert.equal(messages.filter(isRegistrarHit).length, 0, rel)
    }
  })
})

describe("gates sharing a glob are merged, not overridden", () => {
  let widgetTs
  let widgetTsx
  before(async () => {
    const code = 'server.tool("x")\nnew Intl.DateTimeFormat("de")\nd.toLocaleDateString()'
    widgetTs = await gateMessages(`${ENGINE_CONNECTOR_SRC_DIR}/widgets/__probe__.ts`, code)
    widgetTsx = await gateMessages(`${AN}/widgets/__probe__.tsx`, code)
  })

  it("connector widget files carry BOTH the registrar and the date gate", () => {
    for (const messages of [widgetTs, widgetTsx]) {
      assert.ok(messages.some(isRegistrarHit), "registrar gate dropped for widgets")
      assert.equal(messages.filter(isDateHit).length, 2, "date gate dropped for widgets")
    }
  })

  it("both connectors' widgets carry the registrar, date AND number gates in one union per glob", async () => {
    const code = [
      'server.tool("x")',
      "d.toLocaleDateString()",
      "const a = n.toFixed(1)",
      "const b = n.toLocaleString()",
      "const c = n.toLocaleString(undefined)",
      "const d = new Intl.NumberFormat('de').format(n)",
    ].join("\n")
    for (const rel of [
      `${ENGINE_CONNECTOR_SRC_DIR}/widgets/__probe__.ts`,
      `${ENGINE_CONNECTOR_SRC_DIR}/widgets/__probe__.tsx`,
      `${AN}/widgets/__probe__.ts`,
      `${AN}/widgets/__probe__.tsx`,
    ]) {
      const messages = await gateMessages(rel, code)
      assert.ok(messages.some(isRegistrarHit), `${rel}: registrar gate dropped`)
      assert.equal(messages.filter(isDateHit).length, 1, `${rel}: date gate dropped`)
      assert.equal(messages.filter(isNumberHit).length, 4, `${rel}: number gate missing`)
    }
  })

  it("the widget trees without another gate carry exactly the date and number gates", async () => {
    const code = [
      'import { AskAiButton } from "@miragon/pulse-widget-shell/widgets"',
      'server.tool("x")',
      "d.toLocaleTimeString()",
      "const a = n.toFixed(1)",
    ].join("\n")
    for (const dir of [APP_UI, WS]) {
      for (const rel of [`${dir}/__probe__.ts`, `${dir}/__probe__.tsx`]) {
        const messages = await gateMessages(rel, code)
        assert.equal(messages.filter(isDateHit).length, 1, `${rel}: date gate dropped`)
        assert.equal(messages.filter(isNumberHit).length, 1, `${rel}: number gate dropped`)
        assert.equal(messages.length, 2, `${rel}: ${messages.join(" | ")}`)
      }
    }
  })
})

describe("engine-core keeps the CLI's budgets (the CLI block of eslint.config.mjs)", () => {
  const ENGINE = "packages/connectors/engine/engine-core/src"
  const budget = async (rel, rule) => (await ruleOptionsFor(rel, rule))?.slice(1)[0] ?? null

  it("holds its shipped code, the ./testing export included, to complexity 10, 300 lines, 60 per function, 20 statements, depth 3, 4 parameters", async () => {
    for (const rel of [`${ENGINE}/__probe__.ts`, `${ENGINE}/testing/__probe__.ts`]) {
      assert.equal(await budget(rel, "complexity"), 10, rel)
      assert.equal((await budget(rel, "max-lines"))?.max, 300, rel)
      assert.equal((await budget(rel, "max-lines-per-function"))?.max, 60, rel)
      assert.equal(await budget(rel, "max-statements"), 20, rel)
      assert.equal(await budget(rel, "max-depth"), 3, rel)
      assert.equal(await budget(rel, "max-params"), 4, rel)
    }
  })

  it("gives its tests 400 lines and no per-function budget", async () => {
    const rel = `${ENGINE}/__probe__.test.ts`
    assert.equal((await budget(rel, "max-lines"))?.max, 400)
    assert.equal(await ruleOptionsFor(rel, "max-lines-per-function"), null)
  })
})

// D10 of the architecture review (2026-11-02): the type-safety rules are errors in every tree;
// require-await is off in the MCP trees only (the reason sits next to it in eslint.config.mjs).
// Read from the effective config of a real file per tree: linting planted text there depends on
// the typed parser finding the file in its program, and a parse failure would report no rule at
// all (red here on CI, and a silent pass for "off").
describe("type-safety rules: errors everywhere, require-await off in the MCP trees only", () => {
  const TYPE_SAFETY = [
    "@typescript-eslint/no-explicit-any",
    "@typescript-eslint/no-unsafe-argument",
    "@typescript-eslint/no-unsafe-assignment",
    "@typescript-eslint/no-unsafe-call",
    "@typescript-eslint/no-unsafe-member-access",
    "@typescript-eslint/no-unsafe-return",
    "@typescript-eslint/no-base-to-string",
  ]
  const REQUIRE_AWAIT = "@typescript-eslint/require-await"
  const SEVERITY = { 0: "off", 1: "warn", 2: "error" }
  /** The effective severity of `rule` for a repo path: "off", "warn" or "error". */
  const severityAt = async (rel, rule) => {
    const config = await eslint.calculateConfigForFile(path.join(repoRoot, rel))
    const setting = config.rules?.[rule]
    const level = Array.isArray(setting) ? setting[0] : setting
    return SEVERITY[level] ?? level ?? "off"
  }
  const MCP_TREES = [
    "apps/mcp-server/src/setup.ts",
    "apps/mcp-server/test/golden.ts",
    "packages/core/widget-shell/src/caller.ts",
    "packages/core/ui/src/kit/format.ts",
    "packages/connectors/engine/engine-connector/src/widgets/lib/engine-action.ts",
    "packages/connectors/analytics/analytics-client/src/metric-names.ts",
  ]
  const STRICT_TREES = [
    "apps/cli/src/util.ts",
    "packages/connectors/engine/engine-core/src/index.ts",
    "apps/vscode/src/core/boards/board-filters.ts",
  ]

  it("reports every type-safety rule as an error, in the MCP trees and the strict ones", async () => {
    for (const rel of [...MCP_TREES, ...STRICT_TREES]) {
      const notError = []
      for (const rule of TYPE_SAFETY) {
        if ((await severityAt(rel, rule)) !== "error") notError.push(rule)
      }
      assert.deepEqual(notError, [], `${rel}: a type-safety rule is no error`)
    }
  })

  it("leaves require-await off in the MCP trees and at error in the CLI, engine-core and VS Code", async () => {
    for (const rel of MCP_TREES) assert.equal(await severityAt(rel, REQUIRE_AWAIT), "off", rel)
    for (const rel of STRICT_TREES) assert.equal(await severityAt(rel, REQUIRE_AWAIT), "error", rel)
  })
})

describe("the default project: the config files no tsconfig holds", () => {
  let projectService
  before(async () => {
    const config = await eslint.calculateConfigForFile(path.join(repoRoot, "vitest.shared.ts"))
    projectService = config.languageOptions.parserOptions.projectService
  })

  it("the effective list is the one lint:configs lints", () => {
    assert.deepEqual(projectService.allowDefaultProject, DEFAULT_PROJECT_FILES)
  })

  it("the cap covers the list, so a commit staging all of it passes the pre-commit hook", () => {
    assert.ok(
      projectService.maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING >=
        projectService.allowDefaultProject.length,
      "typescript-eslint fails above the cap: 'Too many files (>N) have matched the default project'",
    )
  })

  it("every listed file exists and ESLint lints it", async () => {
    for (const rel of projectService.allowDefaultProject) {
      assert.ok(fs.existsSync(path.join(repoRoot, rel)), `${rel} is gone: drop it from the list`)
      assert.equal(await eslint.isPathIgnored(path.join(repoRoot, rel)), false, rel)
    }
  })
})
