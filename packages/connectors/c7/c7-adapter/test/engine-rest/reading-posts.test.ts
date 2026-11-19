import { type EnginePort, intentOf, routeOf } from "@miragon/pulse-c7-core"
import { ROUTES } from "@miragon/pulse-c7-core/routes"
import * as runtimeEntry from "@miragon/pulse-c7-core/runtime"
import {
  BulkOperationId,
  DefinitionId,
  IncidentId,
  InstanceId,
  type ProcessRuntime,
} from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { portOver, runtimeOver } from "../support/fake-engine.js"
import { fakeEngineRest } from "../support/fake-engine-rest.js"

type Read = (port: EnginePort) => Promise<unknown>
type RuntimeRead = (runtime: ProcessRuntime) => Promise<unknown>

const PAGE = { firstResult: 0, maxResults: 5 }
const PLAN = {
  sourceDefinitionId: DefinitionId("order:1"),
  targetDefinitionId: DefinitionId("order:2"),
  mappings: [],
}

const COMMAND_READS: Readonly<Record<string, Read>> = {
  readHistoricInstances: (port) =>
    runtimeEntry.readHistoricInstances(port, { unfinished: true }, PAGE),
  findActivityTree: (port) => runtimeEntry.findActivityTree(port, "p1"),
  readBatchStatistics: (port) => runtimeEntry.readBatchStatistics(port, "b1"),
  findHistoricBatch: (port) => runtimeEntry.findHistoricBatch(port, "b1"),
}

const RUNTIME_READS: readonly RuntimeRead[] = [
  (runtime) =>
    runtime.searchInstances(
      { variables: [{ name: "amount", operator: "greaterThan", valueJson: "100" }] },
      { limit: 5 },
    ),
  (runtime) => runtime.countInstances({ lifecycle: "running" }),
  (runtime) => runtime.listVariableNames(DefinitionId("order:1")),
  (runtime) => runtime.getInstanceDetail(InstanceId("p1")),
  (runtime) => runtime.searchIncidents({}, { limit: 5 }),
  (runtime) => runtime.getIncidentDetails(IncidentId("i1")),
  (runtime) => runtime.getBulkOperation(BulkOperationId("b1")),
  (runtime) => runtime.getBulkFailures(BulkOperationId("b1")),
  (runtime) => runtime.proposeMigration!(PLAN.sourceDefinitionId, PLAN.targetDefinitionId),
  (runtime) => runtime.checkMigration!(PLAN),
]

const HISTORIC_INSTANCE = {
  id: "p1",
  processDefinitionId: "order:1",
  processDefinitionKey: "order",
  processDefinitionVersion: 1,
  state: "ACTIVE",
}

const RUNNING_MIGRATION_BATCH = {
  id: "b1",
  type: "instance-migration",
  totalJobs: 2,
  invocationsPerBatchJob: 1,
  batchJobDefinitionId: "jd1",
  suspended: false,
  completedJobs: 0,
  failedJobs: 1,
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

describe("the commands' and the runtime's reads by c7-core's route table", () => {
  test("covers every read the commands take from c7-core's runtime entry", () => {
    const reads = Object.keys(runtimeEntry).filter((name) => /^(read|find)[A-Z]/.test(name))
    expect(reads.sort()).toEqual(Object.keys(COMMAND_READS).sort())
  })

  test("sends only reads, its POSTs included, so a connection for reads never writes", async () => {
    const engine = fakeEngineRest([
      { route: "POST /history/process-instance", answer: [HISTORIC_INSTANCE] },
      { route: "GET /batch/statistics", answer: [RUNNING_MIGRATION_BATCH] },
    ])
    const port = portOver(engine)
    for (const read of Object.values(COMMAND_READS)) {
      await read(port).catch(() => undefined)
    }
    const runtime = runtimeOver(engine)
    for (const read of RUNTIME_READS) {
      await read(runtime).catch(() => undefined)
    }
    const sent = engine.requests.map((request) => request.route)
    expect(sent).toContain("GET /job")
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
