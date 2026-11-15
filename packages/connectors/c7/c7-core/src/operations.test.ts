import { DefinitionId } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { type Condition, measure } from "./conditions.js"
import { readStatus } from "./engine-status.js"
import { inspectInstance } from "./inspect.js"
import {
  CONDITION_OPERATIONS,
  CORE_OPERATIONS,
  INSPECT_OPERATIONS,
  RUNTIME_OPERATIONS,
  STATUS_OPERATIONS,
  WITH_INCIDENT_OPERATIONS,
} from "./operations.js"
import { CalledProcessReader } from "./runtime/called-process-reader.js"
import { DefinitionReader } from "./runtime/definition-reader.js"
import { ElementStatisticsReader } from "./runtime/element-statistics-reader.js"
import { EngineReader } from "./runtime/engine-reader.js"
import type { Route } from "./testing/fake-port.js"
import { fakeFailure, fakePort } from "./testing/fake-port.js"
import { P } from "./testing/fixture.js"
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

describe("the runtime operations", () => {
  it("are all the reads of the runtime send", async () => {
    const definition = { id: "order:1:x", key: "order", version: 1 }
    const routes: Record<string, Route> = {
      getTelemetryData: () => {
        throw fakeFailure(404, "InvalidRequestException")
      },
      getRestAPIVersion: () => ({ version: "7.24.0" }),
      getProcessDefinitionStatistics: () => [{ definition, instances: 1 }],
      getProcessDefinitionBpmn20Xml: () => ({ bpmn20Xml: "<definitions/>" }),
      getActivityStatistics: () => [],
    }
    const port = fakePort(only(RUNTIME_OPERATIONS, routes))
    const id = DefinitionId("order:1:x")
    await new EngineReader(port).describe()
    await new DefinitionReader(port).list()
    await new DefinitionReader(port).diagramXml(id)
    await new ElementStatisticsReader(port).of(id)
    await new CalledProcessReader(port).read(id)
    const sent = new Set(port.calls.map((call) => call.operationId))
    expect([...sent].sort()).toEqual([...RUNTIME_OPERATIONS].sort())
  })
})

describe("CORE_OPERATIONS", () => {
  it("is every operation of the composites, the wait, with incident and the runtime, once each, in order", () => {
    const all = new Set<string>([
      ...INSPECT_OPERATIONS,
      ...STATUS_OPERATIONS,
      ...CONDITION_OPERATIONS,
      ...WITH_INCIDENT_OPERATIONS,
      ...RUNTIME_OPERATIONS,
    ])
    expect(CORE_OPERATIONS).toHaveLength(all.size)
    expect(new Set(CORE_OPERATIONS)).toEqual(all)
    expect(CORE_OPERATIONS).toEqual([...all].sort())
  })
})
