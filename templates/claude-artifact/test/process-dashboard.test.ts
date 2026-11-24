import { describe, expect, it } from "vitest"
import {
  readDiagram,
  readIncidents,
  readKpis,
  readOutcomes,
  readPerDay,
  readTasks,
} from "../src/data/process-dashboard.ts"
import { dayStarts } from "../src/data/stats.ts"
import { createEngine } from "../src/engine/engine.ts"
import type { ToolName } from "../src/engine/tools.ts"
import { fakeConnector, pageOf } from "./fake.ts"

const NOW = new Date("2026-11-24T12:00:00.000Z")
const V1 = { id: "p:1:a", key: "p", version: 1, name: null }
const V2 = { id: "p:2:b", key: "p", version: 2, name: null }
const XML =
  '<definitions><process id="p" name="Leasing"><userTask id="Task_Decide" name="Decide" /></process></definitions>'

/** Root incidents name themselves as their root; copies name the incident they stand for. */
const INCIDENTS = [
  {
    id: "i1",
    rootCauseIncidentId: "i1",
    executionId: "e-send-1",
    activityId: "Task_Send",
    incidentMessage: "old",
    incidentTimestamp: "2026-11-20T10:00:00.000+0000",
  },
  {
    id: "i2",
    rootCauseIncidentId: "i2",
    executionId: "e-send-2",
    activityId: "Task_Send",
    incidentMessage: "new",
    incidentTimestamp: "2026-11-23T10:00:00.000+0000",
  },
  {
    id: "i3",
    rootCauseIncidentId: null,
    executionId: "e-bill",
    activityId: "Task_Bill",
    incidentMessage: "x",
    incidentTimestamp: "2026-11-22T10:00:00.000+0000",
  },
  {
    id: "c1",
    rootCauseIncidentId: "r9",
    executionId: "e-call-1",
    activityId: "Call_Assess",
    incidentMessage: null,
    incidentTimestamp: "2026-11-23T11:00:00.000+0000",
  },
  {
    id: "c2",
    rootCauseIncidentId: "r8",
    executionId: "e-call-2",
    activityId: "Call_Assess",
    incidentMessage: null,
    incidentTimestamp: "2026-11-23T12:00:00.000+0000",
  },
]

const iso = (d: Date) => d.toISOString().replace("Z", "+0000")
const hoursAgo = (h: number) => iso(new Date(NOW.getTime() - h * 3_600_000))

function engineOver(
  answers: Partial<Record<ToolName, (args: Record<string, unknown>) => unknown>>,
) {
  const connector = fakeConnector((name, args) => {
    const answer = answers[name]
    if (answer === undefined) throw new Error(`unexpected call ${name}`)
    return answer(args)
  })
  return { connector, engine: createEngine(connector, { engineId: "prod-a", now: () => NOW }) }
}

const PROCESS = {
  engine_list_process_definitions: (args: Record<string, unknown>) => pageOf([V2, V1], args),
  engine_get_process_definition_xml: () => ({ id: V2.id, bpmn20Xml: XML }),
}

describe("the tiles", () => {
  it("read the engine's status for the key, 'With incident' from the runtime, the last 24 h by instants", async () => {
    const { connector, engine } = engineOver({
      engine_status: () => ({
        definitions: [{ key: "p", instances: 12, failedJobs: 3, incidents: 2 }],
      }),
      engine_list_process_instances: () => ({ items: [], totalCount: 5 }),
      engine_list_tasks: () => ({ items: [], totalCount: 7 }),
      engine_query_historic_process_instances: (args) => ({
        items: [],
        totalCount: args.startedAfter ? 9 : 8,
      }),
    })
    expect(await readKpis(engine, "p")).toEqual({
      running: 12,
      failedJobs: 3,
      incidents: 2,
      withIncident: 5,
      openTasks: 7,
      started24h: 9,
      ended24h: 8,
    })
    const instances = connector.calls.find((call) => call.name === "engine_list_process_instances")
    expect(instances?.args).toMatchObject({
      processDefinitionKey: "p",
      withIncidents: true,
      maxResults: 1,
    })
    const started = connector.calls.find((call) => call.args.startedAfter !== undefined)
    expect(started?.args.startedAfter).toBe("2026-11-23T12:00:00.000Z")
  })

  it("leave a count the status lacks unknown, never 0", async () => {
    const { engine } = engineOver({
      engine_status: () => ({ definitions: [] }),
      engine_list_process_instances: () => ({ items: [] }),
      engine_list_tasks: () => ({ items: [], totalCount: 0 }),
      engine_query_historic_process_instances: () => ({ items: [], totalCount: 0 }),
    })
    const kpis = await readKpis(engine, "p")
    expect([kpis.running, kpis.incidents, kpis.withIncident]).toEqual([null, null, null])
    expect(kpis.openTasks).toBe(0)
  })
})

