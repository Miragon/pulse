import { afterEach, describe, expect, it } from "vitest"
import {
  clientFor,
  startFakeEngine,
  type FakeEngine,
  type FakeRoutes,
} from "../tools/test-support/fake-engine.js"
import { buildBpmnViewerData } from "./bpmn-viewer-data.js"

// Badges are scoped to the target (#335 N66): an instance never shows the
// version statistics ("55 failed jobs" on an instance that has one).

const engines: FakeEngine[] = []
afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

const DEF = "order:1:d1"

const ROUTES: FakeRoutes = {
  "GET /process-instance/pi-1": { body: { id: "pi-1", definitionId: DEF } },
  [`GET /process-definition/${DEF}/xml`]: { body: { id: DEF, bpmn20Xml: "<definitions/>" } },
  "GET /process-instance/pi-1/activity-instances": {
    body: {
      id: "pi-1",
      activityId: "order",
      // A multi-instance activity: two tokens on `charge`; one async token at `ship`.
      childActivityInstances: [
        {
          id: "mi",
          activityId: "charge#multiInstanceBody",
          childActivityInstances: [
            { id: "c1", activityId: "charge", childActivityInstances: [] },
            { id: "c2", activityId: "charge", childActivityInstances: [] },
          ],
        },
      ],
      childTransitionInstances: [{ id: "t1", activityId: "ship" }],
    },
  },
  "GET /incident": { body: [{ id: "i1", activityId: "charge" }] },
  "GET /job": { body: [{ id: "j1", failedActivityId: "charge" }] },
  // The version-wide numbers the instance view must NOT show.
  [`GET /process-definition/${DEF}/statistics`]: {
    body: [{ id: "charge", instances: 55, failedJobs: 55 }],
  },
  "GET /process-definition": { body: [{ id: DEF }] },
}

async function build(target: Parameters<typeof buildBpmnViewerData>[2]) {
  const engine = await startFakeEngine(ROUTES, { body: [] })
  engines.push(engine)
  const data = await buildBpmnViewerData(clientFor(engine), "fake", target)
  return { data, requests: engine.requests }
}

describe("buildBpmnViewerData — instance-scoped overlays (#335 N66)", () => {
  it("counts the instance's own tokens and failed jobs, never the version's statistics", async () => {
    const { data, requests } = await build({ processInstanceId: "pi-1" })

    expect(data).toMatchObject({
      processInstanceId: "pi-1",
      processDefinitionId: DEF,
      diagramDefinitionId: DEF,
      statsScope: "instance",
      incidentActivityIds: ["charge"],
      engineId: "fake",
    })
    expect(data.activityStats).toEqual([
      { id: "charge#multiInstanceBody", instances: 1, failedJobs: 0 },
      { id: "charge", instances: 2, failedJobs: 1 },
      { id: "ship", instances: 1, failedJobs: 0 },
    ])
    expect(requests.some((r) => r.path.endsWith("/statistics"))).toBe(false)
    expect(requests.find((r) => r.path === "/job")?.query).toEqual({
      processInstanceId: "pi-1",
      noRetriesLeft: "true",
    })
    expect(requests.find((r) => r.path === "/incident")?.query).toEqual({
      processInstanceId: "pi-1",
    })
  })

  it("draws a bare definition from the version's statistics, and says so", async () => {
    const { data, requests } = await build({ processDefinitionKey: "order" })

    expect(data).toMatchObject({
      processInstanceId: null,
      processDefinitionId: DEF,
      statsScope: "definition",
      activeActivityIds: [],
      incidentActivityIds: [],
      activityStats: [{ id: "charge", instances: 55, failedJobs: 55 }],
    })
    // The highest version over every tenant — sorted, so one of several
    // per-tenant latest versions is never picked at random.
    expect(requests.find((r) => r.path === "/process-definition")?.query).toEqual({
      key: "order",
      latestVersion: "true",
      sortBy: "version",
      sortOrder: "desc",
      maxResults: "1",
    })
    expect(requests.find((r) => r.path.endsWith("/statistics"))?.query).toEqual({
      failedJobs: "true",
    })
  })

  it("names the process from its diagram and the instance by its business key (#322 U13)", async () => {
    const xml = '<definitions><process id="order" name="Order to cash"/></definitions>'
    const named = await startFakeEngine(
      {
        ...ROUTES,
        "GET /process-instance/pi-1": {
          body: { id: "pi-1", definitionId: DEF, businessKey: "ORD-7" },
        },
        [`GET /process-definition/${DEF}/xml`]: { body: { id: DEF, bpmn20Xml: xml } },
      },
      { body: [] },
    )
    engines.push(named)

    const instance = await buildBpmnViewerData(clientFor(named), "fake", {
      processInstanceId: "pi-1",
    })
    const definition = await buildBpmnViewerData(clientFor(named), "fake", {
      processDefinitionKey: "order",
    })

    expect([instance.processDefinitionName, instance.businessKey]).toEqual([
      "Order to cash",
      "ORD-7",
    ])
    expect([definition.processDefinitionName, definition.businessKey]).toEqual([
      "Order to cash",
      null,
    ])
    // An unnamed process or an instance without a key leaves the fields null.
    const { data } = await build({ processInstanceId: "pi-1" })
    expect([data.processDefinitionName, data.businessKey]).toEqual([null, null])
  })

  // One rule with analytics (`parseBpmnNames`): the Modeler names the pool and
  // writes a line break or `&` as a character reference.
  it("names a Modeler collaboration's process by its pool, references decoded", async () => {
    const xml = `<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
  <bpmn:collaboration id="Collaboration_1">
    <bpmn:participant id="Pool" name="Miravelo - Bike&#10;Leasing &#38; Co" processRef="order" />
  </bpmn:collaboration>
  <bpmn:process id="order" isExecutable="true" />
</bpmn:definitions>`
    const pooled = await startFakeEngine(
      {
        ...ROUTES,
        "GET /process-instance/pi-1": { body: { id: "pi-1", definitionId: DEF } },
        [`GET /process-definition/${DEF}/xml`]: { body: { id: DEF, bpmn20Xml: xml } },
      },
      { body: [] },
    )
    engines.push(pooled)

    const view = await buildBpmnViewerData(clientFor(pooled), "fake", { processInstanceId: "pi-1" })

    expect(view.processDefinitionName).toBe("Miravelo - Bike Leasing & Co")
  })

  it("returns the explicit empty shape for a key with no such version", async () => {
    const engine = await startFakeEngine({}, { body: [] })
    engines.push(engine)

    const data = await buildBpmnViewerData(clientFor(engine), "fake", {
      processDefinitionKey: "order",
      version: 9,
    })

    expect(data).toMatchObject({
      processDefinitionId: null,
      processDefinitionName: null,
      businessKey: null,
      diagramDefinitionId: null,
      activityStats: [],
    })
  })
})
