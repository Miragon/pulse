/**
 * The web app's verdict feed (`engine_screen_verdict_data`): c7-core's one verdict over a Camunda 7
 * engine's open root incidents, by the deployment's thresholds, read over the server's own wire
 * (the module's configuration and plugin against a loopback engine), its processes' root incidents
 * from the engine screen's read, which it shares with the engine screen's feed.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import type { z } from "zod"
import { recordingModuleServer } from "@miragon/pulse-widget-shell/testing"
import { engineVerdict, rootIncidentCounts } from "@miragon/pulse-c7-core"
import { engineModule } from "../../module.js"
import { ENGINE_SCREEN_PROCESSES_DATA, ENGINE_SCREEN_VERDICT_DATA } from "../../tool-names.js"
import {
  type FakeEngine,
  type FakeRoutes,
  startFakeEngine,
} from "../../tools/test-support/fake-engine.js"
import { feedPayload } from "../../tools/test-support/feed-payload.js"
import { SCREEN_FLOOR_MS } from "./screen-floor.js"
import type { EngineVerdictData } from "./verdict-data.js"

const engines: FakeEngine[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

/** A version of `key` with `incidents` open root incidents (the statistics, `rootIncidents=true`). */
function version(key: string, incidents: number) {
  return {
    id: `${key}:1:x`,
    instances: 1,
    failedJobs: 0,
    incidents: incidents === 0 ? [] : [{ incidentType: "failedJob", incidentCount: incidents }],
    definition: { id: `${key}:1:x`, key, version: 1, name: key },
  }
}

/** An open failed job at `activityId` of `definition`, a root incident unless it copies `root`. */
function incident(id: string, activityId: string, definition: string | null, root = id) {
  return {
    id,
    rootCauseIncidentId: root,
    processDefinitionId: definition,
    incidentType: "failedJob",
    activityId,
    incidentMessage: root === id ? `failed ${activityId}` : null,
    incidentTimestamp: "2026-11-20T10:00:00.000+0000",
  }
}

/**
 * The label's failed job and Camunda 7's copy of it at the call activity of each of the three
 * processes above it: one failure, four open incidents.
 */
const CHAIN = [
  incident("root", "printLabel", "label:1:x"),
  ...["dispatch", "order", "customer"].map((caller) =>
    incident(`copy-${caller}`, `call-${caller}`, `${caller}:1:x`, "root"),
  ),
]

const CHAIN_ROUTES: FakeRoutes = {
  "GET /process-definition/statistics": {
    body: [
      version("label", 1),
      version("dispatch", 0),
      version("order", 0),
      version("customer", 0),
    ],
  },
  "GET /incident": { body: CHAIN },
  "GET /incident/count": { body: { count: CHAIN.length } },
  "GET /telemetry/data": { body: { product: { name: "Operaton", version: "2.1.0" } } },
}

/** The server over a loopback engine answering `routes`, its health thresholds `env`. */
async function boot(routes: FakeRoutes, env: Record<string, string> = {}) {
  const engine = await startFakeEngine(routes, { body: [] })
  engines.push(engine)
  const config = engineModule.configFromEnv({
    ENGINES_JSON: JSON.stringify({ profiles: { prod: { url: engine.baseUrl } } }),
    ...env,
  })
  const recording = recordingModuleServer()
  engineModule.createPlugin(config).register(recording.server)
  const call = (name: string) => {
    const feed = recording.tool(name)
    return feed.call((feed.config.inputSchema as z.ZodObject).parse({ engine: "prod" }))
  }
  return { engine, call }
}

const paths = (engine: FakeEngine, path: string) =>
  engine.requests.filter((request) => request.path === path)

