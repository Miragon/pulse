import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { SERVER_INSTRUCTIONS } from "../src/app.js"
import { bootServer, type BootOptions } from "./boot-server.js"
import {
  EXPECTED_TOOLS_ADMIN,
  EXPECTED_TOOLS_OPERATIONS,
  EXPECTED_TOOLS_READ_ONLY,
} from "./expected-tools.js"
import {
  assertCharBudget,
  assertGolden,
  isModelVisible,
  modelVisibleChars,
  repeatedParamDescriptions,
  UPDATE_COMMAND,
  type WireTool,
} from "./golden.js"

/**
 * Golden contract of the LLM-facing tool surface, PER TOOLSET.
 *
 * tools/list IS the API a model reads: every `description`, `title`,
 * `annotations` value, `.describe()` text in `inputSchema`, the
 * `outputSchema` and the full `_meta` (incl. `ui.visibility`, which decides
 * whether a model sees the tool at all) steer every consuming model. The name
 * lists in expected-tools.ts pin WHICH tools a toolset exposes; these goldens
 * pin WHAT each of them says: one sorted JSON file per toolset, so a review
 * sees the exact wire change. A per-toolset character budget (shrink-only via
 * `pnpm lint`) keeps the model-visible text from growing silently: it counts
 * the model-visible tools/list text plus the server instructions this boot
 * sends at initialize, so text moved from a description into the
 * instructions still counts. Each toolset also holds every parameter
 * description to at most two model-visible tools (`repeatedParamDescriptions`).
 * The server instructions, which no toolset filters, may name only tools the
 * same boot gives the model; that check runs first, so a planted name fails
 * there and not in the budget. No module's tool text or instructions name a
 * tool of another module (`crossModuleNames`): the other may be off, and two
 * answers about one engine never point at each other.
 *
 * Intended change: `pnpm --fail-if-no-match --filter @miragon/pulse-mcp-server golden:update`,
 * then commit the JSON diff (refused in CI).
 */

const TOOLSETS: ReadonlyArray<{
  golden: string
  label: string
  options: BootOptions
  names: readonly string[]
}> = [
  {
    golden: "tools-read-only",
    label: "read-only (the unauthenticated default)",
    options: {},
    names: EXPECTED_TOOLS_READ_ONLY,
  },
  // The surface depends on the toolset only: an explicit suffix gives the same one OAuth's
  // default would (that default is the engine module's and the boot's to test, not the app's).
  {
    golden: "tools-operations",
    label: "operations (the default under OAuth)",
    options: { env: { MCP_ACTIVE_MODULES: "engine:operations,analytics" } },
    names: EXPECTED_TOOLS_OPERATIONS,
  },
  {
    golden: "tools-admin",
    label: "admin + deployments (the full surface)",
    options: {
      env: {
        MCP_ACTIVE_MODULES: "engine:admin,analytics",
        ENGINE_ALLOW_DEPLOYMENTS: "true",
      },
    },
    names: EXPECTED_TOOLS_ADMIN,
  },
]

/**
 * The metric names and labels of the metrics contract (`engine_id`, `engine_jobs_failed`): they
 * share the engine module's tool prefix and are no tool. Read by path, like the source guards.
 */
const METRIC_VOCABULARY: ReadonlySet<string> = (() => {
  const contract = JSON.parse(
    fs.readFileSync(
      path.join(
        import.meta.dirname,
        "../../../packages/connectors/analytics/analytics-client/metrics-contract.json",
      ),
      "utf8",
    ),
  ) as { metrics: { promName: string; type: string; labels: string[] }[] }
  return new Set(
    contract.metrics.flatMap(({ promName, type, labels }) => [
      promName,
      ...(type === "histogram" ? ["_bucket", "_sum", "_count"].map((s) => promName + s) : []),
      ...labels,
    ]),
  )
})()

/**
 * The `<module>_…` tool names a text mentions; a family wildcard (`engine_query_historic_*`) and a
 * metric name or label name none.
 */
function toolNamesIn(text: string): string[] {
  const shape = /(?<![A-Za-z0-9_])(?:engine|analytics)_[a-z0-9_]*[a-z0-9](?![A-Za-z0-9_*])/g
  return [...new Set(text.match(shape) ?? [])].filter((name) => !METRIC_VOCABULARY.has(name))
}

/** The module of a tool name: its prefix. */
function moduleOf(name: string): string {
  return name.slice(0, name.indexOf("_"))
}

/**
 * Each mention of another module's tool: in a tool's model-visible text (everything but its name
 * and `_meta`) or in a module's own section of the instructions (`<module> (…` after a blank line).
 */
