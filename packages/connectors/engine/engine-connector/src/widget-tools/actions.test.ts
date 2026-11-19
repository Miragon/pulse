import { afterEach, describe, expect, it, vi } from "vitest"
import { feedPayload } from "../tools/test-support/feed-payload.js"
import { appOnly } from "@miragon/pulse-widget-shell/server"
import { recordingModuleServer } from "@miragon/pulse-widget-shell/testing"
import { DEFAULT_VERDICT_THRESHOLDS } from "@miragon/pulse-c7-core"
import type { EngineRegistry } from "../lib/engine/resolve-engine.js"
import { resolveEngineToolset, type EngineToolset } from "../lib/mcp/toolsets.js"
import { ENGINE_WIDGET_ACTIONS, ENGINE_WIDGET_ACTIONS_DATA } from "../tool-names.js"
import { registerWidgetActionsFeed } from "./actions.js"

afterEach(() => {
  vi.restoreAllMocks()
})

/** A registry of one engine of `dialect`: only its backend's dialect and write gate are read. */
const registryOf = (dialect: "c7" | "c8") =>
  ({
    engines: [],
    backends: new Map([["a", { dialect, readOnly: dialect === "c8" }]]),
  }) as unknown as EngineRegistry

function recordFeed(
  toolset: EngineToolset,
  registered: ReadonlySet<string> = new Set(ENGINE_WIDGET_ACTIONS),
  registry = registryOf("c7"),
) {
  const recording = recordingModuleServer()
  registerWidgetActionsFeed({
    server: recording.server,
    registry,
    healthThresholds: DEFAULT_VERDICT_THRESHOLDS,
    toolset,
    registered,
  })
  return recording
}

function registerFeed(toolset: EngineToolset, registered?: ReadonlySet<string>) {
  const recording = recordFeed(toolset, registered)
  expect(recording.tools.size).toBe(1)
  const [feed] = recording.tools.values()
  return feed
}

async function allowedActionsFor(
  toolset: EngineToolset,
  registered?: ReadonlySet<string>,
): Promise<unknown> {
  const result = await registerFeed(toolset, registered).call({})
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

  // A write the registrar left out (no writable engine it serves) offers no button.
  it("names only the writes the registrar registered", async () => {
    const registered = new Set(["engine_resolve_incident", "engine_delete_process_instance"])
    expect(await allowedActionsFor("operations", registered)).toEqual(["engine_resolve_incident"])
    expect(await allowedActionsFor("operations", new Set())).toEqual([])
  })

  // Its mark: its writes are the Camunda 7 REST API's, so a server of Camunda 8 engines alone,
  // whose views offer no write, does not register it.
  it("is not registered without a Camunda 7 engine", () => {
    expect(recordFeed("admin", undefined, registryOf("c8")).tools.size).toBe(0)
  })

  it("keeps the admin-only suspend/cancel out of operations", async () => {
    const allowed = await allowedActionsFor("operations")
    expect(allowed).toContain("engine_resolve_incident")
    expect(allowed).not.toContain("engine_set_process_instance_suspension")
    expect(allowed).not.toContain("engine_delete_process_instance")
  })
})
