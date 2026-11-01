import { describe, expect, it, vi } from "vitest"
import type { MCPServer } from "mcp-use"
import type { Client } from "@miragon/pulse-camunda7-client"
import { DEFAULT_HEALTH_THRESHOLDS } from "../data/health-data.js"
import { createEngineRegistry, type EngineEntry } from "../lib/resolve-engine.js"
import { CAMUNDA7_OPEN_COCKPIT } from "../tool-names.js"
import { engineParamShape } from "../lib/with-engine.js"
import { registerCockpitWidgetTools } from "./cockpit.js"

interface CockpitResult {
  isError?: boolean
  structuredContent?: Record<string, unknown>
  content: Array<{ type: string; text: string }>
}

type Handler = (args: Record<string, unknown>, ctx?: unknown) => Promise<CockpitResult>

function openCockpit(engines: EngineEntry[], defaultEngineId?: string): Handler {
  const tool = vi.fn()
  registerCockpitWidgetTools({
    server: { tool } as unknown as MCPServer,
    registry: createEngineRegistry(engines, (e) => ({ __engine: e.id }) as unknown as Client, {
      defaultEngineId,
    }),
    healthThresholds: DEFAULT_HEALTH_THRESHOLDS,
    toolset: "read-only",
    modelTools: () => [],
    engineParam: engineParamShape,
  })
  const call = tool.mock.calls.find(
    ([definition]) => (definition as { name: string }).name === CAMUNDA7_OPEN_COCKPIT,
  )
  expect(call).toBeDefined()
  return call![1] as Handler
}

const dataOf = (result: CockpitResult) => result.structuredContent!
const textOf = (result: CockpitResult) => result.content.map((c) => c.text).join("\n")

const THREE: EngineEntry[] = [
  { id: "alpha", baseUrl: "http://alpha.internal/engine-rest" },
  { id: "beta", baseUrl: "http://beta.internal/engine-rest" },
  { id: "gamma", baseUrl: "http://gamma.internal/engine-rest" },
]
const ALL = THREE.map((e) => ({ id: e.id, environment: "default" }))

describe("camunda7_open_cockpit — the cockpit bootstrap", () => {
  it("hands the app each engine's id and environment — never its internal REST baseUrl", async () => {
    const handler = openCockpit([
      { id: "alpha", baseUrl: "http://alpha.internal:8410/engine-rest", environment: "prod" },
      { id: "beta", baseUrl: "http://beta.internal:8410/engine-rest" },
    ])
    const result = await handler({})
    const data = dataOf(result)
    expect(data).toEqual({
      engineId: null,
      engines: [
        { id: "alpha", environment: "prod" },
        { id: "beta", environment: "default" },
      ],
    })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain("engine-rest")
    expect(serialized).not.toContain(".internal")
  })

  it("lands on the only engine when exactly one is configured", async () => {
    const handler = openCockpit([{ id: "solo", baseUrl: "http://solo.internal/engine-rest" }])
    const data = dataOf(await handler({}))
    expect(data).toEqual({ engineId: "solo", engines: [{ id: "solo", environment: "default" }] })
  })
})

/** #341: the summary never names an engine the user is not looking at. */
describe("camunda7_open_cockpit — the engine it opens on", () => {
  it("honours the `engine` argument", async () => {
    const result = await openCockpit(THREE)({ engine: "beta" })
    expect(result.isError).toBeUndefined()
    expect(dataOf(result)).toEqual({ engineId: "beta", engines: ALL })
    expect(textOf(result)).toContain('cockpit for engine "beta"')
  })

  it("an unknown `engine` is a tool error — never a silent picker", async () => {
    const result = await openCockpit(THREE)({ engine: "delta" })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(
      '[UNKNOWN_ENGINE] Unknown engine id "delta". Available: alpha, beta, gamma.',
    )
  })

  it("opens on the default engine", async () => {
    const result = await openCockpit(THREE, "gamma")({})
    expect(dataOf(result)).toEqual({ engineId: "gamma", engines: ALL })
    expect(textOf(result)).toBe(
      'Operations cockpit for engine "gamma" (3 configured engine(s)). Where the host shows the view, the user navigates the process landscape in it.',
    )
  })

  it("an explicit `engine` beats the default engine", async () => {
    const handler = openCockpit(THREE, "gamma")
    expect(dataOf(await handler({ engine: "alpha" }))).toMatchObject({ engineId: "alpha" })
  })

  it("several engines, no default: the picker, and the summary says so", async () => {
    const result = await openCockpit(THREE)({})
    expect(dataOf(result)).toEqual({ engineId: null, engines: ALL })
    expect(textOf(result)).toContain("engine picker: 3 configured engine(s)")
    expect(textOf(result)).toContain("no default engine configured")
    expect(textOf(result)).not.toMatch(/for engine "/)
  })
})
