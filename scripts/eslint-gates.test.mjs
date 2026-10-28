import assert from "node:assert/strict"
import path from "node:path"
import { before, describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { ESLint, Linter } from "eslint"
import tseslint from "typescript-eslint"

/**
 * Self-test of the architecture pattern gates in eslint.config.mjs (a gate
 * that has never been red is decoration). For each probe it asks the REAL
 * config which `no-restricted-syntax` options apply to a real path — so a
 * later block silently replacing an earlier block's selectors (flat config
 * does not merge one rule's options) turns this red — and then lints known-bad
 * snippets with exactly those options.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const C7 = "packages/connectors/camunda/camunda7-connector/src"
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
const isDateHit = (m) => m.includes("widget-shell/widgets")
const isNumberHit = (m) => m.includes("view's locale") || m.includes("browser's locale")

const WS = "packages/core/widget-shell/src/ui"

describe("number gate (invariant 6) in the kit's widget code", () => {
  it("catches toFixed and an argument-less toLocaleString in .ts and .tsx", async () => {
    for (const rel of [`${WS}/__probe__.ts`, `${WS}/__probe__.tsx`]) {
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
    for (const rel of [`${WS}/__probe__.ts`, `${WS}/__probe__.tsx`]) {
      for (const code of escapes) {
        const messages = await gateMessages(rel, code)
        assert.equal(messages.filter(isNumberHit).length, 1, `${rel}: "${code}" passed the gate`)
      }
    }
  })

  it("leaves a locale-bound toLocaleString (the kit's own date helpers) alone", async () => {
    const messages = await gateMessages(
      `${WS}/__probe__.ts`,
      'const a = d.toLocaleString(locale, opts)\nconst b = n.toLocaleString("de")\nconst c = d.toLocaleString(current?.locale, zoned())',
    )
    assert.deepEqual(messages, [])
  })

  it("lets exactly the kit's formatters build an Intl.NumberFormat, toFixed stays banned there", async () => {
    const messages = await gateMessages(
      `${WS}/format.ts`,
      "new Intl.NumberFormat(current?.locale, options)\nconst a = n.toFixed(1)",
    )
    assert.equal(messages.filter(isNumberHit).length, 1)
    assert.ok(messages.every((m) => !m.includes("Intl.NumberFormat")))
  })
})

describe("sparkle gate (invariant 6, CI U4) in every widget tree", () => {
  const isSparkleHit = (m) => m.includes("Sparkles")
  const WIDGET_PATHS = [
    `${WS}/__probe__.tsx`,
    `${C7}/widgets/__probe__.tsx`,
    `${AN}/widgets/__probe__.ts`,
    "apps/mcp-server-camunda7/src/ui/__probe__.tsx",
  ]

  it("bans Lucide's AI sparkle, named, renamed or deep-imported", async () => {
    const escapes = [
      'import { Sparkles } from "lucide-react"',
      'import { SparklesIcon as Ai } from "lucide-react"',
      'import { LucideSparkle } from "lucide-react"',
      'import { WandSparkles } from "lucide-react"',
      'import { Wand2 } from "lucide-react"',
      'import Sparkles from "lucide-react/icons/sparkles"',
      'import Wand from "lucide-react/dist/esm/icons/wand-sparkles.js"',
    ]
    for (const rel of WIDGET_PATHS) {
      for (const code of escapes) {
        const messages = await gateMessages(rel, code, "no-restricted-imports")
        assert.equal(messages.filter(isSparkleHit).length, 1, `${rel}: "${code}" passed the gate`)
      }
    }
  })

  it("leaves every other Lucide icon alone", async () => {
    const code = 'import { FileSearch, MessageSquare, X, ArrowRight } from "lucide-react"'
    for (const rel of WIDGET_PATHS) {
      assert.deepEqual(await gateMessages(rel, code, "no-restricted-imports"), [], rel)
    }
  })
})

describe("hand-off gate (invariant 6, CI U4) in both connectors' widgets", () => {
  const isHandOffHit = (m) => m.includes("HandOffButton") && m.includes("not AskAiButton")
  const HAND_OFF_PATHS = [`${C7}/widgets/__probe__.tsx`, `${AN}/widgets/__probe__.tsx`]
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
  for (const rel of [`${C7}/tools/__probe__.ts`, `${AN}/tools/__probe__.tsx`]) {
    for (const [label, code] of Object.entries(REGISTRAR_ESCAPES)) {
      it(`${label} — ${path.extname(rel)}`, async () => {
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
    assert.deepEqual(await gateMessages(`${C7}/tools/__probe__.test.ts`, code), [])
  })

  it("exempts exactly the widget-tools path", async () => {
    for (const rel of [
      `${C7}/widget-tools.ts`,
      `${C7}/widget-tools/__probe__.ts`,
      `${C7}/tools/user-profile.ts`,
      `${AN}/widget-tools.ts`,
      `${AN}/widget-tools/__probe__.ts`,
      `${AN}/settings-tools.ts`,
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
    widgetTs = await gateMessages(`${C7}/widgets/__probe__.ts`, code)
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
      `${C7}/widgets/__probe__.ts`,
      `${C7}/widgets/__probe__.tsx`,
      `${AN}/widgets/__probe__.ts`,
      `${AN}/widgets/__probe__.tsx`,
    ]) {
      const messages = await gateMessages(rel, code)
      assert.ok(messages.some(isRegistrarHit), `${rel}: registrar gate dropped`)
      assert.equal(messages.filter(isDateHit).length, 1, `${rel}: date gate dropped`)
      assert.equal(messages.filter(isNumberHit).length, 4, `${rel}: number gate missing`)
    }
  })

  it("the app's UI keeps the date gate", async () => {
    const messages = await gateMessages(
      "apps/mcp-server-camunda7/src/ui/__probe__.tsx",
      "d.toLocaleTimeString()",
    )
    assert.equal(messages.filter(isDateHit).length, 1)
  })
})
