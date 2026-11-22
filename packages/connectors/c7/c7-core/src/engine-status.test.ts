import { describe, expect, it } from "vitest"
import { readStatus, statusRequests } from "./engine-status.js"
import { fakePort, type Route } from "./testing/fake-port.js"
import { NOW, statistics } from "./testing/status.js"
import type { VerdictThresholds } from "./verdict.js"

const OPTIONS = { keys: [], staleAfterMs: 300_000, maxGroups: 10 }
const failedJob = (id: string, activityId: string) => ({
  id,
  rootCauseIncidentId: id,
  incidentType: "failedJob",
  activityId,
  processDefinitionId: "order:1:x",
  processInstanceId: `pi-${id}`,
  configuration: `j-${id}`,
  incidentMessage: "Unknown property used in expression: ${missingBean}",
  incidentTimestamp: "2026-01-01T11:00:00.000+0000",
})

function engine(overrides: Readonly<Record<string, Route>> = {}) {
  return fakePort({
    getRestAPIVersion: () => ({ version: "2.1.0" }),
    getProcessDefinitionStatistics: () => [statistics("order", 1, [41, 3, 3])],
    getIncidents: () => [failedJob("1", "book"), failedJob("2", "book"), failedJob("3", "pay")],
    getIncidentsCount: () => ({ count: 3 }),
    getExternalTasks: () => [
      { id: "e1", topicName: "mail", createTime: "2026-01-01T11:00:00.000+0000" },
    ],
    getExternalTasksCount: () => ({ count: 1 }),
    getJobsCount: () => ({ count: 5 }),
    getJobs: () => [{ id: "j9", dueDate: "2026-01-01T11:40:00.000+0000" }],
    getTasksCount: () => ({ count: 7 }),
    getBatchStatistics: () => [],
    getStacktrace: () =>
      "org.x.ProcessEngineException: outer\nCaused by: org.x.PropertyNotFoundException: Cannot resolve identifier 'missingBean'",
    ...overrides,
  })
}

/** A clock that advances 4 ms per read. */
function clock() {
  let now = NOW
  return () => {
    const current = now
    now += 4
    return current
  }
}

describe("readStatus", () => {
  it("triages the engine: findings, groups with their root cause, topics, jobs and counts", async () => {
    const port = engine()
    const data = await readStatus({ port, now: clock() }, OPTIONS)
    expect(data.engine).toEqual({ version: "2.1.0", latencyMs: 4 })
    expect(data.status).toBe("critical")
    expect(data.findings.map((finding) => finding.code)).toEqual([
      "JOBS_OVERDUE",
      "INCIDENTS",
      "INCIDENTS",
      "NO_WORKER",
    ])
    expect(data.incidents[0]).toMatchObject({
      activityId: "book",
      count: 2,
      rootCause: "PropertyNotFoundException: Cannot resolve identifier 'missingBean'",
      next: { action: "retryActivity", processDefinitionKey: "order", activityId: "book" },
    })
    expect(data).toMatchObject({
      rootIncidentsTotal: 3,
      incidentsTotal: 3,
      propagated: 0,
      jobs: { executable: 5, overdue: 1, oldestReadySince: "2026-01-01T11:40:00.000+0000" },
      tasks: { open: 7 },
      batches: { running: 0, withFailures: 0 },
    })
    expect(data.truncated).toBeUndefined()
    const jobs = port.calls.find((call) => call.operationId === "getJobs")
    expect(jobs?.input.query).toEqual({
      executable: "true",
      active: "true",
      createTimes: "lt_2026-01-01T11:55:00.000+0000",
      maxResults: "1000",
      processDefinitionKey: undefined,
    })
  })

  it("reads per key, skips the batches and names every cut", async () => {
    const port = engine({
      getIncidents: (input) =>
        Array.from({ length: Number(input.query.maxResults) }, (_, index) =>
          failedJob(String(index), `a${index % 12}`),
        ),
      getExternalTasks: (input) =>
        Array.from({ length: Number(input.query.maxResults) }, (_, index) => ({
          id: `e${index}`,
          topicName: "mail",
        })),
      getJobs: () =>
        Array.from({ length: 1000 }, () => ({ dueDate: "2026-01-01T11:00:00.000+0000" })),
    })
    const data = await readStatus(
      { port, now: clock() },
      { keys: ["order", "nope"], staleAfterMs: 300_000, maxGroups: 3 },
    )
    expect(data.truncated).toEqual([
      "incidents: 2000 of 3 loaded",
      "externalTasks: 2000 of 1 loaded",
      "jobs: the first 1000 overdue candidates loaded",
      "incident groups: 3 of 12 shown",
    ])
    expect(data.batches).toBeUndefined()
    expect(data.incidents).toHaveLength(3)
    expect(data.findings.some((finding) => finding.code === "UNKNOWN_KEY")).toBe(true)
    const operations = port.calls.map((call) => call.operationId)
    expect(operations).not.toContain("getBatchStatistics")
    expect(operations.filter((id) => id === "getJobsCount")).toHaveLength(2)
    const incidents = port.calls.find((call) => call.operationId === "getIncidents")
    expect(incidents?.input.query.processDefinitionKeyIn).toBe("order,nope")
  })

  it("names the overdue-job cut when one key's page is full, whatever the other keys hold", async () => {
    const port = engine({
      getJobs: (input) =>
        input.query.processDefinitionKey === "order"
          ? Array.from({ length: 1000 }, () => ({ dueDate: "2026-01-01T11:00:00.000+0000" }))
          : [],
    })
    const data = await readStatus({ port, now: clock() }, { ...OPTIONS, keys: ["order", "pay"] })
    expect(data.jobs.overdue).toBe(1000)
    expect(data.truncated).toEqual(["jobs: the first 1000 overdue candidates loaded"])
  })

  it("counts batches with failed jobs and keeps their incidents out of the groups", async () => {
    const data = await readStatus(
      {
        port: engine({
          getBatchStatistics: () => [
            { id: "b1", type: "migration", failedJobs: 1, batchJobDefinitionId: "jd-b" },
            { id: "b2", type: "migration", failedJobs: 0 },
          ],
          getIncidents: () => [{ ...failedJob("1", "x"), jobDefinitionId: "jd-b" }],
          getRestAPIVersion: () => ({}),
        }),
        now: clock(),
      },
      OPTIONS,
    )
    expect(data.batches).toEqual({ running: 2, withFailures: 1 })
    expect(data.incidents).toEqual([])
    expect(data.engine.version).toBeNull()
  })
})

