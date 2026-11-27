/**
 * A process is a key in one tenant (owner decision 2026-11-26, F17): `engine_get_screen` and the
 * process screen's feed take the tenant as `tenantId`, the process without a tenant without it,
 * and read that tenant's versions alone. Over the kit's fake engine with its tenants beside the
 * world, the runtime handed in as the engine contract's.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import type { z } from "zod"
import type { ProcessRuntime } from "@miragon/pulse-engine-core"
import {
  FakeEngine,
  FakeWorld,
  PatchedRuntime,
  WORLD_TENANT,
} from "@miragon/pulse-engine-core/testing"
import type { ProcessScreenData } from "@miragon/pulse-screens"
import { recordingModuleServer } from "@miragon/pulse-widget-shell/testing"
import { ENGINE_SCREEN_PROCESS_DATA } from "../tool-names.js"
import { engineModule } from "../module.js"
import type { ScreenFormData } from "../data/json-forms.js"
import { feedPayload } from "./test-support/feed-payload.js"

const runtime = vi.hoisted(() => ({ current: {} }))

vi.mock("../lib/engine/engine-runtime.js", () => ({
  runtimeOf: () => runtime.current,
}))

afterEach(() => {
  runtime.current = {}
})

/** The fake with its tenants, the label's version without a tenant left out where `onlyInTenants`. */
function engineOf(onlyInTenants: boolean): ProcessRuntime {
  const engine = new FakeEngine(FakeWorld.seedWithTenants().state)
  if (!onlyInTenants) return engine
  const inTenant = ({ latest }: { latest: { bpmnProcessId: string; tenantId: unknown } }) =>
    latest.bpmnProcessId !== "pulse-label" || latest.tenantId !== null
  return new PatchedRuntime(engine, {
    listDefinitions: async () => (await engine.listDefinitions()).filter(inTenant),
    listVersions: async (id, tenantId) =>
      id === "pulse-label" && tenantId === null ? [] : engine.listVersions(id, tenantId),
  })
}

function server(onlyInTenants = false) {
  runtime.current = engineOf(onlyInTenants)
  const profiles = { tenants: { url: "http://127.0.0.1:9/engine-rest", flavor: "operaton" } }
  const recording = recordingModuleServer()
  engineModule
    .createPlugin(engineModule.configFromEnv({ ENGINES_JSON: JSON.stringify({ profiles }) }))
    .register(recording.server)
  const call = async (name: string, args: Record<string, unknown>) => {
    const tool = recording.tool(name)
    return tool.call((tool.config.inputSchema as z.ZodObject).parse(args))
  }
  return { recording, call }
}

async function screenOf(
  args: Record<string, unknown>,
  onlyInTenants = false,
): Promise<ProcessScreenData> {
  const result = feedPayload<ScreenFormData>(
    await server(onlyInTenants).call("engine_get_screen", { screen: "process", ...args }),
  )
  if (result.screen !== "process") throw new Error(`not a process screen: ${result.screen}`)
  return result.data
}

describe("a process in one tenant", () => {
  it("is the screen of its tenant's versions, by key, tenant and number", async () => {
    const south = await screenOf({
      processDefinitionKey: "pulse-label",
      tenantId: WORLD_TENANT.south,
      version: 1,
    })
    const none = await screenOf({ processDefinitionKey: "pulse-label" })

    expect(south.tenantId).toBe(WORLD_TENANT.south)
    expect(south.selected).toMatchObject({ tenantId: WORLD_TENANT.south, version: 1 })
    expect(south.versions.map(({ definition }) => definition.version)).toEqual([2, 1])
    expect(none).not.toHaveProperty("tenantId")
    expect(none.versions).toHaveLength(1)
  })

  it("is the first tenant's by id where its key alone names it and has no version without one", async () => {
    const north = await screenOf({ processDefinitionKey: "pulse-label" }, true)

    expect(north.tenantId).toBe(WORLD_TENANT.north)
    expect(north.selected).toMatchObject({ tenantId: WORLD_TENANT.north, version: 1 })
    expect(north.versions).toHaveLength(1)
  })

  it("is refused where its tenant deploys no version of its key, naming the tenant", async () => {
    const { call } = server()

    const result = (await call("engine_get_screen", {
      screen: "process",
      processDefinitionKey: "pulse-order",
      tenantId: WORLD_TENANT.north,
    })) as { isError?: boolean; content: { text: string }[] }

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('in tenant "pulse-north"')
  })

  it("takes its tenant on the process screen only, as every screen takes only its own ids", async () => {
    const { call } = server()

    const result = (await call("engine_get_screen", {
      screen: "engine",
      tenantId: WORLD_TENANT.north,
    })) as { isError?: boolean; content: { text: string }[] }

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("Screen engine takes no tenantId.")
  })

  it("is the process screen feed's by the same parameter", async () => {
    const { call } = server()

    const data = feedPayload<ProcessScreenData>(
      await call(ENGINE_SCREEN_PROCESS_DATA, {
        process: "pulse-dispatch",
        tenantId: WORLD_TENANT.north,
      }),
    )

    expect(data.calls).toEqual([
      expect.objectContaining({
        kind: "definition",
        definition: expect.objectContaining({ tenantId: WORLD_TENANT.north }) as unknown,
      }),
    ])
  })
})
