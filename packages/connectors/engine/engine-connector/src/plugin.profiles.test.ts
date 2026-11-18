import { afterEach, describe, expect, it } from "vitest"
import { z } from "zod"
import { recordingModuleServer } from "@miragon/pulse-widget-shell/testing"
import { queryProcessInstances } from "@miragon/pulse-c7-client/sdk"
import { engineModule } from "./module.js"
import { createConfiguredEngineRegistry, createPlugin, type EnginePluginConfig } from "./plugin.js"
import { resolveEngine } from "./lib/engine/resolve-engine.js"
import { ENGINE_LIST_ENGINES, ENGINE_OPEN_COCKPIT } from "./tool-names.js"
import { feedPayload } from "./tools/test-support/feed-payload.js"
import { worldReply } from "./tools/test-support/engine-world.js"
import { type FakeEngine, startFakeEngine } from "./tools/test-support/fake-engine.js"

/** The text a call of `name` returns, an error included. */
type Text = (name: string, args?: Record<string, unknown>) => Promise<string>

function boot(config: EnginePluginConfig) {
  const recording = recordingModuleServer()
  createPlugin(config).register(recording.server)
  const text: Text = async (name, args = {}) => {
    const result = await recording.tool(name).call(args)
    return result.content.map((part) => ("text" in part ? part.text : "")).join("")
  }
  return { recording, text }
}

const started: FakeEngine[] = []
afterEach(async () => {
  await Promise.all(started.splice(0).map((engine) => engine.close()))
})

async function fakeEngine(): Promise<FakeEngine> {
  const engine = await startFakeEngine({}, worldReply)
  started.push(engine)
  return engine
}

/** A profile the server refused, as engine-profiles.ts hands it on. */
const REFUSED = {
  id: "locked",
  environment: "prod",
  reason: "auth.tokenEnv names a variable that is not set.",
}

describe("readOnly per profile: every write fails before it runs", () => {
  it("each tool without readOnlyHint throws ENGINE_READ_ONLY on a read-only engine, nothing sent", async () => {
    const readOnly = await fakeEngine()
    const { recording, text } = boot({
      engines: [
        { id: "rw", baseUrl: "http://rw.invalid/engine-rest" },
        { id: "ro", baseUrl: readOnly.baseUrl, readOnly: true },
      ],
      toolset: "admin",
      allowDeployments: true,
    })
    const writes = [...recording.tools.values()].filter(
      ({ config }) => config.annotations?.readOnlyHint !== true,
    )
    // The admin surface's writes: the wrapper is not vacuous.
    expect(writes.length).toBeGreaterThanOrEqual(20)
    for (const { name } of writes) {
      expect(await text(name, { engine: "ro" }), name).toBe(
        '[ENGINE_READ_ONLY] Engine "ro" is read-only on this server: its profile sets readOnly, so no tool writes to it. Nothing was sent.',
      )
    }
    expect(readOnly.requests).toEqual([])
  })

  it("routes a write without `engine` like every call: to the read-only default it fails too", async () => {
    const { text } = boot({
      engines: [
        { id: "rw", baseUrl: "http://rw.invalid/engine-rest" },
        { id: "ro", baseUrl: "http://ro.invalid/engine-rest", readOnly: true },
      ],
      defaultEngine: "ro",
      toolset: "operations",
    })
    expect(await text("engine_set_job_retries", { jobId: "j", retries: 1 })).toMatch(
      /^\[ENGINE_READ_ONLY\] Engine "ro"/,
    )
  })

  it("lets a write through to an engine whose profile is not read-only", async () => {
    const writable = await fakeEngine()
    const { text } = boot({
      engines: [
        { id: "rw", baseUrl: writable.baseUrl },
        { id: "ro", baseUrl: "http://ro.invalid/engine-rest", readOnly: true },
      ],
      toolset: "operations",
    })
    const answer = await text("engine_set_job_retries", { engine: "rw", jobId: "j", retries: 1 })
    expect(answer).not.toContain("ENGINE_READ_ONLY")
    expect(writable.requests.map(({ method, path }) => `${method} ${path}`)).toContain(
      "PUT /job/j/retries",
    )
  })

  it("its transport reads, a reading POST included (the route table marks it), and sends no write", async () => {
    const readOnly = await fakeEngine()
    const { client } = resolveEngine(
      "ro",
      createConfiguredEngineRegistry({
        engines: [{ id: "ro", baseUrl: readOnly.baseUrl, readOnly: true }],
      }),
    )
    await queryProcessInstances({ client, body: {} })
    await expect(
      client.put({ url: "/job/{id}/retries", path: { id: "j" }, body: { retries: 1 } }),
    ).rejects.toThrow(
      "the profile of this engine is read-only on this server; nothing was sent (engine ro)",
    )
    expect(readOnly.requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "POST /process-instance",
    ])
  })

  it("tells the widgets which engines take no write", async () => {
    const { text } = boot({
      engines: [
        { id: "rw", baseUrl: "http://rw.invalid/engine-rest" },
        { id: "ro", baseUrl: "http://ro.invalid/engine-rest", readOnly: true },
      ],
      toolset: "operations",
    })
    const feed = feedPayload<{ readOnlyEngines: string[] }>(
      JSON.parse(await text("engine_widget_actions_data")),
    )
    expect(feed.readOnlyEngines).toEqual(["ro"])
  })
})