describe("readStatus verdict", () => {
  const quiet = {
    getJobs: () => [],
    getExternalTasks: () => [],
  }
  const read = (routes: Readonly<Record<string, Route>>, thresholds?: VerdictThresholds) =>
    readStatus(
      { port: engine({ ...quiet, ...routes }), now: clock() },
      thresholds === undefined ? OPTIONS : { ...OPTIONS, thresholds },
    )

  it("is warning with incident findings below the thresholds", async () => {
    const data = await read({})
    expect(data.findings.every((finding) => finding.severity === "warning")).toBe(true)
    expect(data.findings.map((finding) => finding.code)).not.toContain("INCIDENTS_CRITICAL")
    expect(data.status).toBe("warning")
  })

  it("is critical from the open root incidents of the statistics, not of the loaded page", async () => {
    const data = await read({
      getProcessDefinitionStatistics: () => [statistics("order", 1, [41, 3, 50])],
    })
    expect(data.status).toBe("critical")
    expect(data.rootIncidentsTotal).toBe(50)
    // the findings say why, first: the threshold finding leads to the largest cause's group
    expect(data.findings[0]).toEqual({
      severity: "critical",
      code: "INCIDENTS_CRITICAL",
      message:
        "50 open root incidents, 2 of them failedJob at book: critical at >=50 open root incidents or >=25 of one cause",
      next: { action: "retryActivity", processDefinitionKey: "order", activityId: "book" },
    })
    expect(data.findings.slice(1).every((finding) => finding.severity === "warning")).toBe(true)
  })

  it("never judges by the count of every open incident, which counts the copies", async () => {
    const data = await read({ getIncidentsCount: () => ({ count: 50 }) })
    expect(data).toMatchObject({ status: "warning", rootIncidentsTotal: 3, incidentsTotal: 50 })
  })

  it("counts a chain of calls that one failure stops as one root incident", async () => {
    // The label's failed job, copied to the call activity of each of the three instances above it.
    const root = { ...failedJob("r", "printLabel"), processDefinitionId: "label:1:x" }
    const copies = ["dispatch", "order", "customer"].map((caller, level) => ({
      ...failedJob(`c${level}`, `call-${caller}`),
      rootCauseIncidentId: "r",
      incidentMessage: null,
      processDefinitionId: `${caller}:1:x`,
    }))
    const data = await read(
      {
        getProcessDefinitionStatistics: () => [
          statistics("label", 1, [1, 1, 1]),
          ...["dispatch", "order", "customer"].map((key) => statistics(key, 1, [1, 0, 0])),
        ],
        getIncidents: () => [root, ...copies],
        getIncidentsCount: () => ({ count: 4 }),
      },
      { criticalIncidents: 2, criticalClusterSize: 2 },
    )
    expect(data).toMatchObject({
      status: "warning",
      rootIncidentsTotal: 1,
      incidentsTotal: 4,
      propagated: 3,
    })
    expect(data.findings.map((finding) => finding.code)).toEqual(["INCIDENTS"])
    expect(data.incidents.map((group) => [group.processDefinitionKey, group.count])).toEqual([
      ["label", 1],
    ])
  })

  it("counts one cause as the cockpit does: across definitions and batch incidents, never a copy", async () => {
    const other = (id: string) => ({ ...failedJob(id, "book"), processDefinitionId: "pay:1:y" })
    const propagated = (id: string) => ({ ...failedJob(id, "book"), rootCauseIncidentId: "x" })
    const batchJob = (id: string) => ({ ...failedJob(id, "book"), jobDefinitionId: "jd-b" })
    const incidents = [
      ...["o1", "o2"].map((id) => failedJob(id, "book")),
      ...["p1", "p2"].map(other),
      ...["c1", "c2"].map(propagated),
      batchJob("b1"),
    ]
    const routes = {
      getProcessDefinitionStatistics: () => [
        statistics("order", 1, [41, 3, 3]),
        statistics("pay", 1, [2, 2, 2]),
      ],
      getIncidents: () => incidents,
      getIncidentsCount: () => ({ count: incidents.length }),
      getBatchStatistics: () => [
        { id: "b", type: "migration", failedJobs: 1, batchJobDefinitionId: "jd-b" },
      ],
    }
    // the groups stay per definition and root cause; the verdict's cause spans the five roots
    const below = await read(routes, { criticalIncidents: 99, criticalClusterSize: 6 })
    expect(below.incidents.map((group) => group.count)).toEqual([2, 2])
    expect(below.status).toBe("warning")
    const at = await read(routes, { criticalIncidents: 99, criticalClusterSize: 5 })
    expect(at.status).toBe("critical")
    expect(at.findings[0]).toMatchObject({
      code: "INCIDENTS_CRITICAL",
      message:
        "5 open root incidents, 5 of them failedJob at book: critical at >=99 open root incidents or >=5 of one cause",
    })
  })

  it("adds the root incidents outside any process, which the statistics leave out", async () => {
    const cleanup = {
      ...failedJob("h1", "historyCleanup"),
      processDefinitionId: null,
      jobDefinitionId: "jd-cleanup",
    }
    const data = await read({
      getProcessDefinitionStatistics: () => [statistics("order", 1, [41, 0, 0])],
      getIncidents: () => [cleanup],
      getIncidentsCount: () => ({ count: 1 }),
    })
    expect(data).toMatchObject({ status: "warning", rootIncidentsTotal: 1, incidentsTotal: 1 })
  })

  it("lists the cause's incidents by type when no group of it is shown", async () => {
    // The largest cause is a batch's failed jobs, which BATCH_FAILURES reports, not a group.
    const data = await read(
      {
        getIncidents: () => [
          {
            ...failedJob("x", "book"),
            incidentType: "failedExternalTask",
            jobDefinitionId: "jd-b",
          },
        ],
        getIncidentsCount: () => ({ count: 1 }),
        getProcessDefinitionStatistics: () => [statistics("order", 1, [41, 0, 1])],
        getBatchStatistics: () => [
          { id: "b", type: "migration", failedJobs: 1, batchJobDefinitionId: "jd-b" },
        ],
      },
      { criticalIncidents: 99, criticalClusterSize: 1 },
    )
    expect(data.incidents).toEqual([])
    expect(data.findings[0]).toMatchObject({
      code: "INCIDENTS_CRITICAL",
      next: { action: "listIncidentsOfType", incidentType: "failedExternalTask" },
    })
  })

  it("lists failed jobs by type when only copies are loaded at the threshold, naming no cause", async () => {
    const data = await read(
      {
        getIncidents: () => [{ ...failedJob("x", "book"), rootCauseIncidentId: "elsewhere" }],
        getIncidentsCount: () => ({ count: 1 }),
      },
      { criticalIncidents: 1, criticalClusterSize: 99 },
    )
    expect(data.incidents).toEqual([])
    expect(data.findings[0]).toEqual({
      severity: "critical",
      code: "INCIDENTS_CRITICAL",
      message: "3 open root incidents: critical at >=1 open root incidents or >=99 of one cause",
      next: { action: "listIncidentsOfType", incidentType: "failedJob" },
    })
  })

  it("leads to the largest cause's own group, never the largest group of another cause", async () => {
    const other = (id: string) => ({ ...failedJob(id, "pay"), processDefinitionId: "pay:1:y" })
    const incidents = [
      // three of one cause in one group, beside four of another cause in two groups
      ...["x1", "x2", "x3"].map((id) => ({ ...failedJob(id, "ship"), incidentMessage: "late" })),
      ...["o1", "o2"].map((id) => failedJob(id, "pay")),
      ...["p1", "p2"].map(other),
    ]
    const data = await read(
      { getIncidents: () => incidents, getIncidentsCount: () => ({ count: 7 }) },
      { criticalIncidents: 99, criticalClusterSize: 4 },
    )
    expect(data.incidents.map((group) => [group.activityId, group.count])).toEqual([
      ["ship", 3],
      ["pay", 2],
      ["pay", 2],
    ])
    expect(data.findings[0]).toMatchObject({
      code: "INCIDENTS_CRITICAL",
      next: { action: "retryActivity", processDefinitionKey: "order", activityId: "pay" },
    })
  })

  it("is warning from the root incidents of the statistics where none of them was loaded", async () => {
    const data = await read({ getIncidents: () => [], getIncidentsCount: () => ({ count: 3 }) })
    expect(data.findings).toEqual([])
    expect(data).toMatchObject({ status: "warning", rootIncidentsTotal: 3 })
  })

  it("is critical from the largest group of one cause", async () => {
    const many = Array.from({ length: 25 }, (_, index) => failedJob(`m${index}`, "book"))
    const small = Array.from({ length: 12 }, (_, index) => failedJob(`s${index}`, `a${index}`))
    const data = await readStatus(
      {
        port: engine({
          ...quiet,
          getIncidents: () => [...small, ...many],
          getIncidentsCount: () => ({ count: 37 }),
        }),
        now: clock(),
      },
      { ...OPTIONS, maxGroups: 1 },
    )
    expect(data.incidents.map((group) => group.count)).toEqual([25])
    expect(data.status).toBe("critical")
  })

  it("takes the thresholds it is given", async () => {
    expect((await read({}, { criticalIncidents: 3, criticalClusterSize: 99 })).status).toBe(
      "critical",
    )
    expect((await read({}, { criticalIncidents: 99, criticalClusterSize: 2 })).status).toBe(
      "critical",
    )
    expect((await read({}, { criticalIncidents: 4, criticalClusterSize: 3 })).status).toBe(
      "warning",
    )
  })

  it("is ok without incidents and findings", async () => {
    const data = await read({
      getIncidents: () => [],
      getIncidentsCount: () => ({ count: 0 }),
      getProcessDefinitionStatistics: () => [statistics("order", 1, [41, 0, 0])],
    })
    expect(data.findings).toEqual([])
    expect(data.status).toBe("ok")
  })
})

