import {
  BpmnProcessId,
  DefinitionId,
  ElementId,
  IncidentId,
  InstanceId,
  RuntimeError,
  PageCursor,
} from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { C7Adapter } from "../src/index.js"
import { fakeRuntime } from "./support/fake-engine.js"
import {
  engineFailure,
  REST_URL,
  type FakeEngineRest,
  type RestRoute,
} from "./support/fake-engine-rest.js"
import { fixture, WORLD_IDS, worldDiagram } from "./support/fixtures.js"

interface IncidentRow {
  readonly processDefinitionId: string
}

interface HistoricRow {
  readonly id: string
  readonly businessKey: string
}

function incidentsOf(definitionId: string): IncidentRow[] {
  const rows = JSON.parse(fixture("incidents.json")) as IncidentRow[]
  return rows.filter((row) => row.processDefinitionId === definitionId)
}

function failingRows(): HistoricRow[] {
  return JSON.parse(fixture("process-instances-with-incident.json")) as HistoricRow[]
}

function pathOf(id: string): string {
  return encodeURIComponent(id)
}

function bodyOf(engine: FakeEngineRest, index = 0): unknown {
  return JSON.parse(engine.requests[index]?.body ?? "") as unknown
}

function routesOf(engine: FakeEngineRest): string[] {
  return engine.requests.map((request) => request.route)
}

const INSTANCE_MISSING =
  "Process instance 00000000-0000 does not exist (neither running nor in the history)"

const ORDER_V1 = {
  id: WORLD_IDS.order1,
  bpmnProcessId: "pulse-order",
  version: 1,
  name: "Order fulfillment",
}
const LABEL_V1 = {
  id: WORLD_IDS.label1,
  bpmnProcessId: "pulse-label",
  version: 1,
  name: "Print label",
}
const CHARGE_MESSAGE =
  "Unknown property used in expression: ${paymentService.charge(amount)}. Cause: Cannot resolve identifier 'paymentService'"
const LABEL_MESSAGE =
  "Unknown property used in expression: ${labelPrinter.print(orderId)}. Cause: Cannot resolve identifier 'labelPrinter'"
const ROUTE = {
  telemetry: { route: "GET /telemetry/data", answer: new Response(fixture("telemetry.json")) },
  definitionStatistics: {
    route: "GET /process-definition/statistics",
    answer: new Response(fixture("definition-statistics.json")),
  },
  instancesWithIncident: {
    route: "GET /process-instance",
    when: (url: URL) =>
      url.searchParams.get("withIncident") === "true" &&
      !url.searchParams.has("processInstanceIds"),
    answer: new Response(fixture("process-instances-with-incident.json")),
  },
  allIncidents: {
    route: "GET /incident",
    answer: new Response(fixture("incidents.json")),
  },
  incidentsOfDispatch: {
    route: "GET /incident",
    when: (url: URL) =>
      url.searchParams.get("processDefinitionId") === WORLD_IDS.dispatch1 &&
      url.searchParams.get("activityId") === "Activity_PrintShippingLabel",
    answer: incidentsOf(WORLD_IDS.dispatch1),
  },
  activitiesOfOrder: {
    route: `GET /process-definition/${pathOf(WORLD_IDS.order1)}/statistics`,
    when: (url: URL) => url.searchParams.get("incidents") === "true",
    answer: [
      { id: "Activity_ReviewOrder", instances: 1, failedJobs: 0, incidents: [] },
      {
        id: "Activity_ChargePayment",
        instances: 1,
        failedJobs: 1,
        incidents: [{ incidentType: "failedJob", incidentCount: 1 }],
      },
    ],
  },
  activitiesOfDispatch: {
    route: `GET /process-definition/${pathOf(WORLD_IDS.dispatch1)}/statistics`,
    when: (url: URL) => url.searchParams.get("incidents") === "true",
    answer: new Response(fixture("activity-statistics-dispatch.json")),
  },
  orderXml: {
    route: `GET /process-definition/${pathOf(WORLD_IDS.order1)}/xml`,
    answer: { id: WORLD_IDS.order1, bpmn20Xml: worldDiagram("order") },
  },
  dispatchXml: {
    route: `GET /process-definition/${pathOf(WORLD_IDS.dispatch1)}/xml`,
    answer: { id: WORLD_IDS.dispatch1, bpmn20Xml: worldDiagram("dispatch") },
  },
  labelXml: {
    route: `GET /process-definition/${pathOf(WORLD_IDS.label1)}/xml`,
    answer: new Response(fixture("definition-xml.json")),
  },
  missingXml: {
    route: `GET /process-definition/${pathOf("nope:1:x")}/xml`,
    answer: engineFailure(
      404,
      "InvalidRequestException",
      "No matching definition with id nope:1:x",
    ),
  },
  flaggedInstances: {
    route: "GET /process-instance",
    when: (url: URL) =>
      url.searchParams.get("withIncident") === "true" && url.searchParams.has("processInstanceIds"),
    answer: failingRows().filter((row) => row.businessKey === "ORD-1002"),
  },
  orderInstances: {
    route: "POST /history/process-instance",
    when: (_url: URL, body: string) => !body.includes("processInstanceIds"),
    answer: new Response(fixture("historic-instances-order.json")),
  },
  instanceMissing: {
    route: "GET /process-instance/00000000-0000",
    answer: engineFailure(404, "InvalidRequestException", INSTANCE_MISSING),
  },
  historicInstanceMissing: {
    route: "GET /history/process-instance/00000000-0000",
    answer: engineFailure(404, "InvalidRequestException", INSTANCE_MISSING),
  },
  rootIncident: {
    route: `GET /incident/${WORLD_IDS.chargeIncident}`,
    answer: new Response(fixture("incident-root.json")),
  },
  propagatedIncident: {
    route: `GET /incident/${WORLD_IDS.propagatedIncident}`,
    answer: new Response(fixture("incident-propagated.json")),
  },
  missingIncident: {
    route: "GET /incident/00000000-0000",
    answer: engineFailure(
      404,
      "InvalidRequestException",
      "No incident found with id 00000000-0000",
    ),
  },
  chargeStacktrace: {
    route: `GET /job/${WORLD_IDS.chargeJob}/stacktrace`,
    answer: new Response(fixture("job-stacktrace.txt")),
  },
} satisfies Record<string, RestRoute>

