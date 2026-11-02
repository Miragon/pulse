import assert from "node:assert/strict"
import { before, describe, it } from "node:test"
import ts from "typescript"
import { OPAQUE_ARGUMENT, collectTextHelpers, findParamRefs } from "./prompt-param-refs.mjs"
import { scanSources } from "./source-scan.mjs"
import { fullSurface } from "./tool-surface.mjs"

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

/** String literals (not comments, not template expressions) shaped like a `<prefix>_…` tool name. */
function findToolNameLiterals(file, text, prefixes) {
  const shape = new RegExp(`^(?:${prefixes.join("|")})_[a-z0-9_]+$`)
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const refs = []
  const visit = (node) => {
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      shape.test(node.text)
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
    // Prefixes come from the surface itself: `camunda7_…`, `analytics_…`.
    const prefixes = [...new Set([...tools].flatMap((n) => /^([a-z0-9]+)_/.exec(n)?.[1] ?? []))]
    assert.deepEqual(prefixes.sort(), ["analytics", "camunda7"])
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
    const camunda7Refs = refs
      .filter((r) => r.at.startsWith("packages/connectors/camunda/camunda7-connector/src/widgets/"))
      .map((r) => r.name)
    for (const name of ["analytics_engine_landscape_data", "analytics_bpmn_heatmap_data"]) {
      assert.ok(camunda7Refs.includes(name), name)
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
    assert.ok(quoted.has("camunda7_list_jobs.activityId"))
  })
})

describe("findParamRefs", () => {
  const scan = (text) =>
    findParamRefs("x.ts", text, ["camunda7", "analytics"]).map((r) => `${r.tool}.${r.param}`)

  it("reads call notation: named, object, shorthand and parenthesized prose", () => {
    assert.deepEqual(scan('const a = `analytics_x(a="1", b=${n}) and camunda7_y({ c: 1, d })`'), [
      "analytics_x.a",
      "analytics_x.b",
      "camunda7_y.c",
      "camunda7_y.d",
    ])
    assert.deepEqual(
      scan('const a = "camunda7_y (processInstanceId 1), camunda7_z (filter by k)"'),
      ["camunda7_y.processInstanceId", "camunda7_z.filter"],
    )
    assert.deepEqual(scan('const a = "Use the `camunda7_engine` tool (action \\"list\\")"'), [
      "camunda7_engine.action",
    ])
  })

  it("joins concatenations and reads a conditional fragment as its text branch", () => {
    assert.deepEqual(
      scan('const a = "try camunda7_list_x(" + `{ maxResults: 1${e ? `, engine: "e"` : ""} })`'),
      ["camunda7_list_x.maxResults", "camunda7_list_x.engine"],
    )
    assert.deepEqual(scan("const a = `camunda7_y(${x ? 1 : `b: ${x}`})`"), ["camunda7_y.b"])
    // Each side of a conditional is checked in place.
    assert.deepEqual(scan("const a = `camunda7_y${x ? `({ a: 1 })` : ` (b 2)`}`"), [
      "camunda7_y.a",
      "camunda7_y.b",
    ])
  })

  it("inlines a same-file const text, but not a name declared twice", () => {
    const scoped = [
      'const scope = `engine: "${e}", activityId: "${id}"`',
      "const a = `camunda7_y({ ${scope}, c: 1 })`",
    ].join("\n")
    assert.deepEqual(scan(scoped), ["camunda7_y.engine", "camunda7_y.activityId", "camunda7_y.c"])
    const twice = [
      'function f() { const s = "a: 1" }',
      'const s = "b: 1"',
      "const a = `camunda7_y({ ${s} })`",
    ].join("\n")
    assert.deepEqual(scan(twice), [`camunda7_y.${OPAQUE_ARGUMENT}`])
  })

  it("resolves one-line text helpers by name", () => {
    const helperSource = [
      'export function engineArg(id: string) { return id ? `engine: "${id}", ` : "" }',
      'function multi() { const x = 1; return "a" }',
    ].join("\n")
    const helpers = new Map(collectTextHelpers("h.ts", helperSource))
    assert.deepEqual([...helpers.keys()], ["engineArg"])
    const text = "const a = `camunda7_y({${engineArg(id)}incidentId: '${id}'})`"
    assert.deepEqual(
      findParamRefs("x.ts", text, ["camunda7"], helpers).map((r) => `${r.tool}.${r.param}`),
      ["camunda7_y.engine", "camunda7_y.incidentId"],
    )
  })

  it("reports an argument whose name is an unresolvable interpolation", () => {
    assert.deepEqual(scan("const a = `camunda7_y({ ${scope}, c: 1 })`"), [
      `camunda7_y.${OPAQUE_ARGUMENT}`,
      "camunda7_y.c",
    ])
    assert.deepEqual(scan("const a = `camunda7_y({${engineArg(id)}incidentId: 1})`"), [
      `camunda7_y.${OPAQUE_ARGUMENT}`,
    ])
    assert.deepEqual(scan('const a = `camunda7_y (${id ?? "(none)"})`'), [
      `camunda7_y.${OPAQUE_ARGUMENT}`,
    ])
    // A placeholder in VALUE position is fine.
    assert.deepEqual(scan('const a = `camunda7_y(a=${n}, b: "${m}", c ${o})`'), [
      "camunda7_y.a",
      "camunda7_y.b",
      "camunda7_y.c",
    ])
  })

  it("reads prose connectors only for parameter-shaped names", () => {
    assert.deepEqual(
      scan(
        'const a = "camunda7_x with processDefinitionKey=k; camunda7_y for instance 1; camunda7_z with that key"',
      ),
      ["camunda7_x.processDefinitionKey"],
    )
  })

  it("reads every pair of a prose name=value run", () => {
    assert.deepEqual(
      scan('const a = `analytics_x with a="${k}", b="7d", c=true to get, then: d`'),
      ["analytics_x.a", "analytics_x.b", "analytics_x.c"],
    )
  })

  it("ignores comments, unclosed lists and possessive apostrophes", () => {
    assert.deepEqual(scan("// camunda7_x(bogus=1)\nconst a = 'camunda7_y(' "), [])
    assert.deepEqual(scan('const a = "camunda7_x (the instance\'s incidents)"'), ["camunda7_x.the"])
  })
})

describe("findToolNameLiterals", () => {
  it("flags string literals only: comments, template expressions and other shapes pass", () => {
    const text = [
      "// the `camunda7_in_comment_data` feed",
      'const a = "camunda7_stale_data"',
      "const b = `analytics_feed_data`",
      "const c = `camunda7_${'x'}`",
      'const d = "camunda_engine_id"',
      'const e = "camunda7_Upper"',
    ].join("\n")
    assert.deepEqual(findToolNameLiterals("x.ts", text, ["camunda7", "analytics"]), [
      { name: "camunda7_stale_data", at: "x.ts:2" },
      { name: "analytics_feed_data", at: "x.ts:3" },
    ])
  })
})
