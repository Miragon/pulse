import { DefinitionId } from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { Diagrams } from "../../src/reading/diagrams.js"
import { ElementStatisticsReader } from "../../src/reading/element-statistics-reader.js"
import { clientWith, page, problem, type RestRoute } from "../support/fake-transport.js"

function readerWith(routes: readonly RestRoute[]) {
  const { camunda, client } = clientWith(routes)
  return { camunda, statistics: new ElementStatisticsReader(client, new Diagrams(client)) }
}

describe("the element statistics", () => {
  const XML = `<bpmn:definitions>
    <bpmn:callActivity id="Call"><bpmn:extensionElements /></bpmn:callActivity>
    <bpmn:serviceTask id="Task" />
  </bpmn:definitions>`

  test("split a call activity's incidents into its own and those in called instances", async () => {
    const { camunda, statistics } = readerWith([
      {
        route: "POST /process-definitions/100/statistics/element-instances",
        answer: {
          items: [
            { elementId: "Call", active: 1, incidents: 3, canceled: 0, completed: 0 },
            { elementId: "Task", active: 2, incidents: 1, canceled: 0, completed: 0 },
            { elementId: "Done", active: 0, incidents: 0, canceled: 0, completed: 9 },
          ],
        },
      },
      { route: "GET /process-definitions/100/xml", answer: XML },
      {
        route: "POST /incidents/search",
        answer: page([], { totalItems: 1 }),
      },
    ])

    expect(await statistics.read(DefinitionId("100"))).toEqual([
      { elementId: "Call", active: 3, incidents: 1, incidentsInCalledInstances: 2 },
      { elementId: "Task", active: 2, incidents: 1, incidentsInCalledInstances: 0 },
    ])
    expect(camunda.bodiesOf("POST /incidents/search")).toEqual([
      expect.objectContaining({
        filter: { processDefinitionKey: "100", elementId: "Call", state: "ACTIVE" },
        page: { limit: 0 },
      }),
    ])
  })

  test("count every container above a failing task as running, as the cluster flags each one", async () => {
    const { camunda, statistics } = readerWith([
      {
        route: "POST /process-definitions/100/statistics/element-instances",
        answer: {
          items: [
            { elementId: "Activity_ShipOrder", active: 0, incidents: 1, canceled: 0, completed: 0 },
            { elementId: "Activity_PackOrder", active: 0, incidents: 1, canceled: 0, completed: 0 },
            { elementId: "Activity_Pack", active: 0, incidents: 1, canceled: 0, completed: 0 },
          ],
        },
      },
      {
        route: "GET /process-definitions/100/xml",
        answer: `<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
          <bpmn:process id="shop" isExecutable="true">
            <bpmn:subProcess id="Activity_ShipOrder">
              <bpmn:subProcess id="Activity_PackOrder">
                <bpmn:serviceTask id="Activity_Pack" />
              </bpmn:subProcess>
            </bpmn:subProcess>
          </bpmn:process>
        </bpmn:definitions>`,
      },
      { route: "POST /incidents/search", answer: page([], { totalItems: 0 }) },
    ])

    expect(await statistics.read(DefinitionId("100"))).toEqual([
      { elementId: "Activity_ShipOrder", active: 1, incidents: 0, incidentsInCalledInstances: 0 },
      { elementId: "Activity_PackOrder", active: 1, incidents: 0, incidentsInCalledInstances: 0 },
      { elementId: "Activity_Pack", active: 0, incidents: 1, incidentsInCalledInstances: 0 },
    ])
    expect(
      camunda
        .bodiesOf("POST /incidents/search")
        .map((body) => (body as { filter: { elementId: string } }).filter.elementId)
        .toSorted(),
    ).toEqual(["Activity_PackOrder", "Activity_ShipOrder"])
  })

  test("keep the incidents raised at each kind of container, and only a call's others as called", async () => {
    const { statistics } = readerWith([
      {
        route: "POST /process-definitions/100/statistics/element-instances",
        answer: {
          items: [
            { elementId: "OnCancel", active: 0, incidents: 1 },
            { elementId: "Refund", active: 0, incidents: 1 },
            { elementId: "Tools", active: 1, incidents: 1 },
            { elementId: "Lookup", active: 0, incidents: 1 },
            { elementId: "Payment", active: 0, incidents: 2 },
            { elementId: "Book", active: 0, incidents: 1 },
            { elementId: "Call", active: 0, incidents: 2 },
          ],
        },
      },
      {
        route: "GET /process-definitions/100/xml",
        answer: `<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
          <bpmn:process id="shop" isExecutable="true">
            <bpmn:subProcess id="OnCancel" triggeredByEvent="true"><bpmn:serviceTask id="Refund" /></bpmn:subProcess>
            <bpmn:adHocSubProcess id="Tools"><bpmn:serviceTask id="Lookup" /></bpmn:adHocSubProcess>
            <bpmn:transaction id="Payment"><bpmn:serviceTask id="Book" /></bpmn:transaction>
            <bpmn:callActivity id="Call" />
          </bpmn:process>
        </bpmn:definitions>`,
      },
      {
        route: "POST /incidents/search",
        when: (body) => /"elementId":"(Payment|Call)"/.test(body),
        answer: page([], { totalItems: 1 }),
      },
      { route: "POST /incidents/search", answer: page([], { totalItems: 0 }) },
    ])

    expect(await statistics.read(DefinitionId("100"))).toEqual([
      { elementId: "OnCancel", active: 1, incidents: 0, incidentsInCalledInstances: 0 },
      { elementId: "Refund", active: 0, incidents: 1, incidentsInCalledInstances: 0 },
      { elementId: "Tools", active: 2, incidents: 0, incidentsInCalledInstances: 0 },
      { elementId: "Lookup", active: 0, incidents: 1, incidentsInCalledInstances: 0 },
      { elementId: "Payment", active: 1, incidents: 1, incidentsInCalledInstances: 0 },
      { elementId: "Book", active: 0, incidents: 1, incidentsInCalledInstances: 0 },
      { elementId: "Call", active: 1, incidents: 1, incidentsInCalledInstances: 1 },
    ])
  })

  test.each([
    ["a call activity", `<bpmn:callActivity id="Container" />`],
    [
      "an embedded sub-process",
      `<bpmn:subProcess id="Container"><bpmn:serviceTask id="Inner" /></bpmn:subProcess>`,
    ],
  ])(
    "keep the counts of %s as the cluster gives them while its own incidents pass the search's cap",
    async (_container, markup) => {
      const { statistics } = readerWith([
        {
          route: "POST /process-definitions/100/statistics/element-instances",
          answer: { items: [{ elementId: "Container", active: 4, incidents: 12_000 }] },
        },
        {
          route: "GET /process-definitions/100/xml",
          answer: `<bpmn:definitions>${markup}</bpmn:definitions>`,
        },
        {
          route: "POST /incidents/search",
          answer: page([], { totalItems: 10_000, hasMoreTotalItems: true }),
        },
      ])

      expect(await statistics.read(DefinitionId("100"))).toEqual([
        { elementId: "Container", active: 4, incidents: 12_000, incidentsInCalledInstances: 0 },
      ])
    },
  )

  test("pass the rows on as they are while the diagram is missing", async () => {
    const { camunda, statistics } = readerWith([
      {
        route: "POST /process-definitions/100/statistics/element-instances",
        answer: { items: [{ elementId: "Sub", active: 0, incidents: 1 }] },
      },
      {
        route: "GET /process-definitions/100/xml",
        answer: problem(404, "NOT_FOUND", "Process Definition with key '100' not found"),
      },
    ])

    expect(await statistics.read(DefinitionId("100"))).toEqual([
      { elementId: "Sub", active: 0, incidents: 1, incidentsInCalledInstances: 0 },
    ])
    expect(camunda.bodiesOf("POST /incidents/search")).toEqual([])
  })

  test("read no diagram while nothing has an incident, and nothing for an impossible key", async () => {
    const { camunda, statistics } = readerWith([
      {
        route: "POST /process-definitions/100/statistics/element-instances",
        answer: { items: [{ elementId: "Task", active: 2, incidents: 0 }] },
      },
    ])

    expect(await statistics.read(DefinitionId("100"))).toHaveLength(1)
    expect(await statistics.read(DefinitionId("order:1"))).toEqual([])
    expect(camunda.requests).toHaveLength(1)
  })
})
