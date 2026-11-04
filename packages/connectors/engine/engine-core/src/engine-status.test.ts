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

  it("is critical from the open incidents of the count, not of the loaded page", async () => {
    const data = await read({ getIncidentsCount: () => ({ count: 50 }) })
    expect(data.status).toBe("critical")
    // the findings say why, first: the threshold finding leads to the largest cause's group
    expect(data.findings[0]).toEqual({
      severity: "critical",
      code: "INCIDENTS_CRITICAL",
      message:
        "50 open incidents, 2 of them failedJob at book: critical at >=50 open incidents or >=25 of one cause",
      next: { action: "retryActivity", processDefinitionKey: "order", activityId: "book" },
    })
    expect(data.findings.slice(1).every((finding) => finding.severity === "warning")).toBe(true)
  })

  it("counts one cause as the cockpit does: across definitions, propagated and batch incidents too", async () => {
    const other = (id: string) => ({ ...failedJob(id, "book"), processDefinitionId: "pay:1:y" })
    const propagated = (id: string) => ({ ...failedJob(id, "book"), rootCauseIncidentId: "x" })
    const batchJob = (id: string) => ({ ...failedJob(id, "book"), jobDefinitionId: "jd-b" })
    const incidents = [
      ...["o1", "o2"].map((id) => failedJob(id, "book")),
      ...["p1", "p2"].map(other),
      propagated("c1"),
      batchJob("b1"),
    ]
    const data = await read(
      {
        getIncidents: () => incidents,
        getIncidentsCount: () => ({ count: incidents.length }),
        getBatchStatistics: () => [
          { id: "b", type: "migration", failedJobs: 1, batchJobDefinitionId: "jd-b" },
        ],
      },
      { criticalIncidents: 99, criticalClusterSize: 6 },
    )
    // the groups stay per definition and root cause; the verdict's cause spans all six
    expect(data.incidents.map((group) => group.count)).toEqual([2, 2])
    expect(data.status).toBe("critical")
    expect(data.findings[0]).toMatchObject({
      code: "INCIDENTS_CRITICAL",
      message:
        "6 open incidents, 6 of them failedJob at book: critical at >=99 open incidents or >=6 of one cause",
    })
  })

  it("lists the cause's incidents by type when no group of it is shown", async () => {
    const data = await read(
      {
        getIncidents: () => [{ ...failedJob("x", "book"), rootCauseIncidentId: "elsewhere" }],
        getIncidentsCount: () => ({ count: 1 }),
      },
      { criticalIncidents: 1, criticalClusterSize: 99 },
    )
    expect(data.incidents).toEqual([])
    expect(data.findings[0]).toMatchObject({
      code: "INCIDENTS_CRITICAL",
      next: { action: "listIncidentsOfType", incidentType: "failedJob" },
    })
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
