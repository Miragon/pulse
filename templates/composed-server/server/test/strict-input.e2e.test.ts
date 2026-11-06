import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { Tool } from "@modelcontextprotocol/client"
import { ENGINE_ADMIN_ONLY_TOOLS, engineModule } from "@miragon/pulse-engine-connector"
import { MODULES } from "../src/setup.js"
import { bootComposition, closeComposition, isComposed, toolsetSelections } from "./boot.js"

const PROBE_KEY = "__strictInputProbe"

/** One tool, probed once in the first boot that lists it. */
interface ProbedTool {
  tool: Tool
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
 * Boot the composed server on `selection` and probe every tool not probed
 * yet with an unknown key. No toolset grants `engine_create_deployment`
 * on its own: it also needs the `ENGINE_ALLOW_DEPLOYMENTS` opt-in, so the
 * guard sets it.
 */
async function probeBoot(selection: string, probed: Map<string, ProbedTool>): Promise<void> {
  const booted = await bootComposition({
    MCP_ACTIVE_MODULES: selection,
    ENGINE_ALLOW_DEPLOYMENTS: "true",
  })
  try {
    for (const tool of booted.tools) {
      if (probed.has(tool.name)) continue
      const result = await booted.client.callTool({
        name: tool.name,
        arguments: { [PROBE_KEY]: true },
      })
      probed.set(tool.name, {
        tool,
        selection,
        isError: result.isError === true,
        text: errorText(result),
      })
    }
  } finally {
    await closeComposition(booted)
  }
}

/**
 * Strict tool inputs on EVERY listed tool: every composed module's, yours
 * included, on EVERY toolset it declares (see
 * {@link toolsetSelections}), so the writes above the read-only floor, where
 * a dropped scoping key hurts most, are probed too. A non-strict input
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

  it("probes tools of every composed module (the guard is not vacuous)", () => {
    const names = [...probed.keys()]
    const silent = MODULES.map(({ name }) => name).filter(
      (name) => !names.some((tool) => tool.startsWith(`${name}_`)),
    )
    expect(
      silent,
      "modules in MODULES that listed no tool named <module>_… on any toolset: name a module's " +
        "tools after it (create-module skill, Step 4), and register them in its plugin's " +
        "register. Or the module registers no tool under the tests' neutral env: a plugin with " +
        "no tool, or tools gated on config test/neutral-env.ts does not set (give it a stand-in " +
        "value there, as for ENGINE_BASE_URL)",
    ).toEqual([])
  })

  // Registered only above the read-only floor: the floor boot alone never lists them.
  it.runIf(isComposed(engineModule.name))(
    "probes the engine module's writes above its read-only floor",
    () => {
      expect([...probed.keys()]).toEqual(
        expect.arrayContaining([
          ...ENGINE_ADMIN_ONLY_TOOLS,
          "engine_set_job_retries",
          "engine_resolve_incident",
        ]),
      )
    },
  )

  it("every tool advertises additionalProperties: false", () => {
    const open = [...probed.values()]
      .filter(({ tool }) => tool.inputSchema.additionalProperties !== false)
      .map(({ tool, selection }) => `${tool.name} (${selection})`)
    expect(
      open,
      "tools whose advertised input accepts unknown keys: register plain tools through " +
        "createToolRegistrar, give a raw server.tool() inputSchema: strictToolInput(shape)",
    ).toEqual([])
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
    expect(
      failures,
      "tools that strip an unknown key instead of refusing it: register plain tools through " +
        "createToolRegistrar, give a raw server.tool() inputSchema: strictToolInput(shape)",
    ).toEqual([])
  })
})