const DETAIL_SINCE = "2026-10-21T18:44:04.587+0000"
const PARENT_DEFINITION = "order:1:d1"
const CALLED_DEFINITION = "label:2:d2"

function detailRoute(path: string, answer: unknown, query?: readonly [string, string]): RestRoute {
  return {
    route: `GET ${path}`,
    answer,
    ...(query === undefined
      ? {}
      : { when: (url: URL) => url.searchParams.get(query[0]) === query[1] }),
  }
}

function activityTree(id: string, definitionId: string, leaf: Record<string, unknown>) {
  return { id, activityId: definitionId, childActivityInstances: [leaf] }
}

const DETAIL_ROUTES: readonly RestRoute[] = [
  detailRoute("/process-instance/p1", { id: "p1", definitionId: PARENT_DEFINITION }),
  detailRoute("/history/process-instance/p1", {
    id: "p1",
    businessKey: "ORD-1",
    processDefinitionId: PARENT_DEFINITION,
    processDefinitionKey: "order",
    processDefinitionVersion: 1,
    processDefinitionName: "Order",
    startTime: DETAIL_SINCE,
    state: "ACTIVE",
  }),
  detailRoute(
    "/process-instance",
    [{ id: "c1", definitionId: CALLED_DEFINITION }],
    ["superProcessInstance", "p1"],
  ),
  detailRoute("/process-instance", [], ["superProcessInstance", "c1"]),
  detailRoute(
    "/process-instance/p1/activity-instances",
    activityTree("p1", PARENT_DEFINITION, {
      id: "call:a1",
      activityId: "call",
      activityType: "callActivity",
      executionIds: ["e1"],
    }),
  ),
  detailRoute(
    "/process-instance/c1/activity-instances",
    activityTree("c1", CALLED_DEFINITION, {
      id: "print:b1",
      activityId: "print",
      activityName: "Print label",
      activityType: "serviceTask",
      executionIds: ["c1"],
    }),
  ),
  detailRoute("/incident", [], ["processInstanceId", "p1"]),
  detailRoute(
    "/incident",
    [
      {
        id: "i1",
        rootCauseIncidentId: "i1",
        incidentType: "failedJob",
        activityId: "print",
        processInstanceId: "c1",
        configuration: "j1",
        incidentMessage: "Printer offline",
        incidentTimestamp: DETAIL_SINCE,
      },
    ],
    ["processInstanceId", "c1"],
  ),
  detailRoute("/event-subscription", []),
  detailRoute("/task", []),
  detailRoute("/external-task", []),
  detailRoute("/job", [], ["timers", "true"]),
  detailRoute("/job", [
    { id: "j1", failedActivityId: "print", executionId: "c1", processInstanceId: "c1", retries: 0 },
  ]),
  detailRoute("/process-definition", [
    { id: PARENT_DEFINITION, key: "order", version: 1, name: "Order" },
    { id: CALLED_DEFINITION, key: "label", version: 2, name: "Print label" },
  ]),
  detailRoute("/job-definition", []),
  detailRoute("/process-instance/p1/variables", { route: { type: "String", value: "x" } }),
  detailRoute("/history/activity-instance", [
    {
      activityId: "call",
      activityType: "callActivity",
      startTime: DETAIL_SINCE,
      calledProcessInstanceId: "c1",
    },
  ]),
  detailRoute(
    "/job/j1/stacktrace",
    new Response("org.x.PrinterException: offline\n\tat org.x.Printer.print(Printer.java:7)\n"),
  ),
  detailRoute(
    "/variable-instance",
    new Response(
      '[{"name":"ledger","type":"Long","value":9007199254740993,"activityInstanceId":"p1","processInstanceId":"p1"}]',
    ),
  ),
  {
    route: "POST /history/process-instance",
    answer: [
      {
        id: "c1",
        processDefinitionId: CALLED_DEFINITION,
        processDefinitionKey: "label",
        processDefinitionVersion: 2,
        processDefinitionName: "Print label",
        state: "ACTIVE",
      },
    ],
  },
]

