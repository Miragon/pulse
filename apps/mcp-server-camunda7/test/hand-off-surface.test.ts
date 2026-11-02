import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { bootServer, type BootOptions, type BootedServer } from "./boot-server.js"
import { isModelVisible } from "./golden.js"
import {
  findContextFunctions,
  findHandOffSpecs,
  findIdentifiers,
  findModelContextContents,
  findProseToolNames,
  toolNamesIn,
  type HandOffSpec,
} from "./hand-off-refs.js"
import { scanSources, type ScanOptions } from "./source-scan.js"

/**
 * The Ask-AI hand-offs and model contexts (#338).
 *
 * A hand-off reaches the model as the user's own message, so only one
 * primitive posts it (AskAiButton, accepting nothing but an `askAiPrompt`
 * result), and every prompt and model context is built by widget-shell's
 * `askAiPrompt`/`modelContextText` from a typed spec: static text, id-shaped
 * ids and facts, engine text fenced as untrusted. A spec names no tool of any
 * module, so no deployment's surface can make it wrong; the module
 * instructions and the tool descriptions steer the model. This guard pins
 * that, keeps prose anywhere from sending the model to an app-only feed, and
 * holds the server instructions to the tools each toolset registers.
 */

/**
 * The widget rules read the packages and the MCP server apps only: an
 * interface app (a CLI, an editor extension) posts nothing to an MCP host, so
 * its own `askAi` handler or `{ summary, tools }` output is none of these
 * rules' business, and a helper it declares must not make a widget's
 * reference ambiguous. Only the prose check ("no prose anywhere sends the
 * model to an app-only feed") reads every app (scope "all"): any text that
 * names a tool, in a CLI or an extension too, must not send the model to an
 * app-only feed.
 */
const MCP: ScanOptions = { scope: "mcp" }

const PRIMITIVE = "packages/core/widget-shell/src/ui/ask-ai-button.tsx"
/** The view runtime: the host seam, its mcp-use adapter and the test host only pass the pen on. */
const RUNTIME = [
  "packages/core/widget-shell/src/ui/view-host.tsx",
  "packages/core/widget-shell/src/ui/mcp-use-host.tsx",
  "packages/core/widget-shell/src/ui/test-view-host.tsx",
]
const FOLLOW_UP_HOLDERS = [PRIMITIVE, ...RUNTIME]
const FOLLOW_UP_NAMES = new Set([
  "askAi",
  "sendFollowup",
  "sendFollowUp",
  "sendFollowUpMessage",
  "useSendFollowUp",
])

/** Every follow-up reference in the MCP sources. */
function followUpRefs() {
  return scanSources((file, text) => findIdentifiers(file, text, FOLLOW_UP_NAMES), MCP)
}

interface WireTool {
  name: string
  inputSchema: { properties?: Record<string, unknown> }
  _meta?: { ui?: { visibility?: string[] } }
}

async function surfaceOf(server: BootedServer): Promise<WireTool[]> {
  return (await server.client.listTools()).tools
}

const modelVisibleNames = (tools: readonly WireTool[]) =>
  tools.filter((tool) => isModelVisible(tool)).map((tool) => tool.name)

describe("hand-offs go through the one primitive", () => {
  // `askAi`/`sendFollowUp` post a USER-role message: only AskAiButton (which
  // accepts nothing but an `askAiPrompt` result) may hold that pen, and the
  // runtime hands it over. Navigation stays inside the cockpit and posts none.
  it("no source but AskAiButton and the view runtime posts a follow-up", () => {
    const raw = followUpRefs().filter(
      (ref) => !FOLLOW_UP_HOLDERS.some((holder) => ref.at.startsWith(`${holder}:`)),
    )
    expect(
      raw.map((ref) => `${ref.name} (${ref.at})`),
      "Post a hand-off only through <AskAiButton prompt={ask(…)}> (askAiPrompt).",
    ).toEqual([])
  })

  // A view's description function (the analytics `describe*`) is held to the
  // same rule: every return hands back modelContextText(…).
  it("every HostModelContext text is assembled by modelContextText, never written in place", () => {
    const contents = scanSources(findModelContextContents, MCP)
    const functions = scanSources(findContextFunctions, MCP)
    const describes = (callee: string) => {
      const declared = functions.filter((f) => f.name === callee)
      return declared.length === 1 && declared[0].returnsModelContext
    }
    const written = contents.filter(
      (c) =>
        c.callee !== "context" &&
        c.callee !== "modelContextText" &&
        (c.callee === null || !describes(c.callee)),
    )
    expect(
      written.map((c) => `${c.at} (${c.callee ?? "literal"})`),
      "Build the text with useHandOff().context(…), modelContextText(…) or a function " +
        "whose every return is modelContextText(…) (a name declared twice cannot be resolved).",
    ).toEqual([])
    // The scanner is not blind: the cockpit and the detail views.
    expect(contents.length).toBeGreaterThanOrEqual(12)
    // Nor blind to the description functions: the heatmap describes itself. The floor is
    // pinned at the post-cut count: cut 6 removed the failure dashboard, the
    // comparison/dashboard descriptions and nine analytics tools.
    expect(
      contents.filter((c) => c.callee !== null && describes(c.callee)).length,
    ).toBeGreaterThanOrEqual(1)
  })
})

