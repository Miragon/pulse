import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  findContextFunctions,
  findHandOffSpecs,
  findIdentifiers,
  findModelContextContents,
  findProseToolNames,
  toolNamesIn,
} from "./hand-off-refs.mjs"
import { scanSources } from "./source-scan.mjs"
import { appOnlyFeeds } from "./tool-surface.mjs"

/**
 * The Ask-AI hand-offs and model contexts (#338).
 *
 * A hand-off reaches the model as the user's own message, so only one primitive posts it
 * (AskAiButton, accepting nothing but an `askAiPrompt` result), and every prompt and model
 * context is built by widget-shell's `askAiPrompt`/`modelContextText` from a typed spec: static
 * text, id-shaped ids and facts, engine text fenced as untrusted. A spec names no tool of any
 * module, so no deployment's surface can make it wrong; the module instructions and the tool
 * descriptions steer the model. This guard pins that over the packages and the MCP server apps
 * (an interface app posts nothing to an MCP host), and keeps their prose from sending the model
 * to an app-only feed. That the server instructions name only tools a toolset registers is the
 * MCP server app's tools/list golden test.
 */

const PRIMITIVE = "packages/core/widget-shell/src/ui/ask-ai-button.tsx"
/** The view runtime: the host seam, its MCP Apps adapter and the test host only pass the pen on. */
const RUNTIME = [
  "packages/core/widget-shell/src/ui/view-host.tsx",
  "packages/core/widget-shell/src/ui/ext-apps-host.tsx",
  "packages/core/widget-shell/src/ui/view-runtime.ts",
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

describe("hand-offs go through the one primitive", () => {
  // `askAi`/`sendFollowUp` post a USER-role message: only AskAiButton (which accepts nothing but
  // an `askAiPrompt` result) may hold that pen, and the runtime hands it over. Navigation stays
  // inside the cockpit and posts none.
  it("no source but AskAiButton and the view runtime posts a follow-up", () => {
    const raw = scanSources((file, text) => findIdentifiers(file, text, FOLLOW_UP_NAMES)).filter(
      (ref) => !FOLLOW_UP_HOLDERS.some((holder) => ref.at.startsWith(`${holder}:`)),
    )
    assert.deepEqual(
      raw.map((ref) => `${ref.name} (${ref.at})`),
      [],
      "Post a hand-off only through <AskAiButton prompt={ask(…)}> (askAiPrompt).",
    )
  })

  // A view's description function (the analytics `describe*`) is held to the same rule: every
  // return hands back modelContextText(…).
  it("every HostModelContext text is assembled by modelContextText, never written in place", () => {
    const contents = scanSources(findModelContextContents)
    const functions = scanSources(findContextFunctions)
    const describes = (callee) => {
      const declared = functions.filter((f) => f.name === callee)
      return declared.length === 1 && declared[0].returnsModelContext
    }
    const written = contents.filter(
      (c) =>
        c.callee !== "context" &&
        c.callee !== "modelContextText" &&
        (c.callee === null || !describes(c.callee)),
    )
    assert.deepEqual(
      written.map((c) => `${c.at} (${c.callee ?? "literal"})`),
      [],
      "Build the text with useHandOff().context(…), modelContextText(…) or a function " +
        "whose every return is modelContextText(…) (a name declared twice cannot be resolved).",
    )
    // The scanner is not blind: the cockpit and the detail views.
    assert.ok(contents.length >= 12, `${contents.length} model contexts`)
    // Nor blind to the description functions: the heatmap describes itself. The floor is pinned
    // at the post-cut count: cut 6 removed the failure dashboard, the comparison/dashboard
    // descriptions and nine analytics tools.
    assert.ok(contents.filter((c) => c.callee !== null && describes(c.callee)).length >= 1)
  })
})

describe("every hand-off names no tool", () => {
  const specs = scanSources(findHandOffSpecs)

  // The hand-off floor is pinned at the post-cut count: cut 7 removed the BPMN viewer's and the
  // process list's hand-offs with their views.
  it("finds the specs (the scanner is not blind)", () => {
    assert.ok(specs.filter((s) => s.kind === "hand-off").length >= 30)
    assert.ok(specs.filter((s) => s.kind === "context").length >= 12)
  })

  // The intent/summary reaches every deployment as is: it must be static text, and no part of a
  // spec may name a tool, since no surface filters it.
  it("states the view in static text and names no tool", () => {
    assert.deepEqual(
      specs.filter((s) => !s.staticText).map((s) => s.at),
      [],
      "An intent/summary is static text (literals, +, ?:, same-file consts); data goes into ids/facts/untrusted.",
    )
    assert.deepEqual(
      specs.flatMap((s) => s.namedTools.map((tool) => `${tool} (${s.at})`)),
      [],
      "A hand-off names no tool: the module instructions and the tool descriptions steer the model.",
    )
    assert.deepEqual(
      specs.flatMap((s) => s.extraMembers.map((member) => `${member} (${s.at})`)),
      [],
      "A spec is its intent/summary, ids, facts and untrusted; a hand-off carries no tool list.",
    )
  })

  // The original bug class: a prompt telling the model to "read the full trace with
  // engine_incident_detail_data", a feed the host hides from it. No model-facing text (prose:
  // a string with whitespace) may name one.
  it("no prose sends the model to an app-only feed", () => {
    const appOnly = appOnlyFeeds()
    assert.ok(appOnly.size >= 10, `${appOnly.size} app-only feeds`)
    const prose = scanSources((file, text) =>
      findProseToolNames(file, text, ["engine", "analytics"]),
    )
    assert.ok(prose.length >= 20, "the scanner is not blind")
    assert.deepEqual(
      prose.filter((ref) => appOnly.has(ref.name)).map((ref) => `${ref.name} (${ref.at})`),
      [],
    )
  })
})

// The readers above, against the shapes #338 removed: a guard that has never been red is
// decoration.
describe("the hand-off readers", () => {
  it("find a prompt that sends the model to a feed", () => {
    const old =
      'const p = `Read the full trace with engine_incident_detail_data({ incidentId: "${id}" }).`'
    assert.deepEqual(
      findProseToolNames("x.ts", old, ["engine"]).map((r) => r.name),
      ["engine_incident_detail_data"],
    )
    // A bare feed constant is plumbing, not prose; a family wildcard names no tool.
    assert.deepEqual(findProseToolNames("x.ts", 'const F = "engine_jobs_data"', ["engine"]), [])
    assert.deepEqual(toolNamesIn("history (engine_query_historic_*) covers", ["engine"]), [])
  })

  it("read no metric name or label as a tool, and every other engine_ token as one", () => {
    const text =
      "sum by (engine_id) (engine_jobs_failed) next to engine_jobs_faild and engine_stale_data"
    assert.deepEqual(toolNamesIn(text, ["engine"]), ["engine_jobs_faild", "engine_stale_data"])
  })

  it("find a raw follow-up and a hand-written model context", () => {
    const raw = "const { askAi } = useHandOff(); askAi(`Fix ${id}`)"
    assert.equal(findIdentifiers("x.tsx", raw, new Set(["askAi"])).length, 2)
    const written = "<HostModelContext content={`Viewing ${id}`}>{null}</HostModelContext>"
    assert.deepEqual(findModelContextContents("x.tsx", written), [
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
    assert.deepEqual(findHandOffSpecs("x.ts", text), [
      { kind: "hand-off", at: "x.ts:1", staticText: true, namedTools: [], extraMembers: [] },
      // A shorthand summary resolves through the file's consts: here there is none.
      { kind: "context", at: "x.ts:2", staticText: false, namedTools: [], extraMembers: [] },
    ])
  })

  // A spec that regains a tool list stays a spec, so the guard fails on it.
  it("report a spec's members besides its lead, ids, facts and untrusted", () => {
    const text = [
      'const a = { intent: "k", tools: ["engine_x"] }',
      "const b = { summary, ids: { engine }, toolIds: { engine_y: [] } }",
      'const c = { summary: "s", surface }',
    ].join("\n")
    assert.deepEqual(
      findHandOffSpecs("x.ts", text).map((s) => [s.at, s.extraMembers, s.namedTools]),
      [
        ["x.ts:1", ["tools"], ["engine_x"]],
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
      'const c = { summary: "Act via engine_delete_process_instance" }',
      'const d = { summary: "s", facts: { hint: "use analytics_x" } }',
      'const e = { intent: "k", ids: { tool: "engine_list_jobs" } }',
    ].join("\n")
    assert.deepEqual(
      findHandOffSpecs("x.ts", text).map((s) => [s.staticText, s.namedTools]),
      [
        [true, []],
        [false, []],
        [true, ["engine_delete_process_instance"]],
        [true, ["analytics_x"]],
        [true, ["engine_list_jobs"]],
      ],
    )
  })

  it("judge what a description function returns, and read the callee of a model context", () => {
    const text = [
      "export const good = (d) => modelContextText({ summary: 's', ids: { engine } })",
      "export function mixed(d) { if (d) return modelContextText(x); return `Viewing ${d}` }",
      "export const bad = (d) => `Viewing ${d.key}. Drill with analytics_x.`",
      "const a = <HostModelContext content={good(data)}><A /></HostModelContext>",
      "const b = <HostModelContext content={`x`}>{null}</HostModelContext>",
    ].join("\n")
    assert.deepEqual(findContextFunctions("x.tsx", text), [
      { name: "good", at: "x.tsx:1", returnsModelContext: true },
      { name: "mixed", at: "x.tsx:2", returnsModelContext: false },
      { name: "bad", at: "x.tsx:3", returnsModelContext: false },
    ])
    assert.deepEqual(findModelContextContents("x.tsx", text), [
      { name: "content", at: "x.tsx:4", callee: "good" },
      { name: "content", at: "x.tsx:5", callee: null },
    ])
  })
})