function crossModuleNames(tools: readonly WireTool[], instructions: string): string[] {
  const inTools = tools.flatMap((tool) => {
    return toolNamesIn(JSON.stringify({ ...tool, name: null, _meta: null }))
      .filter((named) => moduleOf(named) !== moduleOf(tool.name))
      .map((named) => `${tool.name} names ${named}`)
  })
  const inInstructions = instructions.split("\n\n").flatMap((section) => {
    const owner = /^([a-z0-9]+) \(/.exec(section)?.[1]
    if (owner === undefined) return []
    return toolNamesIn(section)
      .filter((named) => moduleOf(named) !== owner)
      .map((named) => `the ${owner} instructions name ${named}`)
  })
  return [...inTools, ...inInstructions]
}

/** What to do when a toolset's tool names differ from its list: the goldens cannot update first. */
const nameListHint = (label: string) =>
  `The ${label} tool names differ from apps/mcp-server/test/expected-tools.ts. If the change is ` +
  "intended, add, move or remove the tool in its tier there (EXPECTED_TOOLS_READ_ONLY: the " +
  "reads; OPERATIONS_ADDS: the writes the operations toolset adds; ADMIN_ADDS: admin only), " +
  `then run ${UPDATE_COMMAND}.`

/** Instruction tool names this boot does not give the model; `floor` keeps the scanner from going blind. */
function namedButNotVisible(instructions: string, tools: readonly WireTool[], floor: number) {
  const named = toolNamesIn(instructions)
  expect(named.length, "the scanner is not blind").toBeGreaterThanOrEqual(floor)
  const visible = new Set(tools.filter(isModelVisible).map((tool) => tool.name))
  return named.filter((name) => !visible.has(name))
}

describe("tools/list golden contract per toolset", () => {
  it.each(TOOLSETS)("$label matches $golden", async ({ golden, label, options, names }) => {
    const server = await bootServer(options)
    try {
      const { tools } = await server.client.listTools()
      const instructions = server.client.getInstructions() ?? ""
      // The playbooks live in the instructions: each names only what this boot registers.
      expect(namedButNotVisible(instructions, tools, 8)).toEqual([])
      // Code-unit order (not localeCompare): byte-stable across machines' ICU locales.
      const sorted = [...tools].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      // The name list is the reviewable summary; the golden the full payload. It runs first, so
      // a new tool stops here until its tier lists it.
      expect(
        sorted.map((t) => t.name),
        nameListHint(label),
      ).toEqual([...names].sort())
      // No parameter description repeats on more than two of this toolset's model-visible tools.
      expect(
        repeatedParamDescriptions(sorted),
        "A parameter that means the same on several tools is explained once in the module " +
          "instructions; describe it on a tool only where it means more there (add-bpm-feature skill).",
      ).toEqual([])
      assertGolden(golden, sorted)
      assertCharBudget(golden, modelVisibleChars(sorted, instructions))
    } finally {
      await server.close()
    }
  })

  it("reports the package.json version, a title and the instructions in module order", async () => {
    const server = await bootServer()
    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(import.meta.dirname, "..", "package.json"), "utf8"),
      ) as { version: string }
      expect(server.client.getServerVersion()).toMatchObject({
        name: "pulse",
        version: pkg.version,
        title: "Pulse",
        websiteUrl: "https://github.com/Miragon/pulse",
      })
      // The root's preamble, then each active module's own snippet.
      const instructions = server.client.getInstructions() ?? ""
      expect(instructions.startsWith(`${SERVER_INSTRUCTIONS}\n\nengine (`)).toBe(true)
      expect(instructions).toContain("\n\nanalytics (Prometheus metrics of the engines):")
    } finally {
      await server.close()
    }
  })

  // The metric names share the prefix; skipping them must not blind the scanner to tools.
  it("reads a metric name or label as no tool, and every other engine_ name as one", () => {
    expect(toolNamesIn("sum by (engine_id) (engine_jobs_failed), then engine_list_jobs")).toEqual([
      "engine_list_jobs",
    ])
    expect(toolNamesIn("engine_jobs_faild")).toEqual(["engine_jobs_faild"])
  })

  it("no module's tool text or instructions name another module's tool", async () => {
    const server = await bootServer(TOOLSETS.at(-1)!.options)
    try {
      const { tools } = await server.client.listTools()
      const instructions = server.client.getInstructions() ?? ""
      expect(
        crossModuleNames(tools, instructions),
        "A module names only its own tools: the other module may be inactive. Say what the " +
          "other answers without its tool name, or move the routing into the composition.",
      ).toEqual([])
      // The scanner is not blind: both modules name their own tools in tool text and instructions.
      const own = tools.flatMap((tool) => toolNamesIn(JSON.stringify({ ...tool, _meta: null })))
      expect(new Set(own.map(moduleOf))).toEqual(new Set(["engine", "analytics"]))
      expect(instructions).toMatch(/\n\nengine \(/)
      expect(instructions).toMatch(/\n\nanalytics \(/)
    } finally {
      await server.close()
    }
  })

  it("finds another module's tool in a tool's text and in a module's instructions", () => {
    const tools: WireTool[] = [
      { name: "analytics_show_x", description: "Find versions with engine_list_jobs." },
      { name: "engine_status", inputSchema: { properties: { a: { description: "analytics_y" } } } },
      {
        name: "engine_open_cockpit",
        description: "Prefer engine_open_cockpit.",
        _meta: { x: "analytics_z" },
      },
    ]
    const instructions = [
      "preamble names engine_a and analytics_b",
      "engine (Camunda):\n- see analytics_engine_health\n- engine_status triages",
      "analytics (Prometheus):\n- not engine_open_cockpit",
    ].join("\n\n")
    expect(crossModuleNames(tools, instructions)).toEqual([
      "analytics_show_x names engine_list_jobs",
      "engine_status names analytics_y",
      "the engine instructions name analytics_engine_health",
      "the analytics instructions name engine_open_cockpit",
    ])
  })

  // The preamble and every module's snippet reach a deployment as one text: without the engine
  // module, none of it may name an engine tool.
  it("without the engine module, the instructions name only the analytics tools this boot lists", async () => {
    const server = await bootServer({ env: { MCP_ACTIVE_MODULES: "analytics" } })
    try {
      const { tools } = await server.client.listTools()
      const instructions = server.client.getInstructions() ?? ""
      expect(namedButNotVisible(instructions, tools, 4)).toEqual([])
    } finally {
      await server.close()
    }
  })
})
