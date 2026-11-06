import { describe, expect, test } from "vitest"
import { BpmnProcessId, DefinitionId, IncidentId, InstanceId } from "../../../src/contract/index.js"
import {
  matchingIn,
  page,
  pagedByCursor,
  problem,
  searchOf,
  TOPOLOGY,
  type FakeCamundaRest,
  type RestRoute,
  type SearchBody,
} from "./support/fake-camunda-rest.js"
import {
  runtimeWith,
  definition,
  instance,
  element,
  job,
  ENDED_AT,
} from "./support/runtime-fixture.js"

const ACTIVE_ONLY = '"state":"ACTIVE"'
const OPEN_USER_TASKS = ["CREATING", "CREATED", "ASSIGNING", "UPDATING", "COMPLETING", "CANCELING"]

function about(instanceKey: string, ...parts: readonly string[]) {
  return (body: string) =>
    [`"processInstanceKey":"${instanceKey}"`, ...parts].every((part) => body.includes(part))
}

function searchesOf(camunda: FakeCamundaRest, route: string): SearchBody[] {
  return camunda.bodiesOf(route) as SearchBody[]
}

function variable(name: string, scopeKey: string) {
  return { name, value: '"x"', isTruncated: false, scopeKey, processInstanceKey: "1" }
}

interface Waiting {
  readonly active: readonly unknown[]
  readonly jobs?: unknown
  readonly tasks?: unknown
  readonly subscriptions?: unknown
  readonly incidents?: unknown
}

function aloneWaiting(waiting: Waiting): RestRoute[] {
  return [
    TOPOLOGY,
    { route: "GET /process-instances/1", answer: instance("1") },
    { route: "POST /process-instances/search", answer: page([]) },
    { route: "POST /element-instances/search", answer: pagedByCursor(waiting.active) },
    { route: "POST /jobs/search", answer: waiting.jobs ?? page([]) },
    { route: "POST /user-tasks/search", answer: waiting.tasks ?? page([]) },
    { route: "POST /message-subscriptions/search", answer: waiting.subscriptions ?? page([]) },
    { route: "POST /incidents/search", answer: waiting.incidents ?? page([]) },
    { route: "POST /variables/search", answer: page([]) },
  ]
}

describe("its incidents", () => {
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

  test("name their version from one read per definition", async () => {
    const { camunda, runtime } = runtimeWith([
      TOPOLOGY,
      {
        route: "POST /incidents/search",
        answer: page([INCIDENT, { ...INCIDENT, incidentKey: "8" }]),
      },
      { route: "GET /process-definitions/100", answer: definition("100", "order", 4) },
    ])

    const { items } = await runtime.searchIncidents({}, { limit: 50 })
    await runtime.searchIncidents({}, { limit: 50 })

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
    expect(
      camunda.requests.filter((request) => request.route === "GET /process-definitions/100"),
    ).toHaveLength(1)
  })

  test("skip a row whose definition is gone and page by the search", async () => {
    const { runtime } = runtimeWith([
      TOPOLOGY,
      {
        route: "POST /incidents/search",
        answer: page([INCIDENT], { totalItems: 2, endCursor: "c" }),
      },
      { route: "GET /process-definitions/100", answer: problem(404, "NOT_FOUND", "missing") },
    ])

    const found = await runtime.searchIncidents({}, { limit: 1 })

    expect(found.items).toEqual([])
    expect(found.next).toBe("1:c")
  })

  test("read a definition again after a read that failed", async () => {
    const answers: unknown[] = [
      problem(503, "Service Unavailable", "down"),
      definition("100", "order", 4),
    ]
    const { runtime } = runtimeWith([
      TOPOLOGY,
      { route: "POST /incidents/search", answer: page([INCIDENT]) },
      { route: "GET /process-definitions/100", answer: () => answers.shift() },
    ])

    await expect(runtime.searchIncidents({}, { limit: 50 })).rejects.toMatchObject({
      failure: "engineFailure",
    })
    const { items } = await runtime.searchIncidents({}, { limit: 50 })

    expect(items.map((item) => item.definition.version)).toEqual([4])
  })

  test("filter by process, version and instance", async () => {
    const { camunda, runtime } = runtimeWith([
      TOPOLOGY,
      { route: "POST /incidents/search", answer: page([]) },
    ])

    await runtime.searchIncidents(
      {
        bpmnProcessId: BpmnProcessId("order"),
        definitionId: DefinitionId("100"),
        instanceId: InstanceId("1"),
      },
      { limit: 5 },
    )

    expect(camunda.bodiesOf("POST /incidents/search")[0]).toMatchObject({
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
    })
  })

  test("are none for an impossible key, without a call", async () => {
    const { camunda, runtime } = runtimeWith([TOPOLOGY])

    expect(await runtime.searchIncidents({ instanceId: InstanceId("x") }, { limit: 5 })).toEqual({
      items: [],
    })
    expect(await runtime.getIncidentDetails(IncidentId("x"))).toBeUndefined()
    expect(camunda.requests.map((request) => request.route)).toEqual(["GET /topology"])
  })

  test("name no cause for an empty message", async () => {
    const { runtime } = runtimeWith([
      TOPOLOGY,
      { route: "GET /incidents/7", answer: { ...INCIDENT, errorMessage: " \n " } },
    ])

    const details = await runtime.getIncidentDetails(IncidentId("7"))

    expect(details).toMatchObject({ kind: "errorMessage", truncated: false })
    expect(details).not.toHaveProperty("rootCause")
  })

  test("give their details, and a plain message is its own cause", async () => {
    const { runtime } = runtimeWith([
      TOPOLOGY,
      { route: "GET /incidents/7", answer: { ...INCIDENT, errorMessage: "\n  no card on file  " } },
      { route: "GET /incidents/8", answer: problem(404, "NOT_FOUND", "missing") },
    ])

    expect(await runtime.getIncidentDetails(IncidentId("7"))).toEqual({
      kind: "errorMessage",
      text: "\n  no card on file  ",
      truncated: false,
      rootCause: "no card on file",
      rootCauseLine: 1,
    })
    expect(await runtime.getIncidentDetails(IncidentId("8"))).toBeUndefined()
  })
})

