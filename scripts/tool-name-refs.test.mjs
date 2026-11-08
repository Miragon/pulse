import assert from "node:assert/strict"
import { before, describe, it } from "node:test"
import ts from "typescript"
import { scanSources } from "./source-scan.mjs"
import { fullSurface } from "./tool-surface.mjs"

/**
 * Raw tool-name references vs the full tool surface (#322 N187).
 *
 * Modules never import each other (CLAUDE.md invariant 8), so a widget that needed another
 * module's feed would name it by raw string, and graceful degradation would then HIDE a stale
 * name at runtime: the offer behind it is silently never shown, and the module's own tests stub
 * the same stale literal. So every `<module>_…` string literal in a package's or an MCP server
 * app's non-test source must name a tool of the full surface (the admin golden). The engine
 * module names none of another module: its cockpit reads the engines itself.
 */

/**
 * String literals (not comments, not template expressions) shaped like a `<prefix>_…` tool name;
 * every one must be a tool.
 */
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

describe("raw tool-name literals name real tools (full surface)", () => {
  let tools
  let refs

  before(() => {
    const surface = fullSurface()
    tools = new Set(surface.map((tool) => tool.name))
    // Prefixes come from the surface itself: `engine_…`.
    const prefixes = [...new Set([...tools].flatMap((n) => /^([a-z0-9]+)_/.exec(n)?.[1] ?? []))]
    assert.deepEqual(prefixes.sort(), ["engine"])
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

  it("sees the engine module's own names (the scanner is not blind)", () => {
    const engineRefs = refs
      .filter((r) => r.at.startsWith("packages/connectors/engine/engine-connector/src/"))
      .map((r) => r.name)
    assert.ok(engineRefs.includes("engine_job_backlog_data"), "the scan found no engine feed")
  })
})

describe("findToolNameLiterals", () => {
  it("flags string literals only: comments, template expressions and other shapes pass", () => {
    const text = [
      "// the `engine_in_comment_data` feed",
      'const a = "engine_stale_data"',
      "const b = `notes_feed_data`",
      "const c = `engine_${'x'}`",
      'const e = "engine_Upper"',
    ].join("\n")
    assert.deepEqual(findToolNameLiterals("x.ts", text, ["engine", "notes"]), [
      { name: "engine_stale_data", at: "x.ts:2" },
      { name: "notes_feed_data", at: "x.ts:3" },
    ])
  })
})
