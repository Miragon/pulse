import { afterEach, describe, expect, it } from "vitest"
import { registerProcessNumberTools } from "./process-numbers.js"
import {
  callTool,
  captureTools,
  registryFor,
  startFakeEngine,
  type FakeEngine,
  type FakeReply,
  type RecordedRequest,
} from "./test-support/fake-engine.js"
import type { ActivityCountsData, ActivityCountsRow } from "../data/activity-counts-data.js"

/**
 * `engine_activity_counts` on the wire: the element counts as the cockpit reads them, the open
 * tasks counted at user tasks alone, the newest incidents of each kind, a copy worded by its root
 * incident, and the screens' decorations.
 */

const tools = captureTools(registerProcessNumberTools)

const engines: FakeEngine[] = []
afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

async function call(answer: (request: RecordedRequest) => FakeReply, args: object) {
  const engine = await startFakeEngine({}, answer)
  engines.push(engine)
  const config = tools.get("engine_activity_counts")
  if (!config) throw new Error("engine_activity_counts is not registered")
  const result = await callTool(config, registryFor(engine), args as Record<string, unknown>)
  return { data: result as ActivityCountsData, requests: engine.requests }
}

const V1 = "order:1:d1"
const V2 = "order:2:d2"

const versions = [
  { id: V2, key: "order", name: null, version: 2, historyTimeToLive: null },
  { id: V1, key: "order", name: null, version: 1, historyTimeToLive: null },
]

// The activity counts: version 2 holds a user task, a multi-instance task, a root incident at a
// service task and inside a collapsed subprocess, and a call activity's copy; version 1 a token
// at the user task.

const COUNTS_XML =
  '<?xml version="1.0"?><bpmn:definitions><bpmn:process id="order" name="Order">' +
  '<bpmn:userTask id="review" name="Review"/><bpmn:serviceTask id="pay" name="Pay"/>' +
  '<bpmn:serviceTask id="charge" name="Charge"><bpmn:multiInstanceLoopCharacteristics/></bpmn:serviceTask>' +
  '<bpmn:callActivity id="ship" name="Ship" calledElement="shipping"/>' +
  '<bpmn:subProcess id="sub" name="Sub"><bpmn:serviceTask id="inner" name="Inner"/></bpmn:subProcess>' +
  "</bpmn:process></bpmn:definitions>"

const incident = (id: string, activityId: string, timestamp: string, extra: object = {}) => ({
  id,
  incidentType: "failedJob",
  activityId,
  processDefinitionId: V2,
  processInstanceId: `pi-${id}`,
  incidentMessage: `failed at ${activityId}`,
  incidentTimestamp: timestamp,
  rootCauseIncidentId: id,
  ...extra,
})

const COPY = incident("copy-1", "ship", "2026-11-24T10:00:00.000+0000", {
  rootCauseIncidentId: "root-9",
  incidentMessage: null,
})
const SCAN = [
  incident("pay-2", "pay", "2026-11-24T11:00:00.000+0000"),
  COPY,
  incident("inner-1", "inner", "2026-11-24T09:00:00.000+0000"),
  incident("pay-1", "pay", "2026-11-23T11:00:00.000+0000", { incidentMessage: "older" }),
]

function countsWorld(request: RecordedRequest): FakeReply {
  const { path, query } = request
  if (path === "/process-definition") return { body: versions }
  if (/^\/process-definition\/.+\/xml$/.test(path)) return { body: { bpmn20Xml: COUNTS_XML } }
  if (path === `/process-definition/${V2}/statistics`) {
    const failed = (count: number) => [{ incidentType: "failedJob", incidentCount: count }]
    return {
      body: [
        { id: "review", instances: 2, failedJobs: 0, incidents: [] },
        { id: "charge#multiInstanceBody", instances: 1, failedJobs: 0, incidents: [] },
        { id: "charge", instances: 2, failedJobs: 0, incidents: [] },
        { id: "pay", instances: 2, failedJobs: 2, incidents: failed(2) },
        { id: "ship", instances: 1, failedJobs: 0, incidents: failed(1) },
        { id: "inner", instances: 1, failedJobs: 1, incidents: failed(1) },
      ],
    }
  }
  if (path === `/process-definition/${V1}/statistics`) {
    return { body: [{ id: "review", instances: 1, failedJobs: 0, incidents: [] }] }
  }
  if (path === "/incident" && query.activityId === "ship") return { body: [COPY] }
  if (path === "/incident") return { body: query.processDefinitionId === V1 ? [] : SCAN }
  if (path === "/incident/root-9") {
    return {
      body: {
        id: "root-9",
        processInstanceId: "pi-label",
        processDefinitionId: "ship:1:s1",
        activityId: "label",
        incidentMessage: "label printer offline",
      },
    }
  }
  if (path === "/task/count")
    return { body: { count: query.taskDefinitionKey === "review" ? 3 : 0 } }
  if (path === "/task") return { body: [{ id: "t-1", created: "2026-11-20T08:00:00.000+0000" }] }
  return { status: 404, body: { type: "NotFoundException", message: `no ${path}` } }
}

