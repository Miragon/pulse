import { afterEach, describe, expect, it } from "vitest"
import {
  clientFor,
  startFakeEngine,
  type FakeEngine,
  type FakeRoutes,
  type RecordedRequest,
} from "../tools/test-support/fake-engine.js"
import { buildJobPanelData } from "./cockpit-data.js"

// The failure half is the rejection table in `honest-numbers.test.ts`.

const engines: FakeEngine[] = []
afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

async function engineWith(routes: FakeRoutes) {
  const engine = await startFakeEngine(routes, { body: [] })
  engines.push(engine)
  return { engine, client: clientFor(engine) }
}

const calls = (engine: FakeEngine, path: string) => engine.requests.filter((r) => r.path === path)

// Retries alone is no total order, so paging could repeat and skip tied jobs (#322 U11).
const JOB_ORDER = [
  { sortBy: "jobRetries", sortOrder: "asc" },
  { sortBy: "jobId", sortOrder: "asc" },
]

describe("buildJobPanelData — exact totals from /job/count", () => {
  const jobRoutes = {
    "POST /job": {
      body: [
        {
          id: "j1",
          processInstanceId: "p1",
          retries: 0,
          suspended: false,
          priority: 0,
          failedActivityId: "charge",
        },
      ],
    },
    "GET /job/count": (r: RecordedRequest) => ({
      body: { count: r.query.noRetriesLeft ? 3 : 120 },
    }),
    "GET /process-definition": { body: [{ id: "K1:1:a", key: "K1", version: 1 }] },
  }

  it("reports both global totals; the page follows failedOnly", async () => {
    const { engine, client } = await engineWith(jobRoutes)

    const all = await buildJobPanelData(client, "engine-a", { processDefinitionKey: "K1" })
    const failed = await buildJobPanelData(client, "engine-a", { failedOnly: true })

    expect([all.totalCount, all.failedCount]).toEqual([120, 3])
    expect([failed.totalCount, failed.failedCount]).toEqual([3, 3])
    expect(calls(engine, "/job").map((r) => [r.method, r.query, r.body])).toEqual([
      [
        "POST",
        { firstResult: "0", maxResults: "50" },
        { processDefinitionKey: "K1", sorting: JOB_ORDER },
      ],
      ["POST", { firstResult: "0", maxResults: "50" }, { noRetriesLeft: true, sorting: JOB_ORDER }],
    ])
    // A scoped panel checks its key exists (an unknown key is not-found, not "0 jobs").
    expect(calls(engine, "/process-definition").map((r) => r.query)).toEqual([
      { key: "K1", latestVersion: "true", sortBy: "version", sortOrder: "desc", maxResults: "1" },
    ])
  })

  it("asks for the next page at its offset, in the same total order", async () => {
    const { engine, client } = await engineWith(jobRoutes)

    await buildJobPanelData(client, "engine-a", { firstResult: 50, maxResults: 25 })

    expect(calls(engine, "/job").map((r) => [r.query, r.body])).toEqual([
      [{ firstResult: "50", maxResults: "25" }, { sorting: JOB_ORDER }],
    ])
  })

  it("nulls the optional job fields instead of shipping undefined", async () => {
    const { client } = await engineWith(jobRoutes)

    const data = await buildJobPanelData(client, "engine-a", {})

    expect(data.jobs[0]).toEqual({
      id: "j1",
      processInstanceId: "p1",
      processDefinitionKey: null,
      processDefinitionId: null,
      processDefinitionName: null,
      activityId: "charge",
      activityName: null,
      retries: 0,
      exceptionMessage: null,
      dueDate: null,
      suspended: false,
      priority: 0,
      createTime: null,
    })
  })

  it("names each job's activity and process from its version's diagram — once per version", async () => {
    const xml =
      '<definitions><process id="K1" name="Order to cash"><serviceTask id="charge" name="Charge card"/></process></definitions>'
    const job = (id: string, definitionId: string) => ({
      id,
      processInstanceId: "p1",
      processDefinitionKey: "K1",
      processDefinitionId: definitionId,
      retries: 0,
      suspended: false,
      priority: 0,
      failedActivityId: "charge",
    })
    const { engine, client } = await engineWith({
      ...jobRoutes,
      "POST /job": { body: [job("j1", "K1:1:a"), job("j2", "K1:1:a"), job("j3", "K1:2:b")] },
      "GET /process-definition/K1:1:a/xml": { body: { id: "K1:1:a", bpmn20Xml: xml } },
      // Unreadable: its jobs keep their ids, the panel still renders.
      "GET /process-definition/K1:2:b/xml": { status: 500, body: { message: "boom" } },
    })

    const data = await buildJobPanelData(client, "engine-a", {})

    expect(data.jobs.map((j) => [j.activityName, j.processDefinitionName])).toEqual([
      ["Charge card", "Order to cash"],
      ["Charge card", "Order to cash"],
      [null, null],
    ])
    expect(calls(engine, "/process-definition/K1:1:a/xml")).toHaveLength(1)
  })

  // One rule with analytics (`readBpmnNames`): the job panel showed "Rechnung&#10;prüfen" literally.
  it("names a Modeler diagram's activity and process as analytics does", async () => {
    const xml = `<definitions>
  <collaboration id="C"><participant id="Pool" name="Miravelo - Bike Leasing" processRef="K1"/></collaboration>
  <process id="K1"><serviceTask id="charge" name="Rechnung&#10;prüfen &#38; buchen"/></process>
</definitions>`
    const { client } = await engineWith({
      ...jobRoutes,
      "POST /job": {
        body: [
          {
            id: "j1",
            processInstanceId: "p1",
            processDefinitionKey: "K1",
            processDefinitionId: "K1:1:a",
            retries: 0,
            suspended: false,
            priority: 0,
            failedActivityId: "charge",
          },
        ],
      },
      "GET /process-definition/K1:1:a/xml": { body: { id: "K1:1:a", bpmn20Xml: xml } },
    })

    const data = await buildJobPanelData(client, "engine-a", {})

    expect(data.jobs.map((j) => [j.activityName, j.processDefinitionName])).toEqual([
      ["Rechnung prüfen & buchen", "Miravelo - Bike Leasing"],
    ])
  })
})
