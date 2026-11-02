import assert from "node:assert/strict"
import { before, describe, it } from "node:test"
import ts from "typescript"
import { OPAQUE_ARGUMENT, collectTextHelpers, findParamRefs } from "./prompt-param-refs.mjs"
import { scanSources } from "./source-scan.mjs"
import { fullSurface, metricVocabulary } from "./tool-surface.mjs"

/**
 * Raw tool-name references vs the full tool surface (#322 N187).
 *
 * Modules never import each other (CLAUDE.md invariant 8), so a widget that needs another
 * module's feed names it by raw string (`analytics-probe.ts` → `analytics_engine_landscape_data`,
 * `process-incidents/flow.tsx` → `analytics_bpmn_heatmap_data`). Graceful degradation then HIDES
 * a stale name at runtime: the fleet view is silently never offered, the heatmap overlay silently
 * absent, and the module's own tests stub the same stale literal. So every `<module>_…` string
 * literal in a package's or an MCP server app's non-test source must name a tool of the full
 * surface (the admin golden), and every parameter a source quotes for a tool must be one that
 * tool takes.
 */

/** The contract's metric names and labels (`engine_id`, `engine_jobs_failed`) share the prefix. */
const METRIC_VOCABULARY = metricVocabulary()

/**
 * String literals (not comments, not template expressions) shaped like a `<prefix>_…` tool name;
 * a metric name or label of the metrics contract is none, every other one must be a tool.
 */
function findToolNameLiterals(file, text, prefixes) {
  const shape = new RegExp(`^(?:${prefixes.join("|")})_[a-z0-9_]+$`)
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const refs = []
  const visit = (node) => {
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      shape.test(node.text) &&
      !METRIC_VOCABULARY.has(node.text)
    ) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart())
      refs.push({ name: node.text, at: `${file}:${line + 1}` })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return refs
}

/**
 * The parameters the sources quote for a tool. One-line text helpers (`engineArg`) resolve by
 * name; a name declared twice is ambiguous and stays a placeholder.
 */
function collectParamRefs(prefixes) {
  const helperDecls = scanSources(collectTextHelpers)
  const helperNames = helperDecls.map(([name]) => name)
  const helpers = new Map(
    helperDecls.filter(([name]) => helperNames.indexOf(name) === helperNames.lastIndexOf(name)),
  )
  return scanSources((file, text) => findParamRefs(file, text, prefixes, helpers))
}

