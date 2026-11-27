/**
 * A write and the floors it changes, on the wire through the module (F123, F29): after a write
 * tool answered on an engine, the statistics floor, the health floor and the process numbers'
 * floor of that engine go for every caller, so the views a widget's write invalidates
 * (`WRITE_POLICY`) and `engine_process_stats` count its effect at their next read within the 30 s,
 * never the read before it. A read and a write that failed keep them.
 */

import { runWithMcpRequestInfo } from "@miragon/pulse-widget-shell/server"
import { recordingModuleServer } from "@miragon/pulse-widget-shell/testing"
import { afterEach, describe, expect, it } from "vitest"
import { createPlugin } from "../plugin.js"
import {
  ENGINE_COCKPIT_OVERVIEW_DATA,
  ENGINE_HEALTH_DATA,
  ENGINE_INCIDENTS_DATA,
  ENGINE_PROCESS_INCIDENTS_DATA,
} from "../tool-names.js"
import { ENGINE_FAILURE, WORLD, worldReply } from "../tools/test-support/engine-world.js"
import { feedPayload } from "../tools/test-support/feed-payload.js"
import {
  type FakeEngine,
  type RecordedRequest,
  startFakeEngine,
} from "../tools/test-support/fake-engine.js"

const STATISTICS = "/process-definition/statistics"
const RESOLVE = `/incident/${WORLD.incidentId}`

const engines: FakeEngine[] = []
afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

/** The world, whose one root incident a resolve removes: its scan, counts and statistics with it. */
function resolvableWorld(options: { failing: boolean }) {
  let resolved = false
  return (request: RecordedRequest) => {
    if (request.method === "DELETE" && request.path === RESOLVE) {
      if (options.failing) return ENGINE_FAILURE
      resolved = true
      return { status: 204 }
    }
    const reply = worldReply(request)
    if (!resolved) return reply
    if (request.path === "/incident") return { body: [] }
    if (request.path === "/incident/count") return { body: { count: 0 } }
    if (request.path !== STATISTICS) return reply
    const rows = reply.body as object[]
    return { body: rows.map((row) => ({ ...row, failedJobs: 0, incidents: [] })) }
  }
}

/** The module on one engine, each call made by `user` as the MCP request info carries it. */
async function boot(options = { failing: false }) {
  const engine = await startFakeEngine({}, resolvableWorld(options))
  engines.push(engine)
  const recording = recordingModuleServer()
  createPlugin({
    engines: [{ id: "fake", baseUrl: engine.baseUrl }],
    toolset: "operations",
  }).register(recording.server)
  const call = (user: string, name: string, args: Record<string, unknown> = {}) =>
    runWithMcpRequestInfo({ authUserId: user, authorization: `Bearer ${user}` }, () =>
      recording.tool(name).call(args),
    )
  const read = async <T>(user: string, name: string, args?: Record<string, unknown>) =>
    feedPayload<T>(await call(user, name, args))
  const health = (user: string) =>
    read<{ status: string; summary: { totalIncidents: number } }>(user, ENGINE_HEALTH_DATA)
  /** What the views a resolve invalidates count, as `user` reads them. */
  const counts = async (user: string) => ({
    health: await health(user),
    overview: (
      await read<{ summary: { totalIncidents: number } }>(user, ENGINE_COCKPIT_OVERVIEW_DATA)
    ).summary.totalIncidents,
    incidents: (await read<{ totalCount: number }>(user, ENGINE_INCIDENTS_DATA)).totalCount,
    process: (
      await read<{ incidentCount: number }>(user, ENGINE_PROCESS_INCIDENTS_DATA, {
        processDefinitionKey: WORLD.key,
      })
    ).incidentCount,
    numbers: (
      await read<{ now: { incidents: number } }>(user, "engine_process_stats", {
        processDefinitionKey: WORLD.key,
        bucket: "day",
      })
    ).now.incidents,
  })
  const reads = (path: string) => engine.requests.filter((r) => r.path === path).length
  return { call, health, counts, reads }
}

const resolve = { incidentId: WORLD.incidentId }

describe("a write drops its engine's statistics, health and process numbers floors", () => {
  it("counts a resolve at the next read within 30 s, the writer's and another caller's", async () => {
    const { call, counts, reads } = await boot()
    const before = await counts("ada")
    expect(before.health).toMatchObject({ status: "warning", summary: { totalIncidents: 1 } })
    expect([before.overview, before.incidents, before.process, before.numbers]).toEqual([
      1, 1, 1, 1,
    ])
    expect((await counts("bob")).health.status).toBe("warning")
    expect(reads(STATISTICS)).toBe(2)

    await call("ada", "engine_resolve_incident", resolve)
    expect(reads(RESOLVE)).toBe(1)

    for (const user of ["ada", "bob"]) {
      const after = await counts(user)
      expect(after.health, user).toMatchObject({ status: "ok", summary: { totalIncidents: 0 } })
      expect([after.overview, after.incidents, after.process, after.numbers], user).toEqual([
        0, 0, 0, 0,
      ])
    }
    // One read after the write per caller: every view of each shares it again.
    expect(reads(STATISTICS)).toBe(4)
  })

  it("keeps the floors across a read tool and a write that failed", async () => {
    const { call, health, reads } = await boot({ failing: true })
    const first = await health("ada")
    await call("ada", "engine_list_incidents")
    await call("ada", "engine_resolve_incident", resolve)
    expect(reads(RESOLVE)).toBe(1)
    expect(await health("ada")).toEqual(first)
    expect(reads(STATISTICS)).toBe(1)
    expect(reads("/incident")).toBe(2)
  })
})
