import {
  BpmnProcessId,
  BulkOperationId,
  DefinitionId,
  ElementId,
  IncidentId,
  InstanceId,
  type ProcessRuntime,
  RuntimeError,
} from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { RUNTIME_OPERATIONS } from "../operations.js"
import { fakeFailure, fakePort, type Route } from "../testing/fake-port.js"
import { C7Runtime } from "./c7-runtime.js"

type Read = (runtime: C7Runtime) => Promise<unknown>

const DEFINITION = DefinitionId("order:1:x")
const PLAN = { sourceDefinitionId: DEFINITION, targetDefinitionId: DEFINITION, mappings: [] }

/** Every read of the contract, and those beyond it, with the operation each sends first. */
const READS: readonly (readonly [string, string, Read])[] = [
  ["describeEngine", "getTelemetryData", (runtime) => runtime.describeEngine()],
  ["listDefinitions", "getProcessDefinitionStatistics", (runtime) => runtime.listDefinitions()],
  [
    "listVersions",
    "getProcessDefinitionStatistics",
    (runtime) => runtime.listVersions(BpmnProcessId("order")),
  ],
  [
    "getDiagramXml",
    "getProcessDefinitionBpmn20Xml",
    (runtime) => runtime.getDiagramXml(DEFINITION),
  ],
  [
    "getElementStatistics",
    "getActivityStatistics",
    (runtime) => runtime.getElementStatistics(DEFINITION),
  ],
  [
    "getElementStatisticsWithFailedJobs",
    "getActivityStatistics",
    (runtime) => runtime.getElementStatisticsWithFailedJobs(DEFINITION),
  ],
  [
    "getCalledProcesses",
    "getProcessDefinitionBpmn20Xml",
    (runtime) => runtime.getCalledProcesses(DEFINITION),
  ],
  [
    "searchInstances",
    "queryHistoricProcessInstances",
    (runtime) => runtime.searchInstances({}, { limit: 5 }),
  ],
  ["countInstances", "queryHistoricProcessInstancesCount", (runtime) => runtime.countInstances({})],
  [
    "listVariableNames",
    "queryHistoricProcessInstances",
    (runtime) => runtime.listVariableNames(DEFINITION),
  ],
  [
    "getInstanceDetail",
    "getProcessInstance",
    (runtime) => runtime.getInstanceDetail(InstanceId("p1")),
  ],
  ["searchIncidents", "getIncidents", (runtime) => runtime.searchIncidents({}, { limit: 5 })],
  [
    "searchElementRootIncidents",
    "getIncidents",
    (runtime) =>
      runtime.searchElementRootIncidents(
        { bpmnProcessId: BpmnProcessId("order"), elementId: ElementId("Task") },
        { limit: 5 },
      ),
  ],
  ["getIncidentDetails", "getIncident", (runtime) => runtime.getIncidentDetails(IncidentId("i1"))],
  [
    "getBulkOperation",
    "getBatchStatistics",
    (runtime) => runtime.getBulkOperation(BulkOperationId("b1")),
  ],
  [
    "getBulkFailures",
    "getBatchStatistics",
    (runtime) => runtime.getBulkFailures(BulkOperationId("b1")),
  ],
  [
    "proposeMigration",
    "generateMigrationPlan",
    (runtime) => runtime.proposeMigration(DEFINITION, DEFINITION),
  ],
  ["checkMigration", "validateMigrationPlan", (runtime) => runtime.checkMigration(PLAN)],
]

/** A port on which every runtime operation fails with `error`. */
function failingWith(error: Error) {
  const fail: Route = () => {
    throw error
  }
  return fakePort(Object.fromEntries(RUNTIME_OPERATIONS.map((operationId) => [operationId, fail])))
}

function runtimeOver(routes: Readonly<Record<string, Route>>, seen: unknown[] = []) {
  const port = fakePort(routes)
  const runtime = C7Runtime.over(port, {
    failureOf: (error) => {
      seen.push(error)
      return new RuntimeError("engineFailure", "worded by the surface")
    },
  })
  return { port, runtime }
}

