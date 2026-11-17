import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { SERVER_INSTRUCTIONS } from "../src/app.js"
import { bootServer, type BootOptions } from "./boot-server.js"
import {
  EXPECTED_TOOLS_ADMIN,
  EXPECTED_TOOLS_CAMUNDA_8,
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
 * there and not in the budget. Per configuration too: the golden boot's one
 * Camunda 7 engine (`tools-<toolset>`), that engine beside a Camunda 8 one
 * (`tools-mixed-<toolset>`) and a Camunda 8 engine alone (`tools-c8-<toolset>`),
 * since the boot registers what a configured engine's dialect is served by.
 *
 * Intended change: `pnpm --fail-if-no-match --filter @miragon/pulse-mcp-server golden:update`,
 * then commit the JSON diff (refused in CI).
 */

interface Surface {
  golden: string
  label: string
  options: BootOptions
  names: readonly string[]
  /** How many tool names the instructions name at least: the scanner is not blind. */
  floor: number
}

/** Each toolset's suffix: the surface depends on the toolset only (OAuth's default is the boot's). */
const SUFFIXES = [
  { toolset: "read-only", label: "read-only (the unauthenticated default)", env: {} },
  {
    toolset: "operations",
    label: "operations (the default under OAuth)",
    env: { MCP_ACTIVE_MODULES: "engine:operations" },
  },
  {
    toolset: "admin",
    label: "admin + deployments (the full surface)",
    env: { MCP_ACTIVE_MODULES: "engine:admin", ENGINE_ALLOW_DEPLOYMENTS: "true" },
  },
] as const

/** The tool names of each toolset on a Camunda 7 engine. */
const NAMES: Readonly<Record<(typeof SUFFIXES)[number]["toolset"], readonly string[]>> = {
  "read-only": EXPECTED_TOOLS_READ_ONLY,
  operations: EXPECTED_TOOLS_OPERATIONS,
  admin: EXPECTED_TOOLS_ADMIN,
}

/**
 * The engines of each configuration: the golden boot's single Camunda 7 engine, that engine beside
 * a Camunda 8 one (`mixed`: every tool, its `engine` enum the engines it serves) and a Camunda 8
 * engine alone (`c8`: the four that serve it, in every toolset). Each pins its own goldens and
 * char budgets; the dead loopback port is never asked.
 */
const CONFIGURATIONS = [
  { prefix: "tools", env: {}, names: (toolset: keyof typeof NAMES) => NAMES[toolset], floor: 5 },
  {
    prefix: "tools-mixed",
    env: {
      ENGINE_BASE_URL: undefined,
      ENGINES_JSON: JSON.stringify({
        profiles: {
          default: { url: "http://localhost:1" },
          c8: { url: "http://localhost:1/v2", flavor: "camunda8" },
        },
      }),
    },
    names: (toolset: keyof typeof NAMES) => NAMES[toolset],
    floor: 5,
  },
  {
    prefix: "tools-c8",
    env: {
      ENGINE_BASE_URL: undefined,
      ENGINES_JSON: JSON.stringify({
        profiles: { c8: { url: "http://localhost:1/v2", flavor: "camunda8" } },
      }),
    },
    names: () => EXPECTED_TOOLS_CAMUNDA_8,
    floor: 2,
  },
] as const

const TOOLSETS: readonly Surface[] = CONFIGURATIONS.flatMap((configuration) =>
  SUFFIXES.map(({ toolset, label, env }) => ({
    golden: `${configuration.prefix}-${toolset}`,
    label: configuration.prefix === "tools" ? label : `${label}, ${configuration.prefix}`,
    options: { env: { ...configuration.env, ...env } },
    names: configuration.names(toolset),
    floor: configuration.floor,
  })),
)

/** The engine tool names a text mentions; a family wildcard (`engine_query_historic_*`) none. */
function toolNamesIn(text: string): string[] {
  const shape = /(?<![A-Za-z0-9_])engine_[a-z0-9_]*[a-z0-9](?![A-Za-z0-9_*])/g
  return [...new Set(text.match(shape) ?? [])]
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
  it.each(TOOLSETS)("$label matches $golden", async ({ golden, label, options, names, floor }) => {
    const server = await bootServer(options)
    try {
      const { tools } = await server.client.listTools()
      const instructions = server.client.getInstructions() ?? ""
      // The playbooks live in the instructions: each names only what this boot registers.
      expect(namedButNotVisible(instructions, tools, floor)).toEqual([])
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

  // A Camunda 8 engine beside a Camunda 7 one adds one sentence to the instructions: what reads
  // it, that the rest neither offer it nor take it as the default. A second boot measures what the
  // sentence adds, held by its own shrink-only budget as the toolsets' are: the same engine ids,
  // the second once of each dialect. (The mixed goldens' budgets hold it too, with their enums.)
  it("pins the characters a Camunda 8 engine adds to the instructions (instructions-camunda8)", async () => {
    const instructionsOf = async (flavor: string, url: string) => {
      const server = await bootServer({
        env: {
          ENGINE_BASE_URL: undefined,
          ENGINES_JSON: JSON.stringify({
            profiles: { default: { url: "http://localhost:1" }, second: { url, flavor } },
          }),
        },
      })
      try {
        const instructions = server.client.getInstructions() ?? ""
        const { tools } = await server.client.listTools()
        expect(namedButNotVisible(instructions, tools, 5)).toEqual([])
        return instructions
      } finally {
        await server.close()
      }
    }
    const c7 = await instructionsOf("camunda7", "http://localhost:1/engine-rest")
    const c8 = await instructionsOf("camunda8", "http://localhost:1/v2")
    const added = c8.split("\n").filter((line) => !c7.split("\n").includes(line))
    expect(added).toHaveLength(1)
    expect(added[0]).toMatch(/^- Camunda 8 engines .*ENGINE_DIALECT_NOT_SERVED/)
    expect(c8.replace(`${added[0]}\n`, "")).toBe(c7)
    assertCharBudget("instructions-camunda8", c8.length - c7.length)
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
    } finally {
      await server.close()
    }
  })
})
