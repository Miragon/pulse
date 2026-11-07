import { afterEach, describe, expect, it, vi } from "vitest"
import { feedPayload } from "../tools/test-support/feed-payload.js"
import { appOnly } from "@miragon/pulse-widget-shell/server"
import { recordingModuleServer } from "@miragon/pulse-widget-shell/testing"
import { DEFAULT_VERDICT_THRESHOLDS } from "@miragon/pulse-engine-core"
import type { EngineRegistry } from "../lib/engine/resolve-engine.js"
import { resolveEngineToolset, type EngineToolset } from "../lib/mcp/toolsets.js"
import { ENGINE_WIDGET_ACTIONS, ENGINE_WIDGET_ACTIONS_DATA } from "../tool-names.js"
import { engineParamShape } from "../lib/engine/with-engine.js"
import { registerWidgetActionsFeed } from "./actions.js"

afterEach(() => {
  vi.restoreAllMocks()
})

function registerFeed(toolset: EngineToolset) {
  const recording = recordingModuleServer()
  registerWidgetActionsFeed({
    server: recording.server,
    registry: { engines: [] } as unknown as EngineRegistry,
    healthThresholds: DEFAULT_VERDICT_THRESHOLDS,
    toolset,
    engineParam: engineParamShape,
  })
  expect(recording.tools.size).toBe(1)
  const [feed] = recording.tools.values()
  return feed
}

async function allowedActionsFor(toolset: EngineToolset): Promise<unknown> {
  const result = await registerFeed(toolset).call({})
  return feedPayload(result).allowedActions
}

describe("engine_widget_actions_data", () => {
  it("is an app-only feed with no view binding", () => {
    const { name, config } = registerFeed("operations")
    expect(name).toBe(ENGINE_WIDGET_ACTIONS_DATA)
    expect(config._meta).toEqual(appOnly._meta)
    expect(config._meta?.ui).not.toHaveProperty("resourceUri")
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
