import { BpmnProcessId, DefinitionId } from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { DefinitionReader } from "../../src/reading/definition-reader.js"
import { FewAtOnce } from "../../src/reading/few-at-once.js"
import { clientWith, page, searchOf, type RestRoute } from "../support/fake-transport.js"
import { definition } from "../support/rows.js"

function readerWith(routes: readonly RestRoute[]) {
  const { camunda, client } = clientWith(routes)
  return { camunda, definitions: new DefinitionReader(client) }
}

function counts(bpmnProcessId: string, withoutIncident: number, withIncident: number) {
  return {
    processDefinitionId: bpmnProcessId,
    activeInstancesWithoutIncidentCount: withoutIncident,
    activeInstancesWithIncidentCount: withIncident,
  }
}

function incidentsOf(field: string, value: string, totalItems: number, hasMoreTotalItems = false) {
  return {
    route: "POST /incidents/search",
    when: (body: string) => searchOf(body).filter[field] === value,
    answer: page([], { totalItems, hasMoreTotalItems }),
  }
}

function heldIncidentSearches() {
  let running = 0
  let most = 0
  const route: RestRoute = {
    route: "POST /incidents/search",
    answer: async () => {
      running += 1
      most = Math.max(most, running)
      await new Promise((resolve) => setTimeout(resolve, 2))
      running -= 1
      return page([], { totalItems: 1 })
    },
  }
  return { route, most: () => most }
}

const MANY = Array.from({ length: 20 }, (_, index) => index + 1)

