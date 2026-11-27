/**
 * The statistics floor on the wire (F123): every view over the engine-wide definition statistics
 * (the chat's overview and health, a process's incidents, the incidents dashboard, an instance
 * list's keys of bare definition ids) shares ONE read with the failed jobs and the root incidents
 * per engine and caller for 30 s, each folding it per call, so a Refresh within the floor sends no
 * second read, while another caller and a renewed token read anew, and a failed read is not kept.
 */

import { DEFAULT_VERDICT_THRESHOLDS } from "@miragon/pulse-c7-core"
import { runWithMcpRequestInfo } from "@miragon/pulse-widget-shell/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import { resolveEngine } from "../lib/engine/resolve-engine.js"
import {
  BARE_DEFINITION_ID,
  ENGINE_FAILURE,
  onBareDefinitionId,
  WORLD,
  worldReply,
} from "../tools/test-support/engine-world.js"
import {
  type FakeEngine,
  type FakeReply,
  type RecordedRequest,
  registryFor,
  startFakeEngine,
} from "../tools/test-support/fake-engine.js"
import { resolveDefinitionKeys } from "./definition-info.js"
import { healthFeed, incidentsFeed, overviewFeed, processIncidentsFeed } from "./feeds.js"
import { STATISTICS_FLOOR_MS } from "./statistics-floor.js"

const NOW = Date.parse("2026-11-27T09:00:00.000Z")
const CTX = { healthThresholds: DEFAULT_VERDICT_THRESHOLDS }
const STATISTICS = "/process-definition/statistics"

const engines: FakeEngine[] = []
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

/** The world as one configured engine: each call resolves it anew, as an MCP request does. */
async function worldEngine(answer?: (request: RecordedRequest) => FakeReply | undefined) {
  const engine = await startFakeEngine({}, (request) => answer?.(request) ?? worldReply(request))
  engines.push(engine)
  const registry = registryFor(engine)
  const statisticsReads = () => engine.requests.filter((r) => r.path === STATISTICS)
  return { engine, resolve: () => resolveEngine("fake", registry), statisticsReads }
}

/** A call made by `user` with `token`, as the MCP request info carries it. */
function as<T>(user: string, token: string, call: () => Promise<T>): Promise<T> {
  return runWithMcpRequestInfo({ authUserId: user, authorization: `Bearer ${token}` }, call)
}

describe("one statistics read per engine and caller for 30 s", () => {
  it("serves the overview, health, a process, the incidents and a Refresh from one read", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW })
    const { resolve, statisticsReads } = await worldEngine()

    const overview = await overviewFeed.read({}, resolve(), CTX)
    const health = await healthFeed.read({}, resolve(), CTX)
    const process = await processIncidentsFeed.read(
      { processDefinitionKey: WORLD.key },
      resolve(),
      CTX,
    )
    const incidents = await incidentsFeed.read({ incidentType: "failedJob" }, resolve(), CTX)
    vi.setSystemTime(NOW + STATISTICS_FLOOR_MS - 1)
    const refreshed = await overviewFeed.read({}, resolve(), CTX)

    // The one read asks for the failed jobs beside the root incidents, for every view.
    expect(statisticsReads().map((r) => r.query)).toEqual([
      { failedJobs: "true", rootIncidents: "true" },
    ])
    // Each view folds it on its own: the overview counts the failed jobs, the others the roots.
    expect(overview.summary).toMatchObject({ totalFailedJobs: 1, totalIncidents: 1 })
    expect(refreshed.summary).toEqual(overview.summary)
    expect(health.summary.totalIncidents).toBe(1)
    expect(process.incidentCount).toBe(1)
    expect(incidents.totalCount).toBe(1)
  })

  it("names the older read's time in the bars that count the shared read", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW })
    const { resolve } = await worldEngine()
    await overviewFeed.read({}, resolve(), CTX)
    vi.setSystemTime(NOW + 10_000)
    const process = await processIncidentsFeed.read(
      { processDefinitionKey: WORLD.key },
      resolve(),
      CTX,
    )
    const incidents = await incidentsFeed.read({}, resolve(), CTX)
    const readAt = new Date(NOW).toISOString()
    expect([process.fetchedAt, incidents.fetchedAt]).toEqual([readAt, readAt])
  })

  it("folds the one read per call: an incident type counts that type alone", async () => {
    const { resolve, statisticsReads } = await worldEngine()
    const custom = await incidentsFeed.read({ incidentType: "custom" }, resolve(), CTX)
    const failed = await incidentsFeed.read({ incidentType: "failedJob" }, resolve(), CTX)
    expect([custom.totalCount, failed.totalCount]).toEqual([0, 1])
    expect(statisticsReads()).toHaveLength(1)
  })

  it("resolves a bare definition id's key from the same read", async () => {
    const { resolve, statisticsReads } = await worldEngine(onBareDefinitionId("/none", null))
    await overviewFeed.read({}, resolve(), CTX)
    const keyOf = await resolveDefinitionKeys(resolve().client, [BARE_DEFINITION_ID])
    expect(keyOf(BARE_DEFINITION_ID)).toBe("customerOnboardingApprovalProcess")
    expect(statisticsReads()).toHaveLength(1)
  })

  it("reads a version deployed since the read by its bare id, the statistics not again", async () => {
    const bareIdRead = onBareDefinitionId("/none", null)
    // The floored read is older than the version: it lists the world's alone.
    const { engine, resolve, statisticsReads } = await worldEngine((r) =>
      r.path === STATISTICS ? undefined : bareIdRead(r),
    )
    await overviewFeed.read({}, resolve(), CTX)
    const keyOf = await resolveDefinitionKeys(resolve().client, [BARE_DEFINITION_ID])
    expect(keyOf(BARE_DEFINITION_ID)).toBe("customerOnboardingApprovalProcess")
    expect(statisticsReads()).toHaveLength(1)
    const byId = engine.requests.filter((r) => r.query.processDefinitionIdIn !== undefined)
    expect(byId.map((r) => r.query.processDefinitionIdIn)).toEqual([BARE_DEFINITION_ID])
  })

  it("reads again once 30 s have passed since the read was sent", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW })
    const { resolve, statisticsReads } = await worldEngine()
    await overviewFeed.read({}, resolve(), CTX)
    vi.setSystemTime(NOW + STATISTICS_FLOOR_MS)
    await overviewFeed.read({}, resolve(), CTX)
    expect(statisticsReads()).toHaveLength(2)
  })

  it("reads anew for another caller and for a renewed token, never across them", async () => {
    const { resolve, statisticsReads } = await worldEngine()
    const overview = () => overviewFeed.read({}, resolve(), CTX)
    await as("ada", "first", overview)
    await as("ada", "first", overview)
    expect(statisticsReads()).toHaveLength(1)
    await as("ada", "renewed", overview)
    expect(statisticsReads()).toHaveLength(2)
    await as("bob", "first", overview)
    expect(statisticsReads()).toHaveLength(3)
  })

  it("keeps no failed read: the next call reads again", async () => {
    let failing = true
    const { resolve, statisticsReads } = await worldEngine((r) =>
      r.path === STATISTICS && failing ? ENGINE_FAILURE : undefined,
    )
    await expect(overviewFeed.read({}, resolve(), CTX)).rejects.toThrow()
    failing = false
    const overview = await overviewFeed.read({}, resolve(), CTX)
    expect(overview.summary.totalIncidents).toBe(1)
    expect(statisticsReads()).toHaveLength(2)
  })
})
