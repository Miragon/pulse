import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { bootServer, type BootedServer } from "./boot-server.js"

/**
 * `camunda7_open_cockpit` on the wire (#341 K43/N70/N105): the cockpit OPENS
 * on the engine the call resolves — the `engine` argument, else the default
 * engine (`CAMUNDA_DEFAULT_ENGINE`), else the only configured engine — and the
 * summary says exactly that. A bad `engine` is a tool error the model can act
 * on, never a silent engine picker under a summary that names the engine anyway.
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
const ENGINES_JSON = JSON.stringify(
  ENGINES.map((id, i) => ({ id, baseUrl: `http://localhost:${i + 1}/engine-rest` })),
)

const opener =
  (server: () => BootedServer) =>
  (args: Record<string, unknown> = {}) =>
    server().client.callTool({ name: "camunda7_open_cockpit", arguments: args })

describe("camunda7_open_cockpit with a default engine (createApp)", () => {
  let server: BootedServer
  const open = opener(() => server)

  beforeAll(async () => {
    server = await bootServer({
      env: { CAMUNDA_ENGINES_JSON: ENGINES_JSON, CAMUNDA_DEFAULT_ENGINE: "prod-c" },
    })
  })

  afterAll(async () => {
    await server?.close()
  })

  it("opens on the `engine` argument — and says so", async () => {
    const result = await open({ engine: "prod-b" })
    expect(bootstrapOf(result).engineId).toBe("prod-b")
    expect(textOf(result)).toContain('cockpit for engine "prod-b"')
  })

  it("without one, opens on the default engine", async () => {
    const result = await open()
    expect(bootstrapOf(result).engineId).toBe("prod-c")
    expect(textOf(result)).toContain('cockpit for engine "prod-c"')
  })

  it("an unknown engine is refused as a tool error", async () => {
    const result = await open({ engine: "prod-z" })
    expect(result.isError).toBe(true)
  })

  it("the bootstrap lists exactly what camunda7_list_engines lists", async () => {
    const listed = await server.client.callTool({ name: "camunda7_list_engines", arguments: {} })
    const engines = (JSON.parse(textOf(listed)) as { engines: Array<{ id: string }> }).engines
    expect(bootstrapOf(await open()).engines.map((e) => e.id)).toEqual(engines.map((e) => e.id))
  })
})

describe("camunda7_open_cockpit without a default engine (createApp)", () => {
  let server: BootedServer
  const open = opener(() => server)

  beforeAll(async () => {
    server = await bootServer({ env: { CAMUNDA_ENGINES_JSON: ENGINES_JSON } })
  })

  afterAll(async () => {
    await server?.close()
  })

  it("no default, several engines: the picker, and the summary names no engine", async () => {
    const result = await open()
    expect(bootstrapOf(result)).toMatchObject({ engineId: null })
    expect(bootstrapOf(result).engines.map((e) => e.id)).toEqual(ENGINES)
    expect(textOf(result)).toContain("engine picker")
    expect(textOf(result)).not.toMatch(/for engine "/)
  })
})
