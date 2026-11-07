import { describe, expect, test } from "vitest"
import { C8Adapter } from "../../../src/adapters/c8/index.js"
import { BpmnProcessId, DefinitionId } from "../../../src/contract/index.js"
import { fakeCamundaRest, page, problem, REST_URL, TOPOLOGY } from "./support/fake-camunda-rest.js"
import { NONE, runtimeWith, definition } from "./support/runtime-fixture.js"

describe("the C8 runtime", () => {
  test("describes itself by the cluster's version and asks for it once", async () => {
    const { camunda, runtime } = runtimeWith([TOPOLOGY])

    expect(await runtime.describeEngine()).toEqual({ product: "Camunda 8", version: "8.10.8" })
    await runtime.describeEngine()

    expect(camunda.requests.filter((request) => request.route === "GET /topology")).toHaveLength(1)
  })

  test("refuses a cluster below the version it reads, by name", async () => {
    const { runtime } = runtimeWith([
      { route: "GET /topology", answer: { gatewayVersion: "8.8.45" } },
    ])

    await expect(runtime.listDefinitions()).rejects.toMatchObject({
      failure: "misconfigured",
      message: expect.stringContaining("8.9 or newer. This cluster runs 8.8.45") as unknown,
    })
  })

  test("leaves a version it cannot read to the cluster", async () => {
    const { runtime } = runtimeWith([
      { route: "GET /topology", answer: { gatewayVersion: "main-SNAPSHOT" } },
    ])

    expect(await runtime.describeEngine()).toEqual({
      product: "Camunda 8",
      version: "main-SNAPSHOT",
    })
  })

  test("names the url when the root is wrong, and asks again next time", async () => {
    const { camunda, runtime } = runtimeWith([])

    await expect(runtime.listDefinitions()).rejects.toMatchObject({
      failure: "misconfigured",
      hint: expect.stringContaining("end in /v2") as unknown,
    })
    await expect(runtime.describeEngine()).rejects.toMatchObject({ failure: "misconfigured" })

    expect(camunda.requests).toHaveLength(2)
  })

  test("names a cluster without secondary storage instead of calling it forbidden", async () => {
    const { runtime } = runtimeWith([
      TOPOLOGY,
      {
        route: "POST /process-definitions/search",
        answer: problem(
          403,
          "Forbidden",
          "This endpoint requires secondary storage, but none is set.",
        ),
      },
      { route: "POST /process-definitions/statistics/process-instances", answer: page([]) },
    ])

    await expect(runtime.listDefinitions()).rejects.toMatchObject({
      failure: "misconfigured",
      message: expect.stringContaining("without secondary storage") as unknown,
    })
  })

  test.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [302, "misconfigured"],
    [400, "engineFailure"],
    [503, "engineFailure"],
  ])("reads HTTP %i as %s", async (status, failure) => {
    const { runtime } = runtimeWith([
      TOPOLOGY,
      {
        route: "POST /process-instances/search",
        answer: new Response("", { status, headers: { Location: "http://elsewhere.test" } }),
      },
    ])

    await expect(runtime.countInstances({})).rejects.toMatchObject({ failure })
  })

  test("reads an answer of another shape as unexpected", async () => {
    const { runtime } = runtimeWith([
      TOPOLOGY,
      { route: "POST /process-instances/search", answer: { items: "many", page: {} } },
    ])

    await expect(runtime.countInstances({})).rejects.toMatchObject({
      failure: "unexpectedResponse",
    })
  })

  test("reads a cluster that does not answer as unreachable", async () => {
    const runtime = new C8Adapter(() => Promise.reject(new TypeError("fetch failed"))).runtime({
      endpoint: REST_URL,
      credentials: NONE,
    })

    await expect(runtime.listDefinitions()).rejects.toMatchObject({ failure: "unreachable" })
  })

  test("never follows a redirect, and sends basic credentials", async () => {
    const camunda = fakeCamundaRest([TOPOLOGY])
    const runtime = new C8Adapter(camunda.send).runtime({
      endpoint: `${REST_URL}/`,
      credentials: { kind: "basic", username: "demo", password: "s3cret" },
    })

    await runtime.describeEngine()

    expect(camunda.requests[0]).toMatchObject({
      route: "GET /topology",
      redirect: "manual",
      authorization: `Basic ${btoa("demo:s3cret")}`,
    })
  })

  test("has no writes and starts no bulk operation", async () => {
    const adapter = new C8Adapter(fakeCamundaRest([]).send)
    const runtime = adapter.runtime({ endpoint: REST_URL, credentials: NONE })

    expect(adapter.commands()).toBeUndefined()
    expect(await runtime.getBulkOperation(undefined as never)).toBeUndefined()
    expect(await runtime.getBulkFailures(undefined as never)).toEqual([])
    expect("proposeMigration" in runtime).toBe(false)
    expect(runtime.refusedVariableConditions?.()).toEqual(["ordering", "date"])
  })
})

