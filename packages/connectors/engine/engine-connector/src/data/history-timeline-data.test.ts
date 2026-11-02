import { afterEach, describe, expect, it } from "vitest"
import { clientFor, startFakeEngine, type FakeEngine } from "../tools/test-support/fake-engine.js"
import { ENGINE_FAILURE, WORLD, worldReply } from "../tools/test-support/engine-world.js"
import { buildHistoryTimelineData } from "./history-timeline-data.js"

// Enrichment (#322 U14): an unreadable incident list leaves the timeline
// unmarked (null), never "no incidents" ([]).

const engines: FakeEngine[] = []
afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

async function build(failIncidents: boolean) {
  const engine = await startFakeEngine({}, (request) =>
    failIncidents && request.path === "/incident" ? ENGINE_FAILURE : worldReply(request),
  )
  engines.push(engine)
  const data = await buildHistoryTimelineData(clientFor(engine), "fake", {
    processInstanceId: WORLD.instanceId,
  })
  return { data, engine }
}

describe("buildHistoryTimelineData — the failing steps", () => {
  it("names the activities with an open incident on this instance", async () => {
    const { data, engine } = await build(false)
    expect(data.incidentActivityIds).toEqual([WORLD.activityId])
    expect(engine.requests.find((r) => r.path === "/incident")?.query).toEqual({
      processInstanceId: WORLD.instanceId,
      maxResults: "100",
    })
  })

  it("leaves the marks unknown when the incident read fails", async () => {
    const { data } = await build(true)
    expect(data.incidentActivityIds).toBeNull()
    expect(data.totalActivities).toBe(1)
  })
})

// One rule with analytics (`readBpmnNames`): a Modeler pool names the process.
describe("buildHistoryTimelineData — the process name", () => {
  const instance = (processDefinitionName: string | null) => ({
    id: "pi-1",
    processDefinitionId: "miraveloLeasing:3:d",
    processDefinitionKey: "miraveloLeasing",
    processDefinitionName,
    startTime: "2026-10-01T10:00:00.000+0000",
    endTime: null,
    durationInMillis: null,
    state: "ACTIVE",
  })
  const pooled = `<definitions><collaboration id="C"><participant id="Pool" name="Miravelo - Bike Leasing" processRef="miraveloLeasing"/></collaboration><process id="miraveloLeasing"/></definitions>`

  async function timeline(processDefinitionName: string | null) {
    const engine = await startFakeEngine(
      {
        "GET /history/process-instance": { body: [instance(processDefinitionName)] },
        "GET /history/activity-instance/count": { body: { count: 0 } },
        "GET /process-definition/miraveloLeasing:3:d/xml": { body: { bpmn20Xml: pooled } },
      },
      { body: [] },
    )
    engines.push(engine)
    const data = await buildHistoryTimelineData(clientFor(engine), "fake", {
      processInstanceId: "pi-1",
    })
    return { data, engine }
  }

  it("names an unnamed process by its Modeler pool", async () => {
    const { data } = await timeline(null)
    expect(data.processInstance?.processDefinitionName).toBe("Miravelo - Bike Leasing")
  })

  it("keeps the engine's name, and reads no diagram for it", async () => {
    const { data, engine } = await timeline("Bike Leasing")
    expect(data.processInstance?.processDefinitionName).toBe("Bike Leasing")
    expect(engine.requests.some((r) => r.path.endsWith("/xml"))).toBe(false)
  })
})
