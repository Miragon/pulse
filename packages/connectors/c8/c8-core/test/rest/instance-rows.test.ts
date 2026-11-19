import { describe, expect, test } from "vitest"
import {
  clientWith,
  page,
  pagedByCursor,
  problem,
  type SearchBody,
  searchOf,
} from "../support/fake-transport.js"
import { element, ENDED_AT, incident, job, STARTED_AT, variable } from "../support/rows.js"

const MOST_ROWS = 10_000

describe("the rows of an instance", () => {
  test("keep the newest 10,000 elements of a long history and say that they were cut", async () => {
    const rows = Array.from({ length: MOST_ROWS + 1 }, (_, index) =>
      element(String(index), `Task${String(index)}`, "SERVICE_TASK"),
    )
    const { camunda, client } = clientWith([
      { route: "POST /element-instances/search", answer: pagedByCursor(rows) },
    ])

    const history = await client.elementHistory("7")

    expect(history.cut).toBe(true)
    expect(history.items).toHaveLength(MOST_ROWS)
    const bodies = camunda.bodiesOf("POST /element-instances/search") as SearchBody[]
    expect(bodies).toHaveLength(20)
    expect(bodies[0]).toEqual({
      filter: { processInstanceKey: "7" },
      sort: [
        { field: "startDate", order: "DESC" },
        { field: "elementInstanceKey", order: "DESC" },
      ],
      page: { limit: 500 },
    })
    expect(bodies.at(-1)?.page).toEqual({ limit: 501, after: "9500" })
  })

  test("read the active elements in start order, whole", async () => {
    const { camunda, client } = clientWith([
      {
        route: "POST /element-instances/search",
        answer: page([
          element("1", "Charge", "SERVICE_TASK", { incidentKey: "9", endDate: ENDED_AT }),
        ]),
      },
    ])

    expect(await client.activeElements("7")).toEqual({
      items: [
        {
          key: "1",
          elementId: "Charge",
          type: "SERVICE_TASK",
          state: "ACTIVE",
          startedAt: STARTED_AT,
          name: "Charge name",
          endedAt: ENDED_AT,
          incidentKey: "9",
        },
      ],
      cut: false,
    })
    expect(searchOf(camunda.requests[0]?.body ?? "").filter).toEqual({
      processInstanceKey: "7",
      state: "ACTIVE",
    })
  })

  test("read one element by its key, and none that is missing", async () => {
    const { client } = clientWith([
      { route: "GET /element-instances/1", answer: element("1", "Charge", "SERVICE_TASK") },
      {
        route: "GET /element-instances/2",
        answer: problem(404, "NOT_FOUND", "Element instance with key '2' not found"),
      },
    ])

    expect(await client.elementInstance("1")).toMatchObject({ key: "1", elementId: "Charge" })
    expect(await client.elementInstance("2")).toBeUndefined()
  })

  test("ask for the jobs of at most 1,000 elements at a time", async () => {
    const keys = Array.from({ length: 1001 }, (_, index) => String(index))
    const { camunda, client } = clientWith([
      {
        route: "POST /jobs/search",
        answer: (body: string) => {
          const among = (searchOf(body).filter.elementInstanceKey as { $in: string[] }).$in
          return page(among.slice(0, 1).map((key) => job(`j${key}`, key)))
        },
      },
    ])

    const jobs = await client.jobsOf("7", keys)

    expect(jobs).toEqual({
      items: [
        {
          key: "j0",
          type: "job-j0",
          state: "CREATED",
          kind: "BPMN_ELEMENT",
          elementInstanceKey: "0",
          retries: 3,
        },
        expect.objectContaining({ key: "j1000" }) as unknown,
      ],
      cut: false,
    })
    const filters = camunda
      .bodiesOf("POST /jobs/search")
      .map((body) => (body as { filter: { elementInstanceKey: { $in: string[] } } }).filter)
    expect(filters.map((filter) => filter.elementInstanceKey.$in.length)).toEqual([1000, 1])
  })

  test("read jobs by their keys", async () => {
    const { camunda, client } = clientWith([
      {
        route: "POST /jobs/search",
        answer: page([{ jobKey: "j1", type: "charge", state: "FAILED", creationTime: STARTED_AT }]),
      },
    ])

    expect(await client.jobsByKey(["j1"])).toEqual({
      items: [{ key: "j1", type: "charge", state: "FAILED", createdAt: STARTED_AT }],
      cut: false,
    })
    expect(searchOf(camunda.requests[0]?.body ?? "").filter).toEqual({ jobKey: { $in: ["j1"] } })
  })

  test("read the open user tasks and message subscriptions", async () => {
    const { camunda, client } = clientWith([
      {
        route: "POST /user-tasks/search",
        answer: page([{ elementInstanceKey: "5", assignee: "demo", dueDate: ENDED_AT }]),
      },
      {
        route: "POST /message-subscriptions/search",
        answer: page([
          {
            elementInstanceKey: "6",
            elementId: "Paid",
            messageName: "payment",
            correlationKey: "ORD-7",
          },
        ]),
      },
    ])

    expect((await client.userTasks("7")).items).toEqual([
      { elementInstanceKey: "5", assignee: "demo", dueDate: ENDED_AT },
    ])
    expect((await client.messageSubscriptions("7")).items).toEqual([
      {
        elementInstanceKey: "6",
        elementId: "Paid",
        messageName: "payment",
        correlationKey: "ORD-7",
      },
    ])
    expect(camunda.requests.map((request) => searchOf(request.body).filter)).toEqual([
      {
        processInstanceKey: "7",
        state: { $in: ["CREATING", "CREATED", "ASSIGNING", "UPDATING", "COMPLETING", "CANCELING"] },
      },
      { processInstanceKey: "7", messageSubscriptionState: { $in: ["CREATED", "MIGRATED"] } },
    ])
  })

  test("read the open incidents of a filter newest first, and one by its key", async () => {
    const { camunda, client } = clientWith([
      { route: "POST /incidents/search", answer: page([incident("9", { errorMessage: null })]) },
      { route: "GET /incidents/9", answer: incident("9") },
    ])

    const found = await client.incidents({ processInstanceKey: "200" }, { limit: 50 })

    expect(found.items).toEqual([
      {
        key: "9",
        instanceKey: "200",
        definitionKey: "100",
        elementId: "Charge",
        type: "JOB_NO_RETRIES",
        message: "",
        createdAt: STARTED_AT,
        elementInstanceKey: "300",
        jobKey: "400",
      },
    ])
    expect(await client.incident("9")).toMatchObject({ message: "Card expired" })
    expect(searchOf(camunda.requests[0]?.body ?? "")).toEqual({
      filter: { processInstanceKey: "200", state: "ACTIVE" },
      sort: [
        { field: "creationTime", order: "DESC" },
        { field: "incidentKey", order: "ASC" },
      ],
      page: { limit: 50 },
    })
  })

  test("read the variables of instances up to a limit", async () => {
    const { camunda, client } = clientWith([
      {
        route: "POST /variables/search",
        answer: page([variable("total", "42"), variable("note", '"a long', { isTruncated: true })]),
      },
    ])

    expect(await client.variables(["200"], 2)).toEqual([
      { name: "total", value: "42", truncated: false, scopeKey: "200", instanceKey: "200" },
      { name: "note", value: '"a long', truncated: true, scopeKey: "200", instanceKey: "200" },
    ])
    expect(searchOf(camunda.requests[0]?.body ?? "")).toEqual({
      filter: { processInstanceKey: { $in: ["200"] } },
      page: { limit: 2 },
    })
  })
})
