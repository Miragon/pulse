import { BpmnProcessId, DefinitionId, ElementId, InstanceId } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { type FakeCall, fakePort, type Route } from "../testing/fake-port.js"
import { InstanceSearch } from "./instance-search.js"

function searchOver(routes: Readonly<Record<string, Route>>) {
  const port = fakePort(routes)
  return { port, search: new InstanceSearch(port) }
}

function sent(calls: readonly FakeCall[]): string[] {
  return calls.map((call) => call.operationId)
}

function bodyOf(call: FakeCall | undefined): string {
  return JSON.stringify(call?.input.body)
}

/** The history's counts: `all` for a query without ids, `ofIds` for one over ids. */
function historyCounts(counts: { readonly all: number; readonly ofIds: number }): Route {
  return (input) => ({
    count:
      (input.body as { readonly processInstanceIds?: unknown }).processInstanceIds === undefined
        ? counts.all
        : counts.ofIds,
  })
}

describe("InstanceSearch.count", () => {
  it("counts the running instances in the history, asking the runtime nothing", async () => {
    const { port, search } = searchOver({
      queryHistoricProcessInstancesCount: () => ({ count: 4 }),
    })

    expect(await search.count({ lifecycle: "running" })).toBe(4)
    expect(port.calls).toStrictEqual([
      {
        operationId: "queryHistoricProcessInstancesCount",
        input: { pathArgs: [], query: {}, body: { unfinished: true } },
      },
    ])
  })

  it("counts the history's instances of the filter", async () => {
    const { port, search } = searchOver({
      queryHistoricProcessInstancesCount: () => ({ count: 3 }),
    })

    expect(
      await search.count({ businessKey: "ORD-1", activeElementId: ElementId("Activity_Pack") }),
    ).toBe(3)
    expect(bodyOf(port.calls[0])).toBe(
      '{"processInstanceBusinessKey":"ORD-1","activityIdIn":["Activity_Pack"]}',
    )
  })

  it("counts the instances with an incident in one runtime count when the runtime knows the filter", async () => {
    const { port, search } = searchOver({ getProcessInstancesCount: () => ({ count: 2 }) })

    expect(
      await search.count({
        definitionId: DefinitionId("order:1:a"),
        lifecycle: "running",
        withIncident: true,
        businessKey: "ORD-1",
      }),
    ).toBe(2)
    expect(port.calls).toStrictEqual([
      {
        operationId: "getProcessInstancesCount",
        input: {
          pathArgs: [],
          query: { withIncident: "true", processDefinitionId: "order:1:a", businessKey: "ORD-1" },
        },
      },
    ])
  })

  it("counts the instances with an incident at an element over the runtime's ids", async () => {
    const { port, search } = searchOver({
      getProcessInstances: () => [{ id: "p1", definitionId: "order:1:a" }],
      queryHistoricProcessInstancesCount: () => ({ count: 1 }),
    })

    expect(
      await search.count({ withIncident: true, activeElementId: ElementId("Activity_Pay") }),
    ).toBe(1)
    expect(sent(port.calls)).toStrictEqual([
      "getProcessInstances",
      "queryHistoricProcessInstancesCount",
    ])
    expect(bodyOf(port.calls[1])).toBe(
      '{"processInstanceIds":["p1"],"activityIdIn":["Activity_Pay"]}',
    )
  })

  it("counts no ended instance with an incident and no given ids, without a request", async () => {
    const { port, search } = searchOver({})

    expect(await search.count({ lifecycle: "ended", withIncident: true })).toBe(0)
    expect(await search.count({ instanceIds: [] })).toBe(0)
    expect(port.calls).toStrictEqual([])
  })

  it("counts the instances without an incident as the history's minus its count of the runtime's ids with one", async () => {
    const { port, search } = searchOver({
      queryHistoricProcessInstancesCount: historyCounts({ all: 3, ofIds: 1 }),
      getProcessInstances: () => [{ id: "p1", definitionId: "order:1:a" }],
    })

    expect(await search.count({ bpmnProcessId: BpmnProcessId("order"), withIncident: false })).toBe(
      2,
    )
    expect(sent(port.calls)).toStrictEqual([
      "queryHistoricProcessInstancesCount",
      "getProcessInstances",
      "queryHistoricProcessInstancesCount",
    ])
    expect(bodyOf(port.calls[0])).toBe('{"processDefinitionKey":"order"}')
    expect(port.calls[1]?.input.query).toStrictEqual({
      withIncident: "true",
      processDefinitionKey: "order",
      sortBy: "instanceId",
      sortOrder: "asc",
      firstResult: "0",
      maxResults: "500",
    })
    expect(bodyOf(port.calls[2])).toBe(
      '{"processDefinitionKey":"order","processInstanceIds":["p1"]}',
    )
  })

  it("counts 0, never below, where the history holds none of the instances the runtime runs", async () => {
    const { search } = searchOver({
      queryHistoricProcessInstancesCount: historyCounts({ all: 0, ofIds: 0 }),
      getProcessInstances: () => [
        { id: "p1", definitionId: "order:1:a" },
        { id: "p2", definitionId: "order:1:a" },
      ],
    })

    expect(await search.count({ lifecycle: "running", withIncident: false })).toBe(0)
  })

  it("subtracts only the instances with an incident the history holds, where it misses some", async () => {
    const { port, search } = searchOver({
      queryHistoricProcessInstancesCount: historyCounts({ all: 10, ofIds: 1 }),
      getProcessInstances: () => [
        { id: "p1", definitionId: "order:1:a" },
        { id: "p2", definitionId: "order:1:a" },
        { id: "p3", definitionId: "order:1:a" },
      ],
    })

    expect(await search.count({ withIncident: false })).toBe(9)
    expect(bodyOf(port.calls[2])).toBe('{"processInstanceIds":["p1","p2","p3"]}')
  })

  it("counts 0, never below, when an instance with an incident starts between the two counts", async () => {
    const { search } = searchOver({
      queryHistoricProcessInstancesCount: historyCounts({ all: 0, ofIds: 1 }),
      getProcessInstances: () => [{ id: "p1", definitionId: "order:1:a" }],
    })

    expect(await search.count({ withIncident: false })).toBe(0)
  })

  it("subtracts nothing and asks the history once when the runtime holds no open incident in the scope", async () => {
    const { port, search } = searchOver({
      queryHistoricProcessInstancesCount: historyCounts({ all: 4, ofIds: 4 }),
      getProcessInstances: () => [],
    })

    expect(await search.count({ businessKey: "ORD-1", withIncident: false })).toBe(4)
    expect(sent(port.calls)).toStrictEqual([
      "queryHistoricProcessInstancesCount",
      "getProcessInstances",
    ])
  })

  it("subtracts of the given ids those the runtime holds an open incident for", async () => {
    const { port, search } = searchOver({
      queryHistoricProcessInstancesCount: (input) => ({
        count: (input.body as { readonly processInstanceIds: readonly string[] }).processInstanceIds
          .length,
      }),
      getProcessInstances: () => [
        { id: "p1", definitionId: "order:1:a" },
        { id: "p9", definitionId: "order:1:a" },
      ],
    })

    expect(
      await search.count({
        instanceIds: [InstanceId("p1"), InstanceId("p3")],
        withIncident: false,
      }),
    ).toBe(1)
    expect(bodyOf(port.calls[0])).toBe('{"processInstanceIds":["p1","p3"]}')
    expect(bodyOf(port.calls[2])).toBe('{"processInstanceIds":["p1"]}')
  })

  it("counts the ended instances without an incident in the history alone", async () => {
    const { port, search } = searchOver({
      queryHistoricProcessInstancesCount: historyCounts({ all: 5, ofIds: 5 }),
    })

    expect(await search.count({ lifecycle: "ended", withIncident: false })).toBe(5)
    expect(sent(port.calls)).toStrictEqual(["queryHistoricProcessInstancesCount"])
    expect(bodyOf(port.calls[0])).toBe('{"finished":true}')
  })
})
