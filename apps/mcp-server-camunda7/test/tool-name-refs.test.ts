import ts from "typescript"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { bootServer, listToolNames, type BootedServer } from "./boot-server.js"
import {
  OPAQUE_ARGUMENT,
  collectTextHelpers,
  findParamRefs,
  type ParamRef,
} from "./prompt-param-refs.js"
import { scanSources } from "./source-scan.js"

/**
 * Raw tool-name references vs the composed tool surface (#322 N187).
 *
 * Modules never import each other (CLAUDE.md invariant 8), so a widget that
 * needs another module's feed names it by raw string — the tier-2 pattern
 * (`analytics-probe.ts` → `analytics_settings_data`, `process-incidents/
 * flow.tsx` → `analytics_bpmn_heatmap_data`). Graceful degradation then
 * HIDES a stale name at runtime: the fleet view is silently never offered,
 * the heatmap overlay silently absent — and the module's own tests stub the
 * same stale literal. Only the app sees every module at once, so this is
 * where the names are checked: every `<module>_…` string literal in any
 * package's or app's non-test source must name a tool of the full surface —
 * the shell's own tools (`shell_…`, widget-shell's settings contract, which
 * `ProfileGate` reads the language from in every view) included.
 */

interface ToolNameRef {
  name: string
  /** Repo-relative `file:line`. */
  at: string
}

/** String literals (not comments, not template expressions) shaped like a `<prefix>_…` tool name. */
function findToolNameLiterals(
  file: string,
  text: string,
  prefixes: readonly string[],
): ToolNameRef[] {
  const shape = new RegExp(`^(?:${prefixes.join("|")})_[a-z0-9_]+$`)
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const refs: ToolNameRef[] = []
  const visit = (node: ts.Node) => {
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
  let server: BootedServer
  let tools: Set<string>
  /** Advertised input-schema property names per tool. */
  let toolParams: Map<string, string[]>
  let refs: ToolNameRef[]
  let paramRefs: ParamRef[]

  beforeAll(async () => {
    // The full surface: every module, admin toolset, deployments, builder.
    server = await bootServer({
      authenticated: true,
      env: {
        MCP_ACTIVE_MODULES: "camunda7:admin,analytics:standard",
        CAMUNDA_ALLOW_DEPLOYMENTS: "true",
      },
    })
    const names = await listToolNames(server.client)
    tools = new Set(names)
    const { tools: listed } = await server.client.listTools()
    toolParams = new Map(
      listed.map((tool) => [tool.name, Object.keys(tool.inputSchema.properties ?? {})]),
    )
    // Prefixes come from the surface itself: `camunda7_…`, `analytics_…`, `shell_…`.
    const prefixes = [...new Set(names.flatMap((n) => /^([a-z0-9]+)_/.exec(n)?.[1] ?? []))]
    expect(prefixes.sort()).toEqual(["analytics", "camunda7", "shell"])
    // Every app is read for the literals, an interface app (a CLI, an editor
    // extension) included: where it names a tool, that tool must exist.
    refs = scanSources((file, text) => findToolNameLiterals(file, text, prefixes))
    // One-line text helpers (`engineArg`) resolve by name across the sources;
    // a name declared twice is ambiguous and stays a placeholder. The helpers
    // and the parameters quoted with them are read over the packages and the
    // MCP server apps only (scope "mcp"), so a CLI helper that happens to share
    // a server helper's name cannot turn a server prompt's check opaque.
    const helperDecls = scanSources(collectTextHelpers, { scope: "mcp" })
    const helperNames = helperDecls.map(([name]) => name)
    const helpers = new Map(
      helperDecls.filter(([name]) => helperNames.indexOf(name) === helperNames.lastIndexOf(name)),
    )
    paramRefs = scanSources((file, text) => findParamRefs(file, text, prefixes, helpers), {
      scope: "mcp",
    })
  })

  afterAll(async () => {
    await server?.close()
  })

  it("every `<module>_…` literal in app and package sources is a registered tool", () => {
    const stale = refs.filter((ref) => !tools.has(ref.name)).map((r) => `${r.name} (${r.at})`)
    expect(
      stale,
      "A source names a tool the composed server does not register — renamed or removed? " +
        "Fix the literal (a cross-module reference degrades SILENTLY at runtime).",
    ).toEqual([])
  })

  it("sees the tier-2 cross-module references (the scanner is not blind)", () => {
    const camunda7Refs = refs
      .filter((r) => r.at.startsWith("packages/connectors/camunda/camunda7-connector/src/widgets/"))
      .map((r) => r.name)
    expect(camunda7Refs).toEqual(
      expect.arrayContaining(["analytics_settings_data", "analytics_bpmn_heatmap_data"]),
    )
  })

  it("sees the shell's settings contract (the core package is scanned too)", () => {
    const shellRefs = refs
      .filter((r) => r.at.startsWith("packages/core/widget-shell/src/shell-settings-contract.ts:"))
      .map((r) => r.name)
    expect(shellRefs).toEqual(["shell_show_settings", "shell_settings_data", "shell_save_settings"])
  })

  // #329: a prompt that tells the model to pass a filter the tool does not
  // take used to produce a silently UNFILTERED answer; with strict inputs it
  // is a refused call. Either way the prompt is wrong — caught here.
  it("every parameter a prompt or description quotes for a tool is one that tool takes", () => {
    const wrong = paramRefs
      .filter((ref) => !toolParams.get(ref.tool)?.includes(ref.param))
      .map(
        (ref) =>
          `${ref.tool}(${ref.param}) at ${ref.at} — takes: ${
            toolParams.get(ref.tool)?.join(", ") ?? "(no such tool)"
          }`,
      )
    expect(
      wrong,
      "A source quotes a parameter the named tool does not advertise — fix the prompt " +
        "(parentheses right after a tool name are read as its arguments). " +
        `${OPAQUE_ARGUMENT} is an argument whose NAME is interpolated: write the parameter ` +
        "names literally so they can be checked.",
    ).toEqual([])
  })

  // The Ask-AI hand-offs and the widget model contexts (analytics' model
  // descriptions included) no longer quote parameters as prose — their ids
  // are typed (`hand-off-surface.test.ts` checks them per surface); what is
  // left here are the tool descriptions and the server instructions.
  it("sees the parameters the instructions and descriptions quote (the scanner is not blind)", () => {
    const quoted = new Set(paramRefs.map((ref) => `${ref.tool}.${ref.param}`))
    expect([...quoted]).toEqual(
      expect.arrayContaining([
        // instructions.ts: the cluster scope of the guarded retry
        "camunda7_list_jobs.activityId",
      ]),
    )
  })
})