describe("its instance detail", () => {
  const RUNS_OF_THE_ROOT = [
    element("10", "Start", "START_EVENT", { state: "COMPLETED", endDate: ENDED_AT }),
    element("11", "Skipped", "SERVICE_TASK", { state: "TERMINATED", endDate: ENDED_AT }),
    element("12", "Review", "USER_TASK"),
    element("13", "Call", "CALL_ACTIVITY"),
    element("14", "Wait", "INTERMEDIATE_CATCH_EVENT"),
    element("15", "Pay", "RECEIVE_TASK"),
    element("16", "Script", "SCRIPT_TASK"),
    element("17", "Odd", "MANUAL_TASK"),
    element("18", "Bpmn", "PROCESS"),
  ]
  const DETAIL_ROUTES: readonly RestRoute[] = [
    TOPOLOGY,
    { route: "GET /process-instances/1", answer: instance("1", { hasIncident: true }) },
    {
      route: "POST /process-instances/search",
      when: (body) => body.includes('"$in":["1"]'),
      answer: page([
        instance("2", {
          processDefinitionKey: "300",
          processDefinitionId: "label",
          processDefinitionVersion: 3,
          processDefinitionName: "Label",
          parentProcessInstanceKey: "1",
          parentElementInstanceKey: "13",
          hasIncident: true,
        }),
      ]),
    },
    {
      route: "POST /process-instances/search",
      when: (body) => body.includes('"$in":["2"]'),
      answer: page([]),
    },
    {
      route: "POST /element-instances/search",
      when: about("1", ACTIVE_ONLY),
      answer: page(RUNS_OF_THE_ROOT.filter((run) => run.state === "ACTIVE")),
    },
    {
      route: "POST /element-instances/search",
      when: about("1"),
      answer: page(RUNS_OF_THE_ROOT.toReversed()),
    },
    {
      route: "POST /element-instances/search",
      when: about("2", ACTIVE_ONLY),
      answer: page([element("20", "Render", "SERVICE_TASK", { incidentKey: "7" })]),
    },
    {
      route: "POST /jobs/search",
      when: (body) => body.includes('"processInstanceKey":"1"'),
      answer: page([
        { jobKey: "51", type: "done", state: "COMPLETED", elementInstanceKey: "16", retries: 0 },
        {
          jobKey: "52",
          type: "listener",
          state: "CREATED",
          kind: "EXECUTION_LISTENER",
          elementInstanceKey: "16",
        },
        {
          jobKey: "53",
          type: "script",
          state: "CREATED",
          kind: "BPMN_ELEMENT",
          elementInstanceKey: "16",
          retries: 2,
        },
      ]),
    },
    {
      route: "POST /jobs/search",
      when: (body) => body.includes('"processInstanceKey":"2"'),
      answer: page([
        {
          jobKey: "70",
          type: "render-label",
          state: "FAILED",
          kind: "BPMN_ELEMENT",
          elementInstanceKey: "20",
          retries: 0,
        },
      ]),
    },
    {
      route: "POST /user-tasks/search",
      when: (body) => body.includes('"processInstanceKey":"1"'),
      answer: page([
        { elementInstanceKey: "12", assignee: "demo", dueDate: "2026-12-01T00:00:00.000Z" },
      ]),
    },
    { route: "POST /user-tasks/search", answer: page([]) },
    {
      route: "POST /message-subscriptions/search",
      when: (body) => body.includes('"processInstanceKey":"1"'),
      answer: page([
        {
          elementInstanceKey: "15",
          elementId: "Pay",
          messageName: "Paid",
          correlationKey: "ORD-1",
        },
      ]),
    },
    { route: "POST /message-subscriptions/search", answer: page([]) },
    {
      route: "POST /incidents/search",
      answer: page([
        {
          incidentKey: "7",
          processInstanceKey: "2",
          processDefinitionKey: "300",
          elementId: "Render",
          errorType: "JOB_NO_RETRIES",
          errorMessage: "no paper",
          creationTime: "2026-11-05T10:00:00.000Z",
          jobKey: "70",
        },
        {
          incidentKey: "9",
          processInstanceKey: "elsewhere",
          processDefinitionKey: "300",
          elementId: "Render",
          errorType: "JOB_NO_RETRIES",
          errorMessage: "not in this tree",
          creationTime: "2026-11-05T10:00:00.000Z",
        },
      ]),
    },
    {
      route: "POST /variables/search",
      answer: page([
        {
          name: "route",
          value: '"review"',
          isTruncated: false,
          scopeKey: "1",
          processInstanceKey: "1",
        },
        {
          name: "note",
          value: '"local"',
          isTruncated: false,
          scopeKey: "12",
          processInstanceKey: "1",
        },
        { name: "big", value: '"cut', isTruncated: true, scopeKey: "404", processInstanceKey: "1" },
      ]),
    },
    { route: "GET /element-instances/404", answer: problem(404, "NOT_FOUND", "missing") },
    {
      route: "GET /process-definitions/100/xml",
      answer: new Response(
        `<bpmn:definitions>
          <bpmn:intermediateCatchEvent id="Wait"><bpmn:timerEventDefinition /></bpmn:intermediateCatchEvent>
          <bpmn:intermediateCatchEvent id="Stop"><bpmn:signalEventDefinition /></bpmn:intermediateCatchEvent>
        </bpmn:definitions>`,
      ),
    },
  ]

  test("reads the whole tree of a running instance into one view", async () => {
    const { runtime } = runtimeWith(DETAIL_ROUTES)

    const detail = await runtime.getInstanceDetail(InstanceId("1"))

    expect(detail?.instance.hasIncident).toBe(true)
    expect(detail?.truncated).toBe(false)
    expect(
      detail?.path.map((run) => [run.elementId, run.canceled, run.endedAt !== undefined]),
    ).toEqual([
      ["Start", false, true],
      ["Skipped", true, true],
      ["Review", false, false],
      ["Call", false, false],
      ["Wait", false, false],
      ["Pay", false, false],
      ["Script", false, false],
      ["Odd", false, false],
    ])
    expect(detail?.waitStates).toEqual([
      expect.objectContaining({
        instanceId: "1",
        elementId: "Review",
        elementName: "Review name",
        kind: "userTask",
        assignee: "demo",
        dueAt: "2026-12-01T00:00:00.000Z",
      }),
      expect.objectContaining({ elementId: "Wait", kind: "timer" }),
      expect.objectContaining({
        elementId: "Pay",
        kind: "message",
        messageName: "Paid",
        correlationKey: "ORD-1",
      }),
      expect.objectContaining({
        elementId: "Script",
        kind: "workerTask",
        taskType: "script",
        retriesLeft: 2,
      }),
      expect.objectContaining({ elementId: "Odd", kind: "other", description: "MANUAL_TASK" }),
      expect.objectContaining({
        instanceId: "2",
        elementId: "Render",
        kind: "workerTask",
        taskType: "render-label",
        retriesLeft: 0,
        incidentId: "7",
      }),
    ])
    expect(detail?.calledInstances).toEqual([
      {
        id: "2",
        parentInstanceId: "1",
        bpmnProcessId: "label",
        state: "running",
        calledFromElementId: "Call",
      },
    ])
    expect(detail?.incidents).toEqual([
      expect.objectContaining({
        id: "7",
        instanceId: "2",
        definition: { id: "300", bpmnProcessId: "label", version: 3, name: "Label" },
        retriesLeft: 0,
        job: { id: "70", type: "render-label" },
      }),
    ])
    expect(detail?.variables).toEqual([
      {
        name: "route",
        scope: { kind: "instance" },
        valueJson: '"review"',
        truncated: false,
        kind: "string",
      },
      {
        name: "note",
        scope: { kind: "element", elementId: "Review" },
        valueJson: '"local"',
        truncated: false,
        kind: "string",
      },
      {
        name: "big",
        scope: { kind: "instance" },
        valueJson: '"cut',
        truncated: true,
        kind: "string",
      },
    ])
  })

  test("reads the history of the root only, and the waits of the active elements", async () => {
    const { camunda, runtime } = runtimeWith(DETAIL_ROUTES)

    await runtime.getInstanceDetail(InstanceId("1"))

    const elementSearches = searchesOf(camunda, "POST /element-instances/search")
    expect(elementSearches).toHaveLength(3)
    expect(elementSearches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filter: { processInstanceKey: "1" },
          sort: [
            { field: "startDate", order: "DESC" },
            { field: "elementInstanceKey", order: "DESC" },
          ],
        }),
        expect.objectContaining({
          filter: { processInstanceKey: "1", state: "ACTIVE" },
          sort: [
            { field: "startDate", order: "ASC" },
            { field: "elementInstanceKey", order: "ASC" },
          ],
        }),
        expect.objectContaining({ filter: { processInstanceKey: "2", state: "ACTIVE" } }),
      ]),
    )
    const jobSearches = searchesOf(camunda, "POST /jobs/search").map((search) => search.filter)
    expect(jobSearches).toHaveLength(2)
    expect(jobSearches).toEqual(
      expect.arrayContaining([
        {
          processInstanceKey: "1",
          elementInstanceKey: { $in: ["1", "12", "13", "14", "15", "16", "17", "18"] },
        },
        { processInstanceKey: "2", elementInstanceKey: { $in: ["2", "20"] } },
      ]),
    )
    expect(searchesOf(camunda, "POST /user-tasks/search").map((search) => search.filter)).toEqual(
      expect.arrayContaining([
        { processInstanceKey: "1", state: { $in: OPEN_USER_TASKS } },
        { processInstanceKey: "2", state: { $in: OPEN_USER_TASKS } },
      ]),
    )
    expect(
      searchesOf(camunda, "POST /message-subscriptions/search").map((search) => search.filter),
    ).toEqual(
      expect.arrayContaining([
        { processInstanceKey: "1", messageSubscriptionState: { $in: ["CREATED", "MIGRATED"] } },
        { processInstanceKey: "2", messageSubscriptionState: { $in: ["CREATED", "MIGRATED"] } },
      ]),
    )
  })

  test("reads the job an incident names when no active element owns it", async () => {
    const incident = {
      incidentKey: "7",
      processInstanceKey: "1",
      processDefinitionKey: "100",
      elementId: "Charge",
      errorType: "JOB_NO_RETRIES",
      errorMessage: "card declined",
      creationTime: "2026-11-05T10:00:00.000Z",
    }
    const { camunda, runtime } = runtimeWith(
      aloneWaiting({
        active: [],
        jobs: matchingIn([job("70", "10", { type: "charge", state: "FAILED", retries: 0 })]),
        incidents: page([
          { ...incident, jobKey: "70" },
          { ...incident, incidentKey: "8", errorType: "IO_MAPPING_ERROR", errorMessage: null },
        ]),
      }),
    )

    const detail = await runtime.getInstanceDetail(InstanceId("1"))

    expect(detail?.incidents).toEqual([
      expect.objectContaining({ id: "7", retriesLeft: 0, job: { id: "70", type: "charge" } }),
      expect.objectContaining({ id: "8", type: "IO_MAPPING_ERROR", message: "" }),
    ])
    expect(detail?.incidents[1]).not.toHaveProperty("job")
    expect(searchesOf(camunda, "POST /jobs/search").map((search) => search.filter)).toEqual([
      { processInstanceKey: "1", elementInstanceKey: { $in: ["1"] } },
      { jobKey: { $in: ["70"] } },
    ])
  })

  test("says so when it holds only part of the tree", async () => {
    const many = Array.from({ length: 50 }, (_, index) =>
      instance(String(100 + index), { state: "COMPLETED", endDate: "2026-11-05T11:00:00.000Z" }),
    )
    const { runtime } = runtimeWith([
      TOPOLOGY,
      {
        route: "GET /process-instances/1",
        answer: instance("1", { state: "COMPLETED", endDate: "2026-11-05T11:00:00.000Z" }),
      },
      { route: "POST /process-instances/search", answer: page(many) },
      { route: "POST /element-instances/search", answer: page([]) },
      { route: "POST /incidents/search", answer: page([]) },
      { route: "POST /variables/search", answer: page([]) },
    ])

    const detail = await runtime.getInstanceDetail(InstanceId("1"))

    expect(detail?.truncated).toBe(true)
    expect(detail?.waitStates).toEqual([])
    expect(detail?.calledInstances).toHaveLength(50)
  })

  test("reads a catching event it cannot name as other", async () => {
    const { runtime } = runtimeWith([
      TOPOLOGY,
      { route: "GET /process-instances/1", answer: instance("1") },
      { route: "POST /process-instances/search", answer: page([]) },
      {
        route: "POST /element-instances/search",
        answer: page([
          element("10", "Stop", "INTERMEDIATE_CATCH_EVENT"),
          element("11", "Plain", "INTERMEDIATE_CATCH_EVENT"),
        ]),
      },
      { route: "POST /jobs/search", answer: page([]) },
      { route: "POST /user-tasks/search", answer: page([]) },
      { route: "POST /message-subscriptions/search", answer: page([]) },
      { route: "POST /incidents/search", answer: page([]) },
      { route: "POST /variables/search", answer: page([]) },
      {
        route: "GET /process-definitions/100/xml",
        answer: new Response(
          `<bpmn:intermediateCatchEvent id="Stop"><bpmn:signalEventDefinition /></bpmn:intermediateCatchEvent>
           <bpmn:intermediateCatchEvent id="Plain"><bpmn:linkEventDefinition /></bpmn:intermediateCatchEvent>`,
        ),
      },
    ])

    const detail = await runtime.getInstanceDetail(InstanceId("1"))

    expect(detail?.waitStates.map((wait) => [wait.elementId, wait.kind])).toEqual([
      ["Stop", "signal"],
      ["Plain", "other"],
    ])
  })

  test("is undefined for an unknown instance and for free text, without a call for free text", async () => {
    const { camunda, runtime } = runtimeWith([
      TOPOLOGY,
      { route: "GET /process-instances/999", answer: problem(404, "NOT_FOUND", "missing") },
    ])

    expect(await runtime.getInstanceDetail(InstanceId("999"))).toBeUndefined()
    expect(await runtime.getInstanceDetail(InstanceId("ORD-1001"))).toBeUndefined()
    expect(camunda.requests.map((request) => request.route)).toEqual([
      "GET /topology",
      "GET /process-instances/999",
    ])
  })
})

