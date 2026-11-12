import { intentOf, routeOf } from "@miragon/pulse-c7-core"
import { ROUTES } from "@miragon/pulse-c7-core/routes"
import { describe, expect, test } from "vitest"
import { RestEngineClient } from "../../src/engine-rest/index.js"
import { httpOver } from "../support/fake-engine.js"
import { fakeEngineRest } from "../support/fake-engine-rest.js"

type Read = (client: RestEngineClient) => Promise<unknown>

const PAGE = { firstResult: 0, maxResults: 5 }
const PLAN = {
  sourceProcessDefinitionId: "order:1",
  targetProcessDefinitionId: "order:2",
  instructions: [],
}

const READS: Readonly<Record<string, Read>> = {
  product: (client) => client.product(),
  version: (client) => client.version(),
  definitionStatistics: (client) => client.definitionStatistics(),
  activityStatistics: (client) => client.activityStatistics("order:1"),
  diagramXml: (client) => client.diagramXml("order:1"),
  incidents: (client) => client.incidents({ processInstanceId: "p1" }, PAGE),
  incidentInstances: (client) => client.incidentInstances(),
  incident: (client) => client.incident("i1"),
  historicInstances: (client) => client.historicInstances({ unfinished: true }, PAGE),
  historicInstanceCount: (client) => client.historicInstanceCount({ unfinished: true }),
  inspect: (client) => client.inspect("p1"),
  activityInstances: (client) => client.activityInstances("p1"),
  variables: (client) => client.variables("p1"),
  historicVariableNames: (client) => client.historicVariableNames(["p1"]),
  causeText: (client) => client.causeText("getStacktrace", "j1"),
  batchStatistics: (client) => client.batchStatistics("b1"),
  historicBatch: (client) => client.historicBatch("b1"),
  failedJobs: (client) => client.failedJobs("jd1"),
  migrationPlan: (client) => client.migrationPlan("order:1", "order:2"),
  migrationReport: (client) => client.migrationReport(PLAN),
}

const READING_POSTS = [
  "POST /history/process-instance",
  "POST /history/process-instance/count",
  "POST /history/variable-instance",
  "POST /migration/generate",
  "POST /migration/validate",
]

function writesByTheTable(route: string): boolean {
  const [method = "", path = ""] = route.split(" ")
  return intentOf(routeOf(ROUTES, method, path), method) !== "read"
}

describe("the reading client's requests by c7-core's route table", () => {
  test("covers every read of the client", () => {
    const reads = Object.getOwnPropertyNames(RestEngineClient.prototype).filter(
      (name) => name !== "constructor",
    )
    expect(reads.sort()).toEqual(Object.keys(READS).sort())
  })

  test("sends only reads, its POSTs included, so a connection for reads never writes", async () => {
    const engine = fakeEngineRest([])
    const client = new RestEngineClient(httpOver(engine))
    for (const read of Object.values(READS)) {
      await read(client).catch(() => undefined)
    }
    const sent = engine.requests.map((request) => request.route)
    expect(sent.filter((route) => writesByTheTable(route))).toEqual([])
    expect([...new Set(sent.filter((route) => route.startsWith("POST ")))].sort()).toEqual(
      READING_POSTS,
    )
  })

  test("reads a POST of the table that writes as a write", () => {
    expect(writesByTheTable("POST /process-instance/delete")).toBe(true)
    expect(writesByTheTable("POST /migration/execute")).toBe(true)
  })
})
