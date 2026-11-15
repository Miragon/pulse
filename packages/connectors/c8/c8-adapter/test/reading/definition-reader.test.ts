import { BpmnProcessId, DefinitionId } from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { DefinitionReader } from "../../src/reading/definition-reader.js"
import { clientWith, page, type RestRoute } from "../support/fake-camunda-rest.js"
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
      },
    ])
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
    ])

    const versions = await definitions.versions(BpmnProcessId("order"))

    expect(versions.map((row) => [row.definition.version, row.running, row.withIncident])).toEqual([
      [2, 0, 0],
      [1, 2, 1],
    ])
    expect(
      camunda.bodiesOf("POST /process-definitions/statistics/process-instances-by-version"),
    ).toEqual([{ filter: { processDefinitionId: "order" }, page: { from: 0, limit: 500 } }])
  })
})