describe("its wait states", () => {
  test("take a listener job when the element has no job of its own, on a container too", async () => {
    const { runtime } = runtimeWith(
      aloneWaiting({
        active: [
          element("10", "Charge", "SERVICE_TASK"),
          element("11", "Ship", "SUB_PROCESS", { incidentKey: "8" }),
          element("12", "Pack", "SUB_PROCESS"),
          element("13", "Legacy", "SERVICE_TASK"),
        ],
        jobs: page([
          job("50", "10", { type: "audit-start", kind: "EXECUTION_LISTENER" }),
          job("51", "11", {
            type: "notify-end",
            kind: "EXECUTION_LISTENER",
            state: "FAILED",
            retries: 0,
          }),
          job("52", "12", { kind: "EXECUTION_LISTENER", state: "COMPLETED" }),
          job("53", "13", { type: "legacy-listener", kind: "EXECUTION_LISTENER" }),
          { jobKey: "54", type: "legacy", state: "CREATED", elementInstanceKey: "13", retries: 1 },
        ]),
      }),
    )

    const detail = await runtime.getInstanceDetail(InstanceId("1"))

    expect(detail?.waitStates).toEqual([
      expect.objectContaining({
        elementId: "Charge",
        kind: "workerTask",
        taskType: "audit-start",
        retriesLeft: 3,
      }),
      expect.objectContaining({
        elementId: "Ship",
        kind: "workerTask",
        taskType: "notify-end",
        retriesLeft: 0,
        incidentId: "8",
      }),
      expect.objectContaining({
        elementId: "Legacy",
        kind: "workerTask",
        taskType: "legacy",
        retriesLeft: 1,
      }),
    ])
  })

  test("take the job of an ad-hoc sub-process before a listener job", async () => {
    const { runtime } = runtimeWith(
      aloneWaiting({
        active: [
          element("10", "Agent", "AD_HOC_SUB_PROCESS", { incidentKey: "9" }),
          element("11", "Agent", "AD_HOC_SUB_PROCESS_INNER_INSTANCE"),
        ],
        jobs: page([
          job("50", "10", { type: "agent-listener", kind: "EXECUTION_LISTENER" }),
          job("51", "10", {
            type: "ai-agent",
            kind: "AD_HOC_SUB_PROCESS",
            state: "FAILED",
            retries: 0,
          }),
        ]),
      }),
    )

    const detail = await runtime.getInstanceDetail(InstanceId("1"))

    expect(detail?.waitStates).toEqual([
      expect.objectContaining({
        elementId: "Agent",
        kind: "workerTask",
        taskType: "ai-agent",
        retriesLeft: 0,
        incidentId: "9",
      }),
    ])
  })

  test("read a user task in a transitional state as a user task", async () => {
    const { camunda, runtime } = runtimeWith(
      aloneWaiting({
        active: [element("10", "Review", "USER_TASK")],
        jobs: page([job("50", "10", { type: "assign-check", kind: "TASK_LISTENER" })]),
        tasks: (body: string) =>
          page(
            body.includes('"ASSIGNING"') ? [{ elementInstanceKey: "10", assignee: "demo" }] : [],
          ),
      }),
    )

    const detail = await runtime.getInstanceDetail(InstanceId("1"))

    expect(detail?.waitStates).toEqual([
      expect.objectContaining({ elementId: "Review", kind: "userTask", assignee: "demo" }),
    ])
    expect(searchesOf(camunda, "POST /user-tasks/search").map((search) => search.filter)).toEqual([
      { processInstanceKey: "1", state: { $in: OPEN_USER_TASKS } },
    ])
  })

  test("read a migrated message subscription as the message it waits for", async () => {
    const { runtime } = runtimeWith(
      aloneWaiting({
        active: [element("10", "AwaitPayment", "INTERMEDIATE_CATCH_EVENT")],
        subscriptions: (body: string) =>
          page(
            body.includes('"MIGRATED"')
              ? [
                  {
                    elementInstanceKey: "10",
                    elementId: "AwaitPayment",
                    messageName: "Payment received",
                    correlationKey: "ORD-1",
                  },
                ]
              : [],
          ),
      }),
    )

    const detail = await runtime.getInstanceDetail(InstanceId("1"))

    expect(detail?.waitStates).toEqual([
      expect.objectContaining({
        elementId: "AwaitPayment",
        kind: "message",
        messageName: "Payment received",
        correlationKey: "ORD-1",
      }),
    ])
  })

  test("read a catching event as other when its diagram is gone", async () => {
    const { runtime } = runtimeWith([
      ...aloneWaiting({ active: [element("10", "Wait", "INTERMEDIATE_CATCH_EVENT")] }),
      {
        route: "GET /process-definitions/100/xml",
        answer: problem(404, "NOT_FOUND", "The process definition is gone."),
      },
    ])

    const detail = await runtime.getInstanceDetail(InstanceId("1"))

    expect(detail?.waitStates).toEqual([
      expect.objectContaining({
        elementId: "Wait",
        kind: "other",
        description: "INTERMEDIATE_CATCH_EVENT",
      }),
    ])
  })

  test("ask for the jobs of many active elements a thousand keys at a time", async () => {
    const active = Array.from({ length: 1001 }, (_, index) =>
      element(String(10_000 + index), `Task_${String(index)}`, "SERVICE_TASK"),
    )
    const { camunda, runtime } = runtimeWith(
      aloneWaiting({
        active,
        jobs: matchingIn(
          active.map((each) => job(`${each.elementInstanceKey}0`, each.elementInstanceKey)),
        ),
      }),
    )

    const detail = await runtime.getInstanceDetail(InstanceId("1"))

    expect(detail?.waitStates).toHaveLength(1001)
    expect(detail?.waitStates.every((wait) => wait.kind === "workerTask")).toBe(true)
    expect(detail?.truncated).toBe(false)
    expect(
      searchesOf(camunda, "POST /jobs/search")
        .map(
          (search) => (search.filter.elementInstanceKey as { readonly $in: string[] }).$in.length,
        )
        .toSorted((left, right) => left - right),
    ).toEqual([2, 1000])
  })

  test("wait at the process for a start listener job on the process itself", async () => {
    const { camunda, runtime } = runtimeWith(
      aloneWaiting({
        active: [],
        jobs: matchingIn([
          job("50", "1", {
            type: "audit-before",
            kind: "EXECUTION_LISTENER",
            listenerEventType: "START",
            state: "COMPLETED",
          }),
          job("51", "1", {
            type: "audit",
            kind: "EXECUTION_LISTENER",
            listenerEventType: "START",
            creationTime: "2026-11-05T10:00:00.500Z",
          }),
        ]),
      }),
    )

    const detail = await runtime.getInstanceDetail(InstanceId("1"))

    expect(detail?.waitStates).toEqual([
      {
        instanceId: "1",
        elementId: "order",
        elementName: "Order",
        kind: "workerTask",
        taskType: "audit",
        retriesLeft: 3,
        since: "2026-11-05T10:00:00.500Z",
      },
    ])
    expect(detail?.path).toEqual([])
    expect(searchesOf(camunda, "POST /jobs/search").map((search) => search.filter)).toEqual([
      { processInstanceKey: "1", elementInstanceKey: { $in: ["1"] } },
    ])
  })

  test("wait at the process for its failed end listener, with the incident", async () => {
    const { camunda, runtime } = runtimeWith(
      aloneWaiting({
        active: [],
        jobs: matchingIn([
          job("60", "1", {
            type: "notify-end",
            kind: "EXECUTION_LISTENER",
            listenerEventType: "END",
            state: "FAILED",
            retries: 0,
          }),
        ]),
        incidents: page([
          {
            incidentKey: "9",
            processInstanceKey: "1",
            processDefinitionKey: "100",
            elementId: "order",
            elementInstanceKey: "1",
            errorType: "EXECUTION_LISTENER_NO_RETRIES",
            errorMessage: "the notifier is down",
            creationTime: "2026-11-05T10:05:00.000Z",
            jobKey: "60",
          },
        ]),
      }),
    )

    const detail = await runtime.getInstanceDetail(InstanceId("1"))

    expect(detail?.waitStates).toEqual([
      {
        instanceId: "1",
        elementId: "order",
        elementName: "Order",
        kind: "workerTask",
        taskType: "notify-end",
        retriesLeft: 0,
        incidentId: "9",
      },
    ])
    expect(detail?.incidents).toEqual([
      expect.objectContaining({ id: "9", retriesLeft: 0, job: { id: "60", type: "notify-end" } }),
    ])
    expect(searchesOf(camunda, "POST /jobs/search")).toHaveLength(1)
  })

  test("wait at a container that holds an incident of its own and no job", async () => {
    const { runtime } = runtimeWith(
      aloneWaiting({
        active: [
          element("10", "Notify", "MULTI_INSTANCE_BODY", { incidentKey: "7" }),
          element("11", "Label", "CALL_ACTIVITY", { incidentKey: "8" }),
          element("12", "Prepare", "SUB_PROCESS", { incidentKey: "9" }),
          element("13", "Ship", "SUB_PROCESS", { hasIncident: true }),
          element("14", "Pack", "SERVICE_TASK", { incidentKey: "10" }),
        ],
        jobs: matchingIn([job("70", "14", { type: "pack", state: "FAILED", retries: 0 })]),
        subscriptions: page([
          {
            elementInstanceKey: "12",
            elementId: "PrepareCanceled",
            messageName: "Order canceled",
          },
        ]),
        incidents: page([
          {
            incidentKey: "9",
            processInstanceKey: "1",
            processDefinitionKey: "100",
            elementId: "Prepare",
            elementInstanceKey: "12",
            errorType: "IO_MAPPING_ERROR",
            errorMessage: "no variable found with name 'address'",
            creationTime: "2026-11-05T10:00:00.000Z",
          },
        ]),
      }),
    )

    const detail = await runtime.getInstanceDetail(InstanceId("1"))

    expect(detail?.waitStates.map((wait) => [wait.elementId, wait.kind, wait.incidentId])).toEqual([
      ["Notify", "other", "7"],
      ["Label", "other", "8"],
      ["Prepare", "other", "9"],
      ["Pack", "workerTask", "10"],
    ])
    expect(detail?.waitStates[2]).toMatchObject({ description: "SUB_PROCESS" })
    expect(detail?.incidents).toEqual([
      expect.objectContaining({ id: "9", elementId: "Prepare", type: "IO_MAPPING_ERROR" }),
    ])
  })

  test("take only an element's own message subscription, never one of its boundary events", async () => {
    const { camunda, runtime } = runtimeWith([
      ...aloneWaiting({
        active: [
          element("10", "AwaitPayment", "RECEIVE_TASK"),
          element("11", "Charge", "SERVICE_TASK", { incidentKey: "7" }),
        ],
        jobs: matchingIn([job("50", "11", { type: "charge", state: "ERROR_THROWN", retries: 0 })]),
        subscriptions: page([
          {
            elementInstanceKey: "10",
            elementId: "PaymentCanceled",
            messageName: "Order canceled",
            correlationKey: "ORD-1",
          },
          {
            elementInstanceKey: "10",
            elementId: "AwaitPayment",
            messageName: "Payment received",
            correlationKey: "ORD-1",
          },
          {
            elementInstanceKey: "11",
            elementId: "ChargeCanceled",
            messageName: "Order canceled",
            correlationKey: "ORD-1",
          },
        ]),
      }),
      {
        route: "GET /process-definitions/100/xml",
        answer: new Response(
          `<bpmn:receiveTask id="AwaitPayment" messageRef="Paid" />
           <bpmn:serviceTask id="Charge" />`,
        ),
      },
    ])

    const detail = await runtime.getInstanceDetail(InstanceId("1"))

    expect(detail?.waitStates).toEqual([
      expect.objectContaining({
        elementId: "AwaitPayment",
        kind: "message",
        messageName: "Payment received",
        correlationKey: "ORD-1",
      }),
      expect.objectContaining({
        elementId: "Charge",
        kind: "other",
        description: "SERVICE_TASK",
        incidentId: "7",
      }),
    ])
    expect(searchesOf(camunda, "POST /message-subscriptions/search")[0]?.sort).toEqual([
      { field: "messageSubscriptionKey", order: "ASC" },
    ])
  })

  test("read an event-based gateway as the message of the first event after it", async () => {
    const { runtime } = runtimeWith(
      aloneWaiting({
        active: [element("10", "Choose", "EVENT_BASED_GATEWAY")],
        subscriptions: page([
          { elementInstanceKey: "10", elementId: "Paid", messageName: "Payment received" },
          { elementInstanceKey: "10", elementId: "Canceled", messageName: "Order canceled" },
        ]),
      }),
    )

    const detail = await runtime.getInstanceDetail(InstanceId("1"))

    expect(detail?.waitStates).toEqual([
      expect.objectContaining({
        elementId: "Choose",
        kind: "message",
        messageName: "Payment received",
      }),
    ])
  })
})

