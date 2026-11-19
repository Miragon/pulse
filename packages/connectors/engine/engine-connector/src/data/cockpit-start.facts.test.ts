import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { toEngineDate } from "@miragon/pulse-c7-core"
import { resolveEngine } from "../lib/engine/resolve-engine.js"
import {
  registryFor,
  startFakeEngine,
  type FakeEngine,
  type FakeReply,
  type RecordedRequest,
} from "../tools/test-support/fake-engine.js"
import { WORLD, worldReply } from "../tools/test-support/engine-world.js"
import type { CockpitView } from "../view-models.js"
import { messageSignature } from "@miragon/pulse-c7-core"
import { CLUSTER_SCAN_LIMIT } from "./cluster-scan.js"
import { buildCockpitStart, cockpitFacts, isAppView } from "./cockpit-start.js"
import { worldBoard, worldResolver } from "./honest-numbers.test-support.js"
import { DEFAULT_VERDICT_THRESHOLDS } from "@miragon/pulse-c7-core"
import { healthVerdictRule } from "./health-data.js"

// The clock the incidents' age is read against: the world's incident is 2h old.
const NOW = "2026-10-10T08:00:00.000Z"

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date(NOW))
})

const engines: FakeEngine[] = []
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

type Override = (request: RecordedRequest) => FakeReply | undefined

/** A board file that gives no board. */
const BROKEN_FILE = {
  id: "broken",
  file: "broken.board.json",
  problems: [{ path: "$.rows", code: "missing" }],
} as const

/**
 * The start's facts, as the tool puts them after `engine` and `view`; an app route's after `view`,
 * over the world's board, which names the world's one engine, beside a file that gives no board.
 * The call lists the world's engine and a second one.
 */
async function factsOf(view: CockpitView, override: Override = () => undefined) {
  const engine = await startFakeEngine({}, (request) => override(request) ?? worldReply(request))
  engines.push(engine)
  const start = isAppView(view)
    ? await buildCockpitStart(view, {
        resolve: worldResolver(engine.baseUrl),
        boards: { boards: [worldBoard()], refused: [BROKEN_FILE] },
      })
    : await buildCockpitStart(
        view,
        resolveEngine(undefined, registryFor(engine)),
        DEFAULT_VERDICT_THRESHOLDS,
      )
  return cockpitFacts(start, { engines: ["fake", "other"] })
}

const ok = (body: unknown): FakeReply => ({ body })
const at =
  (path: string, reply: FakeReply): Override =>
  (r) =>
    r.path === path ? reply : undefined

/** Incidents of one cluster, all at `NOW` minus two hours. */
function incidents(count: number, message = "card declined"): unknown[] {
  const ts = toEngineDate(new Date(Date.parse(NOW) - 2 * 60 * 60 * 1000))
  return Array.from({ length: count }, (_, n) => ({
    id: `inc-${n}`,
    processDefinitionId: WORLD.instanceDefinitionId,
    processInstanceId: WORLD.instanceId,
    activityId: WORLD.activityId,
    incidentType: "failedJob",
    incidentMessage: message,
    incidentTimestamp: ts,
    configuration: WORLD.jobId,
  }))
}

const RULE = healthVerdictRule(DEFAULT_VERDICT_THRESHOLDS)

