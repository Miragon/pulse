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
 * (templates/claude-artifact/src/page.config.ts), and a call to a tool it did not declare fails.
 * So each name is a tool the server registers (the admin golden, scripts/tool-surface.mjs), a
 * model tool (an app-only `*_data` feed serves the server's own views, never a page), on the
 * read-only floor (what the server runs without OAuth and every toolset holds) and no view tool
 * (`engine_open_cockpit`'s result is a view a host renders, not data). Each recorded load
 * (templates/claude-artifact/fixtures/*.json) calls only those tools and, together, every one of
 * them, so the declaration is what a load calls, no more. ESLint and tool-name-refs skip
 * templates/: this guard holds the names.
 *
 * The template's tests replay those recordings, so this guard also holds each recorded answer to
 * its tool's output golden and its arguments to its input schema, or a published page breaks.
 */

const TEMPLATE = "templates/claude-artifact"
const TOOLS_FILE = `${TEMPLATE}/src/page.config.ts`
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

// The recorded answers and arguments against the server's goldens.
/** The server's output goldens, recorded in another world, so an answer is held to their shape. */
const OUTPUT_GOLDENS = "apps/mcp-server/test/__golden__/outputs"
/** The page tools no output golden pins, each with why; an entry whose tool has one fails. */
const WITHOUT_OUTPUT_GOLDEN = {
  engine_get_process_definition_xml:
    "answers { id, bpmn20Xml }, which no output golden pins: readDiagram fails loud without bpmn20Xml",
}
/** Objects keyed by data (end event ids), held under `*`; an entry needs a map on both sides. */
const DATA_KEYED_MAPS = { engine_process_stats: ["buckets[].endedAt"] }

const LACKS = "which the output golden lacks: an extra or renamed key, or a map for DATA_KEYED_MAPS"
/** The remedies: an answer or input changed on purpose (golden:update), so the page follows. */
const FOLLOW =
  `adapt ${TEMPLATE}/src/data/process-dashboard.ts, then pnpm record there ` + "against pnpm play"
const CALL_REMEDY = `the server refuses this call of a published page: ${FOLLOW}`
const ANSWER_REMEDY =
  `a published page reading it breaks: ${FOLLOW}, or add the case the recording shows to the ` +
  "golden's world (apps/mcp-server/test/engine-goldens)"

const typeOf = (value) => (value === null ? "null" : Array.isArray(value) ? "array" : typeof value)

/** Each key path's JSON types, elements under `[]`, a listed map's values under `*`. */
function shapeOf(value, maps = [], at = "", shape = new Map()) {
  // A lower-bound count `{ atLeast: n }` is a number: history may cut any count.
  const lowerBound = typeof value?.atLeast === "number" && Object.keys(value).length === 1
  const type = lowerBound ? "number" : typeOf(value)
  shape.set(at, (shape.get(at) ?? new Set()).add(type))
  if (type === "array") value.forEach((each) => shapeOf(each, maps, `${at}[]`, shape))
  const below = (key) => (at ? `${at}.` : "") + (maps.includes(at) ? "*" : key)
  if (type === "object") {
    for (const [key, child] of Object.entries(value)) shapeOf(child, maps, below(key), shape)
  }
  return shape
}

/**
 * What of the `recorded` shape the `golden` lacks, a path or a type. Null matches either side, and
 * below a path the golden lacks, saw only null or only empty, it tells nothing.
 */
function shapeFindings(recorded, golden) {
  const known = (at) => [...(golden.get(at) ?? [])].filter((type) => type !== "null")
  const findings = []
  for (const [at, types] of recorded) {
    if (!golden.has(at)) {
      const parent = at.slice(0, Math.max(at.lastIndexOf("."), 0))
      const open = /(\[\]|\.\*)$/.test(at) || known(parent).length === 0
      if (!open) findings.push(`holds ${at}, ${LACKS}`)
      continue
    }
    const wrong = [...types].filter((type) => type !== "null" && !known(at).includes(type))
    if (known(at).length > 0 && wrong.length > 0) {
      findings.push(
        `holds ${at || "the answer itself"} as ${wrong.join(" or ")}, where the output golden ` +
          `holds ${known(at).join(" or ")}`,
      )
    }
  }
  return findings
}

/**
 * What `args` breaks of its tool's input `schema`: a required key, strict input, a JSON type or an
 * enum, but `engine`'s, which lists the golden's profiles. The root has no JSON Schema validator.
 */
function argumentFindings(args, { properties = {}, required = [] }) {
  if (typeOf(args) !== "object") return [`arguments are ${typeOf(args)}, not an object`]
  const findings = required
    .filter((key) => !Object.hasOwn(args, key))
    .map((key) => `lacks the required ${key}`)
  for (const [key, value] of Object.entries(args)) {
    const { type = [], enum: enums } = properties[key] ?? {}
    const types = [type].flat()
    const own = [typeOf(value), Number.isInteger(value) && "integer"]
    if (!Object.hasOwn(properties, key)) {
      findings.push(`passes ${key}, which the input schema does not take (strict input)`)
    } else if (types.length > 0 && !types.some((each) => own.includes(each))) {
      findings.push(`passes ${key} as ${own[0]}, where the schema takes ${types.join(" or ")}`)
    } else if (enums && key !== "engine" && !enums.includes(value)) {
      findings.push(`passes ${key} ${JSON.stringify(value)}, not one of ${JSON.stringify(enums)}`)
    }
  }
  return findings
}

/** The recorded calls against the server's side; a tool off the floor is pageToolFindings'. */
function recordedFindings(recordings, { goldens, schemas, withoutGolden, dataMaps } = repoSide()) {
  const findings = []
  const recordedMaps = new Set()
  for (const { file, calls } of recordings.filter((each) => Array.isArray(each.calls))) {
    for (const { tool, arguments: args, result } of calls) {
      const argLines = schemas.has(tool) ? argumentFindings(args, schemas.get(tool)) : []
      findings.push(...argLines.map((line) => `${file}: ${tool} ${line}; ${CALL_REMEDY}`))
      if (!goldens.has(tool) && !Object.hasOwn(withoutGolden, tool)) {
        findings.push(
          `${file}: ${tool} has no output golden (${OUTPUT_GOLDENS}/${tool}.json) and ` +
            "WITHOUT_OUTPUT_GOLDEN does not name it, so nothing holds its answer to the server's",
        )
      }
      if (!goldens.has(tool) || result?.structuredContent === undefined) continue
      const maps = dataMaps[tool] ?? []
      const shape = shapeOf(result.structuredContent, maps)
      maps.filter((at) => shape.get(at)?.has("object")).forEach((at) => recordedMaps.add(tool + at))
      const lines = shapeFindings(shape, shapeOf(goldens.get(tool), maps))
      findings.push(...lines.map((line) => `${file}: ${tool}'s answer ${line}; ${ANSWER_REMEDY}`))
    }
  }
  for (const tool of Object.keys(withoutGolden).filter((each) => goldens.has(each))) {
    findings.push(`WITHOUT_OUTPUT_GOLDEN names ${tool}, which has an output golden: drop it`)
  }
  for (const [tool, maps] of Object.entries(dataMaps)) {
    const golden = shapeOf(goldens.get(tool), maps)
    for (const at of maps) {
      const listed = `DATA_KEYED_MAPS lists ${tool} ${at}, where`
      if (!golden.get(at)?.has("object")) findings.push(`${listed} its output golden holds no map`)
      if (!recordedMaps.has(tool + at)) findings.push(`${listed} no recorded answer holds a map`)
    }
  }
  return findings
}

/** The server's side: its output goldens' answers and read-only input schemas, by tool. */
function repoSide() {
  const read = (file) => JSON.parse(readFileSync(path.join(REPO_ROOT, file), "utf8"))
  const tools = readdirSync(path.join(REPO_ROOT, OUTPUT_GOLDENS))
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
  return {
    goldens: new Map(
      tools.map((tool) => [tool, read(`${OUTPUT_GOLDENS}/${tool}.json`).result?.structuredContent]),
    ),
    schemas: new Map(read(READ_ONLY_GOLDEN).map(({ name, inputSchema }) => [name, inputSchema])),
    withoutGolden: WITHOUT_OUTPUT_GOLDEN,
    dataMaps: DATA_KEYED_MAPS,
  }
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
    assert.deepEqual(
      pageToolFindings({
        pageTools,
        surface: fullSurface(),
        appOnly: appOnlyFeeds(),
        readOnly: new Set(repoSide().schemas.keys()),
        recordings: recordingsOf(REPO_ROOT),
      }),
      [],
    )
  })
})

