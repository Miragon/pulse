import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { bootServer, createTestRuntime, type BootedServer } from "./boot-server.js"

/**
 * `camunda7_open_cockpit` on the wire (#341 K43/N70/N105): the cockpit OPENS
 * on the engine the call resolves — the `engine` argument, else the caller's
 * saved default, else the only engine in the caller's list — and the summary
 * says exactly that. A bad `engine` is a tool error the model can act on,
 * never a silent engine picker under a summary that names the engine anyway.
 */

interface CockpitPayload {
  engineId: string | null
  engines: Array<{ id: string; environment: string }>
}

type CallResult = Awaited<ReturnType<BootedServer["client"]["callTool"]>>

/** The bootstrap the app receives: the view's structuredContent IS its data. */
function bootstrapOf(result: CallResult): CockpitPayload {
  expect(result.isError, JSON.stringify(result.content)).toBeFalsy()
  return result.structuredContent as CockpitPayload
}

const textOf = (result: CallResult) =>
  (result.content as Array<{ text?: string }>).map((c) => c.text ?? "").join("\n")

const ENGINES = ["prod-a", "prod-b", "prod-c"]

describe("camunda7_open_cockpit — the engine the cockpit opens on (createApp)", () => {
  const runtime = createTestRuntime()
  let server: BootedServer
  const open = (args: Record<string, unknown> = {}) =>
    server.client.callTool({ name: "camunda7_open_cockpit", arguments: args })
  /** Alice's camunda7 settings slice, replaced (the record the stub IdP's `alice` resolves to). */
  const aliceSettings = async (camunda7: Record<string, unknown>) => {
    await runtime.profileStore.delete("alice")
    await runtime.profileStore.save("alice", { modules: { camunda7 } })
  }

  beforeAll(async () => {
    server = await bootServer({
      authenticated: true,
      runtime,
      env: {
        CAMUNDA_ENGINES_JSON: JSON.stringify(
          ENGINES.map((id, i) => ({ id, baseUrl: `http://localhost:${i + 1}/engine-rest` })),
        ),
      },
    })
  })

  afterAll(async () => {
    await server?.close()
  })

  it("opens on the `engine` argument — and says so", async () => {
    await aliceSettings({ defaultEngineId: "prod-c" })
    const result = await open({ engine: "prod-b" })
    expect(bootstrapOf(result).engineId).toBe("prod-b")
    expect(textOf(result)).toContain('cockpit for engine "prod-b"')
  })

  it("without one, opens on the caller's saved default", async () => {
    await aliceSettings({ defaultEngineId: "prod-c" })
    const result = await open()
    expect(bootstrapOf(result).engineId).toBe("prod-c")
    expect(textOf(result)).toContain('cockpit for engine "prod-c"')
  })

  it("no default, several engines: the picker, and the summary names no engine", async () => {
    await aliceSettings({})
    const result = await open()
    expect(bootstrapOf(result)).toMatchObject({ engineId: null })
    expect(bootstrapOf(result).engines.map((e) => e.id)).toEqual(ENGINES)
    expect(textOf(result)).toContain("engine picker")
    expect(textOf(result)).not.toMatch(/for engine "/)
  })

  it("an unknown engine is refused as a tool error", async () => {
    const result = await open({ engine: "prod-z" })
    expect(result.isError).toBe(true)
  })

  it("an engine curated out of the caller's list is a tool error naming the list", async () => {
    await aliceSettings({ allowedEngineIds: ["prod-a", "prod-c"] })
    const result = await open({ engine: "prod-b" })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain("[ENGINE_NOT_AVAILABLE]")
    expect(textOf(result)).toContain("the cockpit offers: prod-a, prod-c")

    // The bootstrap lists exactly what camunda7_list_engines lists.
    const listed = await server.client.callTool({ name: "camunda7_list_engines", arguments: {} })
    const engines = (JSON.parse(textOf(listed)) as { engines: Array<{ id: string }> }).engines
    expect(bootstrapOf(await open()).engines.map((e) => e.id)).toEqual(engines.map((e) => e.id))
  })
})