describe("cockpitFacts: the model's view of each route", () => {
  it("overview: the verdict, the summary, the failed jobs and the top cluster", async () => {
    expect(await factsOf({ section: "overview" })).toEqual({
      status: "warning",
      statusRule: RULE,
      totalIncidents: 1,
      lastHourIncidents: 1,
      last24hIncidents: 1,
      affectedActivities: 1,
      affectedDefinitions: 1,
      runningInstances: 3,
      totalDefinitions: 1,
      started24h: 1,
      completed24h: 1,
      totalFailedJobs: 1,
      topCluster: {
        activityId: WORLD.activityId,
        incidentType: "failedJob",
        messageSignature: messageSignature("card declined"),
        incidentCount: 1,
        scannedIncidentCount: 1,
        processDefinitionKeys: [WORLD.key],
      },
    })
  })

  it("overview without incidents: ok, and no top cluster", async () => {
    const quiet: Override = (r) => {
      if (r.path === "/incident") return ok([])
      if (r.path === "/incident/count") return ok({ count: 0 })
      if (r.path === "/process-definition/statistics") {
        return ok([
          {
            id: WORLD.latestDefinitionId,
            instances: 3,
            failedJobs: 0,
            incidents: [],
            definition: { id: WORLD.latestDefinitionId, key: WORLD.key, name: "Order", version: 2 },
          },
        ])
      }
      return undefined
    }
    expect(await factsOf({ section: "overview" }, quiet)).toEqual({
      status: "ok",
      statusRule: RULE,
      totalIncidents: 0,
      lastHourIncidents: 0,
      last24hIncidents: 0,
      affectedActivities: 0,
      affectedDefinitions: 0,
      runningInstances: 3,
      totalDefinitions: 1,
      started24h: 1,
      completed24h: 1,
      totalFailedJobs: 0,
      topCluster: null,
    })
  })

  // A capped scan holds only part of the cluster: its count is unknown, the scanned share a lower bound.
  it("overview on a capped scan: an unknown count stays null, never the scan's length", async () => {
    const facts = await factsOf(
      { section: "overview" },
      at("/incident", ok(incidents(CLUSTER_SCAN_LIMIT))),
    )
    expect(facts.affectedActivities).toBeNull()
    expect(facts.topCluster).toEqual({
      activityId: WORLD.activityId,
      incidentType: "failedJob",
      messageSignature: messageSignature("card declined"),
      incidentCount: null,
      scannedIncidentCount: CLUSTER_SCAN_LIMIT,
      processDefinitionKeys: [WORLD.key],
    })
  })

  it("incidents: the totals over every process", async () => {
    expect(await factsOf({ section: "incidents" })).toEqual({
      totalCount: 1,
      processCount: 1,
      last24hCount: 1,
      affectedActivityCount: 1,
      latestIncident: "2026-10-10T08:00:00.000+0200",
    })
  })

  it("cluster-detail: the cluster's counts and its sample message, clipped at 140", async () => {
    const message = `${"x".repeat(100)}\n\n   ${"y".repeat(100)}`
    const facts = await factsOf(
      { section: "cluster-detail", activityId: WORLD.activityId, incidentType: "failedJob" },
      at("/incident", ok(incidents(2, message))),
    )
    expect(facts).toEqual({
      activityId: WORLD.activityId,
      incidentType: "failedJob",
      messageSignature: null,
      // The scan holds the whole cluster: exact counts, both incidents two hours old.
      incidentCount: 2,
      scannedIncidentCount: 2,
      lastHourCount: 0,
      last24hCount: 2,
      processDefinitionKeys: [WORLD.key],
      sampleMessage: `${"x".repeat(100)} ${"y".repeat(39)}…`,
    })
  })

  it("process-detail: the key-wide counts, the drawn version and the focus", async () => {
    const view: CockpitView = { section: "process-detail", processDefinitionKey: WORLD.key }
    const facts = {
      processDefinitionKey: WORLD.key,
      diagramVersion: 2,
      runningInstances: 1,
      incidentCount: 1,
      last24hCount: 1,
      failedJobs: 1,
      affectedActivities: 1,
    }
    expect(await factsOf(view)).toEqual(facts)
    expect(await factsOf({ ...view, focus: "incidents" })).toEqual({
      ...facts,
      focus: "incidents",
    })
  })

  it("process-instances: the totals and the page's share, engine-wide as null", async () => {
    const facts = {
      totalCount: 1,
      withIncidentCount: 1,
      suspendedCount: 1,
      returnedCount: 1,
    }
    expect(await factsOf({ section: "process-instances" })).toEqual({
      processDefinitionKey: null,
      ...facts,
    })
    expect(
      await factsOf({ section: "process-instances", processDefinitionKey: WORLD.key }),
    ).toEqual({ processDefinitionKey: WORLD.key, ...facts })
  })

  it.each([
    ["running", {}],
    ["suspended", { suspended: true }],
    ["ended", { suspended: true, ended: true }],
  ])("instance-detail: a %s instance", async (state, flags) => {
    const instance = {
      id: WORLD.instanceId,
      definitionId: WORLD.instanceDefinitionId,
      businessKey: "B-1",
      suspended: false,
      ended: false,
      ...flags,
    }
    expect(
      await factsOf(
        { section: "instance-detail", processInstanceId: WORLD.instanceId },
        at(`/process-instance/${WORLD.instanceId}`, ok(instance)),
      ),
    ).toEqual({
      processInstanceId: WORLD.instanceId,
      businessKey: "B-1",
      processDefinitionKey: WORLD.key,
      state,
      activeActivityIds: [WORLD.key, WORLD.activityId],
      incidentCount: 1,
      openTaskCount: 1,
    })
  })

  it("incident-detail: the incident's ids and its message, clipped at 160", async () => {
    const message = `Boom:\n${"z".repeat(200)}`
    const incident = {
      id: WORLD.incidentId,
      processDefinitionId: WORLD.instanceDefinitionId,
      processInstanceId: WORLD.instanceId,
      executionId: WORLD.instanceId,
      activityId: WORLD.activityId,
      failedActivityId: WORLD.activityId,
      incidentType: "failedJob",
      incidentMessage: message,
      incidentTimestamp: "2026-10-10T08:00:00.000+0200",
      configuration: WORLD.jobId,
    }
    expect(
      await factsOf(
        { section: "incident-detail", incidentId: WORLD.incidentId },
        at(`/incident/${WORLD.incidentId}`, ok(incident)),
      ),
    ).toEqual({
      incidentId: WORLD.incidentId,
      incidentType: "failedJob",
      activityId: WORLD.activityId,
      processDefinitionKey: WORLD.key,
      processInstanceId: WORLD.instanceId,
      businessKey: "B-1",
      incidentMessage: `Boom: ${"z".repeat(154)}…`,
    })
  })

  // As the tool sends them: an `undefined` fact is left out of the JSON.
  it("jobs: the counts, and the key and failedOnly only when the view names them", async () => {
    const json = async (view: CockpitView) =>
      JSON.parse(JSON.stringify(await factsOf(view))) as unknown
    expect(await json({ section: "jobs" })).toStrictEqual({
      totalCount: 1,
      allCount: 1,
      failedCount: 1,
    })
    expect(
      await json({ section: "jobs", processDefinitionKey: WORLD.key, failedOnly: true }),
    ).toStrictEqual({
      processDefinitionKey: WORLD.key,
      failedOnly: true,
      totalCount: 1,
      allCount: 1,
      failedCount: 1,
    })
    expect(await json({ section: "jobs", failedOnly: false })).toStrictEqual({
      totalCount: 1,
      allCount: 1,
      failedCount: 1,
    })
  })

  it("history: an ended instance's state and times", async () => {
    const ended = {
      id: WORLD.instanceId,
      processDefinitionKey: WORLD.key,
      processDefinitionName: "Order",
      startTime: "2026-10-09T08:00:00.000+0200",
      endTime: "2026-10-09T09:00:00.000+0200",
      durationInMillis: 3_600_000,
      state: "COMPLETED",
    }
    expect(
      await factsOf(
        { section: "history", processInstanceId: WORLD.instanceId },
        at("/history/process-instance", ok([ended])),
      ),
    ).toEqual({
      processInstanceId: WORLD.instanceId,
      found: true,
      state: "COMPLETED",
      processDefinitionKey: WORLD.key,
      startTime: ended.startTime,
      endTime: ended.endTime,
      totalActivities: 1,
    })
  })

  it("history: an instance the history does not know reads as not found", async () => {
    expect(
      await factsOf(
        { section: "history", processInstanceId: "gone" },
        at("/history/process-instance", ok([])),
      ),
    ).toEqual({
      processInstanceId: "gone",
      found: false,
      state: null,
      processDefinitionKey: null,
      startTime: null,
      endTime: null,
      totalActivities: 1,
    })
  })

  // The tool sends the facts as JSON: a field without a value is left out.
  const asJson = (facts: unknown) => JSON.parse(JSON.stringify(facts)) as unknown

  it("board: the engines in their state and each tile's numbers and processes", async () => {
    expect(asJson(await factsOf({ section: "board", board: "orders" }))).toEqual({
      board: "orders",
      title: "Orders",
      asOf: NOW,
      engines: [
        { name: "fake", state: "ready", product: "CIB seven", running: 3, withIncident: 1 },
      ],
      tiles: [
        { kind: "counter", process: WORLD.key, count: 1, enginesRead: 1, engines: 1 },
        {
          kind: "instanceList",
          process: WORLD.key,
          shown: 1,
          groups: [{ engine: "fake", total: 1 }],
        },
        {
          kind: "incidentSummary",
          groupBy: "process",
          withIncident: 1,
          enginesRead: 1,
          engines: 1,
        },
        { kind: "processDiagram", process: WORLD.key, engine: "fake", version: 2 },
        { kind: "incidentList", groups: [{ engine: "fake", shown: 1 }] },
      ],
    })
  })

  it("landing: the engine ids the call lists and the board ids the engine list names", async () => {
    expect(asJson(await factsOf({ section: "landing" }))).toEqual({
      engines: ["fake", "other"],
      boards: ["orders"],
      refusedBoards: ["broken"],
    })
  })

  it("board: an engine that fails to say what it is shows failed, its numbers null, never 0", async () => {
    const facts = asJson(
      await factsOf(
        { section: "board", board: "orders" },
        at("/telemetry/data", { status: 503, body: { type: "ProcessEngineException" } }),
      ),
    )
    expect(facts).toMatchObject({
      engines: [{ name: "fake", state: "failed", failure: "engineFailure" }],
      tiles: [
        { kind: "counter", count: null, enginesRead: 0, engines: 1 },
        { kind: "instanceList", shown: 0, groups: [{ engine: "fake", total: null }] },
        { kind: "incidentSummary", withIncident: null, enginesRead: 0 },
        { kind: "processDiagram", version: null },
        { kind: "incidentList", groups: [{ engine: "fake", shown: null }] },
      ],
    })
  })
})