/** An open activity instance of a version: its id, activity, type and execution. */
const open = (id: string, activityId: string, activityType: string, executionId = `e-${id}`) => ({
  id,
  activityId,
  activityType,
  executionId,
})

describe("the diagram's badges", () => {
  it("count root incidents at their activity and copies apart on the call activity, running over every version", async () => {
    const { connector, engine } = engineOver({
      ...PROCESS,
      engine_list_incidents: (args) => pageOf(INCIDENTS, args),
      engine_query_historic_activity_instances: (args) =>
        pageOf(
          args.processDefinitionId === V1.id
            ? [open("a1", "Task_Decide", "userTask"), open("a2", "Call_Assess", "callActivity")]
            : [
                open("b1", "Task_Decide", "userTask"),
                open("b2", "Task_Multi#multiInstanceBody", "multiInstanceBody"),
                open("b3", "Task_Multi", "serviceTask"),
              ],
          args,
        ),
    })
    const diagram = await readDiagram(engine, "p")
    expect(diagram.process.latest?.version).toBe(2)
    expect(diagram.badges).toEqual([
      { elementId: "Call_Assess", running: 1, incidents: 0, incidentsInCalledInstances: 2 },
      { elementId: "Task_Bill", running: 0, incidents: 1, incidentsInCalledInstances: 0 },
      { elementId: "Task_Decide", running: 2, incidents: 0, incidentsInCalledInstances: 0 },
      { elementId: "Task_Multi", running: 1, incidents: 0, incidentsInCalledInstances: 0 },
      { elementId: "Task_Send", running: 0, incidents: 2, incidentsInCalledInstances: 0 },
    ])
    expect(diagram).toMatchObject({ complete: true, cut: null })
    const running = connector.calls.filter(
      (call) => call.name === "engine_query_historic_activity_instances",
    )
    expect(running.map((call) => call.args.processDefinitionId).sort()).toEqual([V1.id, V2.id])
  })

  it("count a token an own root incident holds as that incident, never as running too", async () => {
    // The cockpit's rule (c7-core's ElementStatisticsReader): active = tokens minus the root
    // incidents raised there. An external task without retries keeps its activity instance open
    // on the incident's execution; a failed job before an asynchronous step has none; a copy at
    // a call activity holds no token of its own.
    const incidents = [
      { id: "x1", rootCauseIncidentId: "x1", executionId: "e-ext-1", activityId: "Task_Ext" },
      { id: "j1", rootCauseIncidentId: "j1", executionId: "e-async", activityId: "Task_Async" },
      { id: "k1", rootCauseIncidentId: "r1", executionId: "e-call-1", activityId: "Call_Assess" },
    ]
    const { engine } = engineOver({
      ...PROCESS,
      engine_list_incidents: (args) => pageOf(incidents, args),
      engine_query_historic_activity_instances: (args) =>
        pageOf(
          args.processDefinitionId === V2.id
            ? [
                open("h1", "Task_Ext", "serviceTask", "e-ext-1"),
                open("h2", "Task_Ext", "serviceTask", "e-ext-2"),
                open("h3", "Call_Assess", "callActivity", "e-call-1"),
              ]
            : [],
          args,
        ),
    })
    const { badges } = await readDiagram(engine, "p")
    expect(badges).toEqual([
      { elementId: "Call_Assess", running: 1, incidents: 0, incidentsInCalledInstances: 1 },
      { elementId: "Task_Async", running: 0, incidents: 1, incidentsInCalledInstances: 0 },
      { elementId: "Task_Ext", running: 1, incidents: 1, incidentsInCalledInstances: 0 },
    ])
  })

  it("count no scope's own activity instance and put a multi-instance body's incident on its activity", async () => {
    // Measured on CIB seven: the runtime's statistics hold the tokens at the inner activities only,
    // never at a multi-instance body, an embedded or event subprocess or a transaction, while the
    // history keeps their activity instances open; an asynchronous multi-instance activity's
    // failed job raises its incident on the body.
    const incidents = [
      {
        id: "m1",
        rootCauseIncidentId: "m1",
        executionId: "e-body",
        activityId: "Task_Par#multiInstanceBody",
      },
    ]
    const { engine } = engineOver({
      ...PROCESS,
      engine_list_incidents: (args) => pageOf(incidents, args),
      engine_query_historic_activity_instances: (args) =>
        pageOf(
          args.processDefinitionId === V2.id
            ? [
                open("s1", "Task_Seq#multiInstanceBody", "multiInstanceBody"),
                open("s2", "Task_Seq", "userTask"),
                open("s3", "Sub", "subProcess"),
                open("s4", "Sub_Inner", "userTask"),
                open("s5", "Trx", "transaction"),
                open("s6", "Trx_Task", "userTask"),
                open("s7", "Event_Sub", "subProcess"),
                open("s8", "Event_Task", "userTask"),
              ]
            : [],
          args,
        ),
    })
    const { badges } = await readDiagram(engine, "p")
    expect(badges).toEqual([
      { elementId: "Event_Task", running: 1, incidents: 0, incidentsInCalledInstances: 0 },
      { elementId: "Sub_Inner", running: 1, incidents: 0, incidentsInCalledInstances: 0 },
      { elementId: "Task_Par", running: 0, incidents: 1, incidentsInCalledInstances: 0 },
      { elementId: "Task_Seq", running: 1, incidents: 0, incidentsInCalledInstances: 0 },
      { elementId: "Trx_Task", running: 1, incidents: 0, incidentsInCalledInstances: 0 },
    ])
  })

  it("read at most 4 versions at once and mark the badges cut when the versions read are", async () => {
    const versions = Array.from({ length: 10 }, (_, i) => ({
      id: `p:${String(i + 1)}:x`,
      key: "p",
      version: i + 1,
      name: null,
    }))
    let inFlight = 0
    let most = 0
    const { connector, engine } = engineOver({
      // The engine counts 11 versions but lists 10: a deployment while the versions were paged.
      engine_list_process_definitions: (args) => ({ ...pageOf(versions, args), totalCount: 11 }),
      engine_get_process_definition_xml: () => ({ id: "p:10:x", bpmn20Xml: XML }),
      engine_list_incidents: (args) => pageOf([], args),
      engine_query_historic_activity_instances: async (args) => {
        inFlight += 1
        most = Math.max(most, inFlight)
        await new Promise((done) => setTimeout(done, 5))
        inFlight -= 1
        return pageOf([], args)
      },
    })
    const diagram = await readDiagram(engine, "p")
    expect(most).toBe(4)
    expect(
      connector.calls.filter((call) => call.name === "engine_query_historic_activity_instances"),
    ).toHaveLength(10)
    expect(diagram).toMatchObject({ complete: false, cut: "changed" })
    expect(diagram.process.versionsCut).toBe("changed")
  })
})