describe("a refused profile: listed, named in the enum, never routed to", () => {
  const config: EnginePluginConfig = {
    engines: [{ id: "a", baseUrl: "http://a.invalid/engine-rest" }],
    refused: [REFUSED],
    engineIds: ["a", "locked"],
    profileCount: 2,
    toolset: "operations",
  }

  it("engine_list_engines lists it under refused, with its reason and no value", async () => {
    const list = JSON.parse(await boot(config).text(ENGINE_LIST_ENGINES)) as {
      engines: Array<{ id: string }>
      refused: unknown
    }
    expect(list.engines.map(({ id }) => id)).toEqual(["a"])
    expect(list.refused).toEqual([REFUSED])
  })

  it("engine_list_engines carries no refused key without a refused profile", async () => {
    const list = JSON.parse(
      await boot({ engines: config.engines }).text(ENGINE_LIST_ENGINES),
    ) as Record<string, unknown>
    expect(Object.keys(list)).toEqual(["engines", "environments", "defaultEngineId"])
  })

  it("a call naming it fails with ENGINE_PROFILE_REFUSED and the reason, never a variable", async () => {
    expect(await boot(config).text("engine_status", { engine: "locked" })).toBe(
      '[ENGINE_PROFILE_REFUSED] Engine "locked" is configured, but its profile cannot be used: auth.tokenEnv names a variable that is not set. Ask whoever runs this server to fix it.',
    )
  })

  it("a call without `engine` gives ENGINE_NOT_SELECTED: the usable one is no default", async () => {
    expect(await boot(config).text("engine_status")).toBe(
      "[ENGINE_NOT_SELECTED] No engine specified and no default engine configured. Pass `engine`, one of: a.",
    )
  })

  it("a default on it fails a call without `engine` with its reason, never on another engine", async () => {
    expect(await boot({ ...config, defaultEngine: "locked" }).text("engine_status")).toMatch(
      /^\[ENGINE_PROFILE_REFUSED\] Engine "locked" is configured/,
    )
  })

  it("the enum names it, so a call to it says why instead of a schema error", async () => {
    const { recording } = boot(config)
    const engine = recording.tool("engine_status").config.inputSchema as z.ZodObject
    const json = z.toJSONSchema(engine.shape.engine as z.ZodType) as { enum?: string[] }
    expect(json.enum).toEqual(["a", "locked"])
  })

  it("the cockpit opens the picker for it, listing every engine, the refused one included", async () => {
    const { recording } = boot(config)
    for (const args of [{ engine: "locked" }, {}]) {
      const result = await recording.tool(ENGINE_OPEN_COCKPIT).call(args)
      // A refused profile names no dialect, and says it is refused: no call reaches it, so the
      // widgets read nothing of it.
      expect(result.structuredContent).toEqual({
        engineId: null,
        engines: [
          { id: "a", environment: "default", dialect: "c7" },
          { id: "locked", environment: "prod", refused: true },
        ],
        start: null,
      })
    }
  })

  it("a named view on it is a tool error with the reason", async () => {
    const answer = await boot(config).text(ENGINE_OPEN_COCKPIT, {
      engine: "locked",
      view: "incidents",
    })
    expect(answer).toMatch(/^\[ENGINE_PROFILE_REFUSED\] Engine "locked"/)
  })
})

describe("a camunda8 profile: served, and every Camunda 7 path refuses it before any request", () => {
  it("lists it with its dialect and answers a call to it without a request to its engine", async () => {
    const [c7, c8] = [await fakeEngine(), await fakeEngine()]
    const config = engineModule.configFromEnv({
      ENGINES_JSON: JSON.stringify({
        defaultProfile: "c8",
        profiles: { c7: { url: c7.baseUrl }, c8: { url: c8.baseUrl, flavor: "camunda8" } },
      }),
    })
    const recording = recordingModuleServer()
    engineModule.createPlugin({ ...config, toolset: "operations" }).register(recording.server)
    const text: Text = async (name, args = {}) => {
      const result = await recording.tool(name).call(args)
      return result.content.map((part) => ("text" in part ? part.text : "")).join("")
    }
    const refusal =
      '[ENGINE_DIALECT_NOT_SERVED] Engine "c8" is a Camunda 8 engine, and this tool or view ' +
      "reads the Camunda 7 REST API (Camunda 7, CIB seven, Operaton), so nothing was sent. This " +
      'server reads a Camunda 8 engine on boards only, and no board names "c8" yet; the ' +
      "server's operator adds one."
    const list = JSON.parse(await text(ENGINE_LIST_ENGINES)) as {
      engines: Array<{ id: string; dialect: string }>
      refused?: unknown
    }
    expect(list.engines.map(({ id, dialect }) => [id, dialect])).toEqual([
      ["c7", "c7"],
      ["c8", "c8"],
    ])
    expect(list.refused).toBeUndefined()
    expect(await text("engine_status", { engine: "c8" })).toBe(refusal)
    expect(await text("engine_status")).toBe(refusal)
    expect(await text("engine_list_process_instances", { engine: "c8" })).toBe(refusal)
    expect(await text("engine_set_job_retries", { engine: "c8", jobId: "j", retries: 1 })).toBe(
      refusal,
    )
    expect(c8.requests).toEqual([])
  })
})