/** Plants violations in the repo's recordings, `expect`ing each finding that `plant` causes. */
function assertBites(remedy, plant) {
  const [side, recordings, expected] = [repoSide(), recordingsOf(REPO_ROOT), []]
  for (const { file, calls } of recordings) {
    for (const call of calls) {
      plant(call, side, (line) => expected.push(`${file}: ${call.tool}${line}; ${remedy}`))
    }
  }
  assert.ok(expected.length > 0, "no recorded call to plant a violation in")
  assert.deepEqual(recordedFindings(recordings, side).sort(), expected.sort())
  return expected
}

describe("artifact-tools: the recorded answers and arguments against the server's goldens", () => {
  it("holds arguments to the input schema: required, strict, typed, in its enum but engine's", () => {
    const schema = {
      properties: {
        engine: { type: "string", enum: ["default"] },
        key: { type: "string" },
        bucket: { type: "string", enum: ["day", "hour"] },
        version: { type: "integer" },
      },
      required: ["key", "bucket"],
    }
    const cases = [
      [{ key: "k", bucket: "day", engine: "playground", version: 2 }, []],
      [undefined, ["arguments are undefined, not an object"]],
      [
        { bucket: "week", timeZone: "Europe/Berlin", version: 1.5, engine: 3 },
        [
          "lacks the required key",
          'passes bucket "week", not one of ["day","hour"]',
          "passes timeZone, which the input schema does not take (strict input)",
          "passes version as number, where the schema takes integer",
          "passes engine as number, where the schema takes string",
        ],
      ],
    ]
    for (const [args, expected] of cases) assert.deepEqual(argumentFindings(args, schema), expected)
  })

  it("holds answers to the golden's shape, values and data keys aside, null a wildcard", () => {
    const golden = {
      items: [{ id: "a", note: null, at: "t" }],
      endedAt: { E1: 0 },
      empty: [],
      now: { running: 1 },
      byId: { a: 1 },
    }
    const answer = {
      items: [{ id: 7, note: { message: "m" }, at: null }],
      endedAt: { E2: 3, E3: { atLeast: 1 }, E4: "x" },
      empty: [{ anything: 1 }],
      now: { runningInstances: 1 },
      byId: { b: 1 },
      extra: { deep: 1 },
    }
    const calls = [
      { tool: "t", result: { structuredContent: answer } },
      { tool: "t", result: { isError: true } },
      { tool: "engine_x" },
      { tool: "engine_w" },
    ]
    const findings = recordedFindings([{ file: "p.json", calls }], {
      goldens: new Map(Object.entries({ t: golden, engine_y: {} })),
      schemas: new Map(),
      withoutGolden: { engine_w: "why", engine_y: "why" },
      dataMaps: { t: ["endedAt", "m"] },
    })
    const where = "where the output golden holds"
    assert.deepEqual(findings, [
      ...[
        `items[].id as number, ${where} string`,
        `endedAt.* as string, ${where} number`,
        `now.runningInstances, ${LACKS}`,
        `byId.b, ${LACKS}`,
        `extra, ${LACKS}`,
      ].map((line) => `p.json: t's answer holds ${line}; ${ANSWER_REMEDY}`),
      `p.json: engine_x has no output golden (${OUTPUT_GOLDENS}/engine_x.json) and ` +
        "WITHOUT_OUTPUT_GOLDEN does not name it, so nothing holds its answer to the server's",
      "WITHOUT_OUTPUT_GOLDEN names engine_y, which has an output golden: drop it",
      "DATA_KEYED_MAPS lists t m, where its output golden holds no map",
      "DATA_KEYED_MAPS lists t m, where no recorded answer holds a map",
    ])
  })

  it("holds in the repo: each recorded answer has its golden's shape, each call's arguments its schema", () => {
    assert.deepEqual(recordedFindings(recordingsOf(REPO_ROOT)), [])
  })

  it("bites on the repo's recordings: a renamed field and an extra key in each answer a golden holds", () => {
    assertBites(ANSWER_REMEDY, ({ tool, result }, { goldens }, expect) => {
      const answer = result?.structuredContent
      if (!goldens.has(tool) || answer === undefined) return
      const [first] = Object.keys(answer)
      Object.assign(answer, { [`${first}Renamed`]: answer[first], plantedExtra: 1 })
      delete answer[first]
      expect(`'s answer holds ${first}Renamed, ${LACKS}`)
      expect(`'s answer holds plantedExtra, ${LACKS}`)
    })
  })

  it("bites on the repo's recordings: a missing required key, an unknown key, a value outside an enum", () => {
    const expected = assertBites(CALL_REMEDY, ({ tool, arguments: args }, { schemas }, expect) => {
      const { required = [], properties = {} } = schemas.get(tool) ?? {}
      delete args[required[0]]
      args.plantedKey = 1
      expect(` lacks the required ${required[0]}`)
      expect(" passes plantedKey, which the input schema does not take (strict input)")
      for (const [key, { enum: options }] of Object.entries(properties)) {
        if (!options || key === "engine" || !Object.hasOwn(args, key)) continue
        args[key] = "plantedOutsideEnum"
        expect(` passes ${key} "plantedOutsideEnum", not one of ${JSON.stringify(options)}`)
      }
    })
    assert.match(expected.join("\n"), /not one of/, "no enum value planted")
  })
})
