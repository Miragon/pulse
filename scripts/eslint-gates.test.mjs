import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { before, describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { ESLint, Linter } from "eslint"
import tseslint from "typescript-eslint"
import { DEFAULT_PROJECT_FILES, HTTP_BROWSER_GLOBALS } from "../eslint.config.mjs"

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

/**
 * Every extension of a source in a connector's src: tsc builds .mts and .cts too, ESLint's
 * defaults lint .js, .mjs and .cjs, and only a block's `files` makes it read .jsx.
 */
const SOURCE_EXTENSIONS = ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"]

const eslint = new ESLint({ cwd: repoRoot })
const linter = new Linter({ configType: "flat" })

/** The effective options of `rule` for a repo path (null when off). */
async function ruleOptionsFor(rel, rule) {
  const config = await eslint.calculateConfigForFile(path.join(repoRoot, rel))
  const setting = config?.rules?.[rule]
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
          files: SOURCE_EXTENSIONS.map((extension) => `**/*.${extension}`),
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
const isResourceHit = (m) => m.includes("A connector registers no resource of its own")
const isDateHit = (m) =>
  /^Use format(?:Timestamp|Date|Time|RelativeTime)\b/.test(m) && m.includes("@miragon/pulse-ui")
const isNumberHit = (m) => m.includes("view's locale") || m.includes("browser's locale")

const WS = "packages/core/widget-shell/src/ui"
const UI = "packages/core/ui/src"
const APP_UI = "apps/mcp-server/src/ui"
/**
 * WIDGET_TREES of eslint.config.mjs: the host bundle's src/ui, widget-shell's view half and the
 * connector's widgets, a .ts and a .tsx probe each. The date and number gates hold all of them.
 */
const WIDGET_TREE_PATHS = [APP_UI, WS, `${ENGINE_CONNECTOR_SRC_DIR}/widgets`].flatMap((dir) => [
  `${dir}/__probe__.ts`,
  `${dir}/__probe__.tsx`,
])
/**
 * The runtime view's core and webview, which Pulse for VS Code and Pulse for Orca host: they
 * format through pulse-ui's foundation (`@miragon/pulse-ui/format`), so the date and number
 * gates join their own blocks' unions.
 */
const VSCODE_FORMAT_PATHS = [
  "packages/core/runtime-view/src/core/views/__probe__.ts",
  "packages/core/runtime-view/src/webview/format/__probe__.ts",
  "packages/core/runtime-view/src/webview/screens/__probe__.tsx",
]
/** Every tree the date gate holds. */
const DATE_PATHS = [...WIDGET_TREE_PATHS, ...VSCODE_FORMAT_PATHS]
/** The number gate's probes: pulse-ui's code, every widget tree and the VS Code extension's. */
const NUMBER_PATHS = [`${UI}/__probe__.ts`, `${UI}/__probe__.tsx`, ...DATE_PATHS]

describe("date gate (invariant 6) in every widget tree and the runtime view's core and webview", () => {
  it("catches Intl.DateTimeFormat and Intl.RelativeTimeFormat (new and called), toLocaleDateString and toLocaleTimeString", async () => {
    const code = [
      'new Intl.DateTimeFormat("de", opts).format(d)',
      "Intl.DateTimeFormat(undefined).format(d)",
      'new Intl.RelativeTimeFormat("en", { style: "narrow" }).format(-5, "minute")',
      "d.toLocaleDateString()",
      'd.toLocaleTimeString("de")',
    ].join("\n")
    for (const rel of DATE_PATHS) {
      const messages = await gateMessages(rel, code)
      assert.equal(messages.filter(isDateHit).length, 5, rel)
    }
  })

  it("keeps the VS Code extension's own selectors in the union beside it", async () => {
    const code = 'export const word = "processDefinitionKey"\nd.toLocaleDateString()'
    for (const rel of VSCODE_FORMAT_PATHS) {
      const messages = await gateMessages(rel, code)
      assert.equal(messages.filter(isDateHit).length, 1, rel)
      assert.ok(
        messages.some((m) =>
          m.includes("Engine vocabulary belongs in packages/connectors/<family>/<family>-adapter"),
        ),
        rel,
      )
    }
  })

  it("leaves the server half of widget-shell and the kit's own date formatters alone", async () => {
    const code = 'new Intl.DateTimeFormat("de").format(d)\nd.toLocaleDateString()'
    for (const rel of [
      "packages/core/widget-shell/src/__probe__.ts",
      "packages/core/widget-shell/src/protocol/__probe__.ts",
      `${UI}/format/dates.ts`,
      "apps/vscode/src/host/__probe__.ts",
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
    for (const rel of [`${UI}/format/numbers.ts`, `${UI}/locale/ui-messages.ts`]) {
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

  it("keeps the formatters' tests and the extension's wrappers under the whole gate", async () => {
    for (const rel of [
      `${UI}/format/format.test.ts`,
      `${UI}/format/duration.ts`,
      `${UI}/format/dates.ts`,
      "packages/core/runtime-view/src/webview/format/count-labels.ts",
      "packages/core/runtime-view/src/core/views/labels.ts",
    ]) {
      const messages = await gateMessages(rel, 'new Intl.NumberFormat("en").format(n)')
      assert.equal(messages.filter(isNumberHit).length, 1, rel)
    }
  })
})

describe("MCP Apps runtime gate (invariant 6): only widget-shell's host adapter imports ext-apps", () => {
  const isExtAppsHit = (m) =>
    m.includes("imports the MCP Apps runtime of @modelcontextprotocol/ext-apps")
  const ADAPTER = [`${WS}/view-runtime.ts`, `${WS}/ext-apps-host.tsx`, `${WS}/view-root.tsx`]
  const MCP_PATHS = [
    `${ENGINE_CONNECTOR_SRC_DIR}/widgets/__probe__.tsx`,
    `${ENGINE_CONNECTOR_SRC_DIR}/widgets/__probe__.ts`,
    `${ENGINE_CONNECTOR_SRC_DIR}/widget-tools/__probe__.ts`,
    `${UI}/__probe__.tsx`,
    `${UI}/testing/__probe__.ts`,
    `${WS}/__probe__.tsx`,
    "packages/core/widget-shell/src/__probe__.ts",
    "apps/mcp-server/src/ui/__probe__.tsx",
    "apps/mcp-server/test/__probe__.test.ts",
    "apps/mcp-server/test-host/__probe__.spec.ts",
  ]

  // Every way a static import or re-export reaches the runtime: its root, each browser subpath
  // ext-apps exports, a type alone, a namespace, a side effect.
  const RUNTIME_IMPORTS = [
    'import { App, PostMessageTransport } from "@modelcontextprotocol/ext-apps"',
    'import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps"',
    'import { type McpUiHostContext } from "@modelcontextprotocol/ext-apps"',
    'import * as apps from "@modelcontextprotocol/ext-apps"',
    'import "@modelcontextprotocol/ext-apps"',
    'import { App } from "@modelcontextprotocol/ext-apps/app-with-deps"',
    'import { useApp } from "@modelcontextprotocol/ext-apps/react"',
    'import { useApp } from "@modelcontextprotocol/ext-apps/react-with-deps"',
    'import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge"',
    'export { App } from "@modelcontextprotocol/ext-apps"',
    'export * from "@modelcontextprotocol/ext-apps/react"',
  ]

  it("bans the runtime in every static spelling everywhere but widget-shell's host adapter", async () => {
    for (const rel of MCP_PATHS) {
      for (const code of RUNTIME_IMPORTS) {
        const messages = await gateMessages(rel, code, "no-restricted-imports")
        assert.equal(messages.filter(isExtAppsHit).length, 1, `${rel}: ${code}`)
      }
    }
    for (const rel of ADAPTER) {
      for (const code of RUNTIME_IMPORTS) {
        assert.deepEqual(await gateMessages(rel, code, "no-restricted-imports"), [], rel)
      }
    }
  })

  it("exempts exactly the adapter: its tests and the rest of the view runtime stay gated", async () => {
    const code = RUNTIME_IMPORTS[0]
    for (const rel of [
      `${WS}/view-root.test.tsx`,
      `${WS}/view-runtime.test.ts`,
      `${WS}/view-host.tsx`,
      `${WS}/test-view-host.tsx`,
    ]) {
      const messages = await gateMessages(rel, code, "no-restricted-imports")
      assert.equal(messages.filter(isExtAppsHit).length, 1, rel)
    }
  })

  it("covers every subpath the installed ext-apps exports, its server half aside", async () => {
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(
          repoRoot,
          "packages/core/widget-shell/node_modules/@modelcontextprotocol/ext-apps/package.json",
        ),
        "utf8",
      ),
    )
    const subpaths = Object.keys(manifest.exports).filter((key) => key !== "./server")
    assert.ok(subpaths.includes(".") && subpaths.includes("./react"), subpaths.join(", "))
    for (const subpath of subpaths) {
      const code = `import x from "@modelcontextprotocol/ext-apps${subpath.slice(1)}"`
      const messages = await gateMessages(`${WS}/__probe__.tsx`, code, "no-restricted-imports")
      assert.equal(messages.filter(isExtAppsHit).length, 1, code)
    }
  })

  it("leaves pulse-ui, ext-apps' server half, the SDK and widget-shell's entries alone", async () => {
    const code = [
      'import { Button, WidgetHeader, LocaleProvider, ToastProvider, type ToneVariant } from "@miragon/pulse-ui"',
      'import { scanColors, themeStylesheets } from "@miragon/pulse-ui/testing"',
      'import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server"',
      'import type { McpServer } from "@modelcontextprotocol/server"',
      'import { Client } from "@modelcontextprotocol/client"',
      'import { useToolQuery, useViewHost, TestViewHost } from "@miragon/pulse-widget-shell/widgets"',
      'import { buildViewResult } from "@miragon/pulse-widget-shell/server"',
      // A look-alike package is none of ext-apps.
      'import { x } from "@modelcontextprotocol/ext-apps-extra"',
    ].join("\n")
    for (const rel of MCP_PATHS) {
      assert.deepEqual(await gateMessages(rel, code, "no-restricted-imports"), [], rel)
    }
  })
})

describe("hand-off gate (invariant 6, CI U4) in the connector's widgets", () => {
  const isHandOffHit = (m) => m.includes("HandOffButton") && m.includes("not AskAiButton")
  const HAND_OFF_PATHS = [`${ENGINE_CONNECTOR_SRC_DIR}/widgets/__probe__.tsx`]
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

const EXT_APPS = '"@modelcontextprotocol/ext-apps/server"'

/**
 * The routes both registration gates share, by the method's name and ext-apps' function's: a
 * pattern at any depth, the name as a string or template whatever reads it, a dynamic import's
 * .then and a TypeScript import alias.
 */
const sharedEscapes = (method, appFunction) => ({
  "nested destructuring": `const { srv: { ${method} } } = ctx\n${method}("x")`,
  "nested destructuring, string key": `const { srv: { "${method}": t } } = ctx\nt("x")`,
  "nested destructuring assignment": `let ${method}\n;({ srv: { ${method} } } = ctx)`,
  "array destructuring": `const [{ ${method} }] = [server]\n${method}("x")`,
  "array destructuring assignment": `let ${method}\n;[{ ${method} }] = [server]`,
  "for-of destructuring": `for (const { ${method} } of [server]) ${method}("x")`,
  "for-of destructuring assignment": `let ${method}\nfor ({ ${method} } of [server]) ${method}("x")`,
  "catch destructuring": `try { f() } catch ({ ${method} }) { ${method}("x") }`,
  "a parameter's default": `const f = ({ ${method} } = server) => ${method}("x")`,
  "a parameter's nested pattern": `const f = ({ srv: { ${method} } }) => ${method}("x")`,
  "Reflect with a computed get": `Reflect["get"](server, "${method}")("x")`,
  "a destructured Reflect.get": `const { get } = Reflect\nget(server, "${method}")("x")`,
  "Object.getOwnPropertyDescriptor": `Object.getOwnPropertyDescriptor(server, "${method}").value("x")`,
  "Object.entries": `Object.entries(server).find(([k]) => k === "${method}")[1]("x")`,
  "Object.entries, template key": `Object.entries(server).find(([k]) => k === \`${method}\`)[1]("x")`,
  "a key in a constant": `const key = "${method}"\nserver[key]("x")`,
  "a key under a type assertion": `server["${method}" as keyof typeof server]("x")`,
  "a key in an enum": `enum Key { Name = "${method}" }\nserver[Key.Name]("x")`,
  "an escaped string key": `server["${method.replace("r", "\\u0072")}"]("x")`,
  "an escaped template key": `server[\`${method.replace("r", "\\u0072")}\`]("x")`,
  "an escaped member": `server.${method.replace("r", "\\u0072")}("x")`,
  ".then of a dynamic import": `import(${EXT_APPS}).then(({ ${appFunction} }) => ${appFunction}(server))`,
  ".then of a dynamic import, nested": `import(${EXT_APPS}).then(({ default: { ${appFunction} } }) => ${appFunction}(server))`,
  ".then of a dynamic import, function": `import(${EXT_APPS}).then(function ({ ${appFunction} }) { ${appFunction}(server) })`,
  ".then of a held import": `const apps = import(${EXT_APPS})\napps.then(({ ${appFunction} }) => ${appFunction}(server))`,
  "an import alias": `import * as apps from ${EXT_APPS}\nimport app = apps.${appFunction}\napp(server)`,
})

/**
 * What no selector reaches, or what the gates leave free on purpose. CLAUDE.md names these
 * (invariants 1 and 3): a route that closes turns this red, so the sentence follows the gate.
 */
const openRoutes = (method, head, tail) => ({
  "a concatenated key": `server["${head}" + "${tail}"]("x")`,
  "a template key with an expression": `const a = "${tail}"\nserver[\`${head}\${a}\`]("x")`,
  "a key computed at runtime": 'server[names.pick()]("x")',
  "a key found at runtime": `Object.entries(server).find(([k]) => k.endsWith("${tail}"))[1]("x")`,
  "a parameter's own pattern": `const f = ({ ${method} }) => ${method}("x")\nf(server)`,
})

const REGISTRAR_ESCAPES = {
  ...sharedEscapes("registerTool", "registerAppTool"),
  "direct call": 'server.registerTool("x", {}, handler)',
  "optional call": 'server?.registerTool("x", {}, handler)',
  "computed string key": 'server["registerTool"]("x", {}, handler)',
  "computed template key": 'server[`registerTool`]("x", {}, handler)',
  ".call": 'server.registerTool.call(server, "x", {}, handler)',
  ".bind": 'server.registerTool.bind(server)("x", {}, handler)',
  ".apply": 'server.registerTool.apply(server, ["x", {}, handler])',
  "destructured declaration": 'const { registerTool } = server\nregisterTool("x", {}, handler)',
  "destructured + renamed": 'const { registerTool: register } = server\nregister("x")',
  "destructured string key": 'const { "registerTool": t } = server\nt("x")',
  "destructuring assignment": 'let registerTool\n;({ registerTool } = server)\nregisterTool("x")',
  "destructuring assignment, string key":
    'let t\n;({ "registerTool": t } = server)\nt.call(server, "x")',
  "Reflect.get": 'Reflect.get(server, "registerTool")("x", {}, handler)',
  "Reflect.get, template key": 'Reflect.get(server, `registerTool`).call(server, "x")',
  "registerAppTool import": `import { registerAppTool } from ${EXT_APPS}\nregisterAppTool(server, "x", c, h)`,
  "registerAppTool renamed import": `import { registerAppTool as app } from ${EXT_APPS}\napp(server, "x", c, h)`,
  "registerAppTool string-name import": `import { "registerAppTool" as app } from ${EXT_APPS}\napp(server)`,
  "registerAppTool namespace import": `import * as apps from ${EXT_APPS}\napps.registerAppTool(server, "x", c, h)`,
  "registerAppTool computed key": `import * as apps from ${EXT_APPS}\napps["registerAppTool"](server)`,
  "registerAppTool dynamic import": `const { registerAppTool } = await import(${EXT_APPS})`,
  "registerAppTool re-export": `export { registerAppTool } from ${EXT_APPS}`,
  "registerAppTool re-export, string name": `export { "registerAppTool" as app } from ${EXT_APPS}`,
}

describe("registrar gate (invariant 1) catches every spelling that names the member", () => {
  for (const rel of [
    `${ENGINE_CONNECTOR_SRC_DIR}/tools/__probe__.ts`,
    `${ENGINE_CONNECTOR_SRC_DIR}/tools/__probe__.tsx`,
  ]) {
    for (const [label, code] of Object.entries(REGISTRAR_ESCAPES)) {
      it(`${label} (${path.extname(rel)})`, async () => {
        const messages = await gateMessages(rel, code)
        assert.ok(messages.some(isRegistrarHit), `${rel}: "${code}" passed the registrar gate`)
      })
    }
  }

  it("stays quiet on test fakes, types, parameter destructuring and unrelated names", async () => {
    const code = [
      "const server = { registerTool } as unknown as ModuleServer",
      "const fake = { registerTool: record, registerPrompt: record }",
      "const fn = ({ registerTool, list }: Case) => [registerTool, list]",
      "function own({ registerTool }: ModuleServer) { return registerTool }",
      "const { make = ({ registerTool }: Case) => registerTool } = options",
      "const { made = { registerTool } } = options",
      'type Fake = Pick<ModuleServer, "registerTool" | "registerPrompt">',
      'interface Shape { "registerTool": Register; "registerAppTool"(server: S): void }',
      'declare const typed: { "registerTool": number }',
      'type Register = ModuleServer["registerTool"]',
      "type Template = ModuleServer[`registerTool`]",
      `type App = typeof import(${EXT_APPS})`,
      'import { registerTools } from "./index.js"',
      "registerTools(register, { allowDeployments: true })",
      'const sentence = "a raw registerTool is reserved for the widget-tools files"',
      'const plural = "registerTools"',
      "const name = tool.name + toolName + obj.tools.length + recording.tool(name).config",
      "server.registerPrompt(name, config, callback)",
      `import { RESOURCE_MIME_TYPE } from ${EXT_APPS}`,
    ].join("\n")
    assert.deepEqual(
      await gateMessages(`${ENGINE_CONNECTOR_SRC_DIR}/tools/__probe__.test.ts`, code),
      [],
    )
  })

  it("exempts exactly the widget-tools path", async () => {
    const code = [
      `import { registerAppTool } from ${EXT_APPS}`,
      'server.registerTool("x", {}, handler)',
      "const { srv: { registerTool } } = ctx",
      'Object.entries(server).find(([k]) => k === "registerAppTool")',
    ].join("\n")
    for (const rel of [
      `${ENGINE_CONNECTOR_SRC_DIR}/widget-tools.ts`,
      `${ENGINE_CONNECTOR_SRC_DIR}/widget-tools/__probe__.ts`,
      `${ENGINE_CONNECTOR_SRC_DIR}/widget-tools/__probe__.mts`,
      `${ENGINE_CONNECTOR_SRC_DIR}/widget-tools/__probe__.mjs`,
    ]) {
      assert.deepEqual(await gateMessages(rel, code), [], rel)
    }
    for (const rel of [
      `${ENGINE_CONNECTOR_SRC_DIR}/widget-tools.mts`,
      `${ENGINE_CONNECTOR_SRC_DIR}/widget-tools-more.ts`,
      `${ENGINE_CONNECTOR_SRC_DIR}/widgets/__probe__.tsx`,
    ]) {
      assert.ok((await gateMessages(rel, code)).some(isRegistrarHit), rel)
    }
  })

  for (const [label, code] of Object.entries(openRoutes("registerTool", "register", "Tool"))) {
    it(`leaves ${label} to review, as CLAUDE.md says`, async () => {
      const messages = await gateMessages(`${ENGINE_CONNECTOR_SRC_DIR}/tools/__probe__.ts`, code)
      assert.equal(messages.filter(isRegistrarHit).length, 0, code)
    })
  }
})

const RESOURCE_ESCAPES = {
  ...sharedEscapes("registerResource", "registerAppResource"),
  "direct call": 'server.registerResource("x", "ui://x/y.html", {}, read)',
  "optional call": 'server?.registerResource("x", "ui://x/y.html", {}, read)',
  "computed string key": 'server["registerResource"]("x", "ui://x/y.html", {}, read)',
  "computed template key": 'server[`registerResource`]("x", "ui://x/y.html", {}, read)',
  ".call": 'server.registerResource.call(server, "x", "ui://x/y.html", {}, read)',
  ".bind": 'server.registerResource.bind(server)("x", "ui://x/y.html", {}, read)',
  "destructured declaration": 'const { registerResource } = server\nregisterResource("x")',
  "destructured + renamed": 'const { registerResource: register } = server\nregister("x")',
  "destructuring assignment": "let registerResource\n;({ registerResource } = server)",
  "Reflect.get": 'Reflect.get(server, "registerResource")("x")',
  "registerAppResource import": `import { registerAppResource } from ${EXT_APPS}\nregisterAppResource(server, "x", u, {}, r)`,
  "registerAppResource renamed import": `import { registerAppResource as app } from ${EXT_APPS}\napp(server)`,
  "registerAppResource string-name import": `import { "registerAppResource" as app } from ${EXT_APPS}\napp(server)`,
  "registerAppResource namespace import": `import * as apps from ${EXT_APPS}\napps.registerAppResource(server)`,
  "registerAppResource computed key": `import * as apps from ${EXT_APPS}\napps["registerAppResource"](server)`,
  "registerAppResource dynamic import": `const { registerAppResource } = await import(${EXT_APPS})`,
  "registerAppResource re-export": `export { registerAppResource } from ${EXT_APPS}`,
}

describe("connector resource gate (invariant 3): a connector's views belong in the bundle", () => {
  // The gate has no exempt path: the widget-tools files, where a raw registerTool is fine, the
  // widgets and tests sit under it, and so does every package of a family.
  const CONNECTOR_PATHS = [
    `${ENGINE_CONNECTOR_SRC_DIR}/tools/__probe__.ts`,
    `${ENGINE_CONNECTOR_SRC_DIR}/widget-tools.ts`,
    `${ENGINE_CONNECTOR_SRC_DIR}/widget-tools/__probe__.ts`,
    `${ENGINE_CONNECTOR_SRC_DIR}/widgets/__probe__.tsx`,
    `${ENGINE_CONNECTOR_SRC_DIR}/plugin.test.ts`,
    `${ENGINE_CONNECTOR_SRC_DIR}/widgets/__probe__.ts`,
    "packages/connectors/c7/c7-client/src/__probe__.ts",
    "packages/connectors/newfamily/newfamily-connector/src/__probe__.ts",
    // engine-core's src and the C7 adapter's, where the blocks of Pulse for VS Code's house
    // rules carry the gate in their union, the id constructors' block too.
    "packages/connectors/c7/c7-adapter/src/__probe__.ts",
    "packages/connectors/engine/engine-core/src/__probe__.ts",
    "packages/connectors/engine/engine-core/src/testing/fake/__probe__.ts",
    "packages/connectors/engine/engine-core/src/model/ids.ts",
  ]

  for (const [label, code] of Object.entries(RESOURCE_ESCAPES)) {
    it(`catches ${label} on every connector path`, async () => {
      for (const rel of CONNECTOR_PATHS) {
        const messages = await gateMessages(rel, code)
        assert.ok(messages.some(isResourceHit), `${rel}: "${code}" passed the resource gate`)
      }
    })
  }

  it("stays quiet on what a connector does on the view path", async () => {
    const code = [
      `import { RESOURCE_MIME_TYPE } from ${EXT_APPS}`,
      'server.registerTool("x", { ...showToolBinding("x", "X") }, handler)',
      'const uri = viewResourceUri("x") + recording.resources.size',
      "const fn = ({ registerResource }: Case) => registerResource",
      "const fake = { registerResource: record } as unknown as ModuleServer",
      'type Fake = Pick<ModuleServer, "registerResource">',
      'interface Shape { "registerResource": Register; "registerAppResource"(server: S): void }',
      'declare const typed: { "registerResource": number }',
      'const sentence = "a connector calls no registerResource"',
    ].join("\n")
    assert.deepEqual(
      await gateMessages(`${ENGINE_CONNECTOR_SRC_DIR}/widget-tools/__probe__.ts`, code),
      [],
    )
  })

  for (const [label, code] of Object.entries(
    openRoutes("registerResource", "register", "Resource"),
  )) {
    it(`leaves ${label} to review, as CLAUDE.md says`, async () => {
      const messages = await gateMessages(
        `${ENGINE_CONNECTOR_SRC_DIR}/widget-tools/__probe__.ts`,
        code,
      )
      assert.equal(messages.filter(isResourceHit).length, 0, code)
    })
  }

  it("leaves the boot, which serves the bundle's views, and the apps alone", async () => {
    const code = 'server.registerResource("x", "ui://views/x.html", {}, read)'
    for (const rel of [
      "packages/core/widget-shell/src/mcp-server.ts",
      "apps/mcp-server/src/app.ts",
    ]) {
      const messages = await gateMessages(rel, code)
      assert.equal(messages.filter(isResourceHit).length, 0, rel)
    }
  })

  it("holds next to the registrar, date and number gates in one union on the connector widgets", async () => {
    const code = [
      'server.registerResource("x")',
      'server.registerTool("x")',
      "d.toLocaleDateString()",
      "const a = n.toFixed(1)",
    ].join("\n")
    for (const rel of [
      `${ENGINE_CONNECTOR_SRC_DIR}/widgets/__probe__.ts`,
      `${ENGINE_CONNECTOR_SRC_DIR}/widgets/__probe__.tsx`,
    ]) {
      const messages = await gateMessages(rel, code)
      assert.equal(messages.filter(isResourceHit).length, 1, `${rel}: resource gate dropped`)
      assert.ok(messages.some(isRegistrarHit), `${rel}: registrar gate dropped`)
      assert.equal(messages.filter(isDateHit).length, 1, `${rel}: date gate dropped`)
      assert.equal(messages.filter(isNumberHit).length, 1, `${rel}: number gate dropped`)
    }
  })
})

describe("the registration gates hold every source extension", () => {
  const CALLS = 'server.registerTool("x")\nserver.registerResource("x")'

  it("reach no generated folder, which ESLint skips, as CLAUDE.md says", async () => {
    const rel = `${ENGINE_CONNECTOR_SRC_DIR}/generated/__probe__.ts`
    assert.equal(await eslint.isPathIgnored(path.join(repoRoot, rel)), true)
  })

  for (const extension of SOURCE_EXTENSIONS) {
    it(`a .${extension} file: ESLint lints it, under the gates its path carries`, async () => {
      const paths = [
        // [probe path, registrar gate?]: the registrar holds the connectors outside widget-tools.
        [`${ENGINE_CONNECTOR_SRC_DIR}/__probe__.${extension}`, true],
        [`${ENGINE_CONNECTOR_SRC_DIR}/tools/deep/__probe__.${extension}`, true],
        [`${ENGINE_CONNECTOR_SRC_DIR}/widgets/__probe__.${extension}`, true],
        [`${ENGINE_CONNECTOR_SRC_DIR}/__probe__.test.${extension}`, true],
        [`${ENGINE_CONNECTOR_SRC_DIR}/widget-tools/__probe__.${extension}`, false],
        [`packages/connectors/c7/c7-client/src/__probe__.${extension}`, false],
        [`packages/connectors/newfamily/newfamily-connector/src/__probe__.${extension}`, false],
        [`packages/connectors/engine/engine-core/src/__probe__.${extension}`, false],
      ]
      for (const [rel, registrar] of paths) {
        assert.equal(await eslint.isPathIgnored(path.join(repoRoot, rel)), false, rel)
        const messages = await gateMessages(rel, CALLS)
        assert.equal(messages.filter(isResourceHit).length, 1, `${rel}: resource gate missing`)
        assert.equal(messages.filter(isRegistrarHit).length, registrar ? 1 : 0, `${rel}: registrar`)
      }
    })
  }
})

describe("gates sharing a glob are merged, not overridden", () => {
  let widgetTs
  let widgetTsx
  before(async () => {
    const code = 'server.registerTool("x")\nnew Intl.DateTimeFormat("de")\nd.toLocaleDateString()'
    widgetTs = await gateMessages(`${ENGINE_CONNECTOR_SRC_DIR}/widgets/__probe__.ts`, code)
    widgetTsx = await gateMessages(`${ENGINE_CONNECTOR_SRC_DIR}/widgets/__probe__.tsx`, code)
  })

  it("connector widget files carry BOTH the registrar and the date gate", () => {
    for (const messages of [widgetTs, widgetTsx]) {
      assert.ok(messages.some(isRegistrarHit), "registrar gate dropped for widgets")
      assert.equal(messages.filter(isDateHit).length, 2, "date gate dropped for widgets")
    }
  })

  it("the connector's widgets carry the registrar, date AND number gates in one union per glob", async () => {
    const code = [
      'server.registerTool("x")',
      "d.toLocaleDateString()",
      "const a = n.toFixed(1)",
      "const b = n.toLocaleString()",
      "const c = n.toLocaleString(undefined)",
      "const d = new Intl.NumberFormat('de').format(n)",
    ].join("\n")
    for (const rel of [
      `${ENGINE_CONNECTOR_SRC_DIR}/widgets/__probe__.ts`,
      `${ENGINE_CONNECTOR_SRC_DIR}/widgets/__probe__.tsx`,
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
      'server.registerTool("x")',
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

describe("c7-core keeps the CLI's budgets (the CLI block of eslint.config.mjs)", () => {
  const C7_CORE = "packages/connectors/c7/c7-core/src"
  const budget = async (rel, rule) => (await ruleOptionsFor(rel, rule))?.slice(1)[0] ?? null

  it("holds its shipped code, the ./testing export included, to complexity 10, 300 lines, 60 per function, 20 statements, depth 3, 4 parameters", async () => {
    for (const rel of [`${C7_CORE}/__probe__.ts`, `${C7_CORE}/testing/__probe__.ts`]) {
      assert.equal(await budget(rel, "complexity"), 10, rel)
      assert.equal((await budget(rel, "max-lines"))?.max, 300, rel)
      assert.equal((await budget(rel, "max-lines-per-function"))?.max, 60, rel)
      assert.equal(await budget(rel, "max-statements"), 20, rel)
      assert.equal(await budget(rel, "max-depth"), 3, rel)
      assert.equal(await budget(rel, "max-params"), 4, rel)
    }
  })

  it("gives its tests 400 lines and no per-function budget", async () => {
    const rel = `${C7_CORE}/__probe__.test.ts`
    assert.equal((await budget(rel, "max-lines"))?.max, 400)
    assert.equal(await ruleOptionsFor(rel, "max-lines-per-function"), null)
  })
})

describe("the transport keeps out what only a browser has (packages/core/http)", () => {
  const HTTP_SRC = "packages/core/http/src"
  const isHit = (m) => m.includes("The transport runs outside a browser")
  const globalsGate = (rel, code) => gateMessages(rel, code, "no-restricted-globals")

  it("bans each name of HTTP_BROWSER_GLOBALS in its shipped code, the ./testing export included", async () => {
    for (const name of [
      "window",
      "document",
      "XMLHttpRequest",
      "WebSocket",
      "EventSource",
      "alert",
    ]) {
      assert.ok(HTTP_BROWSER_GLOBALS.includes(name), name)
    }
    for (const rel of [`${HTTP_SRC}/__probe__.ts`, `${HTTP_SRC}/testing/__probe__.ts`]) {
      for (const name of HTTP_BROWSER_GLOBALS) {
        const messages = await globalsGate(rel, `export const probe = ${name}`)
        assert.equal(messages.filter(isHit).length, 1, `${rel}: ${name}`)
      }
    }
  })

  it("leaves fetch's own globals, a local binding of a banned name and the tests alone", async () => {
    const code =
      "const close = (): number => 1\n" +
      "export const probe = [fetch, Request, Response, Headers, AbortSignal, URL, close()]"
    assert.deepEqual(await globalsGate(`${HTTP_SRC}/__probe__.ts`, code), [])
    assert.equal(
      await ruleOptionsFor("packages/core/http/test/__probe__.ts", "no-restricted-globals"),
      null,
    )
  })
})

describe("engine-core keeps the house rules of Pulse for VS Code (packages/connectors/engine/engine-core)", () => {
  const ENGINE_CORE_SRC = "packages/connectors/engine/engine-core/src"
  const ENGINE_CORE_TEST = "packages/connectors/engine/engine-core/test"
  // Every TypeScript extension: a file under src steps out of no rule by its name.
  const SHIPPED = [
    `${ENGINE_CORE_SRC}/__probe__.ts`,
    `${ENGINE_CORE_SRC}/testing/fake/__probe__.ts`,
    `${ENGINE_CORE_SRC}/__probe__.mts`,
    `${ENGINE_CORE_SRC}/__probe__.cts`,
    `${ENGINE_CORE_SRC}/model/__probe__.tsx`,
  ]
  const budget = async (rel, rule) => (await ruleOptionsFor(rel, rule))?.slice(1)[0] ?? null
  const isWordHit = (m) => m.includes("Engine vocabulary belongs in")
  const isClassHit = (m) => m.includes("Put behaviour in a class")

  it("holds its shipped code, the ./testing export included, to the extension's budgets and one class per file", async () => {
    for (const rel of SHIPPED) {
      assert.equal(await budget(rel, "complexity"), 10, rel)
      assert.equal((await budget(rel, "max-lines"))?.max, 300, rel)
      assert.equal((await budget(rel, "max-lines-per-function"))?.max, 60, rel)
      assert.equal(await budget(rel, "max-statements"), 20, rel)
      assert.equal(await budget(rel, "max-depth"), 3, rel)
      assert.equal(await budget(rel, "max-params"), 4, rel)
      assert.equal(await budget(rel, "max-nested-callbacks"), 3, rel)
      assert.equal(await budget(rel, "max-classes-per-file"), 1, rel)
      assert.ok(await ruleOptionsFor(rel, "@typescript-eslint/member-ordering"), rel)
      assert.ok(await ruleOptionsFor(rel, "pulse-vscode/no-comments"), rel)
    }
  })

  it("keeps engine words and module functions out of its shipped code, the id constructors aside", async () => {
    for (const rel of SHIPPED) {
      const words = await gateMessages(rel, 'export const key = "processInstanceKey"')
      assert.equal(words.filter(isWordHit).length, 1, rel)
      assert.deepEqual(
        words.filter((m) => m.includes("apps/vscode")),
        [],
        `${rel}: a public package names no app's path`,
      )
      const helper = await gateMessages(rel, "export function helper(): number {\n  return 1\n}")
      assert.equal(helper.filter(isClassHit).length, 1, rel)
    }
    const ids = `${ENGINE_CORE_SRC}/model/ids.ts`
    assert.equal(
      (await gateMessages(ids, 'export const key = "activityId"')).filter(isWordHit).length,
      1,
    )
    assert.deepEqual(
      await gateMessages(ids, "export const Id = (value: string): string => value"),
      [],
    )
  })

  it("holds its engine words, module functions and the connector resource gate in one union", async () => {
    const code = [
      'export const key = "processInstanceKey"',
      "export function helper(): number {\n  return 1\n}",
      'server.registerResource("x", "ui://x/y.html", {}, read)',
    ].join("\n")
    for (const rel of SHIPPED) {
      const messages = await gateMessages(rel, code)
      assert.equal(messages.filter(isWordHit).length, 1, `${rel}: word gate dropped`)
      assert.equal(messages.filter(isClassHit).length, 1, `${rel}: class gate dropped`)
      assert.equal(messages.filter(isResourceHit).length, 1, `${rel}: resource gate dropped`)
    }
    const ids = await gateMessages(`${ENGINE_CORE_SRC}/model/ids.ts`, code)
    assert.equal(ids.filter(isWordHit).length, 1, "ids.ts: word gate dropped")
    assert.equal(ids.filter(isClassHit).length, 0, "ids.ts: its module functions are allowed")
    assert.equal(ids.filter(isResourceHit).length, 1, "ids.ts: resource gate dropped")
  })

  it("bans comments in its tests as well, never switched off inline, its runtime probe aside", async () => {
    const rel = `${ENGINE_CORE_TEST}/__probe__.test.ts`
    const config = await eslint.calculateConfigForFile(path.join(repoRoot, rel))
    assert.equal(config.linterOptions.noInlineConfig, true)
    assert.ok(await ruleOptionsFor(rel, "pulse-vscode/no-comments"))
    assert.equal(await ruleOptionsFor(rel, "max-lines-per-function"), null)
    for (const [test, max] of [
      [rel, 400],
      [`${ENGINE_CORE_TEST}/support/__probe__.ts`, 300],
      [`${ENGINE_CORE_TEST}/runtime.boundary.ts`, 300],
      ["packages/connectors/engine/engine-core/vitest.config.ts", 300],
    ]) {
      assert.deepEqual(
        (await budget(test, "max-lines")) ?? null,
        { max, skipBlankLines: true, skipComments: true },
        `${test}: the budget its path held before the package took it`,
      )
    }
    assert.equal(
      await ruleOptionsFor(`${ENGINE_CORE_TEST}/runtime.boundary.ts`, "pulse-vscode/no-comments"),
      null,
    )
  })

  it("holds its config files to the rules of the extension's own", async () => {
    for (const rel of [
      "packages/connectors/engine/engine-core/vitest.config.ts",
      "apps/vscode/vitest.config.ts",
    ]) {
      const config = await eslint.calculateConfigForFile(path.join(repoRoot, rel))
      assert.equal(config.linterOptions.noInlineConfig, true, rel)
      assert.ok(await ruleOptionsFor(rel, "pulse-vscode/no-comments"), rel)
      assert.equal(await budget(rel, "complexity"), 10, rel)
      assert.ok(await ruleOptionsFor(rel, "@typescript-eslint/no-unnecessary-condition"), rel)
    }
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
    "packages/core/ui/src/format/numbers.ts",
    "packages/connectors/engine/engine-connector/src/widgets/lib/engine-action.ts",
    "packages/connectors/c7/c7-client/src/client.ts",
  ]
  const STRICT_TREES = [
    "apps/cli/src/util.ts",
    "packages/connectors/c7/c7-core/src/index.ts",
    "packages/connectors/engine/engine-core/src/index.ts",
    "packages/core/runtime-view/src/core/boards/board-filters.ts",
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

  it("leaves require-await off in the MCP trees and at error in the CLI, c7-core, engine-core and VS Code", async () => {
    for (const rel of MCP_TREES) assert.equal(await severityAt(rel, REQUIRE_AWAIT), "off", rel)
    for (const rel of STRICT_TREES) assert.equal(await severityAt(rel, REQUIRE_AWAIT), "error", rel)
  })
})

/**
 * Messages the effective setting of `rule` reports for `code` at `rel`, parsed with the path's own
 * parser options (its jsxPragma among them) and the plugin that brings the rule, without a
 * program: the rules below read syntax and scopes only.
 */
async function syntaxRuleMessages(rel, code, rule) {
  const config = await eslint.calculateConfigForFile(path.join(repoRoot, rel))
  const setting = config?.rules?.[rule]
  if (!setting || setting[0] === 0) return []
  const namespace = rule.includes("/") ? rule.slice(0, rule.lastIndexOf("/")) : undefined
  const {
    project: _project,
    projectService: _projectService,
    tsconfigRootDir: _root,
    ...parserOptions
  } = config.languageOptions.parserOptions ?? {}
  return linter
    .verify(
      code,
      [
        {
          files: SOURCE_EXTENSIONS.map((extension) => `**/*.${extension}`),
          plugins: namespace ? { [namespace]: config.plugins[namespace] } : {},
          languageOptions: {
            parser: tseslint.parser,
            parserOptions: { ...parserOptions, ecmaFeatures: { jsx: true } },
          },
          rules: { [rule]: setting },
        },
      ],
      { filename: path.join(repoRoot, rel) },
    )
    .map((m) => m.message)
}

// Every program compiles with verbatimModuleSyntax (scripts/module-syntax.mjs), so an import or
// re-export not marked `type` stays in the emitted JavaScript as written. Each planted form below
// passed tsc and ESLint before these rules and left a side-effect import (`import {} from`,
// `export {} from`) or a namespace import that only types use.
describe("no import or re-export of types alone stays in the emitted JavaScript", () => {
  const IMPORT_RULE = "@typescript-eslint/no-import-type-side-effects"
  const EXPORT_RULE = "pulse/no-export-type-side-effects"
  const TYPE_IMPORTS = "@typescript-eslint/consistent-type-imports"
  /** A source of every tree, shipped code and tests, MCP and the strict ones. */
  const TREES = [
    "apps/mcp-server/src/__probe__.ts",
    "apps/mcp-server/test/__probe__.ts",
    "apps/cli/src/__probe__.ts",
    "apps/vscode/src/host/__probe__.ts",
    "apps/orca/src/worker/__probe__.ts",
    `${UI}/__probe__.ts`,
    "packages/core/widget-shell/src/__probe__.ts",
    "packages/core/http/src/testing/loopback/__probe__.ts",
    "packages/core/profile/src/__probe__.ts",
    "packages/core/runtime-view/src/host-kit/__probe__.ts",
    "packages/core/runtime-view/test/core/__probe__.test.ts",
    "packages/connectors/c7/c7-client/src/__probe__.ts",
    "packages/connectors/c7/c7-core/src/__probe__.ts",
    "packages/connectors/c7/c7-adapter/test/__probe__.test.ts",
    `${ENGINE_CONNECTOR_SRC_DIR}/__probe__.ts`,
    "packages/connectors/engine/engine-core/src/__probe__.ts",
    ...WIDGET_TREE_PATHS,
  ]
  /**
   * A JSX file of every tree with JSX: the React trees (the runtime view's webview among them)
   * and Orca's own runtime.
   */
  const JSX_TREES = [
    `${UI}/primitives/__probe__.tsx`,
    ...WIDGET_TREE_PATHS.filter((rel) => rel.endsWith(".tsx")),
    "packages/core/runtime-view/src/webview/components/__probe__.tsx",
    "apps/orca/src/__probe__.tsx",
  ]

  it("reports an import whose names all carry an inline type, in every tree", async () => {
    const code = 'import { type A, type B } from "./a.js"\nexport type C = A | B'
    for (const rel of TREES) {
      assert.equal((await syntaxRuleMessages(rel, code, IMPORT_RULE)).length, 1, rel)
    }
  })

  it("reports a re-export whose names all carry an inline type, in every tree", async () => {
    const code = 'export { type A, type B as C } from "./a.js"'
    for (const rel of TREES) {
      assert.equal((await syntaxRuleMessages(rel, code, EXPORT_RULE)).length, 1, rel)
    }
  })

  it("fixes the re-export to `export type`, aliases kept", async () => {
    const config = await eslint.calculateConfigForFile(path.join(repoRoot, `${UI}/__probe__.ts`))
    const { output } = linter.verifyAndFix(
      'export {\n  type A,\n  type B as C,\n} from "./a.js"\n',
      [
        {
          files: ["**/*.ts"],
          plugins: { pulse: config.plugins.pulse },
          languageOptions: { parser: tseslint.parser },
          rules: { [EXPORT_RULE]: "error" },
        },
      ],
      { filename: path.join(repoRoot, `${UI}/__probe__.ts`) },
    )
    assert.equal(output, 'export type {\n  A,\n  B as C,\n} from "./a.js"\n')
  })

  it("leaves the forms the emitted JavaScript drops or needs alone", async () => {
    const imports = [
      'import type { A } from "./a.js"\nexport type C = A',
      'import { type A, b } from "./a.js"\nexport const c: A = b',
      'import "./side-effect.js"',
    ].join("\n")
    const exports = [
      'export type { A } from "./a.js"',
      'export { type B, b } from "./b.js"',
      'export * from "./c.js"',
      "type D = string\nexport { type D }",
    ].join("\n")
    for (const rel of TREES) {
      assert.deepEqual(await syntaxRuleMessages(rel, imports, IMPORT_RULE), [], rel)
      assert.deepEqual(await syntaxRuleMessages(rel, exports, EXPORT_RULE), [], rel)
    }
  })

  it("reads JSX with the automatic runtime: a namespace import only types use is reported", async () => {
    const typeOnly = 'import * as React from "react"\nexport const node: React.ReactNode = <div />'
    const used = 'import * as React from "react"\nexport const node = React.createElement("div")'
    for (const rel of JSX_TREES) {
      assert.equal((await syntaxRuleMessages(rel, typeOnly, TYPE_IMPORTS)).length, 1, rel)
      assert.deepEqual(await syntaxRuleMessages(rel, used, TYPE_IMPORTS), [], rel)
    }
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