describe("its called tree", () => {
  function calledInstance(key: number, parentKey: string) {
    return {
      ...instance(String(key), { state: "COMPLETED", endDate: ENDED_AT }),
      parentProcessInstanceKey: parentKey,
    }
  }

  function calledBelow(parentKey: string, count: number, firstKey: number) {
    return Array.from({ length: count }, (_, index) => calledInstance(firstKey + index, parentKey))
  }

  function treeOf(called: readonly ReturnType<typeof calledInstance>[]) {
    return runtimeWith([
      TOPOLOGY,
      {
        route: "GET /process-instances/1",
        answer: instance("1", { state: "COMPLETED", endDate: ENDED_AT }),
      },
      {
        route: "POST /process-instances/search",
        answer: (body: string) => {
          const search = searchOf(body)
          const parents = (search.filter.parentProcessInstanceKey as { readonly $in: string[] }).$in
          const children = called.filter((child) =>
            parents.includes(child.parentProcessInstanceKey),
          )
          return page(children.slice(0, search.page.limit), { totalItems: children.length })
        },
      },
      { route: "POST /element-instances/search", answer: page([]) },
      { route: "POST /incidents/search", answer: page([]) },
      { route: "POST /variables/search", answer: page([]) },
    ])
  }

  function limitsOf(camunda: FakeCamundaRest): number[] {
    return searchesOf(camunda, "POST /process-instances/search").map((search) => search.page.limit)
  }

  test("is complete with exactly 50 called instances", async () => {
    const { camunda, runtime } = treeOf(calledBelow("1", 50, 100))

    const detail = await runtime.getInstanceDetail(InstanceId("1"))

    expect(detail?.calledInstances).toHaveLength(50)
    expect(detail?.truncated).toBe(false)
    expect(limitsOf(camunda)).toEqual([51, 1])
  })

  test("is complete with 50 called instances over two levels", async () => {
    const { camunda, runtime } = treeOf([
      ...calledBelow("1", 30, 100),
      ...calledBelow("105", 20, 200),
    ])

    const detail = await runtime.getInstanceDetail(InstanceId("1"))

    expect(detail?.calledInstances).toHaveLength(50)
    expect(detail?.truncated).toBe(false)
    expect(limitsOf(camunda)).toEqual([51, 21, 1])
  })

  test("keeps 50 of 51 called instances and says so", async () => {
    const { camunda, runtime } = treeOf(calledBelow("1", 51, 100))

    const detail = await runtime.getInstanceDetail(InstanceId("1"))

    expect(detail?.calledInstances).toHaveLength(50)
    expect(detail?.truncated).toBe(true)
    expect(limitsOf(camunda)).toEqual([51])
  })

  test("asks a level below 30 called instances for the 20 that fit, and one more", async () => {
    const { camunda, runtime } = treeOf([
      ...calledBelow("1", 30, 100),
      ...calledBelow("105", 50, 200),
    ])

    const detail = await runtime.getInstanceDetail(InstanceId("1"))

    expect(detail?.calledInstances).toHaveLength(50)
    expect(detail?.calledInstances.at(-1)).toMatchObject({ id: "219", parentInstanceId: "105" })
    expect(detail?.truncated).toBe(true)
    expect(limitsOf(camunda)).toEqual([51, 21])
  })

  test("is read eight running instances at a time", async () => {
    const children = Array.from({ length: 20 }, (_, index) =>
      instance(String(200 + index), { parentProcessInstanceKey: "1" }),
    )
    const reading = { now: 0, most: 0 }
    const { runtime } = runtimeWith([
      TOPOLOGY,
      { route: "GET /process-instances/1", answer: instance("1") },
      {
        route: "POST /process-instances/search",
        when: (body) => body.includes('"$in":["1"]'),
        answer: page(children),
      },
      { route: "POST /process-instances/search", answer: page([]) },
      {
        route: "POST /element-instances/search",
        when: (body) => body.includes(ACTIVE_ONLY),
        answer: async () => {
          reading.now += 1
          reading.most = Math.max(reading.most, reading.now)
          await new Promise((resolve) => setTimeout(resolve, 5))
          reading.now -= 1
          return page([])
        },
      },
      { route: "POST /element-instances/search", answer: page([]) },
      { route: "POST /jobs/search", answer: page([]) },
      { route: "POST /user-tasks/search", answer: page([]) },
      { route: "POST /message-subscriptions/search", answer: page([]) },
      { route: "POST /incidents/search", answer: page([]) },
      { route: "POST /variables/search", answer: page([]) },
    ])

    const detail = await runtime.getInstanceDetail(InstanceId("1"))

    expect(detail?.calledInstances).toHaveLength(20)
    expect(reading.most).toBe(8)
  })

  test("reads no further instance once a read failed", async () => {
    const children = Array.from({ length: 20 }, (_, index) =>
      instance(String(200 + index), { parentProcessInstanceKey: "1" }),
    )
    const { camunda, runtime } = runtimeWith([
      TOPOLOGY,
      { route: "GET /process-instances/1", answer: instance("1") },
      {
        route: "POST /process-instances/search",
        when: (body) => body.includes('"$in":["1"]'),
        answer: page(children),
      },
      { route: "POST /process-instances/search", answer: page([]) },
      {
        route: "POST /element-instances/search",
        when: about("205", ACTIVE_ONLY),
        answer: problem(500, "Internal Server Error", "the search failed"),
      },
      {
        route: "POST /element-instances/search",
        when: (body) => body.includes(ACTIVE_ONLY),
        answer: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5))
          return page([])
        },
      },
      { route: "POST /element-instances/search", answer: page([]) },
      { route: "POST /jobs/search", answer: page([]) },
      { route: "POST /user-tasks/search", answer: page([]) },
      { route: "POST /message-subscriptions/search", answer: page([]) },
      { route: "POST /incidents/search", answer: page([]) },
      { route: "POST /variables/search", answer: page([]) },
    ])

    await expect(runtime.getInstanceDetail(InstanceId("1"))).rejects.toMatchObject({
      failure: "engineFailure",
    })
    await new Promise((resolve) => setTimeout(resolve, 30))

    const activeSearches = searchesOf(camunda, "POST /element-instances/search").filter(
      (search) => search.filter.state === "ACTIVE",
    )
    expect(activeSearches).toHaveLength(8)
  })
})

