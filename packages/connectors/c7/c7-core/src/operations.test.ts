import {
  BulkOperationId,
  DefinitionId,
  ElementId,
  IncidentId,
  InstanceId,
} from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { type Condition, measure } from "./conditions.js"
import { readStatus } from "./engine-status.js"
import { inspectInstance } from "./inspect.js"
import {
  checkMigrationPlan,
  definitionsAtVersion,
  proposeMigrationPlan,
} from "./migration-plans.js"
import {
  CONDITION_OPERATIONS,
  CORE_OPERATIONS,
  INSPECT_OPERATIONS,
  MIGRATION_PLAN_OPERATIONS,
  RUNTIME_OPERATIONS,
  STATUS_OPERATIONS,
  WITH_INCIDENT_OPERATIONS,
} from "./operations.js"
import { BulkOperationReader } from "./runtime/bulk-operation-reader.js"
import { CalledProcessReader } from "./runtime/called-process-reader.js"
import { DefinitionReader } from "./runtime/definition-reader.js"
import { ElementStatisticsReader } from "./runtime/element-statistics-reader.js"
import { EngineReader } from "./runtime/engine-reader.js"
import { IncidentDetailsReader } from "./runtime/incident-details-reader.js"
import { IncidentSearch } from "./runtime/incident-search.js"
import { InstanceDetailReader } from "./runtime/instance-detail-reader.js"
import { InstanceSearch } from "./runtime/instance-search.js"
import { MigrationReader } from "./runtime/migration-reader.js"
import { VariableNameReader } from "./runtime/variable-name-reader.js"
import type { Route } from "./testing/fake-port.js"
import { fakeFailure, fakePort } from "./testing/fake-port.js"
import { historyDto, P } from "./testing/fixture.js"
import { APPROVE_INCIDENT, approveRoutes } from "./testing/inspect-routes.js"
import { NOW } from "./testing/status.js"
import {
  countWithIncident,
  instancesWithIncident,
  unrecordedIncidents,
  withIncidentAmong,
} from "./with-incident.js"

/** Routes for exactly the declared operations: any other one is refused by the fake port. */
function only(operations: readonly string[], routes: Readonly<Record<string, Route>>) {
  return Object.fromEntries(operations.map((id) => [id, routes[id] ?? (() => [])]))
}

describe("the declared operations", () => {
  it("are all inspect sends, the selection included", async () => {
    const port = fakePort(
      only(INSPECT_OPERATIONS, {
        ...approveRoutes(),
        getHistoricProcessInstances: () => [{ id: P, state: "ACTIVE" }],
      }),
    )
    await inspectInstance(
      port,
      { businessKey: "WF-1", latest: true },
      { variables: true, history: true, stacktrace: true },
    )
    const sent = new Set(port.calls.map((call) => call.operationId))
    expect(
      [...sent].filter((id) => !(INSPECT_OPERATIONS as readonly string[]).includes(id)),
    ).toEqual([])
  })

  it("are all status sends", async () => {
    const routes: Record<string, Route> = {
      getRestAPIVersion: () => ({ version: "7.24.0" }),
      getIncidents: () => [{ ...APPROVE_INCIDENT, processDefinitionId: "order:1:x" }],
      getStacktrace: () => "boom",
      getExternalTasks: () => [{ id: "e1", topicName: "mail", errorMessage: "x", retries: 0 }],
      getBatchStatisticsCount: () => ({ count: 0 }),
    }
    const port = fakePort(only(STATUS_OPERATIONS, routes))
    await readStatus({ port, now: () => NOW }, { keys: [], staleAfterMs: 300_000, maxGroups: 10 })
    const sent = new Set(port.calls.map((call) => call.operationId))
    expect([...sent].sort()).toEqual(
      STATUS_OPERATIONS.filter((id) => id !== "getExternalTaskErrorDetails").toSorted(),
    )
  })

  it("are all wait counts", async () => {
    const counts: Record<string, Route> = {}
    for (const id of CONDITION_OPERATIONS) counts[id] = () => ({ count: 0 })
    const port = fakePort(counts)
    const conditions: Condition[] = [
      { kind: "idle" },
      { kind: "task", key: "approve" },
      { kind: "activity", id: "book" },
    ]
    await measure(port, { id: "p1", ended: false, tree: ["p1"] }, conditions, true)
    const sent = new Set(port.calls.map((call) => call.operationId))
    expect([...sent].sort()).toEqual([...CONDITION_OPERATIONS].sort())
  })
})

