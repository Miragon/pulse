import { afterEach, describe, expect, it, vi } from "vitest"
import { feedPayload } from "../tools/test-support/feed-payload.js"
import type { MCPServer } from "mcp-use"
import { DEFAULT_VERDICT_THRESHOLDS } from "@miragon/pulse-engine-core"
import type { EngineRegistry } from "../lib/engine/resolve-engine.js"
import { resolveEngineToolset, type EngineToolset } from "../lib/mcp/toolsets.js"
import { ENGINE_WIDGET_ACTIONS, ENGINE_WIDGET_ACTIONS_DATA } from "../tool-names.js"
import { engineParamShape } from "../lib/engine/with-engine.js"
import { registerWidgetActionsFeed } from "./actions.js"

afterEach(() => {
  vi.restoreAllMocks()
})

type Handler = (params: unknown) => Promise<{ structuredContent?: Record<string, unknown> }>

function registerFeed(toolset: EngineToolset) {
  const tool = vi.fn()
  registerWidgetActionsFeed({
    server: { tool } as unknown as MCPServer,
    registry: { engines: [] } as unknown as EngineRegistry,
    healthThresholds: DEFAULT_VERDICT_THRESHOLDS,
    toolset,
    engineParam: engineParamShape,
  })
  expect(tool).toHaveBeenCalledOnce()
  const [definition, handler] = tool.mock.calls[0] as [Record<string, unknown>, Handler]
  return { definition, handler }
}

async function allowedActionsFor(toolset: EngineToolset): Promise<unknown> {
  const result = await registerFeed(toolset).handler({})
  return feedPayload(result).allowedActions
}

describe("engine_widget_actions_data", () => {
  it("is an app-only feed with no view binding", () => {
    const { definition } = registerFeed("operations")
    expect(definition.name).toBe(ENGINE_WIDGET_ACTIONS_DATA)
    expect(definition.visibility).toBe("app")
    expect(definition).not.toHaveProperty("view")
  })

  it("allows every widget action only under an explicit admin", async () => {
    expect(await allowedActionsFor("admin")).toEqual([...ENGINE_WIDGET_ACTIONS])
  })

  it("a missing toolset, resolved like the plugin does, allows none (read-only floor)", async () => {
    expect(await allowedActionsFor(resolveEngineToolset(undefined))).toEqual([])
  })

  it("allows none in read-only", async () => {
    expect(await allowedActionsFor("read-only")).toEqual([])
  })

  it("keeps the admin-only suspend/cancel out of operations", async () => {
    const allowed = await allowedActionsFor("operations")
    expect(allowed).toContain("engine_resolve_incident")
    expect(allowed).not.toContain("engine_set_process_instance_suspension")
    expect(allowed).not.toContain("engine_delete_process_instance")
  })
})
