import { BpmnProcessId, DefinitionId, InstanceId, PageCursor } from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { ErrorTranslation } from "../../src/errors/error-translation.js"
import { DefinitionRefsCache } from "../../src/reading/definition-refs-cache.js"
import { IncidentSearch } from "../../src/reading/incident-search.js"
import { clientWith, page, problem, type RestRoute } from "../support/fake-camunda-rest.js"
import { definition } from "../support/rows.js"

const INCIDENT = {
  incidentKey: "7",
  processInstanceKey: "1",
  processDefinitionKey: "100",
  elementId: "Task",
  errorType: "JOB_NO_RETRIES",
  errorMessage:
    "java.lang.IllegalStateException: failed\n\tat a.B(B.java:1)\nCaused by: java.net.ConnectException: down\n\tat c.D(D.java:2)",
  creationTime: "2026-11-05T10:00:00.000Z",
  jobKey: "70",
}

function searchWith(routes: readonly RestRoute[]) {
  const { camunda, client } = clientWith(routes)
  return { camunda, incidents: new IncidentSearch(client, new DefinitionRefsCache(client)) }
}

describe("the incident search", () => {
  test("names each incident's version from one read per definition", async () => {
    const { camunda, incidents } = searchWith([
      {
        route: "POST /incidents/search",
        answer: page([INCIDENT, { ...INCIDENT, incidentKey: "8" }]),
      },
      { route: "GET /process-definitions/100", answer: definition("100", "order", 4) },
    ])

    const { items } = await incidents.search({}, { limit: 50 })
    await incidents.search({}, { limit: 50 })

    expect(items[0]).toEqual({
      id: "7",
      instanceId: "1",
      definition: { id: "100", bpmnProcessId: "order", version: 4, name: "order name" },
      elementId: "Task",
      type: "JOB_NO_RETRIES",
      message: INCIDENT.errorMessage,
      createdAt: "2026-11-05T10:00:00.000Z",
      job: { id: "70" },
      details: {
        kind: "errorMessage",
        text: INCIDENT.errorMessage,
        truncated: false,
        rootCause: "ConnectException: down",
        rootCauseLine: 2,
      },
    })
    expect(items.map((item) => item.id)).toEqual(["7", "8"])
    expect(
      camunda.requests.filter((request) => request.route === "GET /process-definitions/100"),
    ).toHaveLength(1)
  })

  test("skips a row whose definition is gone, pages by the search and reads that definition again", async () => {
    const { camunda, incidents } = searchWith([
      {
        route: "POST /incidents/search",
        answer: page([INCIDENT], { totalItems: 2, endCursor: "c" }),
      },
      { route: "GET /process-definitions/100", answer: problem(404, "NOT_FOUND", "missing") },
    ])

    const found = await incidents.search({}, { limit: 1 })
    await incidents.search({}, { limit: 1 })

    expect(found.items).toEqual([])
    expect(found.next).toBe("1:c")
    expect(
      camunda.requests.filter((request) => request.route === "GET /process-definitions/100"),
    ).toHaveLength(2)
  })

  test("reads a definition again after a read that failed", async () => {
    const answers: unknown[] = [
      problem(503, "Service Unavailable", "down"),
      definition("100", "order", 4),
    ]
    const { incidents } = searchWith([
      { route: "POST /incidents/search", answer: page([INCIDENT]) },
      { route: "GET /process-definitions/100", answer: () => answers.shift() },
    ])

    await expect(
      ErrorTranslation.translated(() => incidents.search({}, { limit: 50 })),
    ).rejects.toMatchObject({ failure: "engineFailure" })
    const { items } = await incidents.search({}, { limit: 50 })

    expect(items.map((item) => item.definition.version)).toEqual([4])
  })

  test("filters by process, version and instance, newest first", async () => {
    const { camunda, incidents } = searchWith([
      { route: "POST /incidents/search", answer: page([]) },
    ])

    await incidents.search(
      {
        bpmnProcessId: BpmnProcessId("order"),
        definitionId: DefinitionId("100"),
        instanceId: InstanceId("1"),
      },
      { limit: 5 },
    )

    expect(camunda.bodiesOf("POST /incidents/search")[0]).toEqual({
      filter: {
        processDefinitionId: "order",
        processDefinitionKey: "100",
        processInstanceKey: "1",
        state: "ACTIVE",
      },
      sort: [
        { field: "creationTime", order: "DESC" },
        { field: "incidentKey", order: "ASC" },
      ],
      page: { limit: 5 },
    })
  })

  test("goes on after a full page while the total says more are left, with the cluster's cursor", async () => {
    const { camunda, incidents } = searchWith([
      {
        route: "POST /incidents/search",
        when: (body) => body.includes('"after"'),
        answer: page([{ ...INCIDENT, incidentKey: "8" }], { totalItems: 2, endCursor: "b" }),
      },
      {
        route: "POST /incidents/search",
        answer: page([INCIDENT], { totalItems: 2, endCursor: "a" }),
      },
      { route: "GET /process-definitions/100", answer: definition("100", "order", 4) },
    ])

    const first = await incidents.search({}, { limit: 1 })
    const second = await incidents.search(
      {},
      { limit: 1, ...(first.next === undefined ? {} : { after: first.next }) },
    )

    expect(first.next).toBe("1:a")
    expect(second.items.map((item) => item.id)).toEqual(["8"])
    expect(second.next).toBeUndefined()
    expect(camunda.bodiesOf("POST /incidents/search")[1]).toMatchObject({
      page: { limit: 1, after: "a" },
    })
  })

  test.each([
    [true, "10000:x"],
    [false, undefined],
  ])(
    "keeps going past a capped total once the rows seen reach it, and stops at an exact one (capped: %s)",
    async (hasMoreTotalItems, next) => {
      const { camunda, incidents } = searchWith([
        {
          route: "POST /incidents/search",
          answer: page([INCIDENT], { totalItems: 10_000, hasMoreTotalItems, endCursor: "x" }),
        },
        { route: "GET /process-definitions/100", answer: definition("100", "order", 4) },
      ])

      const found = await incidents.search({}, { limit: 1, after: PageCursor("9999:c") })

      expect(found.next).toBe(next)
      expect(camunda.bodiesOf("POST /incidents/search")[0]).toMatchObject({
        page: { limit: 1, after: "c" },
      })
    },
  )

  test.each([[{ instanceId: InstanceId("x") }], [{ definitionId: DefinitionId("order:1") }]])(
    "finds none for an impossible key %o, without a call",
    async (filter) => {
      const { camunda, incidents } = searchWith([])

      expect(await incidents.search(filter, { limit: 5 })).toEqual({ items: [] })
      expect(camunda.requests).toEqual([])
    },
  )
})
