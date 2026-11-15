import { BpmnProcessId, DefinitionId, ElementId, InstanceId } from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { InstanceSearch } from "../../src/reading/instance-search.js"
import { clientWith, page, problem, type RestRoute } from "../support/fake-camunda-rest.js"
import { definition } from "../support/rows.js"

function readerWith(routes: readonly RestRoute[]) {
  const { camunda, client } = clientWith(routes)
  return { camunda, instances: new InstanceSearch(client) }
}

describe("the instance counts", () => {
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
    const { instances } = readerWith([
      { route: "POST /process-instances/search", answer: page([], { totalItems: 12 }) },
    ])

    expect(await instances.count({})).toEqual({ count: 12 })
  })

  test.each([
    [{ bpmnProcessId: BpmnProcessId("order"), lifecycle: "running" }, 20013],
    [{ bpmnProcessId: BpmnProcessId("order"), lifecycle: "running", withIncident: true }, 6],
    [{ bpmnProcessId: BpmnProcessId("order"), lifecycle: "running", withIncident: false }, 20007],
  ] as const)("read %o exactly from the statistics above the cap", async (filter, count) => {
    const { instances } = readerWith([
      { route: "POST /process-instances/search", answer: CAPPED },
      BY_VERSION,
    ])

    expect(await instances.count(filter)).toEqual({ count })
  })

  test("of one version read that version's row", async () => {
    const { instances } = readerWith([
      { route: "POST /process-instances/search", answer: CAPPED },
      { route: "GET /process-definitions/100", answer: definition("100", "order", 1) },
      BY_VERSION,
    ])

    expect(
      await instances.count({ definitionId: DefinitionId("100"), lifecycle: "running" }),
    ).toEqual({ count: 20005 })
  })

  test("of one version of a named process read that version's row without reading the version", async () => {
    const { camunda, instances } = readerWith([
      { route: "POST /process-instances/search", answer: CAPPED },
      BY_VERSION,
    ])

    expect(
      await instances.count({
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
      const { camunda, instances } = readerWith([
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

      expect(await instances.count(filter)).toEqual({ count })
      expect(camunda.requests.map((request) => request.route)).toEqual([
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
    const { instances } = readerWith([{ route: "POST /process-instances/search", answer: CAPPED }])

    expect(await instances.count(filter as never)).toEqual({ count: 10000, atLeast: true })
  })

  test("say so too when the definition is unknown", async () => {
    const { instances } = readerWith([
      { route: "POST /process-instances/search", answer: CAPPED },
      { route: "GET /process-definitions/100", answer: problem(404, "NOT_FOUND", "missing") },
    ])

    expect(
      await instances.count({ definitionId: DefinitionId("100"), lifecycle: "running" }),
    ).toEqual({ count: 10000, atLeast: true })
  })
})