describe("the verdict feed", () => {
  it("counts a chain of calls that one failure stops as one root incident", async () => {
    // Four open incidents would make it critical at a threshold of 2; one root incident does not.
    const { engine, call } = await boot(CHAIN_ROUTES, {
      ENGINE_HEALTH_CRITICAL_INCIDENTS: "2",
      ENGINE_HEALTH_CRITICAL_CLUSTER_SIZE: "2",
    })
    const verdict = feedPayload<EngineVerdictData>(await call(ENGINE_SCREEN_VERDICT_DATA))
    expect(verdict).toEqual({ status: "warning" })
    expect(verdict.status).toBe(
      engineVerdict(rootIncidentCounts(1, CHAIN), { criticalIncidents: 2, criticalClusterSize: 2 }),
    )
    // The statistics with rootIncidents=true and the newest open incidents; no count of them all.
    expect(paths(engine, "/process-definition/statistics").map(({ query }) => query)).toEqual([
      { rootIncidents: "true" },
    ])
    expect(paths(engine, "/incident").map(({ query }) => query)).toEqual([
      { maxResults: "2000", sortBy: "incidentTimestamp", sortOrder: "desc" },
    ])
    expect(paths(engine, "/incident/count")).toEqual([])
  })

  it("judges by the deployment's thresholds: critical from the root incidents of one cause", async () => {
    const many = Array.from({ length: 25 }, (_, n) => incident(`i${n}`, "book", "order:1:x"))
    const { call } = await boot({
      ...CHAIN_ROUTES,
      "GET /process-definition/statistics": { body: [version("order", 25)] },
      "GET /incident": { body: many },
    })
    expect(feedPayload(await call(ENGINE_SCREEN_VERDICT_DATA))).toEqual({ status: "critical" })
  })

  it("is ok without an open root incident, and adds one outside any process", async () => {
    const quiet = await boot({
      ...CHAIN_ROUTES,
      "GET /process-definition/statistics": { body: [version("order", 0)] },
      "GET /incident": { body: [] },
    })
    expect(feedPayload(await quiet.call(ENGINE_SCREEN_VERDICT_DATA))).toEqual({ status: "ok" })
    const cleanup = await boot({
      ...CHAIN_ROUTES,
      "GET /process-definition/statistics": { body: [version("order", 0)] },
      "GET /incident": { body: [incident("h1", "historyCleanup", null)] },
    })
    expect(feedPayload(await cleanup.call(ENGINE_SCREEN_VERDICT_DATA))).toEqual({
      status: "warning",
    })
  })

  it("shares the engine screen's statistics read and stands on a floor of 30 s per caller", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    const { engine, call } = await boot(CHAIN_ROUTES)
    // The page asks the engine screen and the verdict at once: one statistics read for both.
    await Promise.all([call(ENGINE_SCREEN_PROCESSES_DATA), call(ENGINE_SCREEN_VERDICT_DATA)])
    expect(paths(engine, "/process-definition/statistics")).toHaveLength(1)
    expect(paths(engine, "/incident")).toHaveLength(1)
    // A Refresh within the floor reads nothing again; past it, both read anew.
    await call(ENGINE_SCREEN_VERDICT_DATA)
    expect(paths(engine, "/incident")).toHaveLength(1)
    vi.setSystemTime(Date.now() + SCREEN_FLOOR_MS + 1)
    await call(ENGINE_SCREEN_VERDICT_DATA)
    expect(paths(engine, "/incident")).toHaveLength(2)
    expect(paths(engine, "/process-definition/statistics")).toHaveLength(2)
  })

  it.each([
    ["says what the engine is", CHAIN_ROUTES],
    [
      "says nothing of what the engine is (its telemetry refused)",
      { ...CHAIN_ROUTES, "GET /telemetry/data": { status: 403, body: { message: "no" } } },
    ],
  ])(
    "asks the engine no second statistics after an engine screen's read that %s",
    async (_name, routes) => {
      const { engine, call } = await boot(routes)
      // The verdict read once its engine's screen answered, not beside it.
      const screen = feedPayload<{ info: unknown }>(await call(ENGINE_SCREEN_PROCESSES_DATA))
      expect(screen.info === null).toBe(routes !== CHAIN_ROUTES)
      expect(feedPayload(await call(ENGINE_SCREEN_VERDICT_DATA))).toEqual({ status: "warning" })
      expect(paths(engine, "/process-definition/statistics")).toHaveLength(1)
      expect(paths(engine, "/incident")).toHaveLength(1)
    },
  )

  it("fails as its incident scan fails, never with a verdict it could not read", async () => {
    const { call } = await boot({
      ...CHAIN_ROUTES,
      "GET /incident": { status: 500, body: { type: "ProcessEngineException", message: "down" } },
    })
    const result = (await call(ENGINE_SCREEN_VERDICT_DATA)) as { isError?: boolean }
    expect(result.isError).toBe(true)
  })

  it("fails as the engine screen's read fails, which the page shows apart", async () => {
    const { call } = await boot({
      ...CHAIN_ROUTES,
      "GET /process-definition/statistics": { status: 403, body: { message: "no" } },
    })
    const result = (await call(ENGINE_SCREEN_VERDICT_DATA)) as { isError?: boolean }
    expect(result.isError).toBe(true)
  })
})
