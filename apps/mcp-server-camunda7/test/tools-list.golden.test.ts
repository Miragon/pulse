import { describe, expect, it } from "vitest"
import { bootServer, type BootOptions } from "./boot-server.js"
import {
  EXPECTED_TOOLS_ADMIN,
  EXPECTED_TOOLS_OPERATIONS,
  EXPECTED_TOOLS_READ_ONLY,
} from "./expected-tools.js"
import { assertCharBudget, assertGolden, modelVisibleChars } from "./golden.js"

/**
 * Golden contract of the LLM-facing tool surface, PER TOOLSET.
 *
 * tools/list IS the API a model reads: every `description`, `title`,
 * `annotations` value, `.describe()` text in `inputSchema`, the
 * `outputSchema` and the full `_meta` (incl. `ui.visibility`, which decides
 * whether a model sees the tool at all) steer every consuming model. The name
 * lists in expected-tools.ts pin WHICH tools a toolset exposes; these goldens
 * pin WHAT each of them says — one sorted JSON file per toolset, so a review
 * sees the exact wire change. A per-golden character budget (shrink-only via
 * `pnpm lint`) keeps the model-visible text from growing silently.
 *
 * Intended change: `GOLDEN_UPDATE=1 pnpm --filter @miragon/pulse-mcp-server-camunda7 test`,
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
  {
    golden: "tools-operations",
    label: "operations (the default under OAuth)",
    options: { authenticated: true },
    names: EXPECTED_TOOLS_OPERATIONS,
  },
  {
    golden: "tools-admin",
    label: "admin + deployments under OAuth (the full surface)",
    options: {
      authenticated: true,
      env: {
        MCP_ACTIVE_MODULES: "camunda7:admin,analytics",
        CAMUNDA_ALLOW_DEPLOYMENTS: "true",
      },
    },
    names: EXPECTED_TOOLS_ADMIN,
  },
]

describe("tools/list golden contract per toolset", () => {
  it.each(TOOLSETS)("$label matches $golden", async ({ golden, options, names }) => {
    const server = await bootServer(options)
    try {
      const { tools } = await server.client.listTools()
      // Code-unit order (not localeCompare): byte-stable across machines' ICU locales.
      const sorted = [...tools].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      // The name list is the reviewable summary; the golden the full payload.
      expect(sorted.map((t) => t.name)).toEqual([...names].sort())
      assertGolden(golden, sorted)
      assertCharBudget(golden, modelVisibleChars(sorted))
    } finally {
      await server.close()
    }
  })
})
