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
import { fakeRuntime, type FakeEngineCli, type FakeRoute } from "./support/fake-engine-cli.js"
import { compactFixture, fixture, WORLD_IDS } from "./support/fixtures.js"

interface IncidentRow {
  readonly processDefinitionId: string
}

interface HistoricRow {
  readonly id: string
  readonly businessKey: string
}

function incidentsOf(definitionId: string): string {
  const rows = JSON.parse(fixture("incidents.json")) as IncidentRow[]
  return JSON.stringify(rows.filter((row) => row.processDefinitionId === definitionId))
}

function historicRows(): HistoricRow[] {
  return JSON.parse(fixture("historic-instances-order.json")) as HistoricRow[]
}

function argAfter(args: readonly string[], flag: string): string | undefined {
  return args[args.indexOf(flag) + 1]
}

function bodyOf(cli: FakeEngineCli, index = 0): string {
  return cli.invocations[index]?.input ?? ""
}

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
  telemetry: { command: ["telemetry", "get-data"], stdout: fixture("telemetry.json") },
  definitionStatistics: {
    command: ["process-definition", "get-statistics"],
    stdout: fixture("definition-statistics.json"),
  },
  incidentInstances: {
    command: ["incident", "list", "--fields"],
    stdout: fixture("incidents.json"),
  },
  allIncidents: { command: ["incident", "list", "--sort-by"], stdout: fixture("incidents.json") },
  incidentsOfDispatch: {
    command: ["incident", "list", "--process-definition-id", WORLD_IDS.dispatch1],
    stdout: incidentsOf(WORLD_IDS.dispatch1),
  },
  incidentsOfOrder: {
    command: ["incident", "list", "--process-definition-id", WORLD_IDS.order1],
    stdout: incidentsOf(WORLD_IDS.order1),
  },
  activitiesOfOrder: {
    command: ["process-definition", "get-activity-statistics", WORLD_IDS.order1],
    stdout: JSON.stringify([
      { id: "Activity_ReviewOrder", instances: 1, failedJobs: 0, incidents: [] },
      { id: "Activity_ChargePayment", instances: 1, failedJobs: 1, incidents: [] },
    ]),
  },
  activitiesOfDispatch: {
    command: ["process-definition", "get-activity-statistics", WORLD_IDS.dispatch1],
    stdout: fixture("activity-statistics-dispatch.json"),
  },
  labelXml: {
    command: ["process-definition", "xml-by-id", WORLD_IDS.label1],
    stdout: fixture("definition-xml.json"),
  },
  missingXml: {
    command: ["process-definition", "xml-by-id", "nope:1:x"],
    exitCode: 5,
    stderr: compactFixture("error-definition-missing.json"),
  },
  flaggedInstances: {
    command: ["historic-process-instance", "query"],
    when: (_args: readonly string[], input: string) => input.includes('"incidentStatus":"open"'),
    stdout: JSON.stringify(historicRows().filter((row) => row.businessKey === "ORD-1002")),
  },
  orderInstances: {
    command: ["historic-process-instance", "query"],
    when: (_args: readonly string[], input: string) => !input.includes("processInstanceIds"),
    stdout: fixture("historic-instances-order.json"),
  },
  calledLabelInstance: {
    command: ["historic-process-instance", "query"],
    when: (_args: readonly string[], input: string) => input.includes(WORLD_IDS.label),
    stdout: JSON.stringify([
      {
        id: WORLD_IDS.label,
        processDefinitionId: WORLD_IDS.label1,
        processDefinitionKey: "pulse-label",
        processDefinitionVersion: 1,
        processDefinitionName: "Print label",
        state: "ACTIVE",
        startTime: "2026-10-21T18:44:04.587+0000",
      },
    ]),
  },
  inspectDispatch: {
    command: ["inspect", WORLD_IDS.dispatch],
    stdout: fixture("inspect-dispatch.json"),
  },
  inspectReview: { command: ["inspect", WORLD_IDS.review], stdout: fixture("inspect-review.json") },
  variablesReview: {
    command: ["variable-instance", "list", "--process-instance-id-in", WORLD_IDS.review],
    stdout: fixture("variable-instances-review.json"),
  },
  inspectCharge: { command: ["inspect", WORLD_IDS.charge], stdout: fixture("inspect-charge.json") },
  inspectEnded: { command: ["inspect", WORLD_IDS.ended], stdout: fixture("inspect-ended.json") },
  inspectExternalTask: {
    command: ["inspect", WORLD_IDS.externalTaskInstance],
    stdout: fixture("inspect-external-task.json"),
  },
  inspectMissing: {
    command: ["inspect", "00000000-0000"],
    exitCode: 5,
    stderr: compactFixture("error-instance-missing.json"),
  },
  rootIncident: {
    command: ["incident", "get", WORLD_IDS.chargeIncident],
    stdout: fixture("incident-root.json"),
  },
  propagatedIncident: {
    command: ["incident", "get", WORLD_IDS.propagatedIncident],
    stdout: fixture("incident-propagated.json"),
  },
  missingIncident: {
    command: ["incident", "get", "00000000-0000"],
    exitCode: 5,
    stderr: compactFixture("error-definition-missing.json"),
  },
  chargeStacktrace: {
    command: ["job", "get-stacktrace", WORLD_IDS.chargeJob],
    stdout: fixture("job-stacktrace.txt"),
  },
} satisfies Record<string, FakeRoute>