describe("raw tool-name literals name real tools (full surface)", () => {
  let tools
  /** Advertised input-schema property names per tool. */
  let toolParams
  let refs
  let paramRefs

  before(() => {
    const surface = fullSurface()
    tools = new Set(surface.map((tool) => tool.name))
    toolParams = new Map(
      surface.map((tool) => [tool.name, Object.keys(tool.inputSchema.properties ?? {})]),
    )
    // Prefixes come from the surface itself: `engine_…`, `analytics_…`.
    const prefixes = [...new Set([...tools].flatMap((n) => /^([a-z0-9]+)_/.exec(n)?.[1] ?? []))]
    assert.deepEqual(prefixes.sort(), ["analytics", "engine"])
    refs = scanSources((file, text) => findToolNameLiterals(file, text, prefixes))
    paramRefs = collectParamRefs(prefixes)
  })

  it("every `<module>_…` literal in package and MCP server app sources is a registered tool", () => {
    const stale = refs.filter((ref) => !tools.has(ref.name)).map((r) => `${r.name} (${r.at})`)
    assert.deepEqual(
      stale,
      [],
      "A source names a tool the composed server does not register (renamed or removed?). " +
        "Fix the literal: a cross-module reference degrades SILENTLY at runtime.",
    )
  })

  it("sees the raw cross-module references (the scanner is not blind)", () => {
    const engineRefs = refs
      .filter((r) => r.at.startsWith("packages/connectors/engine/engine-connector/src/widgets/"))
      .map((r) => r.name)
    for (const name of ["analytics_engine_landscape_data", "analytics_bpmn_heatmap_data"]) {
      assert.ok(engineRefs.includes(name), name)
    }
  })

  // #329: a prompt that tells the model to pass a filter the tool does not take used to produce
  // a silently UNFILTERED answer; with strict inputs it is a refused call. Either way the prompt
  // is wrong, and caught here.
  it("every parameter a prompt or description quotes for a tool is one that tool takes", () => {
    const wrong = paramRefs
      .filter((ref) => !toolParams.get(ref.tool)?.includes(ref.param))
      .map(
        (ref) =>
          `${ref.tool}(${ref.param}) at ${ref.at}, takes: ${
            toolParams.get(ref.tool)?.join(", ") ?? "(no such tool)"
          }`,
      )
    assert.deepEqual(
      wrong,
      [],
      "A source quotes a parameter the named tool does not advertise: fix the prompt " +
        "(parentheses right after a tool name are read as its arguments). " +
        `${OPAQUE_ARGUMENT} is an argument whose NAME is interpolated: write the parameter ` +
        "names literally so they can be checked.",
    )
  })

  // The Ask-AI hand-offs and the widget model contexts name no tool (hand-off-refs.test.mjs);
  // what is left here are the tool descriptions and the server instructions.
  it("sees the parameters the instructions and descriptions quote (the scanner is not blind)", () => {
    const quoted = new Set(paramRefs.map((ref) => `${ref.tool}.${ref.param}`))
    // instructions.ts: the cluster scope of the guarded retry
    assert.ok(quoted.has("engine_list_jobs.activityId"))
  })
})