describe("findParamRefs", () => {
  const scan = (text: string) =>
    findParamRefs("x.ts", text, ["camunda7", "analytics"]).map((r) => `${r.tool}.${r.param}`)

  it("reads call notation: named, object, shorthand and parenthesized prose", () => {
    expect(scan('const a = `analytics_x(a="1", b=${n}) and camunda7_y({ c: 1, d })`')).toEqual([
      "analytics_x.a",
      "analytics_x.b",
      "camunda7_y.c",
      "camunda7_y.d",
    ])
    expect(scan('const a = "camunda7_y (processInstanceId 1), camunda7_z (filter by k)"')).toEqual([
      "camunda7_y.processInstanceId",
      "camunda7_z.filter",
    ])
    expect(scan('const a = "Use the `camunda7_engine` tool (action \\"list\\")"')).toEqual([
      "camunda7_engine.action",
    ])
  })

  it("joins concatenations and reads a conditional fragment as its text branch", () => {
    expect(
      scan('const a = "try camunda7_list_x(" + `{ maxResults: 1${e ? `, engine: "e"` : ""} })`'),
    ).toEqual(["camunda7_list_x.maxResults", "camunda7_list_x.engine"])
    expect(scan("const a = `camunda7_y(${x ? 1 : `b: ${x}`})`")).toEqual(["camunda7_y.b"])
    // Each side of a conditional is checked in place.
    expect(scan("const a = `camunda7_y${x ? `({ a: 1 })` : ` (b 2)`}`")).toEqual([
      "camunda7_y.a",
      "camunda7_y.b",
    ])
  })

  it("inlines a same-file const text, but not a name declared twice", () => {
    const scoped = [
      'const scope = `engine: "${e}", activityId: "${id}"`',
      "const a = `camunda7_y({ ${scope}, c: 1 })`",
    ].join("\n")
    expect(scan(scoped)).toEqual(["camunda7_y.engine", "camunda7_y.activityId", "camunda7_y.c"])
    const twice = [
      'function f() { const s = "a: 1" }',
      'const s = "b: 1"',
      "const a = `camunda7_y({ ${s} })`",
    ].join("\n")
    expect(scan(twice)).toEqual([`camunda7_y.${OPAQUE_ARGUMENT}`])
  })

  it("resolves one-line text helpers by name", () => {
    const helperSource = [
      'export function engineArg(id: string) { return id ? `engine: "${id}", ` : "" }',
      'function multi() { const x = 1; return "a" }',
    ].join("\n")
    const helpers = new Map(collectTextHelpers("h.ts", helperSource))
    expect([...helpers.keys()]).toEqual(["engineArg"])
    const text = "const a = `camunda7_y({${engineArg(id)}incidentId: '${id}'})`"
    expect(
      findParamRefs("x.ts", text, ["camunda7"], helpers).map((r) => `${r.tool}.${r.param}`),
    ).toEqual(["camunda7_y.engine", "camunda7_y.incidentId"])
  })

  it("reports an argument whose name is an unresolvable interpolation", () => {
    expect(scan("const a = `camunda7_y({ ${scope}, c: 1 })`")).toEqual([
      `camunda7_y.${OPAQUE_ARGUMENT}`,
      "camunda7_y.c",
    ])
    expect(scan("const a = `camunda7_y({${engineArg(id)}incidentId: 1})`")).toEqual([
      `camunda7_y.${OPAQUE_ARGUMENT}`,
    ])
    expect(scan('const a = `camunda7_y (${id ?? "(none)"})`')).toEqual([
      `camunda7_y.${OPAQUE_ARGUMENT}`,
    ])
    // A placeholder in VALUE position is fine.
    expect(scan('const a = `camunda7_y(a=${n}, b: "${m}", c ${o})`')).toEqual([
      "camunda7_y.a",
      "camunda7_y.b",
      "camunda7_y.c",
    ])
  })

  it("reads prose connectors only for parameter-shaped names", () => {
    expect(
      scan(
        'const a = "camunda7_x with processDefinitionKey=k; camunda7_y for instance 1; camunda7_z with that key"',
      ),
    ).toEqual(["camunda7_x.processDefinitionKey"])
  })

  it("reads every pair of a prose name=value run", () => {
    expect(scan('const a = `analytics_x with a="${k}", b="7d", c=true to get, then: d`')).toEqual([
      "analytics_x.a",
      "analytics_x.b",
      "analytics_x.c",
    ])
  })

  it("ignores comments, unclosed lists and possessive apostrophes", () => {
    expect(scan("// camunda7_x(bogus=1)\nconst a = 'camunda7_y(' ")).toEqual([])
    expect(scan('const a = "camunda7_x (the instance\'s incidents)"')).toEqual(["camunda7_x.the"])
  })
})

describe("findToolNameLiterals", () => {
  it("flags string literals only — comments, template expressions and other shapes pass", () => {
    const text = [
      "// the `camunda7_in_comment_data` feed",
      'const a = "camunda7_stale_data"',
      "const b = `analytics_feed_data`",
      "const c = `camunda7_${'x'}`",
      'const d = "camunda_engine_id"',
      'const e = "camunda7_Upper"',
    ].join("\n")
    expect(findToolNameLiterals("x.ts", text, ["camunda7", "analytics"])).toEqual([
      { name: "camunda7_stale_data", at: "x.ts:2" },
      { name: "analytics_feed_data", at: "x.ts:3" },
    ])
  })
})
