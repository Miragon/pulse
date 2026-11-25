import { describe, expect, it } from "vitest"
import {
  boundOf,
  historyCutOf,
  incidentsOf,
  outcomesOf,
  readDiagram,
  readStats,
  tasksOf,
  type ActivityCounts,
  type ActivityRow,
  type ProcessStats,
} from "../src/data/process-dashboard.ts"
import { createEngine } from "../src/engine/engine.ts"
import type { ToolName } from "../src/engine/tools.ts"
import { fakeConnector } from "./fake.ts"

const NOW = new Date("2026-11-24T12:00:00.000Z")

/** One activity's row as `engine_activity_counts` answers it, every count 0 but `counts`. */
function row(activityId: string, counts: Partial<ActivityRow> = {}): ActivityRow {
  return {
    activityId,
    name: null,
    running: 0,
    openTasks: 0,
    oldestOpenTask: null,
    incidents: 0,
    incidentsInCalledInstances: 0,
    failedJobs: 0,
    latestIncident: null,
    latestIncidentInCalledInstances: null,
    ...counts,
  }
}

const COUNTS: ActivityCounts = {
  engine: "prod-a",
  processDefinitionKey: "p",
  processDefinitionName: "Leasing",
  asOf: "2026-11-24T11:59:58.000Z",
  definitionId: "p:2:b",
  version: 2,
  versionsCounted: 2,
  decorations: [],
  activities: [
    row("Call_Assess", { running: 60, incidentsInCalledInstances: 60 }),
    row("Task_Decide", { name: "Decide", running: 25, openTasks: 25 }),
    row("Task_Speed", { name: "Speed up", running: 24, openTasks: 24 }),
    row("Task_Send", { incidents: 8, failedJobs: 8 }),
    row("Task_Bill", { incidents: 8 }),
    row("Task_Late", { incidents: 2 }),
  ],
}

const day = (
  start: string,
  started: ProcessStats["buckets"][number]["started"],
  ended: number,
) => ({
  start,
  end: start,
  started,
  ended,
  endedAt: {},
})

const STATS: ProcessStats = {
  engine: "prod-a",
  processDefinitionKey: "p",
  processDefinitionName: "Leasing",
  asOf: "2026-11-24T11:59:59.000Z",
  versions: { count: 2, latestVersion: 2, latestDefinitionId: "p:2:b" },
  now: {
    running: 93,
    incidents: 8,
    withIncident: 68,
    failedJobs: 8,
    openTasks: 49,
    startedLast24h: 142,
    endedLast24h: 129,
  },
  range: {
    from: "2026-11-10T23:00:00.000Z",
    to: NOW.toISOString(),
    bucket: "day",
    timeZone: "Europe/Berlin",
  },
  history: { timeToLiveDays: 30, keptFrom: "2026-10-25T12:00:00.000Z", recorded: true },
  totals: { started: 406, ended: 363 },
  buckets: [day("2026-11-10T23:00:00.000Z", 33, 31), day("2026-11-23T23:00:00.000Z", 137, 126)],
  endEvents: [
    { activityId: "End_Fast", name: "Decision accelerated", ended: 3 },
    { activityId: "End_None", name: null, ended: 0 },
    { activityId: "End_Issued", name: "Policy issued", ended: 336 },
    { activityId: "End_Rejected", name: "Policy rejected", ended: { atLeast: 27 } },
  ],
  durations: { from: "2026-11-10T23:00:00.000Z", ended: 363, medianMs: 27947, p90Ms: 300058 },
}

function engineOver(
  answers: Partial<Record<ToolName, (args: Record<string, unknown>) => unknown>>,
) {
  const connector = fakeConnector((name, args) => {
    const answer = answers[name]
    if (answer === undefined) throw new Error(`unexpected call ${name}`)
    return answer(args)
  })
  const engine = createEngine(connector, { now: () => NOW, timeZone: "Europe/Berlin" })
  return { connector, engine }
}

