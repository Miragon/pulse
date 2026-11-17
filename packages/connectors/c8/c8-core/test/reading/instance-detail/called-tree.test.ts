import { InstanceId } from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { type FakeCamundaRest, page, problem, searchOf } from "../../support/fake-transport.js"
import { ACTIVE_ONLY, about, detailWith, searchesOf } from "../../support/instance-tree.js"
import { ENDED_AT, instance } from "../../support/rows.js"

describe("the called tree of an instance", () => {
  function calledInstance(key: number, parentKey: string) {
    return {
      ...instance(String(key), { state: "COMPLETED", endDate: ENDED_AT }),
      parentProcessInstanceKey: parentKey,
    }
  }

  function calledBelow(parentKey: string, count: number, firstKey: number) {
    return Array.from({ length: count }, (_, index) => calledInstance(firstKey + index, parentKey))
  }

  function treeOf(called: readonly ReturnType<typeof calledInstance>[]) {
    return detailWith([
      {
        route: "GET /process-instances/1",
        answer: instance("1", { state: "COMPLETED", endDate: ENDED_AT }),
      },
      {
        route: "POST /process-instances/search",
        answer: (body: string) => {
          const search = searchOf(body)
          const parents = (search.filter.parentProcessInstanceKey as { readonly $in: string[] }).$in
          const children = called.filter((child) =>
            parents.includes(child.parentProcessInstanceKey),
          )
          return page(children.slice(0, search.page.limit), { totalItems: children.length })
        },
      },
      { route: "POST /element-instances/search", answer: page([]) },
      { route: "POST /incidents/search", answer: page([]) },
      { route: "POST /variables/search", answer: page([]) },
    ])
  }

  function limitsOf(camunda: FakeCamundaRest): number[] {
    return searchesOf(camunda, "POST /process-instances/search").map((search) => search.page.limit)
  }

  test("is complete with exactly 50 called instances", async () => {
    const { camunda, reader } = treeOf(calledBelow("1", 50, 100))

    const detail = await reader.read(InstanceId("1"))

    expect(detail?.calledInstances).toHaveLength(50)
    expect(detail?.truncated).toBe(false)
    expect(limitsOf(camunda)).toEqual([51, 1])
  })

  test("is complete with 50 called instances over two levels", async () => {
    const { camunda, reader } = treeOf([
      ...calledBelow("1", 30, 100),
      ...calledBelow("105", 20, 200),
    ])

    const detail = await reader.read(InstanceId("1"))

    expect(detail?.calledInstances).toHaveLength(50)
    expect(detail?.truncated).toBe(false)
    expect(limitsOf(camunda)).toEqual([51, 21, 1])
  })

  test("keeps 50 of 51 called instances and says so", async () => {
    const { camunda, reader } = treeOf(calledBelow("1", 51, 100))

    const detail = await reader.read(InstanceId("1"))

    expect(detail?.calledInstances).toHaveLength(50)
    expect(detail?.truncated).toBe(true)
    expect(limitsOf(camunda)).toEqual([51])
  })

  test("asks a level below 30 called instances for the 20 that fit, and one more", async () => {
    const { camunda, reader } = treeOf([
      ...calledBelow("1", 30, 100),
      ...calledBelow("105", 50, 200),
    ])

    const detail = await reader.read(InstanceId("1"))

    expect(detail?.calledInstances).toHaveLength(50)
    expect(detail?.calledInstances.at(-1)).toMatchObject({ id: "219", parentInstanceId: "105" })
    expect(detail?.truncated).toBe(true)
    expect(limitsOf(camunda)).toEqual([51, 21])
  })

  test("is read eight running instances at a time", async () => {
    const children = Array.from({ length: 20 }, (_, index) =>
      instance(String(200 + index), { parentProcessInstanceKey: "1" }),
    )
    const reading = { now: 0, most: 0 }
    const { reader } = detailWith([
      { route: "GET /process-instances/1", answer: instance("1") },
      {
        route: "POST /process-instances/search",
        when: (body) => body.includes('"$in":["1"]'),
        answer: page(children),
      },
      { route: "POST /process-instances/search", answer: page([]) },
      {
        route: "POST /element-instances/search",
        when: (body) => body.includes(ACTIVE_ONLY),
        answer: async () => {
          reading.now += 1
          reading.most = Math.max(reading.most, reading.now)
          await new Promise((resolve) => setTimeout(resolve, 5))
          reading.now -= 1
          return page([])
        },
      },
      { route: "POST /element-instances/search", answer: page([]) },
      { route: "POST /jobs/search", answer: page([]) },
      { route: "POST /user-tasks/search", answer: page([]) },
      { route: "POST /message-subscriptions/search", answer: page([]) },
      { route: "POST /incidents/search", answer: page([]) },
      { route: "POST /variables/search", answer: page([]) },
    ])

    const detail = await reader.read(InstanceId("1"))

    expect(detail?.calledInstances).toHaveLength(20)
    expect(reading.most).toBe(8)
  })

  test("reads no further instance once a read failed", async () => {
    const children = Array.from({ length: 20 }, (_, index) =>
      instance(String(200 + index), { parentProcessInstanceKey: "1" }),
    )
    const { camunda, reader } = detailWith([
      { route: "GET /process-instances/1", answer: instance("1") },
      {
        route: "POST /process-instances/search",
        when: (body) => body.includes('"$in":["1"]'),
        answer: page(children),
      },
      { route: "POST /process-instances/search", answer: page([]) },
      {
        route: "POST /element-instances/search",
        when: about("205", ACTIVE_ONLY),
        answer: problem(500, "Internal Server Error", "the search failed"),
      },
      {
        route: "POST /element-instances/search",
        when: (body) => body.includes(ACTIVE_ONLY),
        answer: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5))
          return page([])
        },
      },
      { route: "POST /element-instances/search", answer: page([]) },
      { route: "POST /jobs/search", answer: page([]) },
      { route: "POST /user-tasks/search", answer: page([]) },
      { route: "POST /message-subscriptions/search", answer: page([]) },
      { route: "POST /incidents/search", answer: page([]) },
      { route: "POST /variables/search", answer: page([]) },
    ])

    await expect(reader.read(InstanceId("1"))).rejects.toMatchObject({
      name: "FailedRequest",
      failure: { status: 500 },
    })
    await new Promise((resolve) => setTimeout(resolve, 30))

    const activeSearches = searchesOf(camunda, "POST /element-instances/search").filter(
      (search) => search.filter.state === "ACTIVE",
    )
    expect(activeSearches).toHaveLength(8)
  })
})