describe("the C7 runtime over recorded engine answers", () => {
  test("describes the engine by its product and version", async () => {
    const { runtime } = fakeRuntime([ROUTE.telemetry])

    expect(await runtime.describeEngine()).toEqual({
      product: "Operaton BPM Runtime",
      version: "2.1.5",
    })
  })

  test("falls back to the REST API version when the engine has no telemetry", async () => {
    const { runtime } = fakeRuntime([
      {
        route: "GET /telemetry/data",
        answer: engineFailure(404, "InvalidRequestException", "No telemetry data"),
      },
      { route: "GET /version", answer: { version: "7.24.0" } },
    ])

    expect(await runtime.describeEngine()).toEqual({
      product: "Camunda 7 REST API",
      version: "7.24.0",
    })
  })

  test("summarises each process by its latest version and counts instances with an incident", async () => {
    const { runtime, engine } = fakeRuntime([
      ROUTE.definitionStatistics,
      ROUTE.instancesWithIncident,
    ])

    const summaries = await runtime.listDefinitions()

    expect(
      summaries.map((summary) => [
        summary.latest.bpmnProcessId,
        summary.latest.version,
        summary.running,
        summary.withIncident,
      ]),
    ).toEqual([
      ["invoice", 2, 6, 0],
      ["pulse-dispatch", 1, 1, 1],
      ["pulse-label", 1, 1, 1],
      ["pulse-order", 2, 3, 1],
      ["ReviewInvoice", 1, 2, 0],
    ])
    expect(engine.requests).toHaveLength(2)
  })

  test("lists the versions of one process newest first with their own counts", async () => {
    const { runtime } = fakeRuntime([ROUTE.definitionStatistics, ROUTE.instancesWithIncident])

    const versions = await runtime.listVersions(BpmnProcessId("pulse-order"))

    expect(
      versions.map((version) => [
        version.definition.id,
        version.definition.version,
        version.running,
        version.withIncident,
      ]),
    ).toEqual([
      ["pulse-order:2:63bcbc19-cd7f-11f1-86d2-667bc3771e0d", 2, 1, 0],
      [WORLD_IDS.order1, 1, 2, 1],
    ])
  })

  test("splits incidents raised at an element from those in called instances", async () => {
    const { runtime } = fakeRuntime([
      ROUTE.activitiesOfDispatch,
      ROUTE.dispatchXml,
      ROUTE.incidentsOfDispatch,
    ])

    const statistics = await runtime.getElementStatistics(DefinitionId(WORLD_IDS.dispatch1))

    expect(statistics).toEqual([
      {
        elementId: "Activity_PrintShippingLabel",
        active: 1,
        incidents: 0,
        incidentsInCalledInstances: 1,
      },
    ])
  })

  test("counts an element with an incident raised there as incident, not as active", async () => {
    const { runtime, engine } = fakeRuntime([ROUTE.activitiesOfOrder, ROUTE.orderXml])

    const statistics = await runtime.getElementStatistics(DefinitionId(WORLD_IDS.order1))

    expect(statistics).toEqual([
      { elementId: "Activity_ReviewOrder", active: 1, incidents: 0, incidentsInCalledInstances: 0 },
      {
        elementId: "Activity_ChargePayment",
        active: 0,
        incidents: 1,
        incidentsInCalledInstances: 0,
      },
    ])
    expect(routesOf(engine).filter((route) => route.startsWith("GET /incident"))).toEqual([])
  })

  test("returns the deployed XML of a version and undefined for an unknown one", async () => {
    const { runtime } = fakeRuntime([ROUTE.labelXml, ROUTE.missingXml])

    const xml = await runtime.getDiagramXml(DefinitionId(WORLD_IDS.label1))
    const unknown = await runtime.getDiagramXml(DefinitionId("nope:1:x"))

    expect(xml).toContain('id="Activity_RenderLabel"')
    expect(unknown).toBeUndefined()
  })

  test("pages instances with two calls per page, flags incidents and normalises timestamps", async () => {
    const { runtime, engine } = fakeRuntime([ROUTE.flaggedInstances, ROUTE.orderInstances])

    const page = await runtime.searchInstances(
      { bpmnProcessId: BpmnProcessId("pulse-order") },
      { limit: 3 },
    )

    expect(page).toEqual({
      items: [
        {
          id: WORLD_IDS.reviewV2,
          definition: {
            id: "pulse-order:2:63bcbc19-cd7f-11f1-86d2-667bc3771e0d",
            bpmnProcessId: "pulse-order",
            version: 2,
            name: "Order fulfillment",
          },
          state: "running",
          hasIncident: false,
          businessKey: "ORD-2001",
          startedAt: "2026-10-21T18:44:04.554Z",
        },
        {
          id: WORLD_IDS.ended,
          definition: ORDER_V1,
          state: "completed",
          hasIncident: false,
          businessKey: "ORD-1003",
          startedAt: "2026-10-21T18:44:04.525Z",
          endedAt: "2026-10-21T18:44:04.526Z",
        },
        {
          id: WORLD_IDS.charge,
          definition: ORDER_V1,
          state: "running",
          hasIncident: true,
          businessKey: "ORD-1002",
          startedAt: "2026-10-21T18:44:04.496Z",
        },
      ],
      next: PageCursor("3"),
    })
    expect(engine.requests).toHaveLength(2)
    expect(bodyOf(engine)).toEqual({
      processDefinitionKey: "pulse-order",
      sorting: [
        { sortBy: "startTime", sortOrder: "desc" },
        { sortBy: "instanceId", sortOrder: "asc" },
      ],
    })
    expect(engine.requests[0]?.query.maxResults).toBe("4")
    expect(engine.requests[1]?.query).toMatchObject({
      withIncident: "true",
      processInstanceIds: `${WORLD_IDS.reviewV2},${WORLD_IDS.charge}`,
    })
  })

  test("pages the history rows of the instances the runtime holds an open incident for", async () => {
    const { runtime, engine } = fakeRuntime([
      ROUTE.instancesWithIncident,
      {
        ...ROUTE.orderInstances,
        when: (_url, body) => body.includes("processInstanceIds"),
      },
    ])

    const page = await runtime.searchInstances(
      { withIncident: true, lifecycle: "running" },
      { limit: 10, after: PageCursor("3") },
    )

    expect(page.next).toBeUndefined()
    expect(page.items.map((item) => [item.businessKey, item.hasIncident])).toEqual([
      ["ORD-2001", true],
      ["ORD-1003", true],
      ["ORD-1002", true],
      ["ORD-1001", true],
    ])
    expect(routesOf(engine)).toEqual(["GET /process-instance", "POST /history/process-instance"])
    expect(engine.requests[0]?.query).toEqual({
      withIncident: "true",
      sortBy: "instanceId",
      sortOrder: "asc",
      firstResult: "0",
      maxResults: "500",
    })
    expect(bodyOf(engine, 1)).toEqual({
      processInstanceIds: [WORLD_IDS.charge, WORLD_IDS.dispatch, WORLD_IDS.label],
      unfinished: true,
      sorting: [
        { sortBy: "startTime", sortOrder: "desc" },
        { sortBy: "instanceId", sortOrder: "asc" },
      ],
    })
    expect(engine.requests[1]?.query.firstResult).toBe("3")
  })

  test("translates lifecycle, business key and active element into the historic query", async () => {
    const { runtime, engine } = fakeRuntime([ROUTE.flaggedInstances, ROUTE.orderInstances])

    await runtime.searchInstances(
      {
        lifecycle: "ended",
        businessKey: "ORD-1003",
        activeElementId: ElementId("Activity_ReviewOrder"),
      },
      { limit: 5 },
    )

    expect(bodyOf(engine)).toEqual({
      finished: true,
      processInstanceBusinessKey: "ORD-1003",
      activityIdIn: ["Activity_ReviewOrder"],
      sorting: [
        { sortBy: "startTime", sortOrder: "desc" },
        { sortBy: "instanceId", sortOrder: "asc" },
      ],
    })
  })

  test("leaves out instances with an incident when asked for those without", async () => {
    const { runtime } = fakeRuntime([ROUTE.flaggedInstances, ROUTE.orderInstances])

    const page = await runtime.searchInstances(
      { bpmnProcessId: BpmnProcessId("pulse-order"), withIncident: false },
      { limit: 10 },
    )

    expect(page.items.map((item) => item.businessKey)).toEqual(["ORD-2001", "ORD-1003", "ORD-1001"])
  })

  test("counts instances with an incident in one runtime count when the runtime knows the filter", async () => {
    const { runtime, engine } = fakeRuntime([
      { route: "GET /process-instance/count", answer: { count: 2 } },
    ])

    const count = await runtime.countInstances({
      definitionId: DefinitionId(WORLD_IDS.order1),
      lifecycle: "running",
      withIncident: true,
      businessKey: "ORD-1002",
    })

    expect(count).toEqual({ count: 2 })
    expect(engine.requests.map((request) => [request.route, request.query])).toEqual([
      [
        "GET /process-instance/count",
        { withIncident: "true", processDefinitionId: WORLD_IDS.order1, businessKey: "ORD-1002" },
      ],
    ])
  })

  test("counts instances with an incident at an element over the runtime's ids with the filter of the search", async () => {
    const { runtime, engine } = fakeRuntime([
      { ...ROUTE.instancesWithIncident, answer: failingRows().slice(0, 1) },
      { route: "POST /history/process-instance/count", answer: { count: 1 } },
    ])

    const count = await runtime.countInstances({
      definitionId: DefinitionId(WORLD_IDS.order1),
      lifecycle: "running",
      withIncident: true,
      businessKey: "ORD-1002",
      activeElementId: ElementId("Activity_ChargePayment"),
    })

    expect(count).toEqual({ count: 1 })
    expect(engine.requests[0]?.query).toMatchObject({
      withIncident: "true",
      processDefinitionId: WORLD_IDS.order1,
      businessKey: "ORD-1002",
    })
    expect(bodyOf(engine, 1)).toEqual({
      processDefinitionId: WORLD_IDS.order1,
      processInstanceIds: [WORLD_IDS.charge],
      processInstanceBusinessKey: "ORD-1002",
      unfinished: true,
      activityIdIn: ["Activity_ChargePayment"],
    })
  })

  test("counts instances without an incident as the history's minus its count of the runtime's ids with one", async () => {
    const { runtime, engine } = fakeRuntime([
      { ...ROUTE.instancesWithIncident, answer: failingRows().slice(0, 1) },
      {
        route: "POST /history/process-instance/count",
        when: (_url: URL, body: string) => body.includes("processInstanceIds"),
        answer: { count: 1 },
      },
      { route: "POST /history/process-instance/count", answer: { count: 3 } },
    ])

    const count = await runtime.countInstances({
      bpmnProcessId: BpmnProcessId("pulse-order"),
      withIncident: false,
    })

    expect(count).toEqual({ count: 2 })
    expect(engine.requests.filter((request) => request.body.includes("ncident"))).toEqual([])
    expect(routesOf(engine).filter((route) => route === "GET /process-instance/count")).toEqual([])
    expect(engine.requests[routesOf(engine).indexOf("GET /process-instance")]?.query).toMatchObject(
      { withIncident: "true", processDefinitionKey: "pulse-order" },
    )
    expect(
      engine.requests
        .map((request, index) => ({ request, index }))
        .filter(({ request }) => request.route === "POST /history/process-instance/count")
        .map(({ index }) => bodyOf(engine, index)),
    ).toEqual([
      { processDefinitionKey: "pulse-order" },
      { processDefinitionKey: "pulse-order", processInstanceIds: [WORLD_IDS.charge] },
    ])
  })

  test("counts no instance without an incident, never below 0, where the history holds none the runtime runs", async () => {
    const { runtime } = fakeRuntime([
      ROUTE.instancesWithIncident,
      { route: "POST /history/process-instance/count", answer: { count: 0 } },
    ])

    const count = await runtime.countInstances({ withIncident: false })

    expect(count).toEqual({ count: 0 })
  })

  test("details an instance through the inspection's reads, its typed variables and the history of a called instance", async () => {
    const { runtime, engine } = fakeRuntime(DETAIL_ROUTES)

    const detail = await runtime.getInstanceDetail(InstanceId("p1"))

    expect(detail?.instance).toEqual({
      id: "p1",
      definition: { id: PARENT_DEFINITION, bpmnProcessId: "order", version: 1, name: "Order" },
      state: "running",
      hasIncident: true,
      businessKey: "ORD-1",
      startedAt: "2026-10-21T18:44:04.587Z",
    })
    expect(detail?.waitStates).toEqual([
      {
        instanceId: "c1",
        elementId: "print",
        elementName: "Print label",
        incidentId: "i1",
        kind: "asyncContinuation",
        retriesLeft: 0,
      },
    ])
    expect(detail?.incidents).toEqual([
      {
        id: "i1",
        instanceId: "c1",
        definition: {
          id: CALLED_DEFINITION,
          bpmnProcessId: "label",
          version: 2,
          name: "Print label",
        },
        elementId: "print",
        type: "failedJob",
        message: "Printer offline",
        createdAt: "2026-10-21T18:44:04.587Z",
        retriesLeft: 0,
        job: { id: "j1" },
        details: {
          kind: "stacktrace",
          text: "org.x.PrinterException: offline\n\tat org.x.Printer.print(Printer.java:7)",
          truncated: false,
          rootCause: "PrinterException: offline",
        },
      },
    ])
    expect(detail?.calledInstances).toEqual([
      {
        id: "c1",
        parentInstanceId: "p1",
        bpmnProcessId: "label",
        state: "running",
        calledFromElementId: "call",
      },
    ])
    expect(detail?.path).toEqual([
      { elementId: "call", startedAt: "2026-10-21T18:44:04.587Z", canceled: false },
    ])
    expect(detail?.variables).toEqual([
      {
        name: "ledger",
        scope: { kind: "instance" },
        valueJson: "9007199254740993",
        truncated: false,
        kind: "integer",
        type: "Long",
      },
    ])
    expect(detail?.truncated).toBe(false)
    expect(routesOf(engine)).toHaveLength(DETAIL_ROUTES.length + 2)
  })

  test("reads an instance's detail in one round of four reads, then the history of a called instance", async () => {
    const { runtime, engine } = fakeRuntime(DETAIL_ROUTES)

    await runtime.getInstanceDetail(InstanceId("p1"))

    const [timeline, variables] = engine.requests.slice(2, 4)
    const history = engine.requests.at(-1)
    expect(routesOf(engine).slice(0, 4)).toEqual([
      "GET /process-instance/p1",
      "GET /history/process-instance/p1",
      "GET /history/activity-instance",
      "GET /variable-instance",
    ])
    expect(timeline?.query).toEqual({
      processInstanceId: "p1",
      sortBy: "occurrence",
      sortOrder: "asc",
      firstResult: "0",
      maxResults: "500",
    })
    expect(Object.entries(variables?.query ?? {})).toEqual([
      ["processInstanceIdIn", "p1"],
      ["deserializeValues", "false"],
      ["maxResults", "500"],
    ])
    expect(history?.route).toBe("POST /history/process-instance")
    expect(history?.query).toEqual({ firstResult: "0", maxResults: "1" })
    expect(JSON.parse(history?.body ?? "")).toMatchObject({ processInstanceIds: ["c1"] })
  })

  test("returns undefined for an unknown instance", async () => {
    const { runtime } = fakeRuntime([ROUTE.instanceMissing, ROUTE.historicInstanceMissing])

    expect(await runtime.getInstanceDetail(InstanceId("00000000-0000"))).toBeUndefined()
  })

  test("lists root incidents only, newest first, each with the version it was raised in", async () => {
    const { runtime, engine } = fakeRuntime([ROUTE.allIncidents, ROUTE.definitionStatistics])

    const page = await runtime.searchIncidents({}, { limit: 50 })

    expect(page).toEqual({
      items: [
        {
          id: WORLD_IDS.labelIncident,
          instanceId: WORLD_IDS.label,
          definition: LABEL_V1,
          elementId: "Activity_RenderLabel",
          type: "failedJob",
          message: LABEL_MESSAGE,
          createdAt: "2026-10-21T18:44:04.613Z",
          job: { id: WORLD_IDS.labelJob },
        },
        {
          id: WORLD_IDS.chargeIncident,
          instanceId: WORLD_IDS.charge,
          definition: ORDER_V1,
          elementId: "Activity_ChargePayment",
          type: "failedJob",
          message: CHARGE_MESSAGE,
          createdAt: "2026-10-21T18:44:04.554Z",
          job: { id: WORLD_IDS.chargeJob },
        },
      ],
    })
    expect(engine.requests).toHaveLength(2)
    const incidents = engine.requests.find((request) => request.route === "GET /incident")
    expect(Object.entries(incidents?.query ?? {})).toEqual([
      ["sortBy", "incidentTimestamp"],
      ["sortOrder", "desc"],
      ["firstResult", "0"],
      ["maxResults", "51"],
    ])
  })

  test("lists the job of an incident type the engine raises itself, never of a custom one", async () => {
    const [charge] = JSON.parse(fixture("incidents.json")) as Record<string, unknown>[]
    const rowOf = (id: string, incidentType: string) => ({
      ...charge,
      id,
      causeIncidentId: id,
      rootCauseIncidentId: id,
      incidentType,
      configuration: `${id}-target`,
    })
    const { runtime } = fakeRuntime([
      {
        route: "GET /incident",
        answer: [rowOf("external", "failedExternalTask"), rowOf("custom", "invoiceMismatch")],
      },
      ROUTE.definitionStatistics,
    ])

    const page = await runtime.searchIncidents({}, { limit: 50 })

    expect(page.items.map((incident) => [incident.id, incident.job])).toEqual([
      ["custom", undefined],
      ["external", { id: "external-target" }],
    ])
  })

  test("lists no job where c7-core's incident recovery names none, as the instance does", async () => {
    const [charge] = JSON.parse(fixture("incidents.json")) as Record<string, unknown>[]
    const rowOf = (id: string, incidentType: string, configuration: string | null) => ({
      ...charge,
      id,
      causeIncidentId: id,
      rootCauseIncidentId: id,
      incidentType,
      configuration,
    })
    const { runtime } = fakeRuntime([
      {
        route: "GET /incident",
        answer: [
          rowOf("empty-job", "failedJob", ""),
          rowOf("empty-task", "failedExternalTask", ""),
          rowOf("no-job", "failedJob", null),
        ],
      },
      ROUTE.definitionStatistics,
    ])

    const page = await runtime.searchIncidents({}, { limit: 50 })

    expect(page.items.map((incident) => [incident.id, incident.job])).toEqual([
      ["empty-job", undefined],
      ["empty-task", undefined],
      ["no-job", undefined],
    ])
  })

  test("delivers the complete stacktrace of a root incident", async () => {
    const { runtime } = fakeRuntime([ROUTE.rootIncident, ROUTE.chargeStacktrace])

    const details = await runtime.getIncidentDetails(IncidentId(WORLD_IDS.chargeIncident))

    expect(details?.kind).toBe("stacktrace")
    expect(details?.truncated).toBe(false)
    expect(details?.text.split("\n")).toHaveLength(95)
    expect(details?.text).toContain("Caused by: jakarta.el.PropertyNotFoundException")
  })

  test("delivers the error details of a failed external task, else the incident message", async () => {
    const externalTaskIncident = (id: string, configuration: string) => ({
      ...(JSON.parse(fixture("incident-root.json")) as Record<string, unknown>),
      id,
      rootCauseIncidentId: id,
      incidentType: "failedExternalTask",
      configuration,
      incidentMessage: "Customer service is down",
    })
    const { runtime } = fakeRuntime([
      {
        route: "GET /incident/with-details",
        answer: externalTaskIncident("with-details", "task-1"),
      },
      {
        route: "GET /incident/task-gone",
        answer: externalTaskIncident("task-gone", "task-2"),
      },
      {
        route: "GET /external-task/task-1/errorDetails",
        answer: new Response("java.net.ConnectException: Connection refused\n"),
      },
      {
        route: "GET /external-task/task-2/errorDetails",
        answer: engineFailure(
          500,
          "NullValueException",
          "No external task found with id task-2: externalTask is null",
        ),
      },
    ])

    expect(await runtime.getIncidentDetails(IncidentId("with-details"))).toEqual({
      kind: "stacktrace",
      text: "java.net.ConnectException: Connection refused",
      truncated: false,
      rootCause: "ConnectException: Connection refused",
    })
    expect(await runtime.getIncidentDetails(IncidentId("task-gone"))).toEqual({
      kind: "errorMessage",
      text: "Customer service is down",
      truncated: false,
      rootCause: "Customer service is down",
    })
  })

  test("reads no engine text where c7-core's incident recovery names no job or external task", async () => {
    const incidentAt = (id: string, incidentType: string, configuration: string) => ({
      route: `GET /incident/${id}`,
      answer: {
        ...(JSON.parse(fixture("incident-root.json")) as Record<string, unknown>),
        id,
        rootCauseIncidentId: id,
        incidentType,
        configuration,
        incidentMessage: "Invoice total does not match",
      },
    })
    const { runtime, engine } = fakeRuntime([
      incidentAt("custom", "invoiceMismatch", "inv-1"),
      incidentAt("no-job", "failedJob", ""),
    ])

    for (const id of ["custom", "no-job"]) {
      expect(await runtime.getIncidentDetails(IncidentId(id))).toEqual({
        kind: "errorMessage",
        text: "Invoice total does not match",
        truncated: false,
        rootCause: "Invoice total does not match",
      })
    }
    expect(engine.requests.map((request) => request.route)).toEqual([
      "GET /incident/custom",
      "GET /incident/no-job",
    ])
  })

  test("has no details for a propagated or an unknown incident", async () => {
    const { runtime } = fakeRuntime([ROUTE.propagatedIncident, ROUTE.missingIncident])

    expect(
      await runtime.getIncidentDetails(IncidentId(WORLD_IDS.propagatedIncident)),
    ).toBeUndefined()
    expect(await runtime.getIncidentDetails(IncidentId("00000000-0000"))).toBeUndefined()
  })
})

