import { afterEach, describe, expect, it } from "vitest"
import { engineWith, status, stopFakeEngines } from "./composites.test-support.js"
import type { FakeRoutes } from "../../tools/test-support/fake-engine.js"
import { DEFAULT_VERDICT_THRESHOLDS } from "@miragon/pulse-c7-core"
import { FINDING_RULES, MAX_STATUS_ROWS, statusRule } from "./composites.js"

/** engine_status on the wire (helpers: composites.test-support.ts). */

afterEach(stopFakeEngines)

const STATUS_ROUTES: FakeRoutes = {
  "GET /version": { body: { version: "2.1.0" } },
  "GET /process-definition/statistics": {
    body: [
      {
        id: "order:1:x",
        instances: 41,
        failedJobs: 3,
        incidents: [{ incidentType: "failedJob", incidentCount: 3 }],
        definition: { id: "order:1:x", key: "order", version: 1, name: "Order" },
      },
    ],
  },
  "GET /incident": (request) => ({
    body: Array.from({ length: Math.min(12, Number(request.query.maxResults)) }, (_, index) => ({
      id: `i${index}`,
      rootCauseIncidentId: `i${index}`,
      incidentType: "failedJob",
      activityId: `a${index}`,
      processDefinitionId: "order:1:x",
      processInstanceId: `pi-${index}`,
      configuration: `j${index}`,
      incidentMessage: "boom",
      incidentTimestamp: "2026-01-01T11:00:00.000+0000",
    })),
  }),
  "GET /incident/count": { body: { count: 12 } },
  "GET /external-task": { body: [] },
  "GET /external-task/count": { body: { count: 0 } },
  "GET /job/count": { body: { count: 2 } },
  "GET /job": { body: [] },
  "GET /task/count": { body: { count: 7 } },
  "GET /batch/statistics": { body: [] },
}

