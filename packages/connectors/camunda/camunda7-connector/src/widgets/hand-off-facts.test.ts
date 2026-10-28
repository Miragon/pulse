import { describe, expect, it } from "vitest"
import type {
  BpmnViewerData,
  IncidentsDashboardProcess,
  ProcessIncidentsData,
} from "../view-models.js"
import { explainDiagramHandOff } from "./bpmn-viewer/header.js"
import { processRootCauseHandOff } from "./incidents-dashboard/process-list.js"
import { triageProcessHandOff } from "./process-incidents/header.js"
import { handOffFor } from "./lib/hand-off.test-support.js"

/** Honest-numbers facts (#335) in the #338 hand-offs: a number the server cannot vouch for is left out, never 0. */

const PROCESS_VIEW: ProcessIncidentsData = {
  processDefinitionKey: "invoice",
  processDefinitionName: "Invoice",
  diagramVersion: 3,
  diagramDefinitionId: null,
  cockpitUrl: null,
  runningInstances: 40,
  incidentCount: 7,
  last24hCount: 2,
  failedJobs: 5,
  totalActivityCount: 2,
  affectedDiagramActivityCount: 1,
  latestIncident: "2026-10-01T08:00:00.000Z",
  activities: [
    {
      activityId: "Task_A",
      activityName: "A",
      representativeMessage: null,
      firstSeen: null,
      latestIncident: null,
      incidentCount: 4,
    },
    {
      activityId: "Task_Old",
      activityName: null,
      representativeMessage: null,
      firstSeen: null,
      latestIncident: null,
      incidentCount: 3,
    },
  ],
  siblingsWithIncidents: null,
  engineVendor: "CIB seven",
  engineId: "prod-a",
}

describe("triageProcessHandOff", () => {
  it("states key-wide counts and the diagram's own activity fraction", async () => {
    const prompt = (await handOffFor("read-only")).ask(
      triageProcessHandOff(PROCESS_VIEW, "prod-a"),
    )!
    expect(prompt).toContain('countScope="allVersions", diagramVersion=3, openIncidents=7')
    // "1 of 2" over the diagram — never the key-wide list over it ("2 of 2").
    expect(prompt).toContain("affectedDiagramActivities=1, diagramActivities=2")
    expect(prompt).toContain("affectedOnlyInOlderVersions=1")
  })

  it("leaves the fraction out without a diagram", async () => {
    const prompt = (await handOffFor("read-only")).ask(
      triageProcessHandOff(
        { ...PROCESS_VIEW, totalActivityCount: null, affectedDiagramActivityCount: null },
        "prod-a",
      ),
    )!
    expect(prompt).not.toMatch(/diagramActivities|affectedDiagramActivities|OlderVersions/)
  })
})

const CARD: IncidentsDashboardProcess = {
  processDefinitionKey: "invoice",
  processDefinitionName: "Invoice",
  latestVersion: 3,
  runningInstances: 40,
  incidentCount: 7,
  scannedIncidentCount: 0,
  affectedActivityCount: null,
  last24hCount: null,
  latestIncident: null,
  cockpitUrl: null,
  activities: [],
}

describe("processRootCauseHandOff", () => {
  it("states the card's exact key-wide count and leaves unscanned facts out", async () => {
    const prompt = (await handOffFor("read-only")).ask(processRootCauseHandOff(CARD, "prod-a", {}))!
    expect(prompt).toContain(
      'On screen: countScope="allVersions", latestVersion=3, openIncidents=7, runningInstances=40',
    )
    expect(prompt).not.toMatch(/affectedActivities|last24h|latestIncident/)
  })
})

describe("explainDiagramHandOff", () => {
  const VIEW: BpmnViewerData = {
    diagramDefinitionId: null,
    processInstanceId: "pi-1",
    businessKey: null,
    processDefinitionId: "invoice:3:abc",
    processDefinitionName: null,
    activeActivityIds: ["Task_A"],
    incidentActivityIds: ["Task_A"],
    activityStats: [{ id: "Task_A", instances: 1, failedJobs: 1 }],
    statsScope: "instance",
    engineId: "prod-a",
  }

  it("says whose counts the hotspots are", async () => {
    const h = await handOffFor("read-only")
    expect(h.ask(explainDiagramHandOff(VIEW))).toContain('statsScope="instance"')
    expect(h.ask(explainDiagramHandOff({ ...VIEW, statsScope: "definition" }))).toContain(
      'statsScope="definition"',
    )
  })
})