describe("its definitions", () => {
  test("list an idle process with zero counts, sum tenants and skip deleted ones", async () => {
    const { runtime } = runtimeWith([
      TOPOLOGY,
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
        answer: page([
          {
            processDefinitionId: "order",
            activeInstancesWithoutIncidentCount: 2,
            activeInstancesWithIncidentCount: 1,
          },
          {
            processDefinitionId: "order",
            activeInstancesWithoutIncidentCount: 4,
            activeInstancesWithIncidentCount: 0,
          },
        ]),
      },
    ])

    expect(await runtime.listDefinitions()).toEqual([
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

  test("list versions newest first with their counts, an idle one included", async () => {
    const { runtime } = runtimeWith([
      TOPOLOGY,
      {
        route: "POST /process-definitions/search",
        answer: page([definition("100", "order", 1), definition("200", "order", 2)]),
      },
      {
        route: "POST /process-definitions/statistics/process-instances-by-version",
        answer: page([
          {
            processDefinitionKey: "100",
            activeInstancesWithoutIncidentCount: 1,
            activeInstancesWithIncidentCount: 1,
          },
        ]),
      },
    ])

    const versions = await runtime.listVersions(BpmnProcessId("order"))

    expect(versions.map((row) => [row.definition.version, row.running, row.withIncident])).toEqual([
      [2, 0, 0],
      [1, 2, 1],
    ])
  })

  test("read a diagram once and treat a missing one and an impossible key as none", async () => {
    const { camunda, runtime } = runtimeWith([
      TOPOLOGY,
      {
        route: "GET /process-definitions/100/xml",
        answer: new Response("<definitions />", { headers: { "Content-Type": "text/xml" } }),
      },
      {
        route: "GET /process-definitions/999/xml",
        answer: problem(404, "NOT_FOUND", "Process Definition with key '999' not found"),
      },
    ])

    expect(await runtime.getDiagramXml(DefinitionId("100"))).toBe("<definitions />")
    expect(await runtime.getDiagramXml(DefinitionId("100"))).toBe("<definitions />")
    expect(await runtime.getDiagramXml(DefinitionId("999"))).toBeUndefined()
    expect(await runtime.getDiagramXml(DefinitionId("order:1"))).toBeUndefined()

    expect(camunda.requests.map((request) => request.route)).toEqual([
      "GET /topology",
      "GET /process-definitions/100/xml",
      "GET /process-definitions/999/xml",
    ])
  })

  test.each([["9223372036854775807"], ["-9223372036854775808"], ["0"]])(
    "read the diagram of %s, a key within a Java long",
    async (key) => {
      const { camunda, runtime } = runtimeWith([
        TOPOLOGY,
        { route: `GET /process-definitions/${key}/xml`, answer: new Response("<definitions />") },
      ])

      expect(await runtime.getDiagramXml(DefinitionId(key))).toBe("<definitions />")
      expect(camunda.requests).toHaveLength(2)
    },
  )

  test.each([
    ["9223372036854775808"],
    ["-9223372036854775809"],
    ["9999999999999999999"],
    ["12345678901234567890"],
    ["+1"],
    ["1 "],
    [""],
  ])("treat %j, which is no Java long, as no key and send no call for it", async (key) => {
    const { camunda, runtime } = runtimeWith([TOPOLOGY])

    expect(await runtime.getDiagramXml(DefinitionId(key))).toBeUndefined()
    expect(camunda.requests.map((request) => request.route)).toEqual(["GET /topology"])
  })
})

describe("its element statistics", () => {
  const XML = `<bpmn:definitions>
    <bpmn:callActivity id="Call"><bpmn:extensionElements /></bpmn:callActivity>
    <bpmn:serviceTask id="Task" />
  </bpmn:definitions>`

  test("split a call activity's incidents into its own and those in called instances", async () => {
    const { camunda, runtime } = runtimeWith([
      TOPOLOGY,
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
      { route: "GET /process-definitions/100/xml", answer: new Response(XML) },
      {
        route: "POST /incidents/search",
        answer: page([], { totalItems: 1 }),
      },
    ])

    expect(await runtime.getElementStatistics(DefinitionId("100"))).toEqual([
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
    const { camunda, runtime } = runtimeWith([
      TOPOLOGY,
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
        answer:
          new Response(`<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
          <bpmn:process id="shop" isExecutable="true">
            <bpmn:subProcess id="Activity_ShipOrder">
              <bpmn:subProcess id="Activity_PackOrder">
                <bpmn:serviceTask id="Activity_Pack" />
              </bpmn:subProcess>
            </bpmn:subProcess>
          </bpmn:process>
        </bpmn:definitions>`),
      },
      { route: "POST /incidents/search", answer: page([], { totalItems: 0 }) },
    ])

    expect(await runtime.getElementStatistics(DefinitionId("100"))).toEqual([
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
    const { runtime } = runtimeWith([
      TOPOLOGY,
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
        answer:
          new Response(`<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
          <bpmn:process id="shop" isExecutable="true">
            <bpmn:subProcess id="OnCancel" triggeredByEvent="true"><bpmn:serviceTask id="Refund" /></bpmn:subProcess>
            <bpmn:adHocSubProcess id="Tools"><bpmn:serviceTask id="Lookup" /></bpmn:adHocSubProcess>
            <bpmn:transaction id="Payment"><bpmn:serviceTask id="Book" /></bpmn:transaction>
            <bpmn:callActivity id="Call" />
          </bpmn:process>
        </bpmn:definitions>`),
      },
      {
        route: "POST /incidents/search",
        when: (body) => /"elementId":"(Payment|Call)"/.test(body),
        answer: page([], { totalItems: 1 }),
      },
      { route: "POST /incidents/search", answer: page([], { totalItems: 0 }) },
    ])

    expect(await runtime.getElementStatistics(DefinitionId("100"))).toEqual([
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
      const { runtime } = runtimeWith([
        TOPOLOGY,
        {
          route: "POST /process-definitions/100/statistics/element-instances",
          answer: { items: [{ elementId: "Container", active: 4, incidents: 12_000 }] },
        },
        {
          route: "GET /process-definitions/100/xml",
          answer: new Response(`<bpmn:definitions>${markup}</bpmn:definitions>`),
        },
        {
          route: "POST /incidents/search",
          answer: page([], { totalItems: 10_000, hasMoreTotalItems: true }),
        },
      ])

      expect(await runtime.getElementStatistics(DefinitionId("100"))).toEqual([
        { elementId: "Container", active: 4, incidents: 12_000, incidentsInCalledInstances: 0 },
      ])
    },
  )

  test("pass the rows on as they are while the diagram is missing", async () => {
    const { camunda, runtime } = runtimeWith([
      TOPOLOGY,
      {
        route: "POST /process-definitions/100/statistics/element-instances",
        answer: { items: [{ elementId: "Sub", active: 0, incidents: 1 }] },
      },
      {
        route: "GET /process-definitions/100/xml",
        answer: problem(404, "NOT_FOUND", "Process Definition with key '100' not found"),
      },
    ])

    expect(await runtime.getElementStatistics(DefinitionId("100"))).toEqual([
      { elementId: "Sub", active: 0, incidents: 1, incidentsInCalledInstances: 0 },
    ])
    expect(camunda.bodiesOf("POST /incidents/search")).toEqual([])
  })

  test("read no diagram while nothing has an incident, and nothing for an impossible key", async () => {
    const { camunda, runtime } = runtimeWith([
      TOPOLOGY,
      {
        route: "POST /process-definitions/100/statistics/element-instances",
        answer: { items: [{ elementId: "Task", active: 2, incidents: 0 }] },
      },
    ])

    expect(await runtime.getElementStatistics(DefinitionId("100"))).toHaveLength(1)
    expect(await runtime.getElementStatistics(DefinitionId("order:1"))).toEqual([])
    expect(camunda.requests).toHaveLength(2)
  })
})

describe("its called processes", () => {
  const XML = `<bpmn:definitions xmlns:zeebe="z">
    <bpmn:callActivity id="Latest"><bpmn:extensionElements>
      <zeebe:calledElement processId="label" />
    </bpmn:extensionElements></bpmn:callActivity>
    <bpmn:callActivity id="Tagged" name="a &gt; b"><bpmn:extensionElements>
      <zeebe:calledElement processId="label" bindingType="versionTag" versionTag="stable" />
    </bpmn:extensionElements></bpmn:callActivity>
    <bpmn:callActivity id="Deployment"><bpmn:extensionElements>
      <zeebe:calledElement processId="label" bindingType="deployment" />
    </bpmn:extensionElements></bpmn:callActivity>
    <bpmn:callActivity id="Unknown"><bpmn:extensionElements>
      <zeebe:calledElement processId="nothing" />
    </bpmn:extensionElements></bpmn:callActivity>
    <bpmn:callActivity id="Feel"><bpmn:extensionElements>
      <zeebe:calledElement processId="= target" />
    </bpmn:extensionElements></bpmn:callActivity>
    <bpmn:callActivity id="Bare" />
  </bpmn:definitions>`

  test("take the newest version when tenants hold several latest ones", async () => {
    const { runtime } = runtimeWith([
      TOPOLOGY,
      {
        route: "GET /process-definitions/100/xml",
        answer: new Response(`<bpmn:definitions xmlns:zeebe="z">
          <bpmn:callActivity id="Latest"><bpmn:extensionElements>
            <zeebe:calledElement processId="label" />
          </bpmn:extensionElements></bpmn:callActivity>
        </bpmn:definitions>`),
      },
      {
        route: "POST /process-definitions/search",
        answer: page([definition("20", "label", 2), definition("30", "label", 3)]),
      },
    ])

    const calls = await runtime.getCalledProcesses(DefinitionId("100"))

    expect(calls.map((call) => call.definition?.id)).toEqual(["30"])
  })

  test("resolve each binding, and leave out what only an expression decides", async () => {
    const { runtime } = runtimeWith([
      TOPOLOGY,
      { route: "GET /process-definitions/100/xml", answer: new Response(XML) },
      {
        route: "POST /process-definitions/search",
        when: (body) => body.includes("isLatestVersion"),
        answer: page([definition("30", "label", 3)]),
      },
      {
        route: "POST /process-definitions/search",
        answer: page([
          definition("30", "label", 3),
          definition("20", "label", 2, { versionTag: "stable" }),
        ]),
      },
    ])

    const calls = await runtime.getCalledProcesses(DefinitionId("100"))

    expect(calls.map((call) => [call.elementId, call.bpmnProcessId, call.definition?.id])).toEqual([
      ["Latest", "label", "30"],
      ["Tagged", "label", "20"],
      ["Deployment", "label", undefined],
      ["Unknown", "nothing", undefined],
    ])
  })

  test("are none for a diagram without calls and for an unknown definition", async () => {
    const { runtime } = runtimeWith([
      TOPOLOGY,
      { route: "GET /process-definitions/100/xml", answer: new Response("<definitions />") },
      {
        route: "GET /process-definitions/999/xml",
        answer: problem(404, "NOT_FOUND", "missing"),
      },
    ])

    expect(await runtime.getCalledProcesses(DefinitionId("100"))).toEqual([])
    expect(await runtime.getCalledProcesses(DefinitionId("999"))).toEqual([])
  })
})