describe("findParamRefs", () => {
  const scan = (text) =>
    findParamRefs("x.ts", text, ["engine", "analytics"]).map((r) => `${r.tool}.${r.param}`)

  it("reads call notation: named, object, shorthand and parenthesized prose", () => {
    assert.deepEqual(scan('const a = `analytics_x(a="1", b=${n}) and engine_y({ c: 1, d })`'), [
      "analytics_x.a",
      "analytics_x.b",
      "engine_y.c",
      "engine_y.d",
    ])
    assert.deepEqual(scan('const a = "engine_y (processInstanceId 1), engine_z (filter by k)"'), [
      "engine_y.processInstanceId",
      "engine_z.filter",
    ])
    assert.deepEqual(scan('const a = "Use the `engine_old_tool` tool (action \\"list\\")"'), [
      "engine_old_tool.action",
    ])
  })

  it("joins concatenations and reads a conditional fragment as its text branch", () => {
    assert.deepEqual(
      scan('const a = "try engine_list_x(" + `{ maxResults: 1${e ? `, engine: "e"` : ""} })`'),
      ["engine_list_x.maxResults", "engine_list_x.engine"],
    )
    assert.deepEqual(scan("const a = `engine_y(${x ? 1 : `b: ${x}`})`"), ["engine_y.b"])
    // Each side of a conditional is checked in place.
    assert.deepEqual(scan("const a = `engine_y${x ? `({ a: 1 })` : ` (b 2)`}`"), [
      "engine_y.a",
      "engine_y.b",
    ])
  })

  it("inlines a same-file const text, but not a name declared twice", () => {
    const scoped = [
      'const scope = `engine: "${e}", activityId: "${id}"`',
      "const a = `engine_y({ ${scope}, c: 1 })`",
    ].join("\n")
    assert.deepEqual(scan(scoped), ["engine_y.engine", "engine_y.activityId", "engine_y.c"])
    const twice = [
      'function f() { const s = "a: 1" }',
      'const s = "b: 1"',
      "const a = `engine_y({ ${s} })`",
    ].join("\n")
    assert.deepEqual(scan(twice), [`engine_y.${OPAQUE_ARGUMENT}`])
  })

  it("resolves one-line text helpers by name", () => {
    const helperSource = [
      'export function engineArg(id: string) { return id ? `engine: "${id}", ` : "" }',
      'function multi() { const x = 1; return "a" }',
    ].join("\n")
    const helpers = new Map(collectTextHelpers("h.ts", helperSource))
    assert.deepEqual([...helpers.keys()], ["engineArg"])
    const text = "const a = `engine_y({${engineArg(id)}incidentId: '${id}'})`"
    assert.deepEqual(
      findParamRefs("x.ts", text, ["engine"], helpers).map((r) => `${r.tool}.${r.param}`),
      ["engine_y.engine", "engine_y.incidentId"],
    )
  })

  it("reports an argument whose name is an unresolvable interpolation", () => {
    assert.deepEqual(scan("const a = `engine_y({ ${scope}, c: 1 })`"), [
      `engine_y.${OPAQUE_ARGUMENT}`,
      "engine_y.c",
    ])
    assert.deepEqual(scan("const a = `engine_y({${engineArg(id)}incidentId: 1})`"), [
      `engine_y.${OPAQUE_ARGUMENT}`,
    ])
    assert.deepEqual(scan('const a = `engine_y (${id ?? "(none)"})`'), [
      `engine_y.${OPAQUE_ARGUMENT}`,
    ])
    // A placeholder in VALUE position is fine.
    assert.deepEqual(scan('const a = `engine_y(a=${n}, b: "${m}", c ${o})`'), [
      "engine_y.a",
      "engine_y.b",
      "engine_y.c",
    ])
  })

  it("reads prose connectors only for parameter-shaped names", () => {
    assert.deepEqual(
      scan(
        'const a = "engine_x with processDefinitionKey=k; engine_y for instance 1; engine_z with that key"',
      ),
      ["engine_x.processDefinitionKey"],
    )
  })

  it("reads every pair of a prose name=value run", () => {
    assert.deepEqual(
      scan('const a = `analytics_x with a="${k}", b="7d", c=true to get, then: d`'),
      ["analytics_x.a", "analytics_x.b", "analytics_x.c"],
    )
  })

  it("ignores comments, unclosed lists and possessive apostrophes", () => {
    assert.deepEqual(scan("// engine_x(bogus=1)\nconst a = 'engine_y(' "), [])
    assert.deepEqual(scan('const a = "engine_x (the instance\'s incidents)"'), ["engine_x.the"])
  })

  it("reads no metric label or name as a tool: the contract shares the prefix", () => {
    assert.deepEqual(scan('const a = "sum by (engine_id) (engine_jobs_failed)"'), [])
    assert.deepEqual(scan('const a = "max by engine_id(processDefinitionKey)"'), [])
    assert.deepEqual(scan('const a = "engine_jobs_faild (processInstanceId 1)"'), [
      "engine_jobs_faild.processInstanceId",
    ])
  })
})

describe("findToolNameLiterals", () => {
  it("flags string literals only: comments, template expressions and other shapes pass", () => {
    const text = [
      "// the `engine_in_comment_data` feed",
      'const a = "engine_stale_data"',
      "const b = `analytics_feed_data`",
      "const c = `engine_${'x'}`",
      'const e = "engine_Upper"',
    ].join("\n")
    assert.deepEqual(findToolNameLiterals("x.ts", text, ["engine", "analytics"]), [
      { name: "engine_stale_data", at: "x.ts:2" },
      { name: "analytics_feed_data", at: "x.ts:3" },
    ])
  })

  it("passes the contract's metric names and labels, and only those", () => {
    const text = [
      'const a = "engine_id"',
      'const b = "engine_jobs_failed"',
      'const c = "engine_activity_duration_milliseconds_bucket"',
      'const d = "engine_jobs_faild"',
      'const e = "engine_stale_data"',
    ].join("\n")
    assert.deepEqual(findToolNameLiterals("x.ts", text, ["engine", "analytics"]), [
      { name: "engine_jobs_faild", at: "x.ts:4" },
      { name: "engine_stale_data", at: "x.ts:5" },
    ])
  })
})