describe("the with-incident operations", () => {
  it("are all the reads of with incident send", async () => {
    const routes: Record<string, Route> = {
      getProcessInstances: () => [{ id: "p1", definitionId: "order:1:x" }],
      getProcessInstancesCount: () => ({ count: 1 }),
      getIncidentsCount: () => ({ count: 1 }),
      getHistoricIncidents: () => [],
    }
    const port = fakePort(only(WITH_INCIDENT_OPERATIONS, routes))
    await instancesWithIncident(port, {})
    await countWithIncident(port, {})
    await withIncidentAmong(port, ["p1"])
    await unrecordedIncidents(port)
    const sent = new Set(port.calls.map((call) => call.operationId))
    expect([...sent].sort()).toEqual([...WITH_INCIDENT_OPERATIONS].sort())
  })
})

describe("the migration plan operations", () => {
  it("are all the migration planning rules send", async () => {
    const plan = { sourceProcessDefinitionId: "order:1:x", targetProcessDefinitionId: "order:2:y" }
    const port = fakePort(
      only(MIGRATION_PLAN_OPERATIONS, {
        getProcessDefinitions: () => [{ id: "order:1:x", version: 1 }],
        generateMigrationPlan: () => plan,
        validateMigrationPlan: () => ({}),
      }),
    )
    await definitionsAtVersion(port, "order", 1)
    await definitionsAtVersion(port, "order", "latest")
    const proposal = await proposeMigrationPlan(port, "order:1:x", "order:2:y")
    await checkMigrationPlan(port, proposal)
    const sent = new Set(port.calls.map((call) => call.operationId))
    expect([...sent].sort()).toEqual([...MIGRATION_PLAN_OPERATIONS].sort())
  })
})

describe("the runtime operations", () => {
  it("are all the reads of the runtime send", async () => {
    const definition = { id: "order:1:x", key: "order", version: 1 }
    const instance = {
      id: "p1",
      processDefinitionId: definition.id,
      processDefinitionKey: definition.key,
      processDefinitionVersion: 1,
      state: "ACTIVE",
    }
    const incident = {
      id: "i1",
      incidentType: "failedJob",
      activityId: "a",
      incidentTimestamp: "2026-10-21T18:44:04.554+0000",
    }
    const routes: Record<string, Route> = {
      getTelemetryData: () => {
        throw fakeFailure(404, "InvalidRequestException")
      },
      getRestAPIVersion: () => ({ version: "7.24.0" }),
      getProcessDefinitionStatistics: () => [{ definition, instances: 1 }],
      getProcessInstances: () => [{ id: "p1", definitionId: definition.id }],
      getProcessInstancesCount: () => ({ count: 1 }),
      getProcessDefinitionBpmn20Xml: () => ({ bpmn20Xml: "<definitions/>" }),
      getActivityStatistics: () => [],
      getIncident: (input) => ({
        ...incident,
        incidentType: input.pathArgs[0] === "i1" ? "failedJob" : "failedExternalTask",
        configuration: "t1",
      }),
      getStacktrace: () => "boom",
      getExternalTaskErrorDetails: () => "down",
      queryHistoricProcessInstances: () => [instance],
      queryHistoricProcessInstancesCount: () => ({ count: 1 }),
      queryHistoricVariableInstances: () => [{ name: "amount" }],
    }
    const port = fakePort(only(RUNTIME_OPERATIONS, routes))
    const id = DefinitionId("order:1:x")
    const definitions = new DefinitionReader(port)
    const instances = new InstanceSearch(port)
    await new EngineReader(port).describe()
    await definitions.list()
    await definitions.diagramXml(id)
    await new ElementStatisticsReader(port).of(id)
    await new CalledProcessReader(port).read({ id, tenantId: null })
    await instances.search({}, { limit: 5 })
    await instances.count({ withIncident: true })
    await instances.count({ withIncident: true, activeElementId: ElementId("a") })
    await new VariableNameReader(port).names(id)
    await new IncidentSearch(port, definitions).search({}, { limit: 5 })
    await new IncidentDetailsReader(port).read(IncidentId("i1"))
    await new IncidentDetailsReader(port).read(IncidentId("i2"))
    const details = await instanceDetailSends()
    const batches = await bulkAndMigrationSends()
    const sent = new Set([...port.calls.map((call) => call.operationId), ...details, ...batches])
    expect([...sent].sort()).toEqual([...RUNTIME_OPERATIONS].sort())
  })
})

