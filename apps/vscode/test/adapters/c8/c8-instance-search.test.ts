import { describe, expect, test } from "vitest"
import { BpmnProcessId, DefinitionId, ElementId, InstanceId } from "../../../src/contract/index.js"
import { page, problem, TOPOLOGY } from "./support/fake-camunda-rest.js"
import { runtimeWith, definition, instance } from "./support/runtime-fixture.js"

describe("its instance search", () => {
  test("sends a filter with every field and the newest first", async () => {
    const { camunda, runtime } = runtimeWith([
      TOPOLOGY,
      { route: "POST /process-instances/search", answer: page([instance("1")]) },
    ])

    await runtime.searchInstances(
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
    const { runtime } = runtimeWith([
      TOPOLOGY,
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

    const { items } = await runtime.searchInstances({ lifecycle: "ended" }, { limit: 50 })

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
    const { camunda, runtime } = runtimeWith([
      TOPOLOGY,
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

    const first = await runtime.searchInstances({}, { limit: 1 })
    const second = await runtime.searchInstances(
      {},
      { limit: 1, ...(first.next === undefined ? {} : { after: first.next }) },
    )

    expect(first.next).toBe("1:a")
    expect(second.next).toBeUndefined()
    expect(camunda.bodiesOf("POST /process-instances/search")[1]).toMatchObject({
      page: { limit: 1, after: "a" },
    })
  })

  test("keeps going past a capped total", async () => {
    const { runtime } = runtimeWith([
      TOPOLOGY,
      {
        route: "POST /process-instances/search",
        answer: page([instance("1")], {
          totalItems: 10000,
          hasMoreTotalItems: true,
          endCursor: "x",
        }),
      },
    ])

    expect((await runtime.searchInstances({}, { limit: 1 })).next).toBe("1:x")
  })

  test("finds and counts nothing without a call when no id can exist", async () => {
    const { camunda, runtime } = runtimeWith([TOPOLOGY])

    expect(await runtime.searchInstances({ instanceIds: [] }, { limit: 5 })).toEqual({ items: [] })
    expect(await runtime.countInstances({ instanceIds: [InstanceId("x")] })).toEqual({ count: 0 })
    expect(await runtime.countInstances({ definitionId: DefinitionId("a:1") })).toEqual({
      count: 0,
    })
    expect(camunda.requests.map((request) => request.route)).toEqual(["GET /topology"])
  })

  test("leaves out an id beyond a Java long and counts such ids without a call", async () => {
    const { camunda, runtime } = runtimeWith([
      TOPOLOGY,
      { route: "POST /process-instances/search", answer: page([]) },
    ])

    await runtime.searchInstances(
      { instanceIds: [InstanceId("9223372036854775807"), InstanceId("9223372036854775808")] },
      { limit: 5 },
    )
    expect(
      await runtime.countInstances({ instanceIds: [InstanceId("-9223372036854775809")] }),
    ).toEqual({ count: 0 })
    expect(
      await runtime.countInstances({ definitionId: DefinitionId("12345678901234567890") }),
    ).toEqual({ count: 0 })

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
    const { camunda, runtime } = runtimeWith([TOPOLOGY])
    const variables = [condition] as never

    await expect(runtime.searchInstances({ variables }, { limit: 1 })).rejects.toMatchObject({
      failure: "unsupported",
    })
    await expect(runtime.countInstances({ variables })).rejects.toMatchObject({
      failure: "unsupported",
    })
    expect(camunda.requests.map((request) => request.route)).toEqual(["GET /topology"])
  })

  test("sends no variable filter for an empty list of conditions", async () => {
    const { camunda, runtime } = runtimeWith([
      TOPOLOGY,
      { route: "POST /process-instances/search", answer: page([]) },
    ])

    await runtime.countInstances({ variables: [] })

    expect(camunda.bodiesOf("POST /process-instances/search")[0]).toMatchObject({ filter: {} })
  })
})

describe("its counts", () => {
  const CAPPED = page([], { totalItems: 10000, hasMoreTotalItems: true })
  const BY_VERSION = {
    route: "POST /process-definitions/statistics/process-instances-by-version",
    answer: page([
      {
        processDefinitionKey: "100",
        activeInstancesWithoutIncidentCount: 20000,
        activeInstancesWithIncidentCount: 5,
      },
      {
        processDefinitionKey: "200",
        activeInstancesWithoutIncidentCount: 7,
        activeInstancesWithIncidentCount: 1,
      },
    ]),
  }

  test("are exact below the cap", async () => {
    const { runtime } = runtimeWith([
      TOPOLOGY,
      { route: "POST /process-instances/search", answer: page([], { totalItems: 12 }) },
    ])

    expect(await runtime.countInstances({})).toEqual({ count: 12 })
  })

  test.each([
    [{ bpmnProcessId: BpmnProcessId("order"), lifecycle: "running" }, 20013],
    [{ bpmnProcessId: BpmnProcessId("order"), lifecycle: "running", withIncident: true }, 6],
    [{ bpmnProcessId: BpmnProcessId("order"), lifecycle: "running", withIncident: false }, 20007],
  ] as const)("read %o exactly from the statistics above the cap", async (filter, count) => {
    const { runtime } = runtimeWith([
      TOPOLOGY,
      { route: "POST /process-instances/search", answer: CAPPED },
      BY_VERSION,
    ])

    expect(await runtime.countInstances(filter)).toEqual({ count })
  })

  test("of one version read that version's row", async () => {
    const { runtime } = runtimeWith([
      TOPOLOGY,
      { route: "POST /process-instances/search", answer: CAPPED },
      { route: "GET /process-definitions/100", answer: definition("100", "order", 1) },
      BY_VERSION,
    ])

    expect(
      await runtime.countInstances({ definitionId: DefinitionId("100"), lifecycle: "running" }),
    ).toEqual({ count: 20005 })
  })

  test("of one version of a named process read that version's row without reading the version", async () => {
    const { camunda, runtime } = runtimeWith([
      TOPOLOGY,
      { route: "POST /process-instances/search", answer: CAPPED },
      BY_VERSION,
    ])

    expect(
      await runtime.countInstances({
        definitionId: DefinitionId("100"),
        bpmnProcessId: BpmnProcessId("order"),
        lifecycle: "running",
      }),
    ).toEqual({ count: 20005 })
    expect(camunda.requests.map((request) => request.route)).not.toContain(
      "GET /process-definitions/100",
    )
  })

  test.each([
    [{ lifecycle: "running" }, 20016],
    [{ lifecycle: "running", withIncident: true }, 6],
    [{ lifecycle: "running", withIncident: false }, 20010],
  ] as const)(
    "of the whole engine read %o exactly from the statistics of every process",
    async (filter, count) => {
      const { camunda, runtime } = runtimeWith([
        TOPOLOGY,
        { route: "POST /process-instances/search", answer: CAPPED },
        {
          route: "POST /process-definitions/statistics/process-instances",
          answer: page([
            {
              processDefinitionId: "order",
              activeInstancesWithoutIncidentCount: 20000,
              activeInstancesWithIncidentCount: 5,
            },
            {
              processDefinitionId: "order",
              activeInstancesWithoutIncidentCount: 3,
              activeInstancesWithIncidentCount: 0,
            },
            {
              processDefinitionId: "label",
              activeInstancesWithoutIncidentCount: 7,
              activeInstancesWithIncidentCount: 1,
            },
          ]),
        },
      ])

      expect(await runtime.countInstances(filter)).toEqual({ count })
      expect(camunda.requests.map((request) => request.route)).toEqual([
        "GET /topology",
        "POST /process-instances/search",
        "POST /process-definitions/statistics/process-instances",
      ])
    },
  )

  test.each([
    [{}],
    [{ lifecycle: "ended" }],
    [{ lifecycle: "ended", bpmnProcessId: BpmnProcessId("order") }],
    [{ lifecycle: "running", businessKey: "x" }],
    [{ lifecycle: "running", bpmnProcessId: BpmnProcessId("o"), businessKey: "x" }],
    [{ lifecycle: "running", bpmnProcessId: BpmnProcessId("o"), activeElementId: ElementId("x") }],
    [{ lifecycle: "running", bpmnProcessId: BpmnProcessId("o"), instanceIds: [InstanceId("1")] }],
    [
      {
        lifecycle: "running",
        bpmnProcessId: BpmnProcessId("o"),
        variables: [{ name: "a", operator: "equals", valueJson: "1" }],
      },
    ],
  ] as const)("of %o say they are only a lower bound", async (filter) => {
    const { runtime } = runtimeWith([
      TOPOLOGY,
      { route: "POST /process-instances/search", answer: CAPPED },
    ])

    expect(await runtime.countInstances(filter as never)).toEqual({ count: 10000, atLeast: true })
  })

  test("say so too when the definition is unknown", async () => {
    const { runtime } = runtimeWith([
      TOPOLOGY,
      { route: "POST /process-instances/search", answer: CAPPED },
      { route: "GET /process-definitions/100", answer: problem(404, "NOT_FOUND", "missing") },
    ])

    expect(
      await runtime.countInstances({ definitionId: DefinitionId("100"), lifecycle: "running" }),
    ).toEqual({ count: 10000, atLeast: true })
  })
})

describe("its variable names", () => {
  test("come sorted and once each from the newest instances", async () => {
    const { camunda, runtime } = runtimeWith([
      TOPOLOGY,
      { route: "POST /process-instances/search", answer: page([instance("1"), instance("2")]) },
      {
        route: "POST /variables/search",
        answer: page(
          ["route", "amount", "route"].map((name) => ({
            name,
            value: "1",
            isTruncated: false,
            scopeKey: "1",
            processInstanceKey: "1",
          })),
        ),
      },
    ])

    expect(await runtime.listVariableNames(DefinitionId("100"))).toEqual(["amount", "route"])
    expect(camunda.bodiesOf("POST /variables/search")[0]).toMatchObject({
      filter: { processInstanceKey: { $in: ["1", "2"] } },
    })
  })

  test("are none without instances or for an impossible key", async () => {
    const { runtime } = runtimeWith([
      TOPOLOGY,
      { route: "POST /process-instances/search", answer: page([]) },
    ])

    expect(await runtime.listVariableNames(DefinitionId("100"))).toEqual([])
    expect(await runtime.listVariableNames(DefinitionId("a:1"))).toEqual([])
  })
})
