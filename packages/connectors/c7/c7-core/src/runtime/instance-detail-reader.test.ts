import { InstanceId, RuntimeError } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { fakeFailure, fakePort, type Route } from "../testing/fake-port.js"
import { C, CHILD_DEF, P } from "../testing/fixture.js"
import { approveRoutes } from "../testing/inspect-routes.js"
import { InstanceDetailReader } from "./instance-detail-reader.js"
import type { InspectView } from "./instance-inspection.js"

const SINCE = "2026-10-21T18:44:04.613+0000"
const CHILD_ROW = {
  id: C,
  processDefinitionId: CHILD_DEF,
  processDefinitionKey: "workflow-child",
  processDefinitionVersion: 1,
  processDefinitionName: "Child",
  state: "ACTIVE",
}
const TYPED = [
  {
    name: "amount",
    type: "Integer",
    value: 300,
    activityInstanceId: P,
    processInstanceId: P,
  },
]
const VIEW: InspectView = {
  id: "p1",
  definition: { id: "order:1:d1", key: "order", version: 1 },
  state: "ACTIVE",
  waitingAt: [],
  incidents: [],
  children: [],
  timeline: [],
  next: [],
}

function approveReader(routes: Readonly<Record<string, Route>> = {}) {
  const port = fakePort({
    ...approveRoutes(),
    getVariableInstances: () => TYPED,
    queryHistoricProcessInstances: () => [CHILD_ROW],
    ...routes,
  })
  return { port, reader: new InstanceDetailReader(port) }
}

function readerOf(inspect: () => Promise<InspectView | undefined>, routes = {}) {
  const port = fakePort({ getVariableInstances: () => [], ...routes })
  return { port, reader: new InstanceDetailReader(port, { inspect }) }
}

function incident(id: string, processInstanceId?: string) {
  return {
    id,
    type: "failedJob",
    activityId: "a",
    since: SINCE,
    ...(processInstanceId === undefined ? {} : { processInstanceId }),
  }
}