describe("engineStatusForModel", () => {
  it("triages the engine by its id, with data instead of next steps", async () => {
    const engine = await engineWith(STATUS_ROUTES, () => ({
      body: "Caused by: org.x.PropertyNotFoundException: missingBean",
      contentType: "text/plain",
    }))
    const triage = await status(engine, {})
    expect(triage.engine).toMatchObject({ id: "fake", version: "2.1.0" })
    expect(triage.engine).not.toHaveProperty("url")
    expect(triage.statusRule).toBe(statusRule(DEFAULT_VERDICT_THRESHOLDS))
    expect(triage).toMatchObject({ status: "warning", incidentsTotal: 12, tasks: { open: 7 } })
    expect(triage.truncated).toEqual(["incident groups: 10 of 12 shown"])
    expect(JSON.stringify(triage)).not.toContain('"next"')
    expect(triage.incidents[0]).toMatchObject({
      rootCause: "PropertyNotFoundException: missingBean",
    })
    const paths = new Set(engine.requests.map((request) => request.path))
    expect([...paths].filter((path) => !path.startsWith("/job/j"))).toEqual(
      expect.arrayContaining([
        "/version",
        "/process-definition/statistics",
        "/incident",
        "/incident/count",
        "/external-task",
        "/external-task/count",
        "/job/count",
        "/job",
        "/task/count",
        "/batch/statistics",
      ]),
    )
  })

  it("shows the first 10 definitions and external-task topics and names both cuts", async () => {
    const definitions = Array.from({ length: MAX_STATUS_ROWS + 2 }, (_, index) => {
      const key = `p${String(index).padStart(2, "0")}`
      return {
        id: `${key}:1:x`,
        instances: 1,
        failedJobs: 0,
        incidents: [],
        definition: { id: `${key}:1:x`, key, version: 1 },
      }
    })
    const tasks = Array.from({ length: MAX_STATUS_ROWS + 3 }, (_, index) => ({
      id: `et${index}`,
      topicName: `topic${String(index).padStart(2, "0")}`,
      createTime: "2026-01-01T11:00:00.000+0000",
    }))
    const engine = await engineWith(
      {
        ...STATUS_ROUTES,
        "GET /process-definition/statistics": { body: definitions },
        "GET /incident": { body: [] },
        "GET /incident/count": { body: { count: 0 } },
        "GET /external-task": { body: tasks },
        "GET /external-task/count": { body: { count: tasks.length } },
      },
      () => ({ body: "", contentType: "text/plain" }),
    )
    const triage = await status(engine, {})
    expect(triage.definitions.map((row) => row.key)).toEqual(
      definitions.slice(0, MAX_STATUS_ROWS).map((row) => row.definition.key),
    )
    expect(triage.externalTasks.map((row) => row.topic)).toEqual(
      tasks.slice(0, MAX_STATUS_ROWS).map((task) => task.topicName),
    )
    expect(triage.truncated).toEqual([
      "definitions: 10 of 12 shown",
      "external-task topics: 10 of 13 shown",
    ])
  })

  it("keeps the rows of the topics a finding names when it cuts the topics", async () => {
    const locked = Array.from({ length: MAX_STATUS_ROWS + 2 }, (_, index) => ({
      id: `et${index}`,
      topicName: `topic${String(index).padStart(2, "0")}`,
      workerId: "w1",
      lockExpirationTime: "2099-01-01T00:00:00.000+0000",
    }))
    const stuck = { id: "ez", topicName: "zeta", createTime: "2026-01-01T11:00:00.000+0000" }
    const engine = await engineWith(
      {
        ...STATUS_ROUTES,
        "GET /incident": { body: [] },
        "GET /incident/count": { body: { count: 0 } },
        "GET /external-task": { body: [...locked, stuck] },
        "GET /external-task/count": { body: { count: locked.length + 1 } },
      },
      () => ({ body: "", contentType: "text/plain" }),
    )
    const triage = await status(engine, {})
    expect(triage.findings.map((finding) => finding.code)).toEqual(["NO_WORKER"])
    expect(triage.externalTasks.map((row) => row.topic)).toEqual([
      "zeta",
      ...locked.slice(0, MAX_STATUS_ROWS - 1).map((task) => task.topicName),
    ])
    expect(triage.truncated).toEqual(["external-task topics: 10 of 13 shown"])
  })

  it("states every finding c7-core raises under its severity in statusRule", async () => {
    const routes: FakeRoutes = {
      ...STATUS_ROUTES,
      "GET /job": { body: [{ id: "j9", dueDate: "2026-01-01T11:00:00.000+0000" }] },
      "GET /external-task": {
        body: [
          { id: "e1", topicName: "mail", createTime: "2026-01-01T11:00:00.000+0000" },
          {
            id: "e2",
            topicName: "pay",
            workerId: "w1",
            lockExpirationTime: "2026-01-01T11:00:00.000+0000",
          },
        ],
      },
      "GET /external-task/count": { body: { count: 2 } },
      "GET /batch/statistics": {
        body: [{ id: "b1", type: "migration", failedJobs: 1, batchJobDefinitionId: "jd-b" }],
      },
    }
    const text = () => ({ body: "", contentType: "text/plain" })
    const all = await status(await engineWith(routes, text), {})
    const unknown = await status(await engineWith(routes, text), {
      processDefinitionKeyIn: ["nope"],
    })
    const atThreshold = await status(
      await engineWith(routes, text),
      {},
      { criticalIncidents: 12, criticalClusterSize: 25 },
    )
    const raised = [...all.findings, ...unknown.findings, ...atThreshold.findings]
    expect(new Set(raised.map((finding) => finding.code))).toEqual(
      new Set(Object.keys(FINDING_RULES)),
    )
    for (const finding of raised) {
      const rule = FINDING_RULES[finding.code]
      expect(rule?.severity).toBe(finding.severity)
      const says = rule?.says
      expect(all.statusRule).toContain(
        typeof says === "function" ? says(DEFAULT_VERDICT_THRESHOLDS) : says,
      )
    }
    expect(all.statusRule).toBe(
      "critical: >=50 open incidents or >=25 of one cause, executable jobs overdue (is the job " +
        "executor running?); warning: any open incident (incident groups), topics without a " +
        "worker, topics with expired locks, failed batch jobs, keys not deployed; else ok. " +
        "incidentsTotal counts every open incident, propagated the copies on calling instances; " +
        "the incident groups and definitions count root causes.",
    )
  })

  it("judges by the thresholds it is given, the cockpit's, and says them", async () => {
    const quiet = STATUS_ROUTES
    const text = () => ({ body: "", contentType: "text/plain" })
    // 12 open incidents of 12 causes: below the defaults
    expect((await status(await engineWith(quiet, text), {})).status).toBe("warning")
    const byTotal = await status(
      await engineWith(quiet, text),
      {},
      {
        criticalIncidents: 12,
        criticalClusterSize: 25,
      },
    )
    expect(byTotal.status).toBe("critical")
    expect(byTotal.statusRule).toMatch(/^critical: >=12 open incidents or >=25 of one cause, /)
    // the findings say why: the threshold finding comes first
    expect(byTotal.findings[0]).toEqual({
      severity: "critical",
      code: "INCIDENTS_CRITICAL",
      message:
        "12 open incidents, 1 of them failedJob at a0: critical at >=12 open incidents or >=25 of one cause",
    })
    const sameCause: FakeRoutes = {
      ...quiet,
      "GET /incident": {
        body: ["i1", "i2"].map((id) => ({
          id,
          rootCauseIncidentId: id,
          incidentType: "failedJob",
          activityId: "book",
          processDefinitionId: "order:1:x",
          incidentMessage: `Timeout calling '${id}' after 30 ms`,
          incidentTimestamp: "2026-01-01T11:00:00.000+0000",
        })),
      },
      "GET /incident/count": { body: { count: 2 } },
    }
    const byCause = await status(
      await engineWith(sameCause, text),
      {},
      {
        criticalIncidents: 50,
        criticalClusterSize: 2,
      },
    )
    expect(byCause.incidents.map((group) => group.count)).toEqual([2])
    expect(byCause.status).toBe("critical")
    expect(byCause.findings.map((finding) => [finding.severity, finding.code])).toEqual([
      ["critical", "INCIDENTS_CRITICAL"],
      ["warning", "INCIDENTS"],
    ])
  })

  it("reads the named keys once each, without the batches and blank keys", async () => {
    const engine = await engineWith(STATUS_ROUTES, () => ({ body: "", contentType: "text/plain" }))
    await status(engine, { processDefinitionKeyIn: ["order", "order", "pay", "", " "] })
    const counts = engine.requests.filter((request) => request.path === "/incident/count")
    expect(counts.map((request) => request.query.processDefinitionKeyIn)).toEqual(["order,pay"])
    const jobs = engine.requests.filter((request) => request.path === "/job/count")
    expect(jobs.map((request) => request.query.processDefinitionKey)).toEqual(["order", "pay"])
    expect(engine.requests.some((request) => request.path === "/batch/statistics")).toBe(false)
  })
})