async function rejectionOf(attempt: Promise<unknown>): Promise<unknown> {
  return attempt.then(
    () => undefined,
    (error: unknown) => error,
  )
}

describe("C7Runtime", () => {
  it("answers every read of the contract, refusing no variable condition", () => {
    const runtime: ProcessRuntime = runtimeOver({}).runtime
    const reads = READS.map(([name]) => name)

    expect(reads.filter((name) => typeof Reflect.get(runtime, name) !== "function")).toEqual([])
    expect("refusedVariableConditions" in runtime).toBe(false)
  })

  it.each(READS)(
    "words a wire's failure of %s by the surface's failureOf",
    async (_name, first, read) => {
      const wire = new Error("the wire failed")
      const seen: unknown[] = []
      const port = failingWith(wire)
      const runtime = C7Runtime.over(port, {
        failureOf: (error) => {
          seen.push(error)
          return new RuntimeError("unreachable", "worded by the surface")
        },
      })

      const error = await rejectionOf(read(runtime))

      expect(error).toMatchObject({ failure: "unreachable", message: "worded by the surface" })
      expect(seen).toStrictEqual([wire])
      expect(port.calls[0]?.operationId).toBe(first)
    },
  )

  it.each(READS)("lets a RuntimeError of %s pass as it is", async (_name, _first, read) => {
    const own = new RuntimeError("unexpectedResponse", "c7-core's own words")
    const seen: unknown[] = []
    const { runtime } = runtimeOver(
      Object.fromEntries(
        RUNTIME_OPERATIONS.map((operationId) => [
          operationId,
          () => {
            throw own
          },
        ]),
      ),
      seen,
    )

    expect(await rejectionOf(read(runtime))).toBe(own)
    expect(seen).toStrictEqual([])
  })

  it("reads every diagram through the surface's diagramXml where it gives one", async () => {
    const xml =
      '<bpmn:process id="order"><bpmn:callActivity id="Call" calledElement="label" /></bpmn:process>'
    const port = fakePort({
      getActivityStatistics: () => [
        { id: "Call", instances: 1, incidents: [{ incidentType: "failedJob", incidentCount: 1 }] },
      ],
      getIncidents: () => [
        {
          id: "i1",
          incidentType: "failedJob",
          activityId: "Call",
          incidentTimestamp: "2026-11-21T12:00:00.000+0000",
          rootCauseIncidentId: "i9",
        },
      ],
      getProcessDefinitions: () => [{ id: "label:1:l", key: "label", version: 1 }],
    })
    const asked: string[] = []
    const runtime = C7Runtime.over(port, {
      failureOf: (error) => new RuntimeError("engineFailure", String(error)),
      diagramXml: (id) => {
        asked.push(id)
        return Promise.resolve(xml)
      },
    })

    expect(await runtime.getDiagramXml(DEFINITION)).toBe(xml)
    expect(await runtime.getCalledProcesses(DEFINITION)).toStrictEqual([
      {
        elementId: "Call",
        bpmnProcessId: "label",
        definition: { id: "label:1:l", bpmnProcessId: "label", version: 1 },
      },
    ])
    expect(await runtime.getElementStatistics(DEFINITION)).toStrictEqual([
      { elementId: "Call", active: 1, incidents: 0, incidentsInCalledInstances: 1 },
    ])
    expect(asked).toEqual([DEFINITION, DEFINITION, DEFINITION])
    expect(port.calls.map((call) => call.operationId)).not.toContain(
      "getProcessDefinitionBpmn20Xml",
    )
  })

  it("words a failure of the surface's diagramXml by its failureOf, and counts on without it", async () => {
    const failed = new Error("the surface's read failed")
    const seen: unknown[] = []
    const port = fakePort({
      getActivityStatistics: () => [
        { id: "Task", instances: 2, incidents: [{ incidentType: "failedJob", incidentCount: 1 }] },
      ],
      getIncidents: () => [
        {
          id: "i1",
          incidentType: "failedJob",
          activityId: "Task",
          incidentTimestamp: "2026-11-21T12:00:00.000+0000",
        },
      ],
    })
    const runtime = C7Runtime.over(port, {
      failureOf: (error) => {
        seen.push(error)
        return new RuntimeError("unreachable", "worded by the surface")
      },
      diagramXml: () => Promise.reject(failed),
    })

    await expect(runtime.getDiagramXml(DEFINITION)).rejects.toMatchObject({
      failure: "unreachable",
    })
    await expect(runtime.getCalledProcesses(DEFINITION)).rejects.toMatchObject({
      failure: "unreachable",
    })
    expect(await runtime.getElementStatistics(DEFINITION)).toStrictEqual([
      { elementId: "Task", active: 1, incidents: 1, incidentsInCalledInstances: 0 },
    ])
    expect(seen).toStrictEqual([failed, failed])
  })

  it.each([
    [
      undefined,
      [["getProcessInstancesCount", { withIncident: "true", processDefinitionId: "order:1:x" }]],
    ],
    [
      "listing",
      [
        ["getProcessInstances", expect.objectContaining({ firstResult: "1", maxResults: "1" })],
        ["getProcessInstances", expect.objectContaining({ firstResult: "2", maxResults: "1" })],
      ],
    ],
  ] as const)(
    "counts with incident per version by withIncidentCounting, past a page of one by the path %s",
    async (path, past) => {
      const definition = { id: "order:1:x", key: "order", version: 1 }
      const failing = [
        { id: "p1", definitionId: definition.id },
        { id: "p2", definitionId: definition.id },
      ]
      const port = fakePort({
        getProcessDefinitionStatistics: () => [{ definition, instances: 3, incidents: [] }],
        getProcessInstances: ({ query }) => failing.slice(Number(query.firstResult)).slice(0, 1),
        getProcessInstancesCount: () => ({ count: 2 }),
      })
      const runtime = C7Runtime.over(port, {
        failureOf: (error) => new RuntimeError("engineFailure", String(error)),
        withIncidentCounting: path === undefined ? { pageSize: 1 } : { pageSize: 1, path },
      })

      expect(await runtime.listVersions(BpmnProcessId("order"))).toMatchObject([
        { running: 3, withIncident: 2 },
      ])
      expect(port.calls.map(({ operationId, input }) => [operationId, input.query])).toStrictEqual([
        ["getProcessDefinitionStatistics", { rootIncidents: "true" }],
        [
          "getProcessInstances",
          expect.objectContaining({ processDefinitionKey: "order", maxResults: "1" }),
        ],
        ["getProcessInstancesCount", { withIncident: "true", processDefinitionKey: "order" }],
        ...past,
      ])
    },
  )

  it("answers through the readers over the port", async () => {
    const { runtime } = runtimeOver({
      getTelemetryData: () => {
        throw fakeFailure(404, "InvalidRequestException")
      },
      getRestAPIVersion: () => ({ version: "7.24.0" }),
      queryHistoricProcessInstancesCount: () => ({ count: 7 }),
      getBatchStatistics: () => [],
      getHistoricBatch: () => {
        throw fakeFailure(404, "InvalidRequestException")
      },
      generateMigrationPlan: () => ({
        sourceProcessDefinitionId: DEFINITION,
        targetProcessDefinitionId: DEFINITION,
      }),
    })

    expect(await runtime.describeEngine()).toStrictEqual({
      product: "Camunda 7 REST API",
      version: "7.24.0",
    })
    expect(await runtime.countInstances({})).toStrictEqual({ count: 7 })
    expect(await runtime.getBulkOperation(BulkOperationId("b1"))).toBeUndefined()
    expect(await runtime.getBulkFailures(BulkOperationId("b1"))).toStrictEqual([])
    expect(await runtime.proposeMigration(DEFINITION, DEFINITION)).toStrictEqual(PLAN)
  })
})