describe("every hand-off names no tool", () => {
  let server: BootedServer
  let full: WireTool[]
  let specs: HandOffSpec[]

  beforeAll(async () => {
    // The FULL surface (every module, admin, deployments): every feed a text could name.
    server = await bootServer({
      authenticated: true,
      env: {
        MCP_ACTIVE_MODULES: "camunda7:admin,analytics",
        CAMUNDA_ALLOW_DEPLOYMENTS: "true",
      },
    })
    full = await surfaceOf(server)
    specs = scanSources(findHandOffSpecs, MCP)
  })

  afterAll(async () => {
    await server?.close()
  })

  // The hand-off floor is pinned at the post-cut count: cut 7 removed the BPMN viewer's and the
  // process list's hand-offs with their views.
  it("finds the specs (the scanner is not blind)", () => {
    expect(specs.filter((s) => s.kind === "hand-off").length).toBeGreaterThanOrEqual(30)
    expect(specs.filter((s) => s.kind === "context").length).toBeGreaterThanOrEqual(12)
  })

  // The intent/summary reaches every deployment as is: it must be static
  // text, and no part of a spec may name a tool, since no surface filters it.
  it("states the view in static text and names no tool", () => {
    expect(
      specs.filter((s) => !s.staticText).map((s) => s.at),
      "An intent/summary is static text (literals, +, ?:, same-file consts); data goes into ids/facts/untrusted.",
    ).toEqual([])
    expect(
      specs.flatMap((s) => s.namedTools.map((tool) => `${tool} (${s.at})`)),
      "A hand-off names no tool: the module instructions and the tool descriptions steer the model.",
    ).toEqual([])
    expect(
      specs.flatMap((s) => s.extraMembers.map((member) => `${member} (${s.at})`)),
      "A spec is its intent/summary, ids, facts and untrusted; a hand-off carries no tool list.",
    ).toEqual([])
  })

  // The original bug class: a prompt telling the model to "read the full
  // trace with camunda7_incident_detail_data" — a feed the host hides from
  // it. No model-facing text (prose: a string with whitespace) may name one,
  // in any app: an interface app (a CLI, an editor extension) is read too.
  it("no prose anywhere sends the model to an app-only feed", () => {
    const appOnly = new Set(full.filter((t) => !isModelVisible(t)).map((t) => t.name))
    const prose = scanSources((file, text) =>
      findProseToolNames(file, text, ["camunda7", "analytics"]),
    )
    expect(prose.length, "the scanner is not blind").toBeGreaterThanOrEqual(20)
    expect(
      prose.filter((ref) => appOnly.has(ref.name)).map((ref) => `${ref.name} (${ref.at})`),
    ).toEqual([])
  })
})

const TOOLSETS: ReadonlyArray<{ label: string; options: BootOptions }> = [
  { label: "read-only (the unauthenticated default)", options: {} },
  { label: "operations (the default under OAuth)", options: { authenticated: true } },
  {
    label: "admin",
    options: {
      authenticated: true,
      env: {
        MCP_ACTIVE_MODULES: "camunda7:admin,analytics",
        CAMUNDA_ALLOW_DEPLOYMENTS: "true",
      },
    },
  },
]

describe.each(TOOLSETS)("the live surface on $label", ({ options }) => {
  let server: BootedServer
  let tools: WireTool[]

  beforeAll(async () => {
    server = await bootServer(options)
    tools = await surfaceOf(server)
  })

  afterAll(async () => {
    await server?.close()
  })

  // The playbooks live in the server instructions, which no surface filters:
  // each must name only what this boot registers.
  it("the server instructions name only tools this deployment gives the model", () => {
    const instructions = server.client.getInstructions() ?? ""
    const named = toolNamesIn(instructions, ["camunda7", "analytics"])
    // Pinned at the post-cut count of the read-only boot: cut 7's instructions stopped naming
    // the two camunda7 show tools they routed to.
    expect(named.length).toBeGreaterThanOrEqual(8)
    const visible = new Set(modelVisibleNames(tools))
    expect(named.filter((name) => !visible.has(name))).toEqual([])
  })
})

// The preamble and every module's snippet reach a deployment as one text: without camunda7,
// none of it may name a camunda7 tool (the boots above all carry both modules).
describe("the live surface without camunda7", () => {
  it("the server instructions name only tools this deployment gives the model", async () => {
    const server = await bootServer({ env: { MCP_ACTIVE_MODULES: "analytics" } })
    try {
      const named = toolNamesIn(server.client.getInstructions() ?? "", ["camunda7", "analytics"])
      expect(named.length, "the scanner is not blind").toBeGreaterThanOrEqual(4)
      const visible = new Set(modelVisibleNames(await surfaceOf(server)))
      expect(named.filter((name) => !visible.has(name))).toEqual([])
    } finally {
      await server.close()
    }
  })
})

