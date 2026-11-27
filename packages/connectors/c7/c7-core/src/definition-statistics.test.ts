import { RuntimeError } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import {
  definitionStatisticsOf,
  definitionStatisticsQuery,
  readDefinitionStatistics,
  statisticsByKey,
  statisticsByProcess,
} from "./definition-statistics.js"
import { readStatus } from "./engine-status.js"
import { WorkflowError } from "./errors.js"
import { STATUS_OPERATIONS } from "./operations.js"
import { fakePort, type Route } from "./testing/fake-port.js"
import { NOW } from "./testing/status.js"

const FULL = {
  id: "invoice:2:x",
  key: "invoice",
  tenantId: null,
  version: 2,
  name: "Invoice Receipt",
  deploymentId: "d2",
  versionTag: "stable",
}
const BARE = { id: "order:1:y", key: "order", tenantId: null, version: 1 }

function statisticsPort(answer: unknown) {
  return fakePort({ getProcessDefinitionStatistics: () => answer })
}

async function expectUnexpected(read: Promise<unknown>, message: string): Promise<void> {
  await expect(read).rejects.toBeInstanceOf(RuntimeError)
  await expect(read).rejects.toMatchObject({ failure: "unexpectedResponse", message })
}

const byType = (entries: Record<string, number>) => new Map(Object.entries(entries))

describe("readDefinitionStatistics", () => {
  it("reads every version with its running instances and root incidents, in one request", async () => {
    const port = statisticsPort([
      { definition: FULL, instances: 3, failedJobs: 0, incidents: [] },
      { definition: { ...BARE, name: null, deploymentId: null }, instances: 0 },
    ])
    expect(await readDefinitionStatistics(port)).toStrictEqual([
      {
        definition: FULL,
        instances: 3,
        failedJobs: 0,
        incidentsByType: new Map(),
        rootIncidents: 0,
      },
      {
        definition: BARE,
        instances: 0,
        failedJobs: 0,
        incidentsByType: new Map(),
        rootIncidents: 0,
      },
    ])
    expect(port.calls).toEqual([
      {
        operationId: "getProcessDefinitionStatistics",
        input: { pathArgs: [], query: { rootIncidents: "true" } },
      },
    ])
  })

  it("reads the failed jobs of each version where asked, beside the root incidents", async () => {
    const port = statisticsPort([{ definition: BARE, instances: 2, failedJobs: 4 }])
    const [row] = await readDefinitionStatistics(port, { failedJobs: true })
    expect(row).toMatchObject({ instances: 2, failedJobs: 4 })
    expect(port.calls[0]?.input.query).toEqual({ failedJobs: "true", rootIncidents: "true" })
    expect(definitionStatisticsQuery({ failedJobs: false })).toEqual({ rootIncidents: "true" })
  })

  it("counts the root incidents of a version per incident type and sums them", async () => {
    const port = statisticsPort([
      {
        definition: FULL,
        instances: 5,
        incidents: [
          { incidentType: "failedJob", incidentCount: 2 },
          { incidentType: "failedExternalTask", incidentCount: 1 },
        ],
      },
      { definition: BARE, instances: 1, incidents: null },
    ])
    expect(await readDefinitionStatistics(port)).toStrictEqual([
      {
        definition: FULL,
        instances: 5,
        failedJobs: 0,
        incidentsByType: byType({ failedJob: 2, failedExternalTask: 1 }),
        rootIncidents: 3,
      },
      {
        definition: BARE,
        instances: 1,
        failedJobs: 0,
        incidentsByType: new Map(),
        rootIncidents: 0,
      },
    ])
  })

  it.each([
    ["an answer that is no list", {}, "definition statistics is not a list"],
    ["a row that is no object", [1], "definition statistics[0] is not an object"],
    ["a row without its definition", [{ instances: 1 }], "statistics definition is not an object"],
    ["a row without its count", [{ definition: BARE }], "instances is missing"],
    ["a definition without its id", [{ definition: { key: "a", version: 1 } }], "id is missing"],
    ["a definition without its key", [{ definition: { id: "a", version: 1 } }], "key is missing"],
    [
      "a definition without its version",
      [{ definition: { id: "a", key: "a" }, instances: 1 }],
      "version is missing",
    ],
    [
      "a name that is no text",
      [{ definition: { ...BARE, name: 1 }, instances: 1 }],
      "name is not a string",
    ],
    [
      "a deployment that is no text",
      [{ definition: { ...BARE, deploymentId: 1 }, instances: 1 }],
      "deploymentId is not a string",
    ],
    [
      "a version tag that is no text",
      [{ definition: { ...BARE, versionTag: 1 }, instances: 1 }],
      "versionTag is not a string",
    ],
    [
      "failed jobs that are no number",
      [{ definition: BARE, instances: 1, failedJobs: "3" }],
      "failedJobs is not a number",
    ],
    [
      "incidents that are no list",
      [{ definition: BARE, instances: 1, incidents: 2 }],
      "incidents is not a list",
    ],
    [
      "an incident count without its type",
      [{ definition: BARE, instances: 1, incidents: [{ incidentCount: 2 }] }],
      "incidentType is missing",
    ],
    [
      "an incident type without its count",
      [{ definition: BARE, instances: 1, incidents: [{ incidentType: "failedJob" }] }],
      "incidentCount is missing",
    ],
  ])("fails %s as unexpected", async (_kind, answer, message) => {
    await expectUnexpected(readDefinitionStatistics(statisticsPort(answer)), message)
  })

  it("fails the status triage on the same answer as the reason unexpected-answer", async () => {
    const routes = Object.fromEntries(
      STATUS_OPERATIONS.map((id): [string, Route] => [id, () => []]),
    )
    const port = fakePort({
      ...routes,
      getBatchStatisticsCount: () => ({ count: 0 }),
      getProcessDefinitionStatistics: () => [{ instances: 1 }],
    })
    const read = readStatus({ port, now: () => NOW }, { keys: [] })
    await expect(read).rejects.toBeInstanceOf(WorkflowError)
    await expect(read).rejects.toMatchObject({
      reason: {
        kind: "unexpected-answer",
        operationId: "getProcessDefinitionStatistics",
        problem: "statistics definition is not an object",
      },
    })
  })
})