describe("the three calls of a load", () => {
  it("reads the process's numbers per day in the viewer's time zone, the server's range", async () => {
    const { connector, engine } = engineOver({ engine_process_stats: () => STATS })
    expect(await readStats(engine, "p")).toBe(STATS)
    expect(connector.calls.map((call) => [call.name, call.args])).toEqual([
      [
        "engine_process_stats",
        { processDefinitionKey: "p", bucket: "day", timeZone: "Europe/Berlin" },
      ],
    ])
  })

  it("reads the counts per activity, then the XML of the version they are drawn on", async () => {
    const { connector, engine } = engineOver({
      engine_activity_counts: () => COUNTS,
      engine_get_process_definition_xml: (args) => ({
        id: args.processDefinitionId,
        bpmn20Xml: "<x/>",
      }),
    })
    expect(await readDiagram(engine, "p")).toEqual({ counts: COUNTS, xml: "<x/>" })
    expect(connector.calls.map((call) => [call.name, call.args])).toEqual([
      ["engine_activity_counts", { processDefinitionKey: "p" }],
      ["engine_get_process_definition_xml", { processDefinitionId: "p:2:b" }],
    ])
  })

  it("reads a diagram without XML as none", async () => {
    const { engine } = engineOver({
      engine_activity_counts: () => COUNTS,
      engine_get_process_definition_xml: () => ({ id: "p:2:b", bpmn20Xml: null }),
    })
    expect((await readDiagram(engine, "p")).xml).toBeNull()
  })
})

describe("what the sections show", () => {
  it("lists the end events instances reached, the most first, each share of every instance that ended", () => {
    expect(outcomesOf(STATS)).toEqual({
      outcomes: [
        { activityId: "End_Issued", name: "Policy issued", ended: 336 },
        { activityId: "End_Rejected", name: "Policy rejected", ended: { atLeast: 27 } },
        { activityId: "End_Fast", name: "Decision accelerated", ended: 3 },
      ],
      ended: 363,
    })
  })

  it("keeps an end event whose count is unknown, never read as none reached", () => {
    const unknown = {
      ...STATS,
      history: { ...STATS.history, recorded: false },
      totals: { started: null, ended: null },
      endEvents: STATS.endEvents.map((event) => ({ ...event, ended: null })),
    }
    expect(outcomesOf(unknown)).toEqual({
      outcomes: [
        { activityId: "End_Fast", name: "Decision accelerated", ended: null },
        { activityId: "End_Issued", name: "Policy issued", ended: null },
        { activityId: "End_None", name: null, ended: null },
        { activityId: "End_Rejected", name: "Policy rejected", ended: null },
      ],
      ended: null,
    })
  })

  it("puts the activities with own root incidents in the table, the called ones apart", () => {
    const { own, called } = incidentsOf(COUNTS)
    expect(own.map((r) => [r.activityId, r.incidents])).toEqual([
      ["Task_Bill", 8],
      ["Task_Send", 8],
      ["Task_Late", 2],
    ])
    expect(called.map((r) => [r.activityId, r.incidentsInCalledInstances])).toEqual([
      ["Call_Assess", 60],
    ])
  })

  it("lists the tasks with open tasks, the most first, never an element without", () => {
    expect(tasksOf(COUNTS).map((r) => [r.activityId, r.openTasks])).toEqual([
      ["Task_Decide", 25],
      ["Task_Speed", 24],
    ])
  })

  it("says from when the engine keeps history only where that cuts the chart's days", () => {
    expect(historyCutOf(STATS)).toBeNull()
    const cut = {
      ...STATS,
      history: { timeToLiveDays: 7, keptFrom: "2026-11-17T12:00:00.000Z", recorded: true },
    }
    expect(historyCutOf(cut)).toEqual(new Date("2026-11-17T12:00:00.000Z"))
    expect(
      historyCutOf({ ...STATS, history: { timeToLiveDays: null, keptFrom: null, recorded: true } }),
    ).toBeNull()
  })

  it("reads a count's known part: the number, a lower bound's bound, 0 for none known", () => {
    expect([boundOf(4), boundOf({ atLeast: 7 }), boundOf(null)]).toEqual([4, 7, 0])
  })
})
