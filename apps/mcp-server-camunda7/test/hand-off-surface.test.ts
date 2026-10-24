import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { bootServer, type BootOptions, type BootedServer } from "./boot-server.js"
import { isModelVisible } from "./golden.js"
import {
  findContextFunctions,
  findDescribeForModelArgs,
  findHandOffSpecs,
  findIdentifiers,
  findModelContextContents,
  findProseToolNames,
  toolNamesIn,
  type HandOffSpec,
} from "./hand-off-refs.js"
import { scanSources, type ScanOptions } from "./source-scan.js"

/**
 * The Ask-AI hand-offs and model contexts vs the LIVE tool surface (#338).
 *
 * A hand-off reaches the model as the user's own message, so it must never
 * send the model to a tool the deployment does not give it: an app-only
 * `*_data` feed (SEP-1865 hosts hide those), an admin-only write on an
 * operations deployment, any write on the read-only floor. Widgets therefore
 * build every prompt with widget-shell's `askAiPrompt` from a typed spec whose
 * `tools` pass the deployment's surface at render time — this guard pins both
 * halves: the specs (every tool they can name exists for the model, every id
 * is a parameter of one of them) and the surface (per toolset, what the
 * widgets filter by IS what tools/list advertises).
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
/** Deterministic navigation (`useNav` standalone fallback) — the one other follow-up path. */
const NAVIGATION = "packages/connectors/camunda/camunda7-connector/src/widgets/navigation.ts"

interface WireTool {
  name: string
  inputSchema: { properties?: Record<string, unknown> }
  _meta?: { ui?: { visibility?: string[] } }
}

async function surfaceOf(server: BootedServer): Promise<WireTool[]> {
  return (await server.client.listTools()).tools
}

const modelTools = (tools: readonly WireTool[]) =>
  tools.filter((tool) => isModelVisible(tool)).map((tool) => tool.name)

describe("hand-offs go through the one primitive", () => {
  // `askAi`/`sendFollowup` post a USER-role message: only AskAiButton (which
  // accepts nothing but an `askAiPrompt` result) may hold that pen.
  it("no source but AskAiButton posts a follow-up", () => {
    const raw = scanSources(
      (file, text) =>
        findIdentifiers(
          file,
          text,
          new Set([
            "askAi",
            "sendFollowup",
            "sendFollowUp",
            "sendFollowUpMessage",
            "useSendFollowUp",
          ]),
        ),
      MCP,
    ).filter((ref) => !ref.at.startsWith(`${PRIMITIVE}:`))
    expect(
      raw.map((ref) => `${ref.name} (${ref.at})`),
      "Post a hand-off only through <AskAiButton prompt={ask(…)}> (askAiPrompt).",
    ).toEqual([])
  })

  it("only the navigation seam sends a show-widget follow-up", () => {
    const raw = scanSources(
      (file, text) => findIdentifiers(file, text, new Set(["showWidget"])),
      MCP,
    ).filter((ref) => !ref.at.startsWith(`${NAVIGATION}:`))
    expect(raw.map((ref) => ref.at)).toEqual([])
  })

  it("every HostModelContext text is assembled by modelContextText, never written in place", () => {
    const contents = scanSources(findModelContextContents, MCP)
    const written = contents.filter(
      (c) => c.callee !== "context" && c.callee !== "modelContextText",
    )
    expect(
      written.map((c) => `${c.at} (${c.callee ?? "literal"})`),
      "Build the text with useHandOff().context(…) or modelContextText(…).",
    ).toEqual([])
    // The scanner is not blind: the cockpit, the detail views and the settings.
    expect(contents.length).toBeGreaterThanOrEqual(12)
  })

  // The toolkit renders `adaptDataWidget`'s third argument as the widget's
  // model context — the analytics widgets attach theirs this way — so it is
  // held to the same rule as a HostModelContext text.
  it("every adaptDataWidget model description returns modelContextText(…)", () => {
    const functions = scanSources(findContextFunctions, MCP)
    const args = scanSources(findDescribeForModelArgs, MCP)
    const verdict = (ref: string) => {
      const declared = functions.filter((f) => f.name === ref)
      return declared.length === 1 ? declared[0].returnsModelContext : null
    }
    const written = args.filter((arg) => (arg.ref ? verdict(arg.ref) : arg.inline) !== true)
    expect(
      written.map((arg) => `${arg.at} (${arg.ref ?? "inline"})`),
      "Return modelContextText({ summary, ids, facts, untrusted, tools, surface }) — " +
        "never a hand-written text (a name declared twice cannot be resolved either).",
    ).toEqual([])
    // The scanner is not blind: the analytics widgets describe themselves.
    expect(args.filter((arg) => arg.ref !== null).length).toBeGreaterThanOrEqual(12)
  })
})

