import { afterEach, describe, expect, it, vi } from "vitest"
import { feedPayload } from "../tools/test-support/feed-payload.js"
import type { MCPServer } from "mcp-use"
import { createInMemoryProfileStore } from "@miragon/pulse-widget-shell/server"
import { DEFAULT_HEALTH_THRESHOLDS } from "../data/health-data.js"
import type { EngineRegistry } from "../lib/resolve-engine.js"
import { resolveCamunda7Toolset, type Camunda7Toolset } from "../lib/toolsets.js"
import { CAMUNDA7_WIDGET_ACTIONS, CAMUNDA7_WIDGET_ACTIONS_DATA } from "../tool-names.js"
import { engineParamShape } from "../lib/with-engine.js"
import { registerWidgetActionsFeed } from "./actions.js"

afterEach(() => {
  vi.restoreAllMocks()
})

type Handler = (params: unknown) => Promise<{ structuredContent?: Record<string, unknown> }>

function registerFeed(toolset: Camunda7Toolset, modelTools: () => string[] = () => []) {
  const tool = vi.fn()
  registerWidgetActionsFeed({
    server: { tool } as unknown as MCPServer,
    registry: { engines: [] } as unknown as EngineRegistry,
    healthThresholds: DEFAULT_HEALTH_THRESHOLDS,
    profileStore: createInMemoryProfileStore(),
    toolset,
    modelTools,
    engineParam: engineParamShape,
  })
  expect(tool).toHaveBeenCalledOnce()
  const [definition, handler] = tool.mock.calls[0] as [Record<string, unknown>, Handler]
  return { definition, handler }
}

async function allowedActionsFor(toolset: Camunda7Toolset): Promise<unknown> {
  const result = await registerFeed(toolset).handler({})
  return feedPayload(result).allowedActions
}

describe("camunda7_widget_actions_data", () => {
  it("is an app-only feed with no view binding", () => {
    const { definition } = registerFeed("operations")
    expect(definition.name).toBe(CAMUNDA7_WIDGET_ACTIONS_DATA)
    expect(definition.visibility).toBe("app")
    expect(definition).not.toHaveProperty("view")
  })

  it("allows every widget action only under an explicit admin", async () => {
    expect(await allowedActionsFor("admin")).toEqual([...CAMUNDA7_WIDGET_ACTIONS])
  })

  it("a missing toolset, resolved like the plugin does, allows none (read-only floor)", async () => {
    expect(await allowedActionsFor(resolveCamunda7Toolset(undefined))).toEqual([])
  })

  it("allows none in read-only", async () => {
    expect(await allowedActionsFor("read-only")).toEqual([])
  })

  // Read at CALL time, so registrations after the feed's own count too.
  it("reports the model surface as it stands when the feed is called", async () => {
    const surface = ["camunda7_list_incidents"]
    const { handler } = registerFeed("read-only", () => surface)
    surface.push("camunda7_show_settings")
    const result = await handler({})
    expect(feedPayload(result).modelTools).toEqual([
      "camunda7_list_incidents",
      "camunda7_show_settings",
    ])
  })

  it("keeps the admin-only suspend/cancel out of operations", async () => {
    const allowed = await allowedActionsFor("operations")
    expect(allowed).toContain("camunda7_resolve_incident")
    expect(allowed).not.toContain("camunda7_set_process_instance_suspension")
    expect(allowed).not.toContain("camunda7_delete_process_instance")
  })
})
