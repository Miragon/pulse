import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, it } from "node:test"
import ts from "typescript"
import { REPO_ROOT } from "./source-scan.mjs"
import { appOnlyFeeds, fullSurface } from "./tool-surface.mjs"

/**
 * The tools a Claude artifact on Pulse calls (templates/claude-artifact). A published artifact
 * declares its `mcp` capability with exactly the names of PAGE_TOOLS
 * (templates/claude-artifact/src/engine/tools.ts), and a call to a tool it did not declare fails.
 * So each name is a tool the server registers (the admin golden, scripts/tool-surface.mjs), a
 * model tool (an app-only `*_data` feed serves the server's own views, never a page), on the
 * read-only floor (what the server runs without OAuth and every toolset holds) and no view tool
 * (`engine_open_cockpit`'s result is a view a host renders, not data). Each recorded load
 * (templates/claude-artifact/fixtures/*.json) calls only those tools and, together, every one of
 * them, so the declaration is what a load calls, no more. ESLint and tool-name-refs skip
 * templates/: this guard holds the names.
 */

const TEMPLATE = "templates/claude-artifact"
const TOOLS_FILE = `${TEMPLATE}/src/engine/tools.ts`
const FIXTURES = `${TEMPLATE}/fixtures`
const READ_ONLY_GOLDEN = "apps/mcp-server/test/__golden__/tools-read-only.json"

/**
 * The string entries of the array literal PAGE_TOOLS is declared with in `source` (`as const` and
 * `satisfies` allowed); undefined without one, so the caller names the file.
 */
function pageToolsOf(source, file = TOOLS_FILE) {
  let entries
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText() === "PAGE_TOOLS") {
      let init = node.initializer
      while (init && (ts.isAsExpression(init) || ts.isSatisfiesExpression(init))) {
        init = init.expression
      }
      if (init && ts.isArrayLiteralExpression(init)) {
        entries = init.elements.map((element) =>
          ts.isStringLiteralLike(element)
            ? element.text
            : `<not a string literal: ${element.getText()}>`,
        )
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true))
  return entries
}

/** A tool whose result a host renders as a view (`showToolBinding` stamps its resource). */
const isViewTool = (tool) => typeof tool?._meta?.ui?.resourceUri === "string"

/**
 * What is wrong with `pageTools` (PAGE_TOOLS' entries) against the server's `surface` (the admin
 * golden's tools), its `appOnly` feeds and its `readOnly` floor (names), and with `recordings`
 * (`{ file, calls }[]`, `calls` the recorded `{ tool }`s or not an array), one line each.
 */
function pageToolFindings({ pageTools, surface, appOnly, readOnly, recordings }) {
  const tools = new Map(surface.map((tool) => [tool.name, tool]))
  const findings = []
  const seen = new Set()
  for (const name of pageTools) {
    if (seen.has(name)) findings.push(`${TOOLS_FILE}: PAGE_TOOLS names ${name} twice`)
    seen.add(name)
    if (!tools.has(name)) {
      findings.push(`${TOOLS_FILE}: ${name} is no tool of the server (the admin golden)`)
    } else if (appOnly.has(name)) {
      findings.push(
        `${TOOLS_FILE}: ${name} is an app-only feed of the server's own views; a page calls model tools`,
      )
    } else if (isViewTool(tools.get(name))) {
      findings.push(
        `${TOOLS_FILE}: ${name} is a view tool, whose result a host renders; a page reads data`,
      )
    } else if (!readOnly.has(name)) {
      findings.push(
        `${TOOLS_FILE}: ${name} is not on the read-only floor, so a server without OAuth, or a ` +
          "toolset without it, refuses the page's call",
      )
    }
  }
  if (recordings.length === 0) {
    findings.push(`${FIXTURES}: no recorded load (pnpm record) shows what a load calls`)
  }
  const called = new Set()
  for (const { file, calls } of recordings) {
    if (!Array.isArray(calls)) {
      findings.push(`${file}: no calls array of the recorded { tool, arguments, result }`)
      continue
    }
    for (const tool of new Set(calls.map((call) => call?.tool))) {
      called.add(tool)
      if (!seen.has(tool)) {
        findings.push(
          `${file}: the recorded load calls ${tool}, which PAGE_TOOLS leaves out, so the ` +
            "published page's call fails",
        )
      }
    }
  }
  if (recordings.length > 0) {
    for (const name of pageTools.filter((tool) => !called.has(tool))) {
      findings.push(
        `${TOOLS_FILE}: PAGE_TOOLS declares ${name}, which no recorded load calls: drop it, or ` +
          "record a load that calls it",
      )
    }
  }
  return findings
}

/** The recorded loads of the template at `root`, `{ file, calls }` per fixtures/*.json. */
function recordingsOf(root) {
  const dir = path.join(root, FIXTURES)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const file = `${FIXTURES}/${name}`
      return { file, calls: JSON.parse(readFileSync(path.join(root, file), "utf8")).calls }
    })
}

