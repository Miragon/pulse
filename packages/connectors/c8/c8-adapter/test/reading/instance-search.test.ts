import {
  BpmnProcessId,
  DefinitionId,
  ElementId,
  InstanceId,
  PageCursor,
} from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { InstanceSearch } from "../../src/reading/instance-search.js"
import { clientWith, page, type RestRoute } from "../support/fake-camunda-rest.js"
import { instance } from "../support/rows.js"

function readerWith(routes: readonly RestRoute[]) {
  const { camunda, client } = clientWith(routes)
  return { camunda, instances: new InstanceSearch(client) }
}

describe("the instance search", () => {
  test("sends a filter with every field and the newest first", async () => {
    const { camunda, instances } = readerWith([
      { route: "POST /process-instances/search", answer: page([instance("1")]) },
    ])

    await instances.search(
      {
        definitionId: DefinitionId("100"),
        bpmnProcessId: BpmnProcessId("order"),
        lifecycle: "running",
        withIncident: false,
        businessKey: "ORD-1",
        activeElementId: ElementId("Task"),
        instanceIds: [InstanceId("1"), InstanceId("not-a-key")],
        variables: [
          { name: "a", operator: "equals", valueJson: '"x"' },
          { name: "b", operator: "notEquals", valueJson: "42" },
          { name: "c", operator: "like", pattern: 'r*"?\\' },
        ],
      },
      { limit: 2 },
    )

    expect(camunda.bodiesOf("POST /process-instances/search")).toEqual([
      {
        filter: {
          processDefinitionKey: "100",
          processDefinitionId: "order",
          endDate: { $exists: false },
          hasIncident: false,
          businessId: "ORD-1",
          elementId: "Task",
          elementInstanceState: "ACTIVE",
          processInstanceKey: { $in: ["1"] },
          variables: [
            { name: "a", value: { $eq: '"x"' } },
            { name: "b", value: { $notIn: ["42"] } },
            { name: "c", value: { $like: '"r*\\\\"\\?\\\\\\\\"' } },
          ],
        },
        sort: [
          { field: "startDate", order: "DESC" },
          { field: "processInstanceKey", order: "ASC" },
        ],
        page: { limit: 2 },
      },
    ])
  })

  test("maps an instance and every state", async () => {
    const { instances } = readerWith([
      {
        route: "POST /process-instances/search",
        answer: page([
          instance("1", {
            businessId: "ORD-1",
            hasIncident: true,
            parentProcessInstanceKey: "9",
            startDate: "2026-11-05T10:00:00.000+0000",
          }),
          instance("2", { state: "SUSPENDED" }),
          instance("3", { state: "COMPLETED", endDate: "2026-11-05T11:00:00.000Z" }),
          instance("4", { state: "TERMINATED", endDate: "2026-11-05T11:00:00.000Z" }),
          instance("5", { state: "SOMETHING_NEW", endDate: "2026-11-05T11:00:00.000Z" }),
          instance("6", { state: "SOMETHING_NEW" }),
        ]),
      },
    ])

    const { items } = await instances.search({ lifecycle: "ended" }, { limit: 50 })

    expect(items[0]).toEqual({
      id: "1",
      definition: { id: "100", bpmnProcessId: "order", version: 1, name: "Order" },
      state: "running",
      hasIncident: true,
      businessKey: "ORD-1",
      startedAt: "2026-11-05T10:00:00.000Z",
      parentInstanceId: "9",
    })
    expect(items.map((item) => item.state)).toEqual([
      "running",
      "suspended",
      "completed",
      "terminated",
      "completed",
      "running",
    ])
  })

  test("goes on after a page only while more are left, keeping the cursor opaque", async () => {
    const { camunda, instances } = readerWith([
      {
        route: "POST /process-instances/search",
        when: (body) => body.includes('"after"'),
        answer: page([instance("2")], { totalItems: 2, endCursor: "b" }),
      },
      {
        route: "POST /process-instances/search",
        answer: page([instance("1")], { totalItems: 2, endCursor: "a" }),
      },
    ])

    const first = await instances.search({}, { limit: 1 })
    const second = await instances.search(
      {},
      { limit: 1, ...(first.next === undefined ? {} : { after: first.next }) },
    )

    expect(first.next).toBe("1:a")
    expect(second.next).toBeUndefined()
    expect(camunda.bodiesOf("POST /process-instances/search")[1]).toMatchObject({
      page: { limit: 1, after: "a" },
    })
  })

  test.each([
    [true, "10000:x"],
    [false, undefined],
  ])(
    "keeps going past a capped total once the rows seen reach it, and stops at an exact one (capped: %s)",
    async (hasMoreTotalItems, next) => {
      const { camunda, instances } = readerWith([
        {
          route: "POST /process-instances/search",
          answer: page([instance("1")], { totalItems: 10_000, hasMoreTotalItems, endCursor: "x" }),
        },
      ])

      const found = await instances.search({}, { limit: 1, after: PageCursor("9999:c") })

      expect(found.next).toBe(next)
      expect(camunda.bodiesOf("POST /process-instances/search")[0]).toMatchObject({
        page: { limit: 1, after: "c" },
      })
    },
  )

  test("finds and counts nothing without a call when no id can exist", async () => {
    const { camunda, instances } = readerWith([])

    expect(await instances.search({ instanceIds: [] }, { limit: 5 })).toEqual({ items: [] })
    expect(await instances.count({ instanceIds: [InstanceId("x")] })).toEqual({ count: 0 })
    expect(await instances.count({ definitionId: DefinitionId("a:1") })).toEqual({
      count: 0,
    })
    expect(camunda.requests).toEqual([])
  })

  test("leaves out an id beyond a Java long and counts such ids without a call", async () => {
    const { camunda, instances } = readerWith([
      { route: "POST /process-instances/search", answer: page([]) },
    ])

    await instances.search(
      { instanceIds: [InstanceId("9223372036854775807"), InstanceId("9223372036854775808")] },
      { limit: 5 },
    )
    expect(await instances.count({ instanceIds: [InstanceId("-9223372036854775809")] })).toEqual({
      count: 0,
    })
    expect(await instances.count({ definitionId: DefinitionId("12345678901234567890") })).toEqual({
      count: 0,
    })

    expect(camunda.bodiesOf("POST /process-instances/search")).toEqual([
      expect.objectContaining({
        filter: { processInstanceKey: { $in: ["9223372036854775807"] } },
      }),
    ])
  })

  test.each([
    ["greater than", { name: "a", operator: "greaterThan", valueJson: "1" }],
    ["less than", { name: "a", operator: "lessThan", valueJson: "1" }],
    ["a date", { name: "a", operator: "equals", at: "2026-01-01T00:00:00.000Z" }],
  ] as const)("refuses %s by name, before any search", async (_name, condition) => {
    const { camunda, instances } = readerWith([])
    const variables = [condition] as never

    await expect(instances.search({ variables }, { limit: 1 })).rejects.toMatchObject({
      failure: "unsupported",
    })
    await expect(instances.count({ variables })).rejects.toMatchObject({
      failure: "unsupported",
    })
    expect(camunda.requests).toEqual([])
  })

  test("sends no variable filter for an empty list of conditions", async () => {
    const { camunda, instances } = readerWith([
      { route: "POST /process-instances/search", answer: page([]) },
    ])

    await instances.count({ variables: [] })

    expect(camunda.bodiesOf("POST /process-instances/search")[0]).toMatchObject({ filter: {} })
  })
})