describe("the incidents table", () => {
  it("groups the roots by activity with the latest message, the copies apart", async () => {
    const { engine } = engineOver({
      ...PROCESS,
      engine_list_incidents: (args) => pageOf(INCIDENTS, args),
    })
    const { groups } = await readIncidents(engine, "p")
    expect(groups).toEqual([
      {
        activityId: "Task_Send",
        kind: "own",
        count: 2,
        latestMessage: "new",
        latestAt: INCIDENTS[1].incidentTimestamp,
      },
      {
        activityId: "Task_Bill",
        kind: "own",
        count: 1,
        latestMessage: "x",
        latestAt: INCIDENTS[2].incidentTimestamp,
      },
      {
        activityId: "Call_Assess",
        kind: "called",
        count: 2,
        latestMessage: null,
        latestAt: INCIDENTS[4].incidentTimestamp,
      },
    ])
  })
})

describe("started and ended per day", () => {
  interface Row {
    id: string
    startTime: string
    endTime: string | null
    durationInMillis: number | null
  }
  const started: Row[] = [hoursAgo(1), hoursAgo(2), hoursAgo(30)].map((startTime, i) => ({
    id: `s${String(i)}`,
    startTime,
    endTime: null,
    durationInMillis: null,
  }))
  const ended: Row[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({
    id: `e${String(n)}`,
    startTime: hoursAgo(50),
    endTime: hoursAgo(n),
    durationInMillis: n * 1000,
  }))

  it("buckets the instances of the window by day and takes the median and P90 of the ended", async () => {
    const { connector, engine } = engineOver({
      engine_query_historic_process_instances: (args) =>
        pageOf(args.startedAfter ? started : ended, args),
    })
    const data = await readPerDay(engine, "p")
    expect(data.days).toHaveLength(14)
    expect(data.days.reduce((sum, day) => sum + day.started, 0)).toBe(3)
    expect(data.days.reduce((sum, day) => sum + day.ended, 0)).toBe(10)
    expect([data.medianMs, data.p90Ms]).toEqual([5000, 9000])
    expect(data).toMatchObject({
      durationsRead: 10,
      durationsComplete: true,
      complete: true,
      cut: null,
    })
    expect(connector.calls[0].args.startedAfter).toBe("2026-11-09T12:00:00.000Z")
  })

  it("marks a cut read: the bars are lower bounds, the median and P90 over the rows read", async () => {
    const many: Row[] = Array.from({ length: 1200 }, (_, i) => ({
      id: `m${String(i).padStart(4, "0")}`,
      startTime: hoursAgo(50),
      endTime: hoursAgo(1 + (i % 24)),
      durationInMillis: i,
    }))
    const { engine } = engineOver({
      engine_query_historic_process_instances: (args) =>
        pageOf(args.startedAfter ? started : many, args),
    })
    const data = await readPerDay(engine, "p")
    expect(data.days.reduce((sum, day) => sum + day.ended, 0)).toBe(1000)
    expect(data).toMatchObject({
      durationsRead: 1000,
      durationsComplete: false,
      complete: false,
      cut: "cap",
    })
  })
})