describe("engine_activity_counts", () => {
  it("sums every version onto the latest diagram, as the cockpit's Running does", async () => {
    const { data, requests } = await call(countsWorld, {
      processDefinitionKey: "order",
    })
    expect(data).toMatchObject({
      engine: "fake",
      processDefinitionKey: "order",
      processDefinitionName: "Order",
      definitionId: V2,
      version: 2,
      versionsCounted: 2,
    })
    const rows: Record<string, ActivityCountsRow> = Object.fromEntries(
      data.activities.map((row) => [row.activityId, row]),
    )
    expect(rows.review).toMatchObject({
      name: "Review",
      inDiagram: true,
      running: 3,
      openTasks: 3,
      oldestOpenTask: "2026-11-20T08:00:00.000+0000",
    })
    // The multi-instance body counts on its activity.
    expect(rows.charge).toMatchObject({ running: 3, openTasks: 0, incidents: 0 })
    // A token a root incident holds counts as that incident.
    expect(rows.pay).toMatchObject({
      running: 0,
      incidents: 2,
      failedJobs: 2,
      latestIncident: { message: "failed at pay", at: "2026-11-24T11:00:00.000+0000" },
      latestIncidentInCalledInstances: null,
    })
    // The copy: the called instance's incident, its message its root's.
    expect(rows.ship).toMatchObject({
      running: 1,
      incidents: 0,
      incidentsInCalledInstances: 1,
      latestIncident: null,
      latestIncidentInCalledInstances: {
        message: "label printer offline",
        at: "2026-11-24T10:00:00.000+0000",
      },
    })
    // The screens' decorations: an incident inside the collapsed subprocess shows on it too.
    const decorations = new Map(
      data.decorations.map((decoration) => [decoration.elementId, decoration]),
    )
    expect(decorations.get("sub")).toEqual({
      elementId: "sub",
      counts: [{ kind: "incidents", count: 1, scope: "withIncident" }],
      incident: true,
      call: null,
    })
    expect(decorations.get("ship")?.counts).toEqual([
      { kind: "incidentsInCalledInstances", count: 1, scope: "withIncident" },
      { kind: "running", count: 1, scope: "running" },
    ])
    // Open tasks are counted at user tasks alone, over every version of the key.
    const taskCounts = requests.filter((r) => r.path === "/task/count")
    expect(taskCounts.map((r) => r.query)).toEqual([
      { processDefinitionKey: "order", taskDefinitionKey: "review" },
    ])
    expect(requests.some((r) => r.path.endsWith("/xml") && r.path.includes(V1))).toBe(false)
  })

  it("counts one version on its own diagram, and refuses a version not deployed", async () => {
    const { data, requests } = await call(countsWorld, {
      processDefinitionKey: "order",
      version: 1,
    })
    expect(data).toMatchObject({ definitionId: V1, version: 1, versionsCounted: 1 })
    expect(data.activities).toEqual([
      expect.objectContaining({ activityId: "review", running: 1, openTasks: 3 }),
    ])
    expect(requests.find((r) => r.path === "/task/count")?.query).toEqual({
      processDefinitionId: V1,
      taskDefinitionKey: "review",
    })
    // No incident in v1: no scan of the newest incidents.
    expect(requests.some((r) => r.path === "/incident")).toBe(false)
    await expect(call(countsWorld, { processDefinitionKey: "order", version: 7 })).rejects.toThrow(
      'Version 7 of process definition key "order" is not deployed on this engine (its versions: 2, 1).',
    )
  })
})
