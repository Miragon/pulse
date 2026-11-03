import assert from "node:assert/strict"
import { before, describe, it } from "node:test"
import ts from "typescript"
import { scanSources } from "./source-scan.mjs"
import { fullSurface, metricVocabulary } from "./tool-surface.mjs"

/**
 * Raw tool-name references vs the full tool surface (#322 N187).
 *
 * Modules never import each other (CLAUDE.md invariant 8), so a widget that needs another
 * module's feed names it by raw string (`analytics-probe.ts` → `analytics_engine_landscape_data`,
 * the probe behind every analytics offer). Graceful degradation then HIDES a stale name at
 * runtime: the fleet's landscape and the process flow's heatmap modes are silently never offered,
 * and the module's own tests stub the same stale literal. So every `<module>_…` string literal in
 * a package's or an MCP server app's non-test source must name a tool of the full surface (the
 * admin golden). Another module's widget is rendered by its host-widget id instead, which the
 * app's `view-registry.test.ts` holds to a registered host widget.
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

describe("raw tool-name literals name real tools (full surface)", () => {
  let tools
  let refs

  before(() => {
    const surface = fullSurface()
    tools = new Set(surface.map((tool) => tool.name))
    // Prefixes come from the surface itself: `engine_…`, `analytics_…`.
    const prefixes = [...new Set([...tools].flatMap((n) => /^([a-z0-9]+)_/.exec(n)?.[1] ?? []))]
    assert.deepEqual(prefixes.sort(), ["analytics", "engine"])
    refs = scanSources((file, text) => findToolNameLiterals(file, text, prefixes))
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

  it("sees the raw cross-module references (the scanner is not blind), and only the probe", () => {
    const engineRefs = refs
      .filter((r) => r.at.startsWith("packages/connectors/engine/engine-connector/src/widgets/"))
      .map((r) => r.name)
    // The one raw analytics name in the engine's widgets: the probe. The heat values are
    // analytics' own, read by its `analytics:process-heatmap` host widget; a raw feed name here is
    // a cross-module payload the engine would re-declare without a compile error.
    const analyticsRefs = [...new Set(engineRefs.filter((name) => name.startsWith("analytics_")))]
    assert.deepEqual(analyticsRefs, ["analytics_engine_landscape_data"])
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
