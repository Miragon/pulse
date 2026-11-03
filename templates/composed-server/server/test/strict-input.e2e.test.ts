import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"
import { ENGINE_ADMIN_ONLY_TOOLS } from "@miragon/pulse-engine-connector"
import { createApp } from "../src/app.js"
import { MODULES } from "../src/setup.js"
import { stubNeutralEnv } from "./neutral-env.js"

const FIXTURE_JS = path.join(import.meta.dirname, "fixtures", "mcp-app.js")

const PROBE_KEY = "__strictInputProbe"

interface WireTool {
  name: string
  inputSchema: { properties?: Record<string, unknown>; additionalProperties?: unknown }
}

/** One tool, probed once in the first boot that lists it. */
interface ProbedTool {
  tool: WireTool
  /** The `MCP_ACTIVE_MODULES` selection of that boot. */
  selection: string
  isError: boolean
  text: string
}

function errorText(result: unknown): string {
  const content = (result as { content?: Array<{ text?: string }> }).content ?? []
  return content.map((part) => part.text ?? "").join("\n")
}

/**
 * One `MCP_ACTIVE_MODULES` selection per toolset DEPTH: boot `i` runs every
 * composed module on its `i`-th declared toolset (its last one once it has
 * no more; a module without toolsets by its bare name). Together the boots
 * register every tool any toolset registers. The default boot would not: it
 * puts every module on its read-only floor, which hides every write tool
 * above it (an engine write, a destructive registrar tool):
 * exactly the tools where a dropped scoping key hurts most. Derived from
 * `MODULES`, not hand-listed: your module's toolsets are covered the moment
 * it declares them.
 */
function toolsetSelections(): string[] {
  const depth = Math.max(1, ...MODULES.map((module) => module.toolsets?.names.length ?? 1))
  return Array.from({ length: depth }, (_, i) =>
    MODULES.map(({ name, toolsets }) =>
      toolsets ? `${name}:${toolsets.names[Math.min(i, toolsets.names.length - 1)]}` : name,
    ).join(","),
  )
}

/**
 * Boot the composed server on `selection` and probe every tool not probed
 * yet with an unknown key. No toolset grants `engine_create_deployment`
 * on its own: it also needs the `ENGINE_ALLOW_DEPLOYMENTS` opt-in, so the
 * guard sets it.
 */
async function probeBoot(selection: string, probed: Map<string, ProbedTool>): Promise<void> {
  stubNeutralEnv({ MCP_ACTIVE_MODULES: selection, ENGINE_ALLOW_DEPLOYMENTS: "true" })
  const composed = await createApp(process.env, { bundle: { jsPath: FIXTURE_JS } })
  const app = await composed.listen({ port: 0, host: "127.0.0.1" })
  const client = new Client({ name: "strict-input-test", version: "0.0.0" })
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${app.port}/mcp`)),
    )
    const tools = (await client.listTools()).tools as unknown as WireTool[]
    for (const tool of tools) {
      if (probed.has(tool.name)) continue
      const result = await client.callTool({ name: tool.name, arguments: { [PROBE_KEY]: true } })
      probed.set(tool.name, {
        tool,
        selection,
        isError: result.isError === true,
        text: errorText(result),
      })
    }
  } finally {
    await client.close()
    await app.shutdown()
  }
}

/**
 * Strict tool inputs on EVERY listed tool: every composed module's, yours
 * included, on EVERY toolset it declares (see
 * {@link toolsetSelections}). A non-strict input
 * schema lets the server STRIP an unknown key before the handler runs: a
 * misnamed optional filter then silently widens the result and the model
 * never learns. Registrar tools (`createToolRegistrar`) are always strict,
 * raw `server.tool()` registrations take `strictToolInput(shape)` (both from
 * `@miragon/pulse-widget-shell/server`); then an unknown key is a tool error
 * naming the valid keys, which the model fixes in one retry.
 */
describe("strict tool inputs on the wire (every module, every toolset)", () => {
  const selections = toolsetSelections()
  const probed = new Map<string, ProbedTool>()

  beforeAll(async () => {
    for (const selection of selections) await probeBoot(selection, probed)
  }, 30_000 * selections.length)

  afterAll(() => {
    vi.unstubAllEnvs()
  })

  it("boots each module on every toolset it declares", () => {
    for (const { name, toolsets } of MODULES) {
      const booted = selections.map((selection) =>
        selection.split(",").find((entry) => entry.split(":")[0] === name)!,
      )
      const expected = toolsets ? toolsets.names.map((toolset) => `${name}:${toolset}`) : [name]
      expect(new Set(booted), name).toEqual(new Set(expected))
    }
  })

  it("covers the custom notes module next to the Miragon modules, write tools included (the guard is not vacuous)", () => {
    const names = [...probed.keys()]
    expect(names).toEqual(
      expect.arrayContaining(["notes_list_notes", "notes_show_notes", "notes_list_data"]),
    )
    expect(names.some((name) => name.startsWith("engine_"))).toBe(true)
    expect(names.some((name) => name.startsWith("analytics_"))).toBe(true)
    // Registered only above the read-only floor: the floor boot alone never lists them.
    expect(names).toEqual(
      expect.arrayContaining([
        ...ENGINE_ADMIN_ONLY_TOOLS,
        "engine_set_job_retries",
        "engine_resolve_incident",
      ]),
    )
  })

  it("every tool advertises additionalProperties: false", () => {
    const open = [...probed.values()]
      .filter(({ tool }) => tool.inputSchema.additionalProperties !== false)
      .map(({ tool, selection }) => `${tool.name} (${selection})`)
    expect(open, "tools whose advertised input accepts unknown keys").toEqual([])
  })

  it("every tool refuses an unknown key with a tool error naming the valid keys", () => {
    const failures: string[] = []
    for (const { tool, selection, isError, text } of probed.values()) {
      const valid = Object.keys(tool.inputSchema.properties ?? {})
      const named =
        valid.length === 0
          ? text.includes("This tool takes no arguments")
          : valid.every((key) => text.includes(JSON.stringify(key)))
      if (!isError || !text.includes(`Unknown key "${PROBE_KEY}"`) || !named) {
        failures.push(`${tool.name} (${selection}): ${isError ? text : "accepted the call"}`)
      }
    }
    expect(failures).toEqual([])
  })
})