describe("failures of the C7 runtime", () => {
  const CONNECTION = { endpoint: REST_URL, credentials: { kind: "none" } } as const
  const REFUSED = Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
  })

  const runtimeAnswering = (answer: Response | Error) =>
    answer instanceof Error
      ? new C7Adapter(() => Promise.reject(answer)).runtime(CONNECTION)
      : fakeRuntime([
          { route: "GET /process-definition/statistics", answer },
          { route: "GET /process-instance", answer: [] },
        ]).runtime

  const failingWith = async (answer: Response | Error): Promise<unknown> =>
    runtimeAnswering(answer)
      .listDefinitions()
      .then(
        () => undefined,
        (error: unknown) => error,
      )

  test.each([
    ["a refused connection", "unreachable", REFUSED],
    [
      "a 401",
      "unauthorized",
      engineFailure(401, "AuthenticationException", "HTTP 401 Unauthorized"),
    ],
    [
      "a 404 of a wrong REST root",
      "misconfigured",
      engineFailure(404, "NotFoundException", "HTTP 404 Not Found"),
    ],
    [
      "a 500 NullValueException",
      "engineFailure",
      engineFailure(500, "NullValueException", "No external task found: externalTask is null"),
    ],
  ])('maps %s to "%s"', async (_name, failure, answer) => {
    const error = await failingWith(answer)

    expect(RuntimeError.is(error) && error.failure).toBe(failure)
  })

  test('maps a forbidden request to "forbidden"', async () => {
    const error = await failingWith(
      engineFailure(403, "AuthorizationException", "HTTP 403 Forbidden"),
    )

    expect(RuntimeError.is(error) && error.failure).toBe("forbidden")
  })

  test('maps output it cannot read to "unexpectedResponse"', async () => {
    const { runtime } = fakeRuntime([
      { route: "GET /process-definition/statistics", answer: { not: "a list" } },
      { route: "GET /process-instance", answer: [] },
    ])

    const error = await runtime.listDefinitions().then(
      () => undefined,
      (failure: unknown) => failure,
    )

    expect(RuntimeError.is(error) && error.failure).toBe("unexpectedResponse")
  })

  test('maps a count without a number to "unexpectedResponse"', async () => {
    const { runtime } = fakeRuntime([
      { route: "POST /history/process-instance/count", answer: { count: "many" } },
    ])

    const error = await runtime.countInstances({}).then(
      () => undefined,
      (failure: unknown) => failure,
    )

    expect(RuntimeError.is(error) && error.failure).toBe("unexpectedResponse")
  })

  test('maps a redirect away from the REST API to "misconfigured"', async () => {
    const error = await failingWith(
      new Response("", { status: 302, headers: { Location: "/login" } }),
    )

    expect(RuntimeError.is(error) && error.failure).toBe("misconfigured")
  })
})