describe("the definitions", () => {
  test("list an idle process with zero counts, sum tenants and skip deleted ones", async () => {
    const { definitions } = readerWith([
      {
        route: "POST /process-definitions/search",
        answer: page([
          definition("200", "order", 2),
          definition("300", "idle", 1),
          definition("400", "gone", 3, { state: "DELETED" }),
        ]),
      },
      {
        route: "POST /process-definitions/statistics/process-instances",
        answer: { items: [counts("order", 2, 1), counts("order", 4, 0), counts("gone", 1, 1)] },
      },
      incidentsOf("processDefinitionId", "order", 2),
    ])

    expect(await definitions.list()).toEqual([
      {
        latest: {
          id: DefinitionId("200"),
          bpmnProcessId: BpmnProcessId("order"),
          version: 2,
          name: "order name",
        },
        running: 7,
        withIncident: 1,
        incidents: 2,
      },
      {
        latest: {
          id: DefinitionId("300"),
          bpmnProcessId: BpmnProcessId("idle"),
          version: 1,
          name: "idle name",
        },
        running: 0,
        withIncident: 0,
        incidents: 0,
      },
    ])
  })

  test("count the open incidents of a process with an instance with incident alone, in one search each over every version", async () => {
    const { camunda, definitions } = readerWith([
      {
        route: "POST /process-definitions/search",
        answer: page([definition("200", "order", 2), definition("300", "idle", 1)]),
      },
      {
        route: "POST /process-definitions/statistics/process-instances",
        answer: { items: [counts("order", 2, 1), counts("idle", 3, 0)] },
      },
      incidentsOf("processDefinitionId", "order", 1),
    ])

    const listed = await definitions.list()

    expect(listed.map((row) => [row.latest.bpmnProcessId, row.incidents])).toEqual([
      ["order", 1],
      ["idle", 0],
    ])
    expect(camunda.bodiesOf("POST /incidents/search")).toEqual([
      {
        filter: { processDefinitionId: "order", state: "ACTIVE" },
        sort: [
          { field: "creationTime", order: "DESC" },
          { field: "incidentKey", order: "ASC" },
        ],
        page: { limit: 0 },
      },
    ])
  })

  test("count the open incidents of many processes in trouble with no more searches at once than READS", async () => {
    const searches = heldIncidentSearches()
    const { camunda, definitions } = readerWith([
      {
        route: "POST /process-definitions/search",
        answer: page(MANY.map((index) => definition(String(index), `p${String(index)}`, 1))),
      },
      {
        route: "POST /process-definitions/statistics/process-instances",
        answer: { items: MANY.map((index) => counts(`p${String(index)}`, 0, 1)) },
      },
      searches.route,
    ])

    const listed = await definitions.list()

    expect(listed.map((row) => [row.latest.bpmnProcessId, row.incidents])).toEqual(
      MANY.map((index) => [`p${String(index)}`, 1]),
    )
    expect(camunda.bodiesOf("POST /incidents/search")).toHaveLength(MANY.length)
    expect(searches.most()).toBe(FewAtOnce.READS)
  })

  test("count the open incidents of a process as a lower bound where the cluster stops counting", async () => {
    const { definitions } = readerWith([
      { route: "POST /process-definitions/search", answer: page([definition("200", "order", 2)]) },
      {
        route: "POST /process-definitions/statistics/process-instances",
        answer: { items: [counts("order", 0, 12_000)] },
      },
      incidentsOf("processDefinitionId", "order", 10_000, true),
    ])

    const [order] = await definitions.list()

    expect(order).toMatchObject({ incidents: 10_000, incidentsAtLeast: true })
  })

  test("list the newest of the latest versions that tenants hold of one process", async () => {
    const { definitions } = readerWith([
      {
        route: "POST /process-definitions/search",
        answer: page([
          definition("300", "order", 3, { name: undefined }),
          definition("200", "order", 2),
          definition("400", "order", 4, { state: "DELETED" }),
        ]),
      },
      { route: "POST /process-definitions/statistics/process-instances", answer: { items: [] } },
    ])

    expect(await definitions.list()).toEqual([
      {
        latest: { id: "300", bpmnProcessId: "order", version: 3 },
        running: 0,
        withIncident: 0,
        incidents: 0,
      },
    ])
  })

  test("list versions newest first with their counts, an idle one included, a deleted one left out", async () => {
    const { camunda, definitions } = readerWith([
      {
        route: "POST /process-definitions/search",
        answer: page([
          definition("100", "order", 1),
          definition("300", "order", 3, { state: "DELETED" }),
          definition("200", "order", 2),
        ]),
      },
      {
        route: "POST /process-definitions/statistics/process-instances-by-version",
        answer: {
          items: [
            {
              processDefinitionKey: "100",
              activeInstancesWithoutIncidentCount: 1,
              activeInstancesWithIncidentCount: 1,
            },
          ],
        },
      },
      incidentsOf("processDefinitionKey", "100", 3),
    ])

    const versions = await definitions.versions(BpmnProcessId("order"))

    expect(
      versions.map((row) => [row.definition.version, row.running, row.withIncident, row.incidents]),
    ).toEqual([
      [2, 0, 0, 0],
      [1, 2, 1, 3],
    ])
    expect(
      camunda.bodiesOf("POST /process-definitions/statistics/process-instances-by-version"),
    ).toEqual([{ filter: { processDefinitionId: "order" }, page: { from: 0, limit: 500 } }])
    expect(camunda.bodiesOf("POST /incidents/search")).toMatchObject([
      { filter: { processDefinitionKey: "100", state: "ACTIVE" }, page: { limit: 0 } },
    ])
  })

  test("count the open incidents of many versions in trouble with no more searches at once than READS", async () => {
    const searches = heldIncidentSearches()
    const { camunda, definitions } = readerWith([
      {
        route: "POST /process-definitions/search",
        answer: page(MANY.map((version) => definition(String(version), "order", version))),
      },
      {
        route: "POST /process-definitions/statistics/process-instances-by-version",
        answer: {
          items: MANY.map((version) => ({
            processDefinitionKey: String(version),
            activeInstancesWithoutIncidentCount: 0,
            activeInstancesWithIncidentCount: 1,
          })),
        },
      },
      searches.route,
    ])

    const versions = await definitions.versions(BpmnProcessId("order"))

    expect(versions.map((row) => [row.definition.version, row.incidents])).toEqual(
      MANY.toReversed().map((version) => [version, 1]),
    )
    expect(camunda.bodiesOf("POST /incidents/search")).toHaveLength(MANY.length)
    expect(searches.most()).toBe(FewAtOnce.READS)
  })

  test("count the open incidents of a version as a lower bound where the cluster stops counting", async () => {
    const { definitions } = readerWith([
      { route: "POST /process-definitions/search", answer: page([definition("100", "order", 1)]) },
      {
        route: "POST /process-definitions/statistics/process-instances-by-version",
        answer: {
          items: [
            {
              processDefinitionKey: "100",
              activeInstancesWithoutIncidentCount: 0,
              activeInstancesWithIncidentCount: 11_000,
            },
          ],
        },
      },
      incidentsOf("processDefinitionKey", "100", 10_000, true),
    ])

    const [version] = await definitions.versions(BpmnProcessId("order"))

    expect(version).toMatchObject({ incidents: 10_000, incidentsAtLeast: true })
  })
})