// The readers above, against the shapes #338 removed — a guard that has never
// been red is decoration.
describe("the hand-off readers", () => {
  it("find a prompt that sends the model to a feed", () => {
    const old =
      'const p = `Read the full trace with camunda7_incident_detail_data({ incidentId: "${id}" }).`'
    expect(findProseToolNames("x.ts", old, ["camunda7"]).map((r) => r.name)).toEqual([
      "camunda7_incident_detail_data",
    ])
    // A bare feed constant is plumbing, not prose; a family wildcard names no tool.
    expect(findProseToolNames("x.ts", 'const F = "camunda7_jobs_data"', ["camunda7"])).toEqual([])
    expect(toolNamesIn("history (camunda7_query_historic_*) covers", ["camunda7"])).toEqual([])
  })

  it("find a raw follow-up and a hand-written model context", () => {
    const raw = "const { askAi } = useHandOff(); askAi(`Fix ${id}`)"
    expect(findIdentifiers("x.tsx", raw, new Set(["askAi"]))).toHaveLength(2)
    const written = "<HostModelContext content={`Viewing ${id}`}>{null}</HostModelContext>"
    expect(findModelContextContents("x.tsx", written)).toEqual([
      { name: "content", at: "x.tsx:1", callee: null },
    ])
  })

  it("read a spec, and skip plumbing and data", () => {
    const text = [
      'const a = { intent: "k", ids: { engine, jobId: j }, untrusted: [{ label: "m", text: m }] }',
      "const b = { summary, facts: { count } }",
      'const c = { ...handOff, intent: "k", locale }',
      'const d = { isError, summary: "s" }',
      // A nav intent and view-model summaries are data, not a lead's text.
      'const e = { id: "jobs", intent: { type: "jobs" }, icon }',
      "const f = { summary: { total: 1 }, definitions }",
      "const g = { query, summary, tone }",
    ].join("\n")
    expect(findHandOffSpecs("x.ts", text)).toEqual([
      { kind: "hand-off", at: "x.ts:1", staticText: true, namedTools: [], extraMembers: [] },
      // A shorthand summary resolves through the file's consts: here there is none.
      { kind: "context", at: "x.ts:2", staticText: false, namedTools: [], extraMembers: [] },
    ])
  })

  // A spec that regains a tool list stays a spec, so the guard fails on it.
  it("report a spec's members besides its lead, ids, facts and untrusted", () => {
    const text = [
      'const a = { intent: "k", tools: ["camunda7_x"] }',
      "const b = { summary, ids: { engine }, toolIds: { camunda7_y: [] } }",
      'const c = { summary: "s", surface }',
    ].join("\n")
    expect(findHandOffSpecs("x.ts", text).map((s) => [s.at, s.extraMembers, s.namedTools])).toEqual(
      [
        ["x.ts:1", ["tools"], ["camunda7_x"]],
        ["x.ts:2", ["toolIds"], []],
        ["x.ts:3", ["surface"], []],
      ],
    )
  })

  // The N118 shape: a write tool in the summary, data interpolated into it.
  it("flag a summary that carries data and a tool named anywhere in a spec", () => {
    const text = [
      'const LEAD = "Viewing jobs."',
      'const a = { summary: LEAD + (x ? " Retry." : ""), ids: { engine } }',
      "const b = { summary: `Viewing ${engine}` }",
      'const c = { summary: "Act via camunda7_delete_process_instance" }',
      'const d = { summary: "s", facts: { hint: "use analytics_x" } }',
      'const e = { intent: "k", ids: { tool: "camunda7_list_jobs" } }',
    ].join("\n")
    expect(findHandOffSpecs("x.ts", text).map((s) => [s.staticText, s.namedTools])).toEqual([
      [true, []],
      [false, []],
      [true, ["camunda7_delete_process_instance"]],
      [true, ["analytics_x"]],
      [true, ["camunda7_list_jobs"]],
    ])
  })

  it("judge what a description function returns, and read the callee of a model context", () => {
    const text = [
      "export const good = (d) => modelContextText({ summary: 's', ids: { engine } })",
      "export function mixed(d) { if (d) return modelContextText(x); return `Viewing ${d}` }",
      "export const bad = (d) => `Viewing ${d.key}. Drill with analytics_x.`",
      "const a = <HostModelContext content={good(data)}><A /></HostModelContext>",
      "const b = <HostModelContext content={`x`}>{null}</HostModelContext>",
    ].join("\n")
    expect(findContextFunctions("x.tsx", text)).toEqual([
      { name: "good", at: "x.tsx:1", returnsModelContext: true },
      { name: "mixed", at: "x.tsx:2", returnsModelContext: false },
      { name: "bad", at: "x.tsx:3", returnsModelContext: false },
    ])
    expect(findModelContextContents("x.tsx", text)).toEqual([
      { name: "content", at: "x.tsx:4", callee: "good" },
      { name: "content", at: "x.tsx:5", callee: null },
    ])
  })
})
