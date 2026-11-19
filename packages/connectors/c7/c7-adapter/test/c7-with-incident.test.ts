import { BpmnProcessId, DefinitionId, InstanceId } from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { fakeRuntime } from "./support/fake-engine.js"
import type { FakeEngineRest, RestRoute } from "./support/fake-engine-rest.js"
import { fixture, WORLD_IDS } from "./support/fixtures.js"

interface Row {
  readonly id: string
  readonly businessKey: string | null
}

const SORTING = [
  { sortBy: "startTime", sortOrder: "desc" },
  { sortBy: "instanceId", sortOrder: "asc" },
]

function rowsOf(name: string): Row[] {
  return JSON.parse(fixture(name)) as Row[]
}

function bodyOf(engine: FakeEngineRest, index: number): unknown {
  return JSON.parse(engine.requests[index]?.body ?? "") as unknown
}

const RUNTIME: RestRoute = {
  route: "GET /process-instance",
  when: (url) => url.searchParams.get("withIncident") === "true",
  answer: rowsOf("process-instances-with-incident.json"),
}

const HISTORY: RestRoute = {
  route: "POST /history/process-instance",
  answer: rowsOf("historic-instances-order.json").filter((row) => row.businessKey === "ORD-1002"),
}

describe("with incident in the C7 adapter: an open incident the runtime holds now", () => {
  test("finds and counts no ended instance with an incident, without a request", async () => {
    const { runtime, engine } = fakeRuntime([])
    const filter = { lifecycle: "ended", withIncident: true } as const

    expect(await runtime.searchInstances(filter, { limit: 50 })).toEqual({ items: [] })
    expect(await runtime.countInstances(filter)).toEqual({ count: 0 })
    expect(engine.requests).toEqual([])
  })

  test("reads no history when the runtime holds no open incident in the scope", async () => {
    const { runtime, engine } = fakeRuntime([{ ...RUNTIME, answer: [] }])
    const filter = { bpmnProcessId: BpmnProcessId("pulse-order"), withIncident: true }

    expect(await runtime.searchInstances(filter, { limit: 50 })).toEqual({ items: [] })
    expect(engine.requests.map((request) => request.query)).toEqual([
      {
        withIncident: "true",
        processDefinitionKey: "pulse-order",
        sortBy: "instanceId",
        sortOrder: "asc",
        firstResult: "0",
        maxResults: "500",
      },
    ])
  })

  test("keeps of the given ids those the runtime holds an open incident for", async () => {
    const { runtime, engine } = fakeRuntime([
      RUNTIME,
      HISTORY,
      { route: "POST /history/process-instance/count", answer: { count: 1 } },
    ])
    const filter = {
      instanceIds: [InstanceId(WORLD_IDS.review), InstanceId(WORLD_IDS.charge)],
      withIncident: true,
    }

    const page = await runtime.searchInstances(filter, { limit: 50 })
    const counted = await runtime.countInstances(filter)

    expect(page.items.map((item) => [item.id, item.hasIncident])).toEqual([
      [WORLD_IDS.charge, true],
    ])
    expect(counted).toEqual({ count: 1 })
    expect(engine.requests[0]?.query).not.toHaveProperty("processInstanceIds")
    expect(bodyOf(engine, 1)).toEqual({ processInstanceIds: [WORLD_IDS.charge], sorting: SORTING })
    expect(engine.requests[1]?.query.maxResults).toBe("1")
    expect(bodyOf(engine, 3)).toEqual({ processInstanceIds: [WORLD_IDS.charge] })
  })

  test("counts with variable conditions over the runtime's ids, as the search pages them", async () => {
    const { runtime, engine } = fakeRuntime([
      RUNTIME,
      { route: "POST /history/process-instance/count", answer: { count: 1 } },
    ])

    const counted = await runtime.countInstances({
      definitionId: DefinitionId(WORLD_IDS.order1),
      lifecycle: "running",
      withIncident: true,
      variables: [{ name: "amount", operator: "greaterThan", valueJson: "100" }],
    })

    expect(counted).toEqual({ count: 1 })
    expect(bodyOf(engine, 1)).toEqual({
      processDefinitionId: WORLD_IDS.order1,
      processInstanceIds: [WORLD_IDS.charge, WORLD_IDS.dispatch, WORLD_IDS.label],
      unfinished: true,
      variables: [{ name: "amount", operator: "gt", value: 100 }],
    })
  })

  test("asks the runtime nothing for a page of ended instances", async () => {
    const ended = rowsOf("historic-instances-order.json").filter(
      (row) => row.businessKey === "ORD-1003",
    )
    const { runtime, engine } = fakeRuntime([{ ...HISTORY, answer: ended }])

    const page = await runtime.searchInstances({ lifecycle: "ended" }, { limit: 50 })

    expect(page.items.map((item) => [item.businessKey, item.hasIncident])).toEqual([
      ["ORD-1003", false],
    ])
    expect(engine.requests).toHaveLength(1)
  })
})