describe("outcomes", () => {
  const ended = (id: string, activityId: string, activityName: string, hours: number) => ({
    id,
    activityId,
    activityName,
    endTime: hoursAgo(hours),
  })

  it("count the plain end events reached since the chart's first day, every version summed", async () => {
    const { connector, engine } = engineOver({
      ...PROCESS,
      engine_query_historic_activity_instances: (args) =>
        pageOf(
          args.processDefinitionId === V1.id
            ? [
                ended("o1", "End_Ok", "Issued", 3),
                ended("o2", "End_No", "Rejected", 30),
                // Inside the read's window, before the chart's first local day in every time zone.
                ended("o3", "End_No", "Rejected", 14 * 24 + 12),
              ]
            : [ended("o4", "End_Ok", "Issued", 1)],
          args,
        ),
    })
    const data = await readOutcomes(engine, "p")
    expect(data.outcomes).toEqual([
      { activityId: "End_Ok", activityName: "Issued", count: 2 },
      { activityId: "End_No", activityName: "Rejected", count: 1 },
    ])
    expect(data).toMatchObject({ reached: 3, complete: true, cut: null })
    // The chart's window: its first local day, read by instants a day earlier, so the recorded
    // arguments match on replay in any time zone.
    expect(data.since).toEqual(dayStarts(NOW, 14)[0])
    expect(
      connector.calls.find((call) => call.name === "engine_query_historic_activity_instances")
        ?.args,
    ).toMatchObject({
      activityType: "noneEndEvent",
      finishedAfter: "2026-11-09T12:00:00.000Z",
    })
  })

  it("mark the outcomes cut when the versions read are", async () => {
    const { engine } = engineOver({
      engine_list_process_definitions: (args) => ({ ...pageOf([V2, V1], args), totalCount: 3 }),
      engine_get_process_definition_xml: () => ({ id: V2.id, bpmn20Xml: XML }),
      engine_query_historic_activity_instances: (args) => pageOf([], args),
    })
    expect(await readOutcomes(engine, "p")).toMatchObject({ complete: false, cut: "changed" })
  })
})

describe("open tasks", () => {
  it("group by task with the oldest", async () => {
    const tasks = [
      {
        id: "t1",
        taskDefinitionKey: "Task_Decide",
        name: "Decide",
        created: "2026-11-23T10:00:00.000+0000",
      },
      {
        id: "t2",
        taskDefinitionKey: "Task_Decide",
        name: "Decide",
        created: "2026-11-20T10:00:00.000+0000",
      },
      {
        id: "t3",
        taskDefinitionKey: "Task_Speed",
        name: "Speed up",
        created: "2026-11-24T10:00:00.000+0000",
      },
    ]
    const { engine } = engineOver({ ...PROCESS, engine_list_tasks: (args) => pageOf(tasks, args) })
    const data = await readTasks(engine, "p")
    expect(data.groups).toEqual([
      {
        taskDefinitionKey: "Task_Decide",
        name: "Decide",
        count: 2,
        oldestCreated: tasks[1].created,
      },
      {
        taskDefinitionKey: "Task_Speed",
        name: "Speed up",
        count: 1,
        oldestCreated: tasks[2].created,
      },
    ])
    expect(data.total).toBe(3)
  })
})