describe("every hand-off names only tools the model can call", () => {
  let server: BootedServer
  let full: WireTool[]
  let floor: Set<string>
  let operations: Set<string>
  let specs: HandOffSpec[]

  beforeAll(async () => {
    // The FULL surface (every module, admin, deployments) — what a spec may
    // name at all; the read-only floor — what the analytics part may assume;
    // operations — the default under OAuth.
    server = await bootServer({
      authenticated: true,
      env: {
        MCP_ACTIVE_MODULES: "camunda7:admin,analytics:standard",
        CAMUNDA_ALLOW_DEPLOYMENTS: "true",
      },
    })
    full = await surfaceOf(server)
    await server.close()
    server = await bootServer({ authenticated: true })
    operations = new Set(modelTools(await surfaceOf(server)))
    await server.close()
    server = await bootServer({})
    floor = new Set(modelTools(await surfaceOf(server)))
    specs = scanSources(findHandOffSpecs, MCP)
  })

  afterAll(async () => {
    await server?.close()
  })

  it("finds the specs (the scanner is not blind)", () => {
    expect(specs.filter((s) => s.kind === "hand-off").length).toBeGreaterThanOrEqual(35)
    expect(specs.filter((s) => s.kind === "context").length).toBeGreaterThanOrEqual(15)
  })

  it("writes every tool list and id set literally, so they can be checked", () => {
    const opaque = specs
      .filter((s) => s.tools === null || s.ids === null || s.toolIds === null)
      .map((s) => s.at)
    expect(
      opaque,
      'Write `tools: ["…"]`, `ids: { … }` and `toolIds: { tool: { … } }` as literals.',
    ).toEqual([])
  })

  // The intent/summary reaches every deployment unfiltered: it must be
  // static text, and a tool may only travel through `tools`, where the live
  // surface filters it — never through the summary, a fact or an id value.
  it("states the view in static text and names tools through `tools` only", () => {
    expect(
      specs.filter((s) => !s.staticText).map((s) => s.at),
      "An intent/summary is static text (literals, +, ?:, same-file consts); data goes into ids/facts/untrusted.",
    ).toEqual([])
    expect(
      specs.flatMap((s) => s.namedOutsideTools.map((tool) => `${tool} (${s.at})`)),
      "Name a tool in `tools` only — the live surface filters nothing else.",
    ).toEqual([])
  })

  it("names only tools the model can call — never an app-only feed or an unknown name", () => {
    const visible = new Set(modelTools(full))
    const wrong = specs.flatMap((s) =>
      (s.tools ?? [])
        .filter((tool) => !visible.has(tool))
        .map(
          (tool) =>
            `${tool} (${s.at}) — ${
              full.some((t) => t.name === tool)
                ? "app-only: hosts hide it from the model"
                : "no such tool"
            }`,
        ),
    )
    expect(wrong).toEqual([])
  })

  // The surface drops tools per deployment, and strict inputs refuse an
  // argument a tool does not take: so on EVERY surface a hand-off renders on
  // (each toolset; the other module active or not), each id it inlines must
  // be taken by a tool still named there. An argument only some tools take
  // belongs in `toolIds`, inlined only while its tool is named.
  it("passes each id to a tool still named on every surface it renders on", () => {
    const params = new Map(full.map((t) => [t.name, Object.keys(t.inputSchema.properties ?? {})]))
    const takes = (tool: string, id: string) => params.get(tool)?.includes(id) ?? false
    // A camunda7 widget renders with camunda7 active, an analytics one with analytics.
    const otherModule = (at: string) =>
      at.startsWith("packages/connectors/camunda/")
        ? "analytics_"
        : at.startsWith("packages/connectors/analytics/")
          ? "camunda7_"
          : null
    const surfaces = (at: string) =>
      [
        ["read-only", floor],
        ["operations", operations],
        ["admin", new Set(modelTools(full))],
      ].flatMap(([label, tools]) => {
        const other = otherModule(at)
        const without = other && new Set([...tools].filter((t) => !t.startsWith(other)))
        return [
          { label: label as string, tools: tools as Set<string> },
          ...(without ? [{ label: `${label as string} without ${other}*`, tools: without }] : []),
        ]
      })
    const wrong = specs.flatMap((s) => {
      const toolIds = Object.entries(s.toolIds ?? {}).flatMap(([tool, ids]) => [
        ...(s.tools?.includes(tool) ? [] : [`toolIds.${tool} (${s.at}) — not a listed tool`]),
        ...ids
          .filter((id) => !takes(tool, id))
          .map((id) => `toolIds.${tool}.${id} (${s.at}) — ${tool} does not take it`),
      ])
      const ids = surfaces(s.at).flatMap(({ label, tools }) => {
        const named = (s.tools ?? []).filter((tool) => tools.has(tool))
        if (named.length === 0) return [] // no Tools line — nothing to pass the ids to
        return (s.ids ?? [])
          .filter((id) => !named.some((tool) => takes(tool, id)))
          .map((id) => `${id} (${s.at}) — on ${label} only ${named.join(", ")} remain`)
      })
      return [...toolIds, ...ids]
    })
    expect(
      [...new Set(wrong)],
      "An id no named tool takes is refused by strict inputs: move it to `toolIds` " +
        "(an argument of one tool) or to `facts` (a number on screen).",
    ).toEqual([])
  })

  // Widgets treat analytics tools as present whenever the analytics module is
  // (camunda7's probe; analytics' own widgets): so a spec may only name the
  // analytics tools its read-only floor registers too. The one exception is
  // the settings section's save, which its own surface gates on `canSave`.
  it("names only analytics tools every analytics toolset registers", () => {
    const gated = new Map([
      [
        "analytics_save_settings",
        "packages/connectors/analytics/analytics-connector/src/widgets/model-descriptions.ts",
      ],
    ])
    const wrong = specs.flatMap((s) =>
      (s.tools ?? [])
        .filter((tool) => tool.startsWith("analytics_") && !floor.has(tool))
        .filter((tool) => !s.at.startsWith(`${gated.get(tool)}:`))
        .map((tool) => `${tool} (${s.at})`),
    )
    expect(wrong).toEqual([])
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
        MCP_ACTIVE_MODULES: "camunda7:admin,analytics:standard",
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

  // The widgets filter every camunda7 tool a hand-off names by this feed: it
  // must report exactly what tools/list gives the model — no app-only feed,
  // no tool the toolset withholds, none missing.
  it("camunda7_widget_actions_data reports exactly the model's camunda7 tools", async () => {
    const result = await server.client.callTool({
      name: "camunda7_widget_actions_data",
      arguments: {},
    })
    // A feed answers in JSON text only.
    const [{ text }] = result.content as Array<{ text: string }>
    const reported = (JSON.parse(text) as { modelTools: string[] }).modelTools
    expect(reported).toEqual(
      modelTools(tools)
        .filter((name) => name.startsWith("camunda7_"))
        .sort(),
    )
  })

  // The playbooks moved from the prompts into the server instructions, which
  // no surface filters: each must name only what this boot registers.
  it("the server instructions name only tools this deployment gives the model", () => {
    const instructions = server.client.getInstructions() ?? ""
    const named = toolNamesIn(instructions, ["camunda7", "analytics"])
    expect(named.length).toBeGreaterThanOrEqual(10)
    const visible = new Set(modelTools(tools))
    expect(named.filter((name) => !visible.has(name))).toEqual([])
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
    const raw = "const { askAi } = useHostActions(); askAi(`Fix ${id}`)"
    expect(findIdentifiers("x.tsx", raw, new Set(["askAi"]))).toHaveLength(2)
    const written = "<HostModelContext content={`Viewing ${id}`}>{null}</HostModelContext>"
    expect(findModelContextContents("x.tsx", written)).toEqual([
      { name: "content", at: "x.tsx:1", callee: null },
    ])
  })

  it("read a spec's tools and ids — and flag a list it cannot read", () => {
    const text = [
      'const a = { intent: "k", ids: { engine, jobId: j }, tools: ["camunda7_get_job_stacktrace"] }',
      'const b = { summary: "s", tools: ["camunda7_x", "camunda7_y"].filter(keep) }',
      'const c = { intent: "k", ids: { ...rest }, tools: names, toolIds: own }',
      'const d = { intent: "k", tools: ["analytics_x"], toolIds: { analytics_x: { period: p } } }',
    ].join("\n")
    const clean = { staticText: true, namedOutsideTools: [] }
    expect(findHandOffSpecs("x.ts", text)).toEqual([
      {
        kind: "hand-off",
        at: "x.ts:1",
        tools: ["camunda7_get_job_stacktrace"],
        ids: ["engine", "jobId"],
        toolIds: {},
        ...clean,
      },
      {
        kind: "context",
        at: "x.ts:2",
        tools: ["camunda7_x", "camunda7_y"],
        ids: [],
        toolIds: {},
        ...clean,
      },
      { kind: "hand-off", at: "x.ts:3", tools: null, ids: null, toolIds: null, ...clean },
      {
        kind: "hand-off",
        at: "x.ts:4",
        tools: ["analytics_x"],
        ids: [],
        toolIds: { analytics_x: ["period"] },
        ...clean,
      },
    ])
  })

  // The N118 shape: a write tool in the summary, data interpolated into it.
  it("flag a summary that carries data or names a tool outside `tools`", () => {
    const text = [
      'const LEAD = "Viewing jobs."',
      'const a = { summary: LEAD + (x ? " Retry." : ""), tools: [] }',
      "const b = { summary: `Viewing ${engine}`, tools: [] }",
      'const c = { summary: "Act via camunda7_delete_process_instance", tools: [] }',
      'const d = { summary: "s", facts: { hint: "use analytics_x" }, tools: [] }',
      'const e = { summary: "s", tools: [], surface: { has: (t) => t === "analytics_y" } }',
    ].join("\n")
    expect(findHandOffSpecs("x.ts", text).map((s) => [s.staticText, s.namedOutsideTools])).toEqual([
      [true, []],
      [false, []],
      [true, ["camunda7_delete_process_instance"]],
      [true, ["analytics_x"]],
      [true, []],
    ])
  })

  it("resolve an adaptDataWidget description and judge what it returns", () => {
    const text = [
      "export const good = (d) => modelContextText({ summary: 's', tools: [], surface })",
      "export function mixed(d) { if (d) return modelContextText(x); return `Viewing ${d}` }",
      "export const bad = (d) => `Viewing ${d.key}. Drill with analytics_x.`",
      "const w = { a: adaptDataWidget(A, 't', good), b: adaptDataWidget(B, 't', bad) }",
      "const v = { c: adaptDataWidget(C, 't', (d) => `x`), d: adaptDataWidget(D, 't') }",
    ].join("\n")
    expect(findContextFunctions("x.ts", text)).toEqual([
      { name: "good", at: "x.ts:1", returnsModelContext: true },
      { name: "mixed", at: "x.ts:2", returnsModelContext: false },
      { name: "bad", at: "x.ts:3", returnsModelContext: false },
    ])
    expect(findDescribeForModelArgs("x.ts", text)).toEqual([
      { at: "x.ts:4", ref: "good", inline: null },
      { at: "x.ts:4", ref: "bad", inline: null },
      { at: "x.ts:5", ref: null, inline: false },
    ])
  })
})
