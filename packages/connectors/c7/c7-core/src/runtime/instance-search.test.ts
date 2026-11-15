import {
  BpmnProcessId,
  DefinitionId,
  ElementId,
  InstanceId,
  PageCursor,
} from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { type FakeCall, fakePort, type Route } from "../testing/fake-port.js"
import { InstanceSearch } from "./instance-search.js"

const ROW = {
  processDefinitionId: "order:1:a",
  processDefinitionKey: "order",
  processDefinitionVersion: 1,
  state: "ACTIVE",
}
const RUNNING = { ...ROW, id: "p3", startTime: "2026-10-21T18:44:04.554+0000" }
const ENDED = { ...ROW, id: "p2", state: "COMPLETED", endTime: "2026-10-21T18:44:04.526+0000" }
const FAILING = { ...ROW, id: "p1" }

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

const SORTING =
  '"sorting":[{"sortBy":"startTime","sortOrder":"desc"},{"sortBy":"instanceId","sortOrder":"asc"}]'

describe("InstanceSearch.search", () => {
  it("pages the history's rows newest first and flags the running ones the runtime holds an incident for", async () => {
    const { port, search } = searchOver({
      queryHistoricProcessInstances: () => [RUNNING, ENDED, FAILING],
      getProcessInstances: () => [{ id: "p1", definitionId: "order:1:a" }],
    })

    const page = await search.search({ bpmnProcessId: BpmnProcessId("order") }, { limit: 2 })

    expect(page).toStrictEqual({
      items: [
        {
          id: "p3",
          definition: { id: "order:1:a", bpmnProcessId: "order", version: 1 },
          state: "running",
          hasIncident: false,
          startedAt: "2026-10-21T18:44:04.554Z",
        },
        {
          id: "p2",
          definition: { id: "order:1:a", bpmnProcessId: "order", version: 1 },
          state: "completed",
          hasIncident: false,
          endedAt: "2026-10-21T18:44:04.526Z",
        },
      ],
      next: PageCursor("2"),
    })
    expect(sent(port.calls)).toStrictEqual(["queryHistoricProcessInstances", "getProcessInstances"])
    expect(port.calls[0]?.input.query).toStrictEqual({ firstResult: "0", maxResults: "3" })
    expect(bodyOf(port.calls[0])).toBe(`{"processDefinitionKey":"order",${SORTING}}`)
    expect(port.calls[1]?.input.query).toMatchObject({
      withIncident: "true",
      processInstanceIds: "p3",
    })
  })

  it("flags a running row the runtime holds an open incident for", async () => {
    const { search } = searchOver({
      queryHistoricProcessInstances: () => [RUNNING, FAILING],
      getProcessInstances: () => [{ id: "p1", definitionId: "order:1:a" }],
    })

    const page = await search.search({}, { limit: 5 })

    expect(page.items.map((item) => [item.id, item.hasIncident])).toStrictEqual([
      ["p3", false],
      ["p1", true],
    ])
  })

  it("leaves out the instances with an incident when asked for those without", async () => {
    const { search } = searchOver({
      queryHistoricProcessInstances: () => [RUNNING, FAILING, ENDED],
      getProcessInstances: () => [{ id: "p1", definitionId: "order:1:a" }],
    })

    const page = await search.search({ withIncident: false }, { limit: 5 })

    expect(page.items.map((item) => item.id)).toStrictEqual(["p3", "p2"])
  })

  it("asks the runtime nothing for a page of ended instances", async () => {
    const { port, search } = searchOver({ queryHistoricProcessInstances: () => [ENDED] })

    const page = await search.search({ lifecycle: "ended" }, { limit: 5 })

    expect(page.items.map((item) => [item.id, item.hasIncident])).toStrictEqual([["p2", false]])
    expect(sent(port.calls)).toStrictEqual(["queryHistoricProcessInstances"])
    expect(bodyOf(port.calls[0])).toBe(`{"finished":true,${SORTING}}`)
  })

  it("pages the history's rows of the runtime's ids with an incident, all of them flagged", async () => {
    const { port, search } = searchOver({
      getProcessInstances: () => [
        { id: "p1", definitionId: "order:1:a" },
        { id: "p3", definitionId: "order:1:a" },
      ],
      queryHistoricProcessInstances: () => [RUNNING, FAILING],
    })

    const page = await search.search(
      { withIncident: true, lifecycle: "running", definitionId: DefinitionId("order:1:a") },
      { limit: 10, after: PageCursor("3") },
    )

    expect(page.items.map((item) => [item.id, item.hasIncident])).toStrictEqual([
      ["p3", true],
      ["p1", true],
    ])
    expect(page.next).toBeUndefined()
    expect(sent(port.calls)).toStrictEqual(["getProcessInstances", "queryHistoricProcessInstances"])
    expect(port.calls[0]?.input.query).toStrictEqual({
      withIncident: "true",
      processDefinitionId: "order:1:a",
      sortBy: "instanceId",
      sortOrder: "asc",
      firstResult: "0",
      maxResults: "500",
    })
    expect(bodyOf(port.calls[1])).toBe(
      `{"processDefinitionId":"order:1:a","processInstanceIds":["p1","p3"],"unfinished":true,${SORTING}}`,
    )
    expect(port.calls[1]?.input.query).toStrictEqual({ firstResult: "3", maxResults: "2" })
  })

  it("keeps of the given ids those the runtime holds an open incident for", async () => {
    const { port, search } = searchOver({
      getProcessInstances: () => [
        { id: "p1", definitionId: "order:1:a" },
        { id: "p9", definitionId: "order:1:a" },
      ],
      queryHistoricProcessInstances: () => [FAILING],
    })

    const page = await search.search(
      { withIncident: true, instanceIds: [InstanceId("p1"), InstanceId("p3")] },
      { limit: 50 },
    )

    expect(page.items.map((item) => item.id)).toStrictEqual(["p1"])
    expect(port.calls[0]?.input.query).not.toHaveProperty("processInstanceIds")
    expect(bodyOf(port.calls[1])).toBe(`{"processInstanceIds":["p1"],${SORTING}}`)
    expect(port.calls[1]?.input.query.maxResults).toBe("1")
  })

  it("reads no history when the runtime holds no open incident in the scope", async () => {
    const { port, search } = searchOver({ getProcessInstances: () => [] })

    const page = await search.search(
      { bpmnProcessId: BpmnProcessId("order"), withIncident: true },
      { limit: 50 },
    )

    expect(page).toStrictEqual({ items: [] })
    expect(sent(port.calls)).toStrictEqual(["getProcessInstances"])
  })

  it.each([
    ["ended instances with an incident", { lifecycle: "ended", withIncident: true }],
    ["no given ids with an incident", { instanceIds: [], withIncident: true }],
    ["no given ids", { instanceIds: [] }],
  ] as const)("finds no %s, without a request", async (_name, filter) => {
    const { port, search } = searchOver({})

    expect(await search.search(filter, { limit: 50 })).toStrictEqual({ items: [] })
    expect(port.calls).toStrictEqual([])
  })

  it("asks for no more rows than there are ids, and for the page and one more otherwise", async () => {
    const ids = ["p1", "p2", "p3"].map((id) => InstanceId(id))
    const { port, search } = searchOver({
      queryHistoricProcessInstances: () => [],
    })

    await search.search({ instanceIds: ids }, { limit: 5 })
    await search.search({ instanceIds: ids }, { limit: 2 })
    await search.search({ instanceIds: ids }, { limit: 1 })

    expect(port.calls.map((call) => call.input.query.maxResults)).toStrictEqual(["3", "3", "2"])
  })

  it("fails a cursor of another paging after the runtime's read, before the history's", async () => {
    const { port, search } = searchOver({
      getProcessInstances: () => [{ id: "p1", definitionId: "order:1:a" }],
    })

    await expect(
      search.search({ withIncident: true }, { limit: 5, after: PageCursor("x") }),
    ).rejects.toThrow(RangeError)
    expect(sent(port.calls)).toStrictEqual(["getProcessInstances"])
  })
})

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

  it("counts the instances without an incident as all of them minus those with one", async () => {
    const { port, search } = searchOver({
      queryHistoricProcessInstancesCount: () => ({ count: 3 }),
      getProcessInstancesCount: () => ({ count: 1 }),
    })

    expect(await search.count({ bpmnProcessId: BpmnProcessId("order"), withIncident: false })).toBe(
      2,
    )
    expect(sent(port.calls)).toStrictEqual([
      "queryHistoricProcessInstancesCount",
      "getProcessInstancesCount",
    ])
    expect(bodyOf(port.calls[0])).toBe('{"processDefinitionKey":"order"}')
  })
})