describe("the C7 runtime over recorded engine CLI output", () => {
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
        command: ["telemetry"],
        exitCode: 5,
        stderr: compactFixture("error-definition-missing.json"),
      },
      { command: ["version", "get"], stdout: '{"version":"7.24.0"}' },
    ])

    expect(await runtime.describeEngine()).toEqual({
      product: "Camunda 7 REST API",
      version: "7.24.0",
    })
  })

  test("summarises each process by its latest version and counts instances with an incident", async () => {
    const { runtime, cli } = fakeRuntime([ROUTE.definitionStatistics, ROUTE.incidentInstances])

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
    expect(cli.invocations).toHaveLength(2)
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
    const { runtime, cli } = fakeRuntime([ROUTE.orderInstances, ROUTE.flaggedInstances])

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
    expect(cli.invocations).toHaveLength(2)
    const query = cli.commands()[0] ?? []
    expect(JSON.parse(bodyOf(cli))).toEqual({
      processDefinitionKey: "pulse-order",
      sorting: [
        { sortBy: "startTime", sortOrder: "desc" },
        { sortBy: "instanceId", sortOrder: "asc" },
      ],
    })
    expect(argAfter(query, "--max-results")).toBe("4")
  })

  test("continues after a cursor and skips the flag query when only incidents are asked for", async () => {
    const { runtime, cli } = fakeRuntime([
      {
        ...ROUTE.orderInstances,
        when: (_args, input) => input.includes('"incidentStatus":"open"'),
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
    expect(cli.invocations).toHaveLength(1)
    const query = cli.commands()[0] ?? []
    expect(JSON.parse(bodyOf(cli))).toMatchObject({ incidentStatus: "open", unfinished: true })
    expect(argAfter(query, "--first-result")).toBe("3")
  })

  test("translates lifecycle, business key and active element into the historic query", async () => {
    const { runtime, cli } = fakeRuntime([ROUTE.orderInstances, ROUTE.flaggedInstances])

    await runtime.searchInstances(
      {
        lifecycle: "ended",
        businessKey: "ORD-1003",
        activeElementId: ElementId("Activity_ReviewOrder"),
      },
      { limit: 5 },
    )

    expect(JSON.parse(bodyOf(cli))).toEqual({
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
    const { runtime } = fakeRuntime([ROUTE.orderInstances, ROUTE.flaggedInstances])

    const page = await runtime.searchInstances(
      { bpmnProcessId: BpmnProcessId("pulse-order"), withIncident: false },
      { limit: 10 },
    )

    expect(page.items.map((item) => item.businessKey)).toEqual(["ORD-2001", "ORD-1003", "ORD-1001"])
  })

  test("counts instances with one call that carries the filter of the search", async () => {
    const { runtime, cli } = fakeRuntime([
      { command: ["historic-process-instance", "query-count"], stdout: '{"count":2}' },
    ])

    const count = await runtime.countInstances({
      definitionId: DefinitionId(WORLD_IDS.order1),
      lifecycle: "running",
      withIncident: true,
      businessKey: "ORD-1002",
      activeElementId: ElementId("Activity_ChargePayment"),
    })

    expect(count).toBe(2)
    expect(cli.commands()).toHaveLength(1)
    expect(JSON.parse(bodyOf(cli))).toEqual({
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
        command: ["historic-process-instance", "query-count"],
        when: (_args, input) => input.includes('"incidentStatus":"open"'),
        stdout: '{"count":1}',
      },
      {
        command: ["historic-process-instance", "query-count"],
        when: (_args, input) => !input.includes("incidentStatus"),
        stdout: '{"count":3}',
      },
    ])

    const count = await runtime.countInstances({
      bpmnProcessId: BpmnProcessId("pulse-order"),
      withIncident: false,
    })

    expect(count).toBe(2)
  })

  test("details a parent with the wait states and the root incident of its called instance", async () => {
    const { runtime, cli } = fakeRuntime([ROUTE.inspectDispatch, ROUTE.calledLabelInstance])

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
    expect(cli.commands().filter(([command]) => command === "inspect")).toHaveLength(1)
  })

  test("details a user task wait with the typed variables of every scope", async () => {
    const { runtime, cli } = fakeRuntime([ROUTE.inspectReview, ROUTE.variablesReview])

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
    expect(cli.commands().map(([command]) => command)).toEqual(["inspect", "variable-instance"])
    expect(cli.commands()[1]).toContain("--no-deserialize-values")
  })

  test("details an incident at the failing element of the instance itself", async () => {
    const { runtime, cli } = fakeRuntime([ROUTE.inspectCharge])

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
    expect(cli.commands().filter(([command]) => command === "inspect")).toHaveLength(1)
  })

  test("names the failed external task with its topic and maps the worker wait", async () => {
    const { runtime } = fakeRuntime([ROUTE.inspectExternalTask])

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
    const { runtime } = fakeRuntime([ROUTE.inspectEnded])

    const detail = await runtime.getInstanceDetail(InstanceId(WORLD_IDS.ended))

    expect(detail?.instance.state).toBe("completed")
    expect(detail?.instance.endedAt).toBe("2026-10-21T18:44:04.526Z")
    expect(detail?.waitStates).toEqual([])
    expect(detail?.incidents).toEqual([])
  })

  test("returns undefined for an unknown instance", async () => {
    const { runtime } = fakeRuntime([ROUTE.inspectMissing])

    expect(await runtime.getInstanceDetail(InstanceId("00000000-0000"))).toBeUndefined()
  })

  test("lists root incidents only, each with the version it was raised in", async () => {
    const { runtime, cli } = fakeRuntime([ROUTE.allIncidents, ROUTE.definitionStatistics])

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
    expect(cli.invocations).toHaveLength(2)
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
    const externalTaskIncident = (id: string, configuration: string) =>
      JSON.stringify({
        ...(JSON.parse(fixture("incident-root.json")) as Record<string, unknown>),
        id,
        rootCauseIncidentId: id,
        incidentType: "failedExternalTask",
        configuration,
        incidentMessage: "Customer service is down",
      })
    const { runtime } = fakeRuntime([
      {
        command: ["incident", "get", "with-details"],
        stdout: externalTaskIncident("with-details", "task-1"),
      },
      {
        command: ["incident", "get", "task-gone"],
        stdout: externalTaskIncident("task-gone", "task-2"),
      },
      {
        command: ["external-task", "get-error-details", "task-1"],
        stdout: "java.net.ConnectException: Connection refused\n",
      },
      {
        command: ["external-task", "get-error-details", "task-2"],
        exitCode: 7,
        stderr: compactFixture("error-null-value.json"),
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
  const failingWith = async (stderr: string, exitCode: number): Promise<unknown> => {
    const { runtime } = fakeRuntime([
      { command: ["process-definition", "get-statistics"], exitCode, stderr },
      { command: ["incident", "list"], stdout: "[]" },
    ])
    return runtime.listDefinitions().then(
      () => undefined,
      (error: unknown) => error,
    )
  }

  test.each([
    ["error-unreachable.json", 8, "unreachable"],
    ["error-unauthorized.json", 4, "unauthorized"],
    ["error-routing.json", 5, "misconfigured"],
    ["error-null-value.json", 7, "engineFailure"],
  ])('maps %s to "%s"', async (name, exitCode, failure) => {
    const error = await failingWith(compactFixture(name), exitCode)

    expect(RuntimeError.is(error) && error.failure).toBe(failure)
  })

  test('maps a forbidden request to "forbidden"', async () => {
    const forbidden = JSON.stringify({
      error: { code: "FORBIDDEN", exitCode: 4, message: "HTTP 403 Forbidden", status: 403 },
    })

    const error = await failingWith(forbidden, 4)

    expect(RuntimeError.is(error) && error.failure).toBe("forbidden")
  })

  test('maps output it cannot read to "unexpectedResponse"', async () => {
    const { runtime } = fakeRuntime([
      { command: ["process-definition", "get-statistics"], stdout: '{"not":"a list"}' },
      { command: ["incident", "list"], stdout: "[]" },
    ])

    const error = await runtime.listDefinitions().then(
      () => undefined,
      (failure: unknown) => failure,
    )

    expect(RuntimeError.is(error) && error.failure).toBe("unexpectedResponse")
  })

  test('maps a count without a number to "unexpectedResponse"', async () => {
    const { runtime } = fakeRuntime([
      { command: ["historic-process-instance", "query-count"], stdout: '{"count":"many"}' },
    ])

    const error = await runtime.countInstances({}).then(
      () => undefined,
      (failure: unknown) => failure,
    )

    expect(RuntimeError.is(error) && error.failure).toBe("unexpectedResponse")
  })

  test('maps a missing CLI to "misconfigured"', async () => {
    const error = await failingWith("Error: Cannot find module /opt/pulse/engine-cli.js", 1)

    expect(RuntimeError.is(error) && error.failure).toBe("misconfigured")
  })
})
