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
 * there and not in the budget.
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
    options: { env: { MCP_ACTIVE_MODULES: "engine:operations" } },
    names: EXPECTED_TOOLS_OPERATIONS,
  },
  {
    golden: "tools-admin",
    label: "admin + deployments (the full surface)",
    options: {
      env: {
        MCP_ACTIVE_MODULES: "engine:admin",
        ENGINE_ALLOW_DEPLOYMENTS: "true",
      },
    },
    names: EXPECTED_TOOLS_ADMIN,
  },
]

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
  it.each(TOOLSETS)("$label matches $golden", async ({ golden, label, options, names }) => {
    const server = await bootServer(options)
    try {
      const { tools } = await server.client.listTools()
      const instructions = server.client.getInstructions() ?? ""
      // The playbooks live in the instructions: each names only what this boot registers.
      expect(namedButNotVisible(instructions, tools, 5)).toEqual([])
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
    } finally {
      await server.close()
    }
  })
})