describe("InstanceDetailReader.read", () => {
  it("details an instance from its inspection, its typed variables and its incidents' versions", async () => {
    const { reader } = approveReader()

    const detail = await reader.read(InstanceId(P))

    expect(detail?.instance).toMatchObject({ id: P, state: "running", hasIncident: true })
    expect(detail?.waitStates.map((wait) => [wait.kind, wait.instanceId])).toStrictEqual([
      ["userTask", C],
    ])
    expect(detail?.incidents).toMatchObject([
      {
        id: "i1",
        instanceId: C,
        definition: { id: CHILD_DEF, bpmnProcessId: "workflow-child", version: 1, name: "Child" },
        details: { kind: "stacktrace", rootCause: "PropertyNotFoundException: missingBean" },
      },
    ])
    expect(detail?.calledInstances).toStrictEqual([
      { id: C, parentInstanceId: P, bpmnProcessId: "workflow-child", state: "running" },
    ])
    expect(detail?.path.map((step) => step.elementId)).toStrictEqual(["start"])
    expect(detail?.variables).toStrictEqual([
      {
        name: "amount",
        scope: { kind: "instance" },
        valueJson: "300",
        truncated: false,
        kind: "integer",
        type: "Integer",
      },
    ])
  })

  it("starts the inspection and the typed variables together, then asks for the versions", async () => {
    const { port, reader } = approveReader()

    await reader.read(InstanceId(P))

    expect(port.calls.slice(0, 4).map((call) => call.operationId)).toStrictEqual([
      "getProcessInstance",
      "getHistoricProcessInstance",
      "queryHistoricActivityInstances",
      "getVariableInstances",
    ])
    expect(port.calls.at(-1)).toStrictEqual({
      operationId: "queryHistoricProcessInstances",
      input: {
        pathArgs: [],
        query: { firstResult: "0", maxResults: "1" },
        body: {
          processInstanceIds: [C],
          sorting: [
            { sortBy: "startTime", sortOrder: "desc" },
            { sortBy: "instanceId", sortOrder: "asc" },
          ],
        },
      },
    })
  })

  it("asks the history once for each called instance an incident was raised in", async () => {
    const view = {
      ...VIEW,
      incidents: [incident("i1"), incident("i2", "p1"), incident("i3", "c1"), incident("i4", "c1")],
    }
    const { port, reader } = readerOf(() => Promise.resolve(view), {
      queryHistoricProcessInstances: () => [{ ...CHILD_ROW, id: "c1" }],
    })

    const detail = await reader.read(InstanceId("p1"))

    const history = port.calls.filter(
      (call) => call.operationId === "queryHistoricProcessInstances",
    )
    expect(history.map((call) => [call.input.query, call.input.body])).toMatchObject([
      [{ maxResults: "1" }, { processInstanceIds: ["c1"] }],
    ])
    expect(detail?.incidents.map((each) => [each.id, each.definition.id])).toStrictEqual([
      ["i1", "order:1:d1"],
      ["i2", "order:1:d1"],
      ["i3", CHILD_DEF],
      ["i4", CHILD_DEF],
    ])
  })

  it("asks the history nothing when every incident is the instance's own", async () => {
    const view = { ...VIEW, incidents: [incident("i1"), incident("i2", "p1")] }
    const { port, reader } = readerOf(() => Promise.resolve(view))

    expect((await reader.read(InstanceId("p1")))?.incidents).toHaveLength(2)
    expect(port.calls.map((call) => call.operationId)).toStrictEqual(["getVariableInstances"])
  })

  it.each<[string, Route]>([
    [
      "the engine fails to list them",
      () => {
        throw fakeFailure(500, "ProcessEngineException")
      },
    ],
    ["the engine lists no variables", () => ({ variables: [] })],
  ])("takes the inspection's variables when %s", async (_name, variables) => {
    const { reader } = approveReader({ getVariableInstances: variables })

    expect((await reader.read(InstanceId(P)))?.variables).toStrictEqual([
      {
        name: "amount",
        scope: { kind: "instance" },
        valueJson: "250",
        truncated: false,
        kind: "integer",
      },
    ])
  })

  it.each(["p/1", ".", "..", "a,b"])(
    "is undefined for the id %j, which no engine assigns, without a request",
    async (id) => {
      const { port, reader } = approveReader()

      expect(await reader.read(InstanceId(id))).toBeUndefined()
      expect(port.calls).toStrictEqual([])
    },
  )

  it("is undefined for an instance the engine does not know", async () => {
    const missing = () => {
      throw fakeFailure(404, "InvalidRequestException")
    }
    const { reader } = approveReader({
      getProcessInstance: missing,
      getHistoricProcessInstance: missing,
    })

    expect(await reader.read(InstanceId(P))).toBeUndefined()
  })

  it.each([
    ["missing", 404, "InvalidRequestException"],
    ["gone meanwhile", 500, "NullValueException"],
  ])("is undefined for an instance whose inspection finds it %s", async (_name, status, type) => {
    const { reader } = readerOf(() => Promise.reject(fakeFailure(status, type)))

    expect(await reader.read(InstanceId("p1"))).toBeUndefined()
  })

  it.each([
    ["an engine failure", 500, "ProcessEngineException"],
    ["a path the REST API does not serve", 404, "NotFoundException"],
  ])("fails on %s of the inspection", async (_name, status, type) => {
    const { reader } = readerOf(() => Promise.reject(fakeFailure(status, type)))

    await expect(reader.read(InstanceId("p1"))).rejects.toThrow(`HTTP ${String(status)} ${type}`)
  })

  it("fails when the history cannot name the version of a called instance", async () => {
    const { reader } = approveReader({ queryHistoricProcessInstances: () => [{ id: C }] })
    const error = await reader.read(InstanceId(P)).catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(RuntimeError)
    expect(error).toMatchObject({ failure: "unexpectedResponse" })
  })

  it("leaves out an incident whose instance the history does not list", async () => {
    const { reader } = approveReader({ queryHistoricProcessInstances: () => [] })

    expect((await reader.read(InstanceId(P)))?.incidents).toStrictEqual([])
  })

  it("names the parent's own version for the instance itself", async () => {
    const view = { ...VIEW, incidents: [incident("i1")] }
    const { reader } = readerOf(() => Promise.resolve(view))

    expect((await reader.read(InstanceId("p1")))?.incidents[0]?.definition).toStrictEqual({
      id: "order:1:d1",
      bpmnProcessId: "order",
      version: 1,
    })
  })
})