const tool = (name, _meta) => ({ name, inputSchema: {}, _meta })
const SURFACE = [
  tool("engine_status"),
  tool("engine_list_incidents"),
  tool("engine_delete_process_instance"),
  tool("engine_bpmn_xml_data", { ui: { visibility: ["app"] } }),
  tool("engine_open_cockpit", { ui: { resourceUri: "ui://views/engine_open_cockpit.html" } }),
]
const CONTEXT = {
  surface: SURFACE,
  appOnly: new Set(["engine_bpmn_xml_data"]),
  readOnly: new Set(["engine_status", "engine_list_incidents", "engine_open_cockpit"]),
}
const recorded = (...tools) => [
  { file: `${FIXTURES}/p.json`, calls: tools.map((name) => ({ tool: name, arguments: {} })) },
]

describe("artifact-tools: the tools a Claude artifact declares and calls", () => {
  it("reads PAGE_TOOLS as declared, `as const` and `satisfies` included", () => {
    assert.deepEqual(pageToolsOf(`export const PAGE_TOOLS = ["engine_status", "a"] as const`), [
      "engine_status",
      "a",
    ])
    assert.deepEqual(
      pageToolsOf(
        `export const PAGE_TOOLS = ["engine_status"] as const satisfies readonly string[]`,
      ),
      ["engine_status"],
    )
    assert.deepEqual(pageToolsOf(`const OTHER = ["engine_status"]`), undefined)
    assert.deepEqual(pageToolsOf("const extra = 'x'\nexport const PAGE_TOOLS = [extra]"), [
      "<not a string literal: extra>",
    ])
  })

  it("passes model tools of the read-only floor that the recorded loads call, every one", () => {
    const pageTools = ["engine_status", "engine_list_incidents"]
    assert.deepEqual(
      pageToolFindings({
        ...CONTEXT,
        pageTools,
        recordings: recorded(...pageTools, "engine_status"),
      }),
      [],
    )
  })

  it("fails an unknown tool, an app-only feed, a view tool, a write and a name twice", () => {
    const pageTools = [
      "engine_status",
      "engine_made_up",
      "engine_bpmn_xml_data",
      "engine_open_cockpit",
      "engine_delete_process_instance",
      "engine_status",
    ]
    assert.deepEqual(
      pageToolFindings({ ...CONTEXT, pageTools, recordings: recorded(...pageTools) }).map((line) =>
        line.replace(`${TOOLS_FILE}: `, ""),
      ),
      [
        "engine_made_up is no tool of the server (the admin golden)",
        "engine_bpmn_xml_data is an app-only feed of the server's own views; a page calls model tools",
        "engine_open_cockpit is a view tool, whose result a host renders; a page reads data",
        "engine_delete_process_instance is not on the read-only floor, so a server without " +
          "OAuth, or a toolset without it, refuses the page's call",
        "PAGE_TOOLS names engine_status twice",
      ],
    )
  })

  it("fails a recorded call PAGE_TOOLS leaves out, and a declared tool no load calls", () => {
    assert.deepEqual(
      pageToolFindings({
        ...CONTEXT,
        pageTools: ["engine_status", "engine_list_incidents"],
        recordings: recorded("engine_status", "engine_list_jobs"),
      }),
      [
        `${FIXTURES}/p.json: the recorded load calls engine_list_jobs, which PAGE_TOOLS leaves ` +
          "out, so the published page's call fails",
        `${TOOLS_FILE}: PAGE_TOOLS declares engine_list_incidents, which no recorded load ` +
          "calls: drop it, or record a load that calls it",
      ],
    )
  })

  it("fails without a recorded load, and a recording without its calls", () => {
    assert.deepEqual(
      pageToolFindings({ ...CONTEXT, pageTools: ["engine_status"], recordings: [] }),
      [`${FIXTURES}: no recorded load (pnpm record) shows what a load calls`],
    )
    assert.deepEqual(
      pageToolFindings({
        ...CONTEXT,
        pageTools: ["engine_status"],
        recordings: [{ file: `${FIXTURES}/p.json`, calls: undefined }],
      }),
      [
        `${FIXTURES}/p.json: no calls array of the recorded { tool, arguments, result }`,
        `${TOOLS_FILE}: PAGE_TOOLS declares engine_status, which no recorded load calls: drop ` +
          "it, or record a load that calls it",
      ],
    )
  })

  it("holds in the repo: the template declares and its recordings call model tools of the floor", () => {
    const source = readFileSync(path.join(REPO_ROOT, TOOLS_FILE), "utf8")
    const pageTools = pageToolsOf(source)
    assert.ok(pageTools !== undefined, `${TOOLS_FILE} declares no PAGE_TOOLS array literal`)
    assert.ok(pageTools.length > 0, `${TOOLS_FILE}: PAGE_TOOLS is empty`)
    const readOnly = new Set(
      JSON.parse(readFileSync(path.join(REPO_ROOT, READ_ONLY_GOLDEN), "utf8")).map(
        ({ name }) => name,
      ),
    )
    assert.deepEqual(
      pageToolFindings({
        pageTools,
        surface: fullSurface(),
        appOnly: appOnlyFeeds(),
        readOnly,
        recordings: recordingsOf(REPO_ROOT),
      }),
      [],
    )
  })
})