describe("statusRequests", () => {
  it("previews round one with the first page of the lists", () => {
    const requests = statusRequests({ ...OPTIONS, keys: ["order"] }, NOW)
    expect(requests.map((request) => request.operationId)).toEqual([
      "getRestAPIVersion",
      "getProcessDefinitionStatistics",
      "getIncidents",
      "getIncidentsCount",
      "getExternalTasks",
      "getExternalTasksCount",
      "getJobsCount",
      "getJobs",
      "getTasksCount",
    ])
    expect(statusRequests(OPTIONS, NOW).at(-1)?.operationId).toBe("getBatchStatistics")
  })

  it("waits 5 minutes and shows 10 incident groups unless told otherwise", async () => {
    expect(statusRequests({ keys: [] }, NOW)).toEqual(statusRequests(OPTIONS, NOW))
    const incidents = Array.from({ length: 11 }, (_, index) =>
      failedJob(String(index), `a${String(index).padStart(2, "0")}`),
    )
    const data = await readStatus(
      {
        port: engine({ getIncidents: () => incidents, getIncidentsCount: () => ({ count: 11 }) }),
        now: clock(),
      },
      { keys: [] },
    )
    expect(data.incidents).toHaveLength(10)
    expect(data.truncated).toEqual(["incident groups: 10 of 11 shown"])
    expect(data.findings[0]?.message).toContain("waited longer than 5m")
  })
})
