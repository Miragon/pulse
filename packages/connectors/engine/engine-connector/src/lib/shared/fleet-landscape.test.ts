import { describe, expect, it } from "vitest"
import type { DefinitionStat } from "../../view-models.js"
import { foldFleetLandscape, type FleetEngineReads } from "./fleet-landscape.js"

function definition(
  key: string,
  instances: number,
  { incidents = 0, failedJobs = 0, name = null as string | null } = {},
): DefinitionStat {
  return {
    id: `${key}:1:d`,
    key,
    name,
    latestVersion: 1,
    instances,
    failedJobs,
    incidents: incidents > 0 ? [{ incidentType: "failedJob", incidentCount: incidents }] : [],
  }
}

const BACKLOG = { executableJobs: 4, suspendedJobs: 1, jobsDueLater: 6, externalTasks: 2 }

/** prod-a and prod-b share `invoice`; each has one key of its own; down never answered. */
const READS: FleetEngineReads[] = [
  {
    engineId: "prod-a",
    definitions: [
      definition("invoice", 3, { incidents: 2, failedJobs: 1, name: "Invoice Receipt" }),
      definition("billing", 1),
    ],
    backlog: BACKLOG,
  },
  {
    engineId: "prod-b",
    definitions: [
      definition("invoice", 4, { incidents: 1, name: "Rechnungseingang" }),
      definition("onboarding", 0),
    ],
    backlog: null,
  },
  { engineId: "down", definitions: null, backlog: null },
]

describe("foldFleetLandscape", () => {
  it("rows every engine in order, an engine not read with no figure at all, never a 0", () => {
    const { engines } = foldFleetLandscape(READS)
    expect(engines.map((e) => e.engineId)).toEqual(["prod-a", "prod-b", "down"])
    expect(engines[0]).toEqual({
      engineId: "prod-a",
      read: true,
      runningInstances: 4,
      openIncidents: 2,
      failedJobs: 1,
      executableJobs: 4,
      suspendedJobs: 1,
      jobsDueLater: 6,
      externalTasks: 2,
      definitionKeys: 2,
      exclusiveDefinitionKeys: 1,
    })
    // The overview read, the backlog not: its four counts stay unknown.
    expect(engines[1]).toMatchObject({
      read: true,
      runningInstances: 4,
      executableJobs: null,
      externalTasks: null,
      exclusiveDefinitionKeys: 1,
    })
    expect(engines[2]).toEqual({
      engineId: "down",
      read: false,
      runningInstances: null,
      openIncidents: null,
      failedJobs: null,
      executableJobs: null,
      suspendedJobs: null,
      jobsDueLater: null,
      externalTasks: null,
      definitionKeys: null,
      exclusiveDefinitionKeys: null,
    })
  })

  it("lists a key once over the engines that deploy it, shared keys first, then by running", () => {
    const { processes } = foldFleetLandscape(READS)
    expect(processes.map((p) => p.processDefinitionKey)).toEqual([
      "invoice",
      "billing",
      "onboarding",
    ])
    expect(processes[0]).toEqual({
      processDefinitionKey: "invoice",
      name: "Invoice Receipt",
      engineIds: ["prod-a", "prod-b"],
      shared: true,
      runningByEngine: { "prod-a": 3, "prod-b": 4 },
      runningTotal: 7,
      openIncidentsTotal: 3,
    })
    // Deployed with nothing running is a 0 on its engine, not an empty cell.
    expect(processes[2]).toMatchObject({ engineIds: ["prod-b"], runningByEngine: { "prod-b": 0 } })
  })

  it("totals the read engines, so the reader knows a total without them is a lower bound", () => {
    expect(foldFleetLandscape(READS).totals).toEqual({
      engineCount: 3,
      readEngineCount: 2,
      processKeyCount: 3,
      sharedProcessKeyCount: 1,
      runningInstances: 8,
      openIncidents: 3,
    })
  })

  it("has no total while no engine is read", () => {
    const { totals, processes } = foldFleetLandscape([
      { engineId: "down", definitions: null, backlog: null },
    ])
    expect(totals).toMatchObject({
      readEngineCount: 0,
      runningInstances: null,
      openIncidents: null,
    })
    expect(processes).toEqual([])
  })

  // CLAUDE.md, "Never aggregate a RATE across engines": a figure over engines is a sum of counts.
  it("folds only absolute counts: every figure a whole number, every total the sum of the engines'", () => {
    const figures = foldFleetLandscape(READS)
    const numbers = JSON.stringify(figures).match(/-?\d+(\.\d+)?(?=[,}\]])/g) ?? []
    expect(numbers.length).toBeGreaterThan(0)
    expect(numbers.filter((n) => !Number.isInteger(Number(n)))).toEqual([])

    const engines = figures.engines.filter((e) => e.read)
    const sumOf = (pick: (e: (typeof engines)[number]) => number | null) =>
      engines.reduce((total, e) => total + (pick(e) ?? 0), 0)
    expect(figures.totals.runningInstances).toBe(sumOf((e) => e.runningInstances))
    expect(figures.totals.openIncidents).toBe(sumOf((e) => e.openIncidents))
    for (const p of figures.processes) {
      expect(p.runningTotal).toBe(Object.values(p.runningByEngine).reduce((a, b) => a + b, 0))
    }
  })
})