describe("its long history", () => {
  const FIRST_START = Date.parse("2026-11-01T00:00:00.000Z")
  const TIMER_XML =
    '<bpmn:intermediateCatchEvent id="Tick"><bpmn:timerEventDefinition /></bpmn:intermediateCatchEvent>'

  function startOf(index: number): string {
    return new Date(FIRST_START + index * 1000).toISOString()
  }

  function pollKey(index: number): string {
    return String(100_001 + index)
  }

  function poll(index: number) {
    return element(pollKey(index), "Poll", "SERVICE_TASK", {
      state: "COMPLETED",
      startDate: startOf(index + 1),
      endDate: startOf(index + 1),
    })
  }

  function lookedUp(camunda: FakeCamundaRest): string[] {
    const prefix = "GET /element-instances/"
    return camunda.requests
      .filter((request) => request.route.startsWith(prefix))
      .map((request) => request.route.slice(prefix.length))
  }

  function historyOf(
    count: number,
    variables?: readonly unknown[],
    lookups: readonly RestRoute[] = [],
  ) {
    const review = element("100000", "Review", "USER_TASK", { startDate: startOf(0) })
    const polls = Array.from({ length: count - 2 }, (_, index) => poll(index))
    const tick = element(String(100_000 + count - 1), "Tick", "INTERMEDIATE_CATCH_EVENT", {
      startDate: startOf(count - 1),
    })
    return runtimeWith([
      TOPOLOGY,
      { route: "GET /process-instances/1", answer: instance("1") },
      { route: "POST /process-instances/search", answer: page([]) },
      {
        route: "POST /element-instances/search",
        when: (body) => body.includes(ACTIVE_ONLY),
        answer: page([review, tick]),
      },
      {
        route: "POST /element-instances/search",
        answer: pagedByCursor([review, ...polls, tick].toReversed()),
      },
      { route: "POST /jobs/search", answer: page([]) },
      {
        route: "POST /user-tasks/search",
        answer: page([{ elementInstanceKey: "100000", assignee: "demo" }]),
      },
      { route: "POST /message-subscriptions/search", answer: page([]) },
      { route: "POST /incidents/search", answer: page([]) },
      {
        route: "POST /variables/search",
        answer: page(
          variables ?? [variable("note", "100000"), variable("attempt", tick.elementInstanceKey)],
        ),
      },
      { route: "GET /process-definitions/100/xml", answer: new Response(TIMER_XML) },
      ...lookups,
    ])
  }

  function historyLimitsOf(camunda: FakeCamundaRest): number[] {
    return searchesOf(camunda, "POST /element-instances/search")
      .filter((search) => !("state" in search.filter))
      .map((search) => search.page.limit)
  }

  const TWENTY_PAGES = [...Array.from({ length: 19 }, () => 500), 501]

  test("keeps the waits and the newest 10,000 runs of a longer one, and says so", async () => {
    const { camunda, runtime } = historyOf(10_500)

    const detail = await runtime.getInstanceDetail(InstanceId("1"))

    expect(detail?.waitStates.map((wait) => [wait.elementId, wait.kind])).toEqual([
      ["Review", "userTask"],
      ["Tick", "timer"],
    ])
    expect(detail?.truncated).toBe(true)
    expect(detail?.path).toHaveLength(10_000)
    expect(detail?.path.at(0)).toMatchObject({ elementId: "Poll", startedAt: startOf(500) })
    expect(detail?.path.at(-1)).toMatchObject({ elementId: "Tick", startedAt: startOf(10_499) })
    expect(detail?.path.at(-1)?.endedAt).toBeUndefined()
    expect(detail?.variables.map((each) => each.scope)).toEqual([
      { kind: "element", elementId: "Review" },
      { kind: "element", elementId: "Tick" },
    ])
    expect(historyLimitsOf(camunda)).toEqual(TWENTY_PAGES)
  })

  test("holds exactly 10,000 runs completely", async () => {
    const { camunda, runtime } = historyOf(10_000)

    const detail = await runtime.getInstanceDetail(InstanceId("1"))

    expect(detail?.truncated).toBe(false)
    expect(detail?.path).toHaveLength(10_000)
    expect(detail?.path.at(0)).toMatchObject({ elementId: "Review", startedAt: startOf(0) })
    expect(historyLimitsOf(camunda)).toEqual(TWENTY_PAGES)
  })

  test("looks up the element of a local variable on a run past the cut, and only there", async () => {
    const { camunda, runtime } = historyOf(
      10_500,
      [
        variable("orderId", "1"),
        variable("attempt", pollKey(0)),
        variable("attempt", pollKey(1)),
        variable("lastAttempt", pollKey(1)),
        variable("attempt", pollKey(498)),
        variable("attempt", pollKey(499)),
        variable("note", "100000"),
      ],
      [0, 1, 498].map((index) => ({
        route: `GET /element-instances/${pollKey(index)}`,
        answer: poll(index),
      })),
    )

    const detail = await runtime.getInstanceDetail(InstanceId("1"))

    expect(detail?.variables.map((each) => [each.name, each.scope])).toEqual([
      ["orderId", { kind: "instance" }],
      ["attempt", { kind: "element", elementId: "Poll" }],
      ["attempt", { kind: "element", elementId: "Poll" }],
      ["lastAttempt", { kind: "element", elementId: "Poll" }],
      ["attempt", { kind: "element", elementId: "Poll" }],
      ["attempt", { kind: "element", elementId: "Poll" }],
      ["note", { kind: "element", elementId: "Review" }],
    ])
    expect(lookedUp(camunda).toSorted()).toEqual([pollKey(0), pollKey(1), pollKey(498)])
    expect(detail?.path).toHaveLength(10_000)
    expect(detail?.truncated).toBe(true)
  })

  test("looks the element of a past run up once, not again on the next read", async () => {
    const { camunda, runtime } = historyOf(
      10_500,
      [variable("attempt", pollKey(0)), variable("attempt", pollKey(1))],
      [0, 1].map((index) => ({
        route: `GET /element-instances/${pollKey(index)}`,
        answer: poll(index),
      })),
    )

    await runtime.getInstanceDetail(InstanceId("1"))
    const again = await runtime.getInstanceDetail(InstanceId("1"))

    expect(again?.variables.map((each) => each.scope)).toEqual([
      { kind: "element", elementId: "Poll" },
      { kind: "element", elementId: "Poll" },
    ])
    expect(lookedUp(camunda).toSorted()).toEqual([pollKey(0), pollKey(1)])
  })

  test("keeps the element of every local variable of the oldest runs, eight lookups at a time", async () => {
    const reading = { now: 0, most: 0 }
    const lookups = Array.from({ length: 499 }, (_, index) => ({
      route: `GET /element-instances/${pollKey(index)}`,
      answer: async () => {
        reading.now += 1
        reading.most = Math.max(reading.most, reading.now)
        await new Promise((resolve) => setTimeout(resolve, 5))
        reading.now -= 1
        return poll(index)
      },
    }))
    const { camunda, runtime } = historyOf(
      10_500,
      Array.from({ length: 1000 }, (_, index) => variable("attempt", pollKey(index))),
      lookups,
    )

    const detail = await runtime.getInstanceDetail(InstanceId("1"))

    expect(detail?.variables.map((each) => each.scope)).toEqual(
      Array.from({ length: 1000 }, () => ({ kind: "element", elementId: "Poll" })),
    )
    expect(lookedUp(camunda)).toHaveLength(499)
    expect(reading.most).toBe(8)
    expect(detail?.truncated).toBe(true)
  })
})
