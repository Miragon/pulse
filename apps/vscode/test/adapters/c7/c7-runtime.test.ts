import {
  BpmnProcessId,
  DefinitionId,
  ElementId,
  IncidentId,
  InstanceId,
  RuntimeError,
  PageCursor,
} from "../../../src/contract/index.js"
import { describe, expect, test } from "vitest"
import { C7Adapter } from "../../../src/adapters/c7/index.js"
import { fakeRuntime } from "./support/fake-engine.js"
import {
  engineFailure,
  REST_URL,
  type FakeEngineRest,
  type RestRoute,
} from "./support/fake-engine-rest.js"
import { fixture, WORLD_IDS } from "./support/fixtures.js"

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

function historicRows(): HistoricRow[] {
  return JSON.parse(fixture("historic-instances-order.json")) as HistoricRow[]
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
const STACKTRACE_DETAILS = {
  kind: "stacktrace",
  text: expect.stringMatching(/^org\.operaton\.bpm\.engine\.ProcessEngineException/) as string,
  truncated: false,
}

const ROUTE = {
  telemetry: { route: "GET /telemetry/data", answer: new Response(fixture("telemetry.json")) },
  definitionStatistics: {
    route: "GET /process-definition/statistics",
    answer: new Response(fixture("definition-statistics.json")),
  },
  incidentInstances: {
    route: "GET /incident",
    when: (url: URL) => !url.searchParams.has("sortBy"),
    answer: new Response(fixture("incidents.json")),
  },
  allIncidents: {
    route: "GET /incident",
    when: (url: URL) => url.searchParams.has("sortBy"),
    answer: new Response(fixture("incidents.json")),
  },
  incidentsOfDispatch: {
    route: "GET /incident",
    when: (url: URL) => url.searchParams.get("processDefinitionId") === WORLD_IDS.dispatch1,
    answer: incidentsOf(WORLD_IDS.dispatch1),
  },
  incidentsOfOrder: {
    route: "GET /incident",
    when: (url: URL) => url.searchParams.get("processDefinitionId") === WORLD_IDS.order1,
    answer: incidentsOf(WORLD_IDS.order1),
  },
  activitiesOfOrder: {
    route: `GET /process-definition/${pathOf(WORLD_IDS.order1)}/statistics`,
    answer: [
      { id: "Activity_ReviewOrder", instances: 1, failedJobs: 0, incidents: [] },
      { id: "Activity_ChargePayment", instances: 1, failedJobs: 1, incidents: [] },
    ],
  },
  activitiesOfDispatch: {
    route: `GET /process-definition/${pathOf(WORLD_IDS.dispatch1)}/statistics`,
    answer: new Response(fixture("activity-statistics-dispatch.json")),
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
    route: "POST /history/process-instance",
    when: (_url: URL, body: string) => body.includes('"incidentStatus":"open"'),
    answer: historicRows().filter((row) => row.businessKey === "ORD-1002"),
  },
  orderInstances: {
    route: "POST /history/process-instance",
    when: (_url: URL, body: string) => !body.includes("processInstanceIds"),
    answer: new Response(fixture("historic-instances-order.json")),
  },
  calledLabelInstance: {
    route: "POST /history/process-instance",
    when: (_url: URL, body: string) => body.includes(WORLD_IDS.label),
    answer: [
      {
        id: WORLD_IDS.label,
        processDefinitionId: WORLD_IDS.label1,
        processDefinitionKey: "pulse-label",
        processDefinitionVersion: 1,
        processDefinitionName: "Print label",
        state: "ACTIVE",
        startTime: "2026-10-21T18:44:04.587+0000",
      },
    ],
  },
  variablesReview: {
    route: "GET /variable-instance",
    when: (url: URL) => url.searchParams.get("processInstanceIdIn") === WORLD_IDS.review,
    answer: new Response(fixture("variable-instances-review.json")),
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

const SNAPSHOT = {
  dispatch: { [WORLD_IDS.dispatch]: fixture("inspect-dispatch.json") },
  review: { [WORLD_IDS.review]: fixture("inspect-review.json") },
  charge: { [WORLD_IDS.charge]: fixture("inspect-charge.json") },
  ended: { [WORLD_IDS.ended]: fixture("inspect-ended.json") },
  externalTask: { [WORLD_IDS.externalTaskInstance]: fixture("inspect-external-task.json") },
}

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
    const { runtime, engine } = fakeRuntime([ROUTE.definitionStatistics, ROUTE.incidentInstances])

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
    const { runtime } = fakeRuntime([ROUTE.definitionStatistics, ROUTE.incidentInstances])

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
    const { runtime } = fakeRuntime([ROUTE.activitiesOfDispatch, ROUTE.incidentsOfDispatch])

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
    const { runtime } = fakeRuntime([ROUTE.activitiesOfOrder, ROUTE.incidentsOfOrder])

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
  })

  test("continues after a cursor and skips the flag query when only incidents are asked for", async () => {
    const { runtime, engine } = fakeRuntime([
      {
        ...ROUTE.orderInstances,
        when: (_url, body) => body.includes('"incidentStatus":"open"'),
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
    expect(engine.requests).toHaveLength(1)
    expect(bodyOf(engine)).toMatchObject({ incidentStatus: "open", unfinished: true })
    expect(engine.requests[0]?.query.firstResult).toBe("3")
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

  test("counts instances with one call that carries the filter of the search", async () => {
    const { runtime, engine } = fakeRuntime([
      { route: "POST /history/process-instance/count", answer: { count: 2 } },
    ])

    const count = await runtime.countInstances({
      definitionId: DefinitionId(WORLD_IDS.order1),
      lifecycle: "running",
      withIncident: true,
      businessKey: "ORD-1002",
      activeElementId: ElementId("Activity_ChargePayment"),
    })

    expect(count).toBe(2)
    expect(engine.requests).toHaveLength(1)
    expect(bodyOf(engine)).toEqual({
      processDefinitionId: WORLD_IDS.order1,
      processInstanceBusinessKey: "ORD-1002",
      unfinished: true,
      incidentStatus: "open",
      activityIdIn: ["Activity_ChargePayment"],
    })
  })

  test("counts instances without an incident as all of them minus those with one", async () => {
    const { runtime } = fakeRuntime([
      {
        route: "POST /history/process-instance/count",
        when: (_url, body) => body.includes('"incidentStatus":"open"'),
        answer: { count: 1 },
      },
      {
        route: "POST /history/process-instance/count",
        when: (_url, body) => !body.includes("incidentStatus"),
        answer: { count: 3 },
      },
    ])

    const count = await runtime.countInstances({
      bpmnProcessId: BpmnProcessId("pulse-order"),
      withIncident: false,
    })

    expect(count).toBe(2)
  })

  test("details a parent with the wait states and the root incident of its called instance", async () => {
    const { runtime, engine } = fakeRuntime([ROUTE.calledLabelInstance], SNAPSHOT.dispatch)

    const detail = await runtime.getInstanceDetail(InstanceId(WORLD_IDS.dispatch))

    expect(detail?.instance).toEqual({
      id: WORLD_IDS.dispatch,
      definition: {
        id: WORLD_IDS.dispatch1,
        bpmnProcessId: "pulse-dispatch",
        version: 1,
        name: "Dispatch order",
      },
      state: "running",
      hasIncident: true,
      businessKey: "DSP-3001",
      startedAt: "2026-10-21T18:44:04.586Z",
    })
    expect(detail?.calledInstances).toEqual([
      {
        id: WORLD_IDS.label,
        parentInstanceId: WORLD_IDS.dispatch,
        bpmnProcessId: "pulse-label",
        state: "running",
        calledFromElementId: "Activity_PrintShippingLabel",
      },
    ])
    expect(detail?.waitStates).toEqual([
      {
        instanceId: WORLD_IDS.label,
        elementId: "Activity_RenderLabel",
        elementName: "Render label",
        since: "2026-10-21T18:44:04.588Z",
        incidentId: WORLD_IDS.labelIncident,
        kind: "asyncContinuation",
        retriesLeft: 0,
      },
    ])
    expect(detail?.incidents).toEqual([
      {
        id: WORLD_IDS.labelIncident,
        instanceId: WORLD_IDS.label,
        definition: LABEL_V1,
        elementId: "Activity_RenderLabel",
        type: "failedJob",
        message: LABEL_MESSAGE,
        createdAt: "2026-10-21T18:44:04.613Z",
        retriesLeft: 0,
        job: { id: WORLD_IDS.labelJob },
        details: STACKTRACE_DETAILS,
      },
    ])
    expect(detail?.variables).toEqual([
      {
        name: "orderId",
        scope: { kind: "instance" },
        valueJson: '"ORD-1001"',
        truncated: false,
        kind: "string",
      },
    ])
    expect(detail?.truncated).toBe(false)
    expect(routesOf(engine)).toEqual(["GET /variable-instance", "POST /history/process-instance"])
  })

  test("details a user task wait with the typed variables of every scope", async () => {
    const { runtime, engine } = fakeRuntime([ROUTE.variablesReview], SNAPSHOT.review)

    const detail = await runtime.getInstanceDetail(InstanceId(WORLD_IDS.review))

    expect(detail?.waitStates).toEqual([
      {
        instanceId: WORLD_IDS.review,
        elementId: "Activity_ReviewOrder",
        elementName: "Review order",
        since: "2026-10-21T18:44:04.475Z",
        kind: "userTask",
        assignee: "demo",
      },
    ])
    const instanceScope = { kind: "instance" }
    expect(detail?.variables).toEqual([
      {
        name: "address",
        scope: instanceScope,
        valueJson: '{"city":"Munich"}',
        truncated: false,
        kind: "json",
        type: "Json",
      },
      {
        name: "invoice",
        scope: instanceScope,
        valueJson: '"rO0ABXNyABFqYXZhLnV0aWwuSGFzaE1hcA=="',
        truncated: false,
        kind: "opaque",
        type: "Object",
      },
      {
        name: "ledger",
        scope: instanceScope,
        valueJson: "9007199254740993",
        truncated: false,
        kind: "integer",
        type: "Long",
      },
      {
        name: "nrOfInstances",
        scope: { kind: "element", elementId: "Activity_PackParcel" },
        valueJson: "2",
        truncated: false,
        kind: "integer",
        type: "Integer",
      },
      {
        name: "reviewNote",
        scope: { kind: "element", elementId: "Activity_ReviewOrder" },
        valueJson: '"Check the delivery address"',
        truncated: false,
        kind: "string",
        type: "String",
      },
      {
        name: "route",
        scope: instanceScope,
        valueJson: '"review"',
        truncated: false,
        kind: "string",
        type: "String",
      },
    ])
    expect(detail?.incidents).toEqual([])
    expect(detail?.instance.hasIncident).toBe(false)
    expect(routesOf(engine)).toEqual(["GET /variable-instance"])
    expect(engine.requests[0]?.query.deserializeValues).toBe("false")
  })

  test("details an incident at the failing element of the instance itself", async () => {
    const { runtime, engine } = fakeRuntime([], SNAPSHOT.charge)

    const detail = await runtime.getInstanceDetail(InstanceId(WORLD_IDS.charge))

    expect(detail?.incidents).toEqual([
      {
        id: WORLD_IDS.chargeIncident,
        instanceId: WORLD_IDS.charge,
        definition: ORDER_V1,
        elementId: "Activity_ChargePayment",
        type: "failedJob",
        message: CHARGE_MESSAGE,
        createdAt: "2026-10-21T18:44:04.554Z",
        retriesLeft: 0,
        job: { id: WORLD_IDS.chargeJob },
        details: STACKTRACE_DETAILS,
      },
    ])
    expect(detail?.path).toEqual([
      {
        elementId: "Event_OrderReceived",
        elementName: "Order received",
        startedAt: "2026-10-21T18:44:04.497Z",
        endedAt: "2026-10-21T18:44:04.497Z",
        canceled: false,
      },
      {
        elementId: "Gateway_Route",
        elementName: "Route?",
        startedAt: "2026-10-21T18:44:04.497Z",
        endedAt: "2026-10-21T18:44:04.497Z",
        canceled: false,
      },
    ])
    expect(routesOf(engine)).toEqual(["GET /variable-instance"])
  })

  test("names the failed external task with its topic and maps the worker wait", async () => {
    const { runtime } = fakeRuntime([], SNAPSHOT.externalTask)

    const detail = await runtime.getInstanceDetail(InstanceId(WORLD_IDS.externalTaskInstance))

    expect(detail?.incidents.map((incident) => [incident.type, incident.job])).toEqual([
      ["failedJob", { id: "c729ac73-cd79-11f1-9d36-92016cbb8c45" }],
      [
        "failedExternalTask",
        { id: "c72a6fc7-cd79-11f1-9d36-92016cbb8c45", type: "notify-customer" },
      ],
    ])
    expect(detail?.waitStates.map((waitState) => waitState.kind)).toEqual([
      "asyncContinuation",
      "workerTask",
      "message",
      "userTask",
      "timer",
    ])
    expect(detail?.waitStates[1]).toEqual({
      instanceId: WORLD_IDS.externalTaskInstance,
      elementId: "notify",
      elementName: "Notify customer",
      since: "2026-10-21T18:03:54.138Z",
      incidentId: "ccbde620-cd79-11f1-9d36-92016cbb8c45",
      kind: "workerTask",
      taskType: "notify-customer",
      retriesLeft: 0,
    })
    expect(detail?.variables.find((variable) => variable.name === "bigId")?.valueJson).toBe(
      "9007199254740993",
    )
  })

  test("details an ended instance without wait states and incidents", async () => {
    const { runtime } = fakeRuntime([], SNAPSHOT.ended)

    const detail = await runtime.getInstanceDetail(InstanceId(WORLD_IDS.ended))

    expect(detail?.instance.state).toBe("completed")
    expect(detail?.instance.endedAt).toBe("2026-10-21T18:44:04.526Z")
    expect(detail?.waitStates).toEqual([])
    expect(detail?.incidents).toEqual([])
  })

  test("returns undefined for an unknown instance", async () => {
    const { runtime } = fakeRuntime([ROUTE.instanceMissing, ROUTE.historicInstanceMissing])

    expect(await runtime.getInstanceDetail(InstanceId("00000000-0000"))).toBeUndefined()
  })

  test("lists root incidents only, each with the version it was raised in", async () => {
    const { runtime, engine } = fakeRuntime([ROUTE.allIncidents, ROUTE.definitionStatistics])

    const page = await runtime.searchIncidents({}, { limit: 50 })

    expect(page).toEqual({
      items: [
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
      ],
    })
    expect(engine.requests).toHaveLength(2)
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
    })
    expect(await runtime.getIncidentDetails(IncidentId("task-gone"))).toEqual({
      kind: "errorMessage",
      text: "Customer service is down",
      truncated: false,
    })
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
          { route: "GET /incident", answer: [] },
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
      { route: "GET /incident", answer: [] },
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