/** A statistics row of `definition` as the engine answers it. */
const row = (
  definition: { id: string; key: string; tenantId?: string | null; version: number; name?: string },
  [instances, failedJobs]: readonly [number, number],
  incidents: Record<string, number> = {},
) => ({
  definition,
  instances,
  failedJobs,
  incidents: Object.entries(incidents).map(([incidentType, incidentCount]) => ({
    incidentType,
    incidentCount,
  })),
})

const ORDER_1 = { id: "order:1:a", key: "order", tenantId: null, version: 1, name: "Order" }
const ORDER_3 = { id: "order:3:c", key: "order", tenantId: null, version: 3, name: "Order v3" }
const ORDER_3_TENANT = {
  id: "order:3:t",
  key: "order",
  tenantId: "acme",
  version: 3,
  name: "Order of acme",
}
const ORDER_2 = { id: "order:2:b", key: "order", tenantId: null, version: 2 }
const SHIP_1 = { id: "ship:1:s", key: "ship", tenantId: null, version: 1 }

/** Versions in no order of theirs, a version number twice (two tenants), keys interleaved. */
const ROWS = definitionStatisticsOf([
  row(ORDER_1, [2, 1], { failedJob: 1 }),
  row(SHIP_1, [0, 0]),
  row(ORDER_3, [1, 0], { failedExternalTask: 2 }),
  row(ORDER_3_TENANT, [4, 2], { failedJob: 3 }),
  row(ORDER_2, [5, 0]),
])

describe("statisticsByKey", () => {
  it("folds the versions of each key: the latest by version number, the sums over all", () => {
    const folded = statisticsByKey(ROWS)
    expect([...folded.keys()]).toEqual(["order", "ship"])
    const order = folded.get("order")
    expect(order).toMatchObject({
      key: "order",
      latest: ORDER_3,
      instances: 12,
      failedJobs: 3,
      incidentsByType: byType({ failedJob: 4, failedExternalTask: 2 }),
      rootIncidents: 6,
      incidentVersionIds: [ORDER_1.id, ORDER_3.id, ORDER_3_TENANT.id],
    })
    expect(order?.versions.map((version) => version.definition.id)).toEqual([
      ORDER_1.id,
      ORDER_3.id,
      ORDER_3_TENANT.id,
      ORDER_2.id,
    ])
    expect(folded.get("ship")).toMatchObject({
      latest: SHIP_1,
      instances: 0,
      incidentsByType: new Map(),
      rootIncidents: 0,
      incidentVersionIds: [],
    })
  })

  it("takes the first listed of equal latest versions, in any order of the rows", () => {
    const reversed = statisticsByKey(ROWS.toReversed())
    expect(reversed.get("order")?.latest).toEqual(ORDER_3_TENANT)
    expect(reversed.get("order")?.rootIncidents).toBe(6)
  })

  it("counts the root incidents of one incident type where one is named", () => {
    const failedJobs = statisticsByKey(ROWS, "failedJob").get("order")
    expect(failedJobs).toMatchObject({
      incidentsByType: byType({ failedJob: 4 }),
      rootIncidents: 4,
      incidentVersionIds: [ORDER_1.id, ORDER_3_TENANT.id],
      instances: 12,
    })
    expect(statisticsByKey(ROWS, "custom").get("order")).toMatchObject({
      incidentsByType: new Map(),
      rootIncidents: 0,
      incidentVersionIds: [],
    })
  })

  it("has no key on an engine without deployments", () => {
    expect(statisticsByKey([])).toEqual(new Map())
  })
})

describe("statisticsByProcess", () => {
  it("folds the versions of a key in each tenant apart, each tenant's latest its own", () => {
    const processes = statisticsByProcess(ROWS)
    expect(processes.map(({ key, tenantId }) => [key, tenantId])).toEqual([
      ["order", null],
      ["ship", null],
      ["order", "acme"],
    ])
    expect(processes[0]).toMatchObject({
      latest: ORDER_3,
      instances: 8,
      failedJobs: 1,
      rootIncidents: 3,
      incidentVersionIds: [ORDER_1.id, ORDER_3.id],
    })
    expect(processes[2]).toMatchObject({
      latest: ORDER_3_TENANT,
      instances: 4,
      failedJobs: 2,
      incidentsByType: byType({ failedJob: 3 }),
      incidentVersionIds: [ORDER_3_TENANT.id],
    })
  })

  it("reads a version's tenant as the engine names it, an empty one as none", () => {
    const [none, empty, acme] = definitionStatisticsOf([
      row({ id: ORDER_1.id, key: "order", version: 1 }, [0, 0]),
      row({ ...ORDER_2, tenantId: "" }, [0, 0]),
      row(ORDER_3_TENANT, [0, 0]),
    ])
    expect([none, empty, acme].map((version) => version?.definition.tenantId)).toEqual([
      null,
      null,
      "acme",
    ])
    expect(
      statisticsByProcess([none, empty, acme].flatMap((version) => version ?? [])),
    ).toHaveLength(2)
  })
})