/** What the instance detail sends for a running instance with an incident in a called one and for an ended one. */
async function instanceDetailSends(): Promise<string[]> {
  const extra: Record<string, Route> = {
    getVariableInstances: () => [],
    queryHistoricProcessInstances: () => [],
  }
  const running = fakePort(only(RUNTIME_OPERATIONS, { ...approveRoutes(), ...extra }))
  const ended = fakePort(
    only(RUNTIME_OPERATIONS, {
      ...extra,
      getProcessInstance: () => {
        throw fakeFailure(404, "InvalidRequestException")
      },
      getHistoricProcessInstance: () => ({ ...historyDto, state: "COMPLETED" }),
    }),
  )
  await new InstanceDetailReader(running).read(InstanceId(P))
  await new InstanceDetailReader(ended).read(InstanceId(P))
  return [...running.calls, ...ended.calls].map((call) => call.operationId)
}

/** What a bulk operation that ended, the failures of a running one and a migration's planning send. */
async function bulkAndMigrationSends(): Promise<string[]> {
  const batch = { id: "b1", type: "instance-migration", totalJobs: 2, batchJobDefinitionId: "jd1" }
  const port = fakePort(
    only(RUNTIME_OPERATIONS, {
      getBatchStatistics: (input) =>
        input.query.batchId === "b1" ? [{ ...batch, completedJobs: 0, failedJobs: 1 }] : [],
      getHistoricBatch: () => ({ ...batch, id: "b2" }),
      getJobs: () => [{ id: "j1" }],
      generateMigrationPlan: () => ({
        sourceProcessDefinitionId: "order:1:x",
        targetProcessDefinitionId: "order:2:y",
      }),
      validateMigrationPlan: () => ({}),
    }),
  )
  const bulk = new BulkOperationReader(port)
  const migrations = new MigrationReader(port)
  await bulk.read(BulkOperationId("b2"))
  await bulk.failures(BulkOperationId("b1"))
  const plan = await migrations.proposal(DefinitionId("order:1:x"), DefinitionId("order:2:y"))
  await migrations.check(plan)
  return port.calls.map((call) => call.operationId)
}

describe("CORE_OPERATIONS", () => {
  it("is every operation of the composites, the wait, with incident, the migration plans and the runtime, once each, in order", () => {
    const all = new Set<string>([
      ...INSPECT_OPERATIONS,
      ...STATUS_OPERATIONS,
      ...CONDITION_OPERATIONS,
      ...WITH_INCIDENT_OPERATIONS,
      ...MIGRATION_PLAN_OPERATIONS,
      ...RUNTIME_OPERATIONS,
    ])
    expect(CORE_OPERATIONS).toHaveLength(all.size)
    expect(new Set(CORE_OPERATIONS)).toEqual(all)
    expect(CORE_OPERATIONS).toEqual([...all].sort())
  })
})
