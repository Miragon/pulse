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
 * there and not in the budget.
 *
 * Intended change: `GOLDEN_UPDATE=1 pnpm --filter @miragon/pulse-mcp-server test`,
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

/** Instruction tool names this boot does not give the model; `floor` keeps the scanner from going blind. */
function namedButNotVisible(instructions: string, tools: readonly WireTool[], floor: number) {
  const named = toolNamesIn(instructions)
  expect(named.length, "the scanner is not blind").toBeGreaterThanOrEqual(floor)
  const visible = new Set(tools.filter(isModelVisible).map((tool) => tool.name))
  return named.filter((name) => !visible.has(name))
}

describe("tools/list golden contract per toolset", () => {
  it.each(TOOLSETS)("$label matches $golden", async ({ golden, options, names }) => {
    const server = await bootServer(options)
    try {
      const { tools } = await server.client.listTools()
      const instructions = server.client.getInstructions() ?? ""
      // The playbooks live in the instructions: each names only what this boot registers.
      expect(namedButNotVisible(instructions, tools, 8)).toEqual([])
      // Code-unit order (not localeCompare): byte-stable across machines' ICU locales.
      const sorted = [...tools].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      // The name list is the reviewable summary; the golden the full payload.
      expect(sorted.map((t) => t.name)).toEqual([...names].sort())
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
