import { describe, expect, test } from "vitest"
import {
  clientWith,
  FailedRequest,
  page,
  pagedByCursor,
  pagedByOffset,
  problem,
  searchOf,
  TOPOLOGY,
} from "../support/fake-transport.js"
import { definition, ENDED_AT, instance, STARTED_AT } from "../support/rows.js"

const XML = '<?xml version="1.0"?><bpmn:definitions id="d"/>'

describe("the REST client of a cluster", () => {
  test("reads the gateway version", async () => {
    const { camunda, client } = clientWith([TOPOLOGY])

    expect(await client.topology()).toEqual({ gatewayVersion: "8.10.8" })
    expect(camunda.requests.map((request) => request.route)).toEqual(["GET /topology"])
  })

  test("reads the latest definitions page by page, by the cursor of each page", async () => {
    const rows = Array.from({ length: 501 }, (_, index) =>
      definition(String(index + 1), `p${String(index)}`, 1),
    )
    const { camunda, client } = clientWith([
      { route: "POST /process-definitions/search", answer: pagedByCursor(rows) },
    ])

    const definitions = await client.latestDefinitions()

    expect(definitions).toHaveLength(501)
    expect(definitions[0]).toEqual({
      key: "1",
      bpmnProcessId: "p0",
      version: 1,
      name: "p0 name",
      state: "ACTIVE",
    })
    expect(camunda.bodiesOf("POST /process-definitions/search")).toEqual([
      { filter: { isLatestVersion: true }, page: { limit: 500 } },
      { filter: { isLatestVersion: true }, page: { limit: 500, after: "500" } },
    ])
  })

  test("reads the versions of a process newest first", async () => {
    const { camunda, client } = clientWith([
      {
        route: "POST /process-definitions/search",
        answer: page([
          definition("2", "order", 2, { versionTag: "v2" }),
          definition("1", "order", 1),
        ]),
      },
    ])

    expect((await client.versionsOf("order")).map((row) => row.versionTag ?? row.version)).toEqual([
      "v2",
      1,
    ])
    expect(camunda.bodiesOf("POST /process-definitions/search")).toEqual([
      {
        filter: { processDefinitionId: "order" },
        sort: [{ field: "version", order: "DESC" }],
        page: { limit: 500 },
      },
    ])
  })

  test("reads one definition by its key, and none that is missing", async () => {
    const { camunda, client } = clientWith([
      { route: "GET /process-definitions/1", answer: definition("1", "order", 3) },
      {
        route: "GET /process-definitions/2",
        answer: problem(404, "NOT_FOUND", "Process definition with key '2' not found"),
      },
    ])

    expect(await client.definition("1")).toMatchObject({ key: "1", version: 3 })
    expect(await client.definition("2")).toBeUndefined()
    expect(camunda.requests).toHaveLength(2)
  })

  test("refuses a key that names no resource before sending it, and encodes every other", async () => {
    const { camunda, client } = clientWith([
      {
        route: "GET /process-instances/a/b",
        answer: problem(404, "NOT_FOUND", "Process instance with key 'a/b' not found"),
      },
    ])

    expect(await client.instance(".")).toBeUndefined()
    expect(await client.instance("..")).toBeUndefined()
    expect(await client.instance("")).toBeUndefined()
    expect(await client.instance("a/b")).toBeUndefined()
    expect(camunda.requests.map((request) => request.target)).toEqual(["/process-instances/a%2Fb"])
  })

  test("fails on a 404 that names no missing resource, which a wrong root answers", async () => {
    const { client } = clientWith([])

    const read = client.definition("1")

    await expect(read).rejects.toBeInstanceOf(FailedRequest)
    await expect(read).rejects.toMatchObject({ failure: { status: 404, title: "Not Found" } })
  })

  test("reads the instance counts of every process by offset, until a page is short", async () => {
    const rows = Array.from({ length: 501 }, (_, index) => ({
      processDefinitionId: `p${String(index)}`,
      activeInstancesWithoutIncidentCount: index,
      activeInstancesWithIncidentCount: 1,
    }))
    const { camunda, client } = clientWith([
      {
        route: "POST /process-definitions/statistics/process-instances",
        answer: pagedByOffset(rows),
      },
    ])

    const statistics = await client.processStatistics()

    expect(statistics).toHaveLength(501)
    expect(statistics[2]).toEqual({ bpmnProcessId: "p2", withoutIncident: 2, withIncident: 1 })
    expect(
      camunda
        .bodiesOf("POST /process-definitions/statistics/process-instances")
        .map((body) => (body as { page: unknown }).page),
    ).toEqual([
      { from: 0, limit: 500 },
      { from: 500, limit: 500 },
    ])
  })

  test("stops reading the instance counts at 10,000 rows when every page is full", async () => {
    const full = Array.from({ length: 500 }, (_, index) => ({
      processDefinitionId: `p${String(index)}`,
      activeInstancesWithoutIncidentCount: 1,
      activeInstancesWithIncidentCount: 0,
    }))
    const { camunda, client } = clientWith([
      {
        route: "POST /process-definitions/statistics/process-instances",
        answer: (body: string) =>
          (searchOf(body).page.from ?? 0) < 10_000
            ? { items: full }
            : problem(500, "Internal Server Error", "Read past 10,000 rows."),
      },
    ])

    expect(await client.processStatistics()).toHaveLength(10_000)
    const pages = camunda
      .bodiesOf("POST /process-definitions/statistics/process-instances")
      .map((body) => (body as { page: unknown }).page)
    expect(pages).toHaveLength(20)
    expect(pages.at(-1)).toEqual({ from: 9_500, limit: 500 })
  })

  test("reads the instance counts of each version of a process", async () => {
    const { camunda, client } = clientWith([
      {
        route: "POST /process-definitions/statistics/process-instances-by-version",
        answer: {
          items: [
            {
              processDefinitionKey: "1",
              activeInstancesWithoutIncidentCount: 4,
              activeInstancesWithIncidentCount: 2,
            },
          ],
        },
      },
    ])

    expect(await client.versionStatistics("order")).toEqual([
      { key: "1", withoutIncident: 4, withIncident: 2 },
    ])
    expect(
      camunda.bodiesOf("POST /process-definitions/statistics/process-instances-by-version"),
    ).toEqual([{ filter: { processDefinitionId: "order" }, page: { from: 0, limit: 500 } }])
  })

  test("reads the element counts of a version", async () => {
    const { camunda, client } = clientWith([
      {
        route: "POST /process-definitions/1/statistics/element-instances",
        answer: { items: [{ elementId: "Charge", active: 3, incidents: 1, completed: 9 }] },
      },
    ])

    expect(await client.elementStatistics("1")).toEqual([
      { elementId: "Charge", active: 3, incidents: 1 },
    ])
    expect(camunda.bodiesOf("POST /process-definitions/1/statistics/element-instances")).toEqual([
      {},
    ])
  })

  test("reads a diagram as text, and none that is missing", async () => {
    const { camunda, client } = clientWith([
      {
        route: "GET /process-definitions/1/xml",
        answer: XML,
      },
      {
        route: "GET /process-definitions/2/xml",
        answer: problem(404, "NOT_FOUND", "Process definition with key '2' not found"),
      },
    ])

    expect(await client.diagramXml("1")).toBe(XML)
    expect(await client.diagramXml("2")).toBeUndefined()
    expect(camunda.requests.map((request) => request.route)).toEqual([
      "GET /process-definitions/1/xml",
      "GET /process-definitions/2/xml",
    ])
  })

  test("reads a page of instances newest first with its total and cursor", async () => {
    const { camunda, client } = clientWith([
      {
        route: "POST /process-instances/search",
        answer: page(
          [
            instance("7", {
              endDate: ENDED_AT,
              parentProcessInstanceKey: "6",
              parentElementInstanceKey: "60",
              businessId: "ORD-7",
              hasIncident: true,
              state: "COMPLETED",
            }),
          ],
          { totalItems: 10_000, hasMoreTotalItems: true, endCursor: "c2" },
        ),
      },
    ])

    const found = await client.instances(
      { processDefinitionId: "order" },
      { limit: 1, after: "c1" },
    )

    expect(found).toEqual({
      items: [
        {
          key: "7",
          definitionKey: "100",
          bpmnProcessId: "order",
          version: 1,
          state: "COMPLETED",
          hasIncident: true,
          definitionName: "Order",
          startedAt: STARTED_AT,
          endedAt: ENDED_AT,
          parentKey: "6",
          parentElementKey: "60",
          businessId: "ORD-7",
        },
      ],
      total: 10_000,
      capped: true,
      endCursor: "c2",
    })
    expect(searchOf(camunda.requests[0]?.body ?? "")).toEqual({
      filter: { processDefinitionId: "order" },
      sort: [
        { field: "startDate", order: "DESC" },
        { field: "processInstanceKey", order: "ASC" },
      ],
      page: { limit: 1, after: "c1" },
    })
  })

  test("reads one instance by its key, and none that is missing", async () => {
    const { client } = clientWith([
      { route: "GET /process-instances/7", answer: instance("7") },
      {
        route: "GET /process-instances/8",
        answer: problem(404, "NOT_FOUND", "Process instance with key '8' not found"),
      },
    ])

    expect(await client.instance("7")).toMatchObject({ key: "7", hasIncident: false })
    expect(await client.instance("8")).toBeUndefined()
  })
})
