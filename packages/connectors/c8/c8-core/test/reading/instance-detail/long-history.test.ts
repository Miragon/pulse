import { InstanceId } from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import {
  type FakeCamundaRest,
  page,
  pagedByCursor,
  type RestRoute,
} from "../../support/fake-transport.js"
import { ACTIVE_ONLY, detailWith, searchesOf } from "../../support/instance-tree.js"
import { element, instance, variable } from "../../support/rows.js"

describe("the long history of an instance", () => {
  const FIRST_START = Date.parse("2026-11-01T00:00:00.000Z")
  const TIMER_XML =
    '<bpmn:intermediateCatchEvent id="Tick"><bpmn:timerEventDefinition /></bpmn:intermediateCatchEvent>'

  function startOf(index: number): string {
    return new Date(FIRST_START + index * 1000).toISOString()
  }

  function pollKey(index: number): string {
    return String(100_001 + index)
  }

  function poll(index: number) {
    return element(pollKey(index), "Poll", "SERVICE_TASK", {
      state: "COMPLETED",
      startDate: startOf(index + 1),
      endDate: startOf(index + 1),
    })
  }

  function scoped(name: string, scopeKey: string) {
    return variable(name, '"x"', { scopeKey, processInstanceKey: "1" })
  }

  function lookedUp(camunda: FakeCamundaRest): string[] {
    const prefix = "GET /element-instances/"
    return camunda.requests
      .filter((request) => request.route.startsWith(prefix))
      .map((request) => request.route.slice(prefix.length))
  }

  function historyOf(
    count: number,
    variables?: readonly unknown[],
    lookups: readonly RestRoute[] = [],
  ) {
    const review = element("100000", "Review", "USER_TASK", { startDate: startOf(0) })
    const polls = Array.from({ length: count - 2 }, (_, index) => poll(index))
    const tick = element(String(100_000 + count - 1), "Tick", "INTERMEDIATE_CATCH_EVENT", {
      startDate: startOf(count - 1),
    })
    return detailWith([
      { route: "GET /process-instances/1", answer: instance("1") },
      { route: "POST /process-instances/search", answer: page([]) },
      {
        route: "POST /element-instances/search",
        when: (body) => body.includes(ACTIVE_ONLY),
        answer: page([review, tick]),
      },
      {
        route: "POST /element-instances/search",
        answer: pagedByCursor([review, ...polls, tick].toReversed()),
      },
      { route: "POST /jobs/search", answer: page([]) },
      {
        route: "POST /user-tasks/search",
        answer: page([{ elementInstanceKey: "100000", assignee: "demo" }]),
      },
      { route: "POST /message-subscriptions/search", answer: page([]) },
      { route: "POST /incidents/search", answer: page([]) },
      {
        route: "POST /variables/search",
        answer: page(
          variables ?? [scoped("note", "100000"), scoped("attempt", tick.elementInstanceKey)],
        ),
      },
      { route: "GET /process-definitions/100/xml", answer: TIMER_XML },
      ...lookups,
    ])
  }

  function historyLimitsOf(camunda: FakeCamundaRest): number[] {
    return searchesOf(camunda, "POST /element-instances/search")
      .filter((search) => !("state" in search.filter))
      .map((search) => search.page.limit)
  }

  const TWENTY_PAGES = [...Array.from({ length: 19 }, () => 500), 501]

  test("keeps the waits and the newest 10,000 runs of a longer one, and says so", async () => {
    const { camunda, reader } = historyOf(10_500)

    const detail = await reader.read(InstanceId("1"))

    expect(detail?.waitStates.map((wait) => [wait.elementId, wait.kind])).toEqual([
      ["Review", "userTask"],
      ["Tick", "timer"],
    ])
    expect(detail?.truncated).toBe(true)
    expect(detail?.path).toHaveLength(10_000)
    expect(detail?.path.at(0)).toMatchObject({ elementId: "Poll", startedAt: startOf(500) })
    expect(detail?.path.at(-1)).toMatchObject({ elementId: "Tick", startedAt: startOf(10_499) })
    expect(detail?.path.at(-1)?.endedAt).toBeUndefined()
    expect(detail?.variables.map((each) => each.scope)).toEqual([
      { kind: "element", elementId: "Review" },
      { kind: "element", elementId: "Tick" },
    ])
    expect(historyLimitsOf(camunda)).toEqual(TWENTY_PAGES)
  })

  test("holds exactly 10,000 runs completely", async () => {
    const { camunda, reader } = historyOf(10_000)

    const detail = await reader.read(InstanceId("1"))

    expect(detail?.truncated).toBe(false)
    expect(detail?.path).toHaveLength(10_000)
    expect(detail?.path.at(0)).toMatchObject({ elementId: "Review", startedAt: startOf(0) })
    expect(historyLimitsOf(camunda)).toEqual(TWENTY_PAGES)
  })

  test("looks up the element of a local variable on a run past the cut, and only there", async () => {
    const { camunda, reader } = historyOf(
      10_500,
      [
        scoped("orderId", "1"),
        scoped("attempt", pollKey(0)),
        scoped("attempt", pollKey(1)),
        scoped("lastAttempt", pollKey(1)),
        scoped("attempt", pollKey(498)),
        scoped("attempt", pollKey(499)),
        scoped("note", "100000"),
      ],
      [0, 1, 498].map((index) => ({
        route: `GET /element-instances/${pollKey(index)}`,
        answer: poll(index),
      })),
    )

    const detail = await reader.read(InstanceId("1"))

    expect(detail?.variables.map((each) => [each.name, each.scope])).toEqual([
      ["orderId", { kind: "instance" }],
      ["attempt", { kind: "element", elementId: "Poll" }],
      ["attempt", { kind: "element", elementId: "Poll" }],
      ["lastAttempt", { kind: "element", elementId: "Poll" }],
      ["attempt", { kind: "element", elementId: "Poll" }],
      ["attempt", { kind: "element", elementId: "Poll" }],
      ["note", { kind: "element", elementId: "Review" }],
    ])
    expect(lookedUp(camunda).toSorted()).toEqual([pollKey(0), pollKey(1), pollKey(498)])
    expect(detail?.path).toHaveLength(10_000)
    expect(detail?.truncated).toBe(true)
  })

  test("looks the element of a past run up once, not again on the next read", async () => {
    const { camunda, reader } = historyOf(
      10_500,
      [scoped("attempt", pollKey(0)), scoped("attempt", pollKey(1))],
      [0, 1].map((index) => ({
        route: `GET /element-instances/${pollKey(index)}`,
        answer: poll(index),
      })),
    )

    await reader.read(InstanceId("1"))
    const again = await reader.read(InstanceId("1"))

    expect(again?.variables.map((each) => each.scope)).toEqual([
      { kind: "element", elementId: "Poll" },
      { kind: "element", elementId: "Poll" },
    ])
    expect(lookedUp(camunda).toSorted()).toEqual([pollKey(0), pollKey(1)])
  })

  test("keeps the element of every local variable of the oldest runs, eight lookups at a time", async () => {
    const reading = { now: 0, most: 0 }
    const lookups = Array.from({ length: 499 }, (_, index) => ({
      route: `GET /element-instances/${pollKey(index)}`,
      answer: async () => {
        reading.now += 1
        reading.most = Math.max(reading.most, reading.now)
        await new Promise((resolve) => setTimeout(resolve, 5))
        reading.now -= 1
        return poll(index)
      },
    }))
    const { camunda, reader } = historyOf(
      10_500,
      Array.from({ length: 1000 }, (_, index) => scoped("attempt", pollKey(index))),
      lookups,
    )

    const detail = await reader.read(InstanceId("1"))

    expect(detail?.variables.map((each) => each.scope)).toEqual(
      Array.from({ length: 1000 }, () => ({ kind: "element", elementId: "Poll" })),
    )
    expect(lookedUp(camunda)).toHaveLength(499)
    expect(reading.most).toBe(8)
    expect(detail?.truncated).toBe(true)
  })
})
