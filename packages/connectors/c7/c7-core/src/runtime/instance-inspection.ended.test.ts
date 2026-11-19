import { describe, expect, it } from "vitest"
import type { OperationInput } from "../port.js"
import { fakeFailure, fakePort, type Route } from "../testing/fake-port.js"
import { InstanceInspection } from "./instance-inspection.js"
import { inspectedVariablesOf } from "./variable-instances.js"

const SINCE = "2026-10-21T18:00:00.000+0000"
const LATER = "2026-10-21T19:00:00.000+0000"
const ORDER = "order:1:d1"
const LISTS = ["getIncidents", "getEventSubscriptions", "getTasks", "getExternalTasks", "getJobs"]

type Routes = Record<string, Route>

const missing: Route = () => {
  throw fakeFailure(404, "InvalidRequestException")
}

function byQuery(key: string, answers: Readonly<Record<string, unknown>>): Route {
  return (input) => answers[input.query[key] ?? ""] ?? []
}

function history(id: string, more: Record<string, unknown> = {}) {
  const definition = { processDefinitionKey: "order", processDefinitionVersion: 1 }
  return { id, processDefinitionId: ORDER, ...definition, ...more }
}

function emptyLists(): Routes {
  return Object.fromEntries(LISTS.map((operationId) => [operationId, () => []]))
}

function inspect(routes: Routes, id = "p1") {
  const port = fakePort(routes)
  return { port, view: new InstanceInspection(port).inspect(id) }
}

function pathReads(calls: readonly { operationId: string; input: OperationInput }[]) {
  return calls.filter((call) => call.operationId === "getHistoricActivityInstances")
}

describe("InstanceInspection of an instance that is not running", () => {
  it("is undefined for an instance neither the runtime nor the history knows", async () => {
    const routes = { getProcessInstance: missing, getHistoricProcessInstance: missing }

    expect(await inspect({ ...routes, getHistoricActivityInstances: missing }).view).toBeUndefined()
  })

  it("reads an ended instance from its history alone, its path once more after the rounds", async () => {
    const { port, view } = inspect(
      {
        getProcessInstance: missing,
        getHistoricProcessInstance: () =>
          history("e1", { state: "COMPLETED", superProcessInstanceId: "p0" }),
        getHistoricVariableInstances: () => [
          { name: "route", type: "String", value: "review", activityInstanceId: "e1" },
          { name: "local", type: "String", value: "x", activityInstanceId: "task:1" },
        ],
        getProcessDefinitions: () => [{ id: ORDER, key: "order", version: 1 }],
        getHistoricActivityInstances: () => [],
      },
      "e1",
    )

    expect(await view).toMatchObject({
      state: "COMPLETED",
      parentId: "p0",
      waitingAt: [],
      children: [],
    })
    expect(inspectedVariablesOf((await view)?.variables)).toEqual([
      { name: "route", valueJson: '"review"' },
    ])
    expect(pathReads(port.calls)).toHaveLength(2)
  })

  it("reads the path of an ended instance after the rounds, whatever the parallel read gave", async () => {
    let pathRead = 0
    const { view } = inspect({
      getProcessInstance: missing,
      getHistoricProcessInstance: () => history("p1", { state: "COMPLETED" }),
      getHistoricVariableInstances: () => [],
      getHistoricActivityInstances: () => {
        pathRead += 1
        if (pathRead === 1) throw fakeFailure(500, "ProcessEngineException")
        return [{ activityId: "end", startTime: LATER }]
      },
    })

    expect((await view)?.timeline.map((step) => step.activityId)).toEqual(["end"])
  })

  it("names the definition and the caller of an instance without history", async () => {
    const { view } = inspect({
      getProcessInstance: () => ({ id: "p1", definitionId: ORDER, businessKey: "K" }),
      getHistoricProcessInstance: missing,
      getProcessInstances: byQuery("subProcessInstance", { p1: [{ id: "p0" }] }),
      getActivityInstanceTree: () => ({ id: "p1", activityId: ORDER }),
      getProcessInstanceVariables: () => ({}),
      getProcessDefinitions: () => [{ id: ORDER, key: "order", version: 4 }],
      ...emptyLists(),
      getJobDefinitions: () => [],
      getHistoricActivityInstances: () => [],
    })

    expect(await view).toMatchObject({
      businessKey: "K",
      parentId: "p0",
      definition: { version: 4 },
    })
  })
})

describe("InstanceInspection of an instance that ends while it is read", () => {
  /** The instance answers once, then is gone: its tree, its variables and its runtime record. */
  function endingTree(path: Route): Routes {
    let runtimeReads = 0
    return {
      ...emptyLists(),
      getProcessDefinitions: () => [],
      getJobDefinitions: () => [],
      getProcessInstances: () => [],
      getProcessInstance: () => {
        runtimeReads += 1
        if (runtimeReads === 1) return { id: "p1", definitionId: ORDER }
        throw fakeFailure(404, "InvalidRequestException")
      },
      getHistoricProcessInstance: () => history("p1", { state: "COMPLETED" }),
      getActivityInstanceTree: missing,
      getProcessInstanceVariables: () => {
        throw fakeFailure(500, "NullValueException")
      },
      getHistoricVariableInstances: () => [],
      getHistoricActivityInstances: path,
    }
  }

  it("reads it as ended", async () => {
    const view = await inspect(endingTree(() => [])).view

    expect(view).toMatchObject({ id: "p1", state: "COMPLETED", waitingAt: [] })
  })

  it("reads its path after its end", async () => {
    const start = { activityId: "start", startTime: SINCE, endTime: SINCE }
    let pathReads = 0
    const view = await inspect(
      endingTree(() => {
        pathReads += 1
        return pathReads === 1 ? [start] : [start, { activityId: "end", startTime: LATER }]
      }),
    ).view

    expect(view?.timeline.map((step) => step.activityId)).toEqual(["start", "end"])
  })
})
