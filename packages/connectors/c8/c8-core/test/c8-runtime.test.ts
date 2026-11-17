import {
  BpmnProcessId,
  DefinitionId,
  IncidentId,
  InstanceId,
  IsoTimestamp,
  type ProcessRuntime,
} from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { C8Runtime } from "../src/c8-runtime.js"
import type { C8WordsOf } from "../src/c8-failures.js"
import {
  failed,
  FakeCamundaRest,
  page,
  problem,
  type RestRoute,
  TOPOLOGY,
} from "./support/fake-transport.js"
import { definition, incident, instance, variable } from "./support/rows.js"

const MISSING = problem(404, "NOT_FOUND", "Nothing has this key.")
const STACK_TRACE = [
  "io.camunda.WorkerException: payment failed",
  "Caused by: java.net.SocketTimeoutException: Read timed out",
].join("\n")

const IN_ITS_OWN_WORDS: C8WordsOf = (error, kind) => ({ message: `${kind}: ${String(error)}` })

function runtimeWith(routes: readonly RestRoute[], wordsOf = IN_ITS_OWN_WORDS) {
  const camunda = new FakeCamundaRest(routes)
  const runtime: ProcessRuntime = C8Runtime.over(camunda, { wordsOf })
  return { camunda, runtime }
}

function routesOf(camunda: FakeCamundaRest): string[] {
  return camunda.requests.map((request) => request.route)
}

describe("the C8 runtime", () => {
  test("describes itself as Camunda 8 by the cluster's version, read once for every question", async () => {
    const { camunda, runtime } = runtimeWith([
      TOPOLOGY,
      { route: "POST /incidents/search", answer: page([]) },
    ])

    expect(await runtime.describeEngine()).toEqual({ product: "Camunda 8", version: "8.10.8" })
    expect(await runtime.searchIncidents({}, { limit: 10 })).toEqual({ items: [] })
    await runtime.describeEngine()

    expect(routesOf(camunda)).toEqual(["GET /topology", "POST /incidents/search"])
  })

  test("refuses every question on a cluster below the version it reads, asking nothing else", async () => {
    const { camunda, runtime } = runtimeWith([
      { route: "GET /topology", answer: { gatewayVersion: "8.8.45" } },
    ])

    await expect(runtime.listDefinitions()).rejects.toMatchObject({
      name: "RuntimeError",
      failure: "misconfigured",
      message: "Pulse reads Camunda 8.9 or newer. This cluster runs 8.8.45.",
    })
    expect(routesOf(camunda)).toEqual(["GET /topology"])
  })

  test("names the REST root when the url is wrong, and asks again on the next question", async () => {
    const { camunda, runtime } = runtimeWith([])

    await expect(runtime.listDefinitions()).rejects.toMatchObject({
      failure: "misconfigured",
      hint: "The profile's url must be the REST root of the cluster and end in /v2.",
    })
    await expect(runtime.describeEngine()).rejects.toMatchObject({ failure: "misconfigured" })

    expect(routesOf(camunda)).toEqual(["GET /topology", "GET /topology"])
  })

  test.each([
    { status: 401, redirect: false, failure: "unauthorized" },
    { status: 403, redirect: false, failure: "forbidden" },
    { status: 302, redirect: true, failure: "misconfigured" },
    { status: 400, redirect: false, failure: "engineFailure" },
    { status: 503, redirect: false, failure: "engineFailure" },
  ])("words HTTP $status of a question as $failure", async ({ status, redirect, failure }) => {
    const { runtime } = runtimeWith([
      TOPOLOGY,
      {
        route: "POST /process-instances/search",
        answer: failed({ kind: "answered", status, title: undefined, detail: undefined, redirect }),
      },
    ])

    await expect(runtime.countInstances({})).rejects.toMatchObject({
      name: "RuntimeError",
      failure,
      message: `${failure}: FailedRequest: the transport failed: answered`,
    })
  })

  test("words a cluster that does not answer as unreachable, in the surface's words", async () => {
    const { runtime } = runtimeWith([
      {
        route: "GET /topology",
        answer: failed({ kind: "transport", reason: "unreachable", code: "ECONNREFUSED" }),
      },
    ])

    await expect(runtime.describeEngine()).rejects.toMatchObject({
      failure: "unreachable",
      message: "unreachable: FailedRequest: the transport failed: transport",
    })
  })
})

describe("what the C8 runtime refuses", () => {
  test("declares ordering and date conditions refused and fails them before searching", async () => {
    const { camunda, runtime } = runtimeWith([TOPOLOGY])
    const after = IsoTimestamp("2026-11-05T10:00:00.000Z")

    expect(runtime.refusedVariableConditions?.()).toEqual(["ordering", "date"])
    await expect(
      runtime.searchInstances(
        { variables: [{ name: "amount", operator: "greaterThan", valueJson: "42" }] },
        { limit: 10 },
      ),
    ).rejects.toMatchObject({ name: "RuntimeError", failure: "unsupported" })
    await expect(
      runtime.countInstances({ variables: [{ name: "due", operator: "lessThan", at: after }] }),
    ).rejects.toMatchObject({ failure: "unsupported" })

    expect(routesOf(camunda)).toEqual(["GET /topology"])
  })

  test("plans no migration, knows no bulk operation and asks nothing for either", async () => {
    const { camunda, runtime } = runtimeWith([])

    expect("proposeMigration" in runtime).toBe(false)
    expect("checkMigration" in runtime).toBe(false)
    expect(await runtime.getBulkOperation(undefined as never)).toBeUndefined()
    expect(await runtime.getBulkFailures(undefined as never)).toEqual([])
    expect(camunda.requests).toEqual([])
  })
})

describe("the questions of the C8 runtime", () => {
  test("list the processes with the counts of all their versions", async () => {
    const { runtime } = runtimeWith([
      TOPOLOGY,
      { route: "POST /process-definitions/search", answer: page([definition("100", "order", 1)]) },
      {
        route: "POST /process-definitions/statistics/process-instances",
        answer: {
          items: [
            {
              processDefinitionId: "order",
              activeInstancesWithoutIncidentCount: 3,
              activeInstancesWithIncidentCount: 1,
            },
          ],
        },
      },
    ])

    expect(await runtime.listDefinitions()).toEqual([
      {
        latest: { id: "100", bpmnProcessId: "order", version: 1, name: "order name" },
        running: 4,
        withIncident: 1,
      },
    ])
  })

  test("list the versions of a process with their counts", async () => {
    const { runtime } = runtimeWith([
      TOPOLOGY,
      { route: "POST /process-definitions/search", answer: page([definition("100", "order", 1)]) },
      {
        route: "POST /process-definitions/statistics/process-instances-by-version",
        answer: { items: [] },
      },
    ])

    expect(await runtime.listVersions(BpmnProcessId("order"))).toEqual([
      {
        definition: { id: "100", bpmnProcessId: "order", version: 1, name: "order name" },
        running: 0,
        withIncident: 0,
      },
    ])
  })

  test("read a diagram once for its XML, its statistics and its calls", async () => {
    const xml = `<bpmn:definitions><bpmn:serviceTask id="Charge" /></bpmn:definitions>`
    const { camunda, runtime } = runtimeWith([
      TOPOLOGY,
      { route: "GET /process-definitions/100/xml", answer: xml },
      {
        route: "POST /process-definitions/100/statistics/element-instances",
        answer: { items: [{ elementId: "Charge", active: 2, incidents: 0 }] },
      },
    ])
    const id = DefinitionId("100")

    expect(await runtime.getDiagramXml(id)).toBe(xml)
    expect(await runtime.getElementStatistics(id)).toEqual([
      { elementId: "Charge", active: 2, incidents: 0, incidentsInCalledInstances: 0 },
    ])
    expect(await runtime.getCalledProcesses(id)).toEqual([])
    expect(routesOf(camunda).filter((route) => route.endsWith("/xml"))).toHaveLength(1)
  })

  test("count instances, a capped count as a lower bound, and page them by the cluster's cursor", async () => {
    const { runtime } = runtimeWith([
      TOPOLOGY,
      {
        route: "POST /process-instances/search",
        when: (body) => body.includes('"limit":0'),
        answer: page([], { totalItems: 10_000, hasMoreTotalItems: true }),
      },
      {
        route: "POST /process-instances/search",
        answer: page([instance("200")], { totalItems: 2, endCursor: "c1" }),
      },
    ])

    expect(await runtime.countInstances({ businessKey: "ORD-1" })).toEqual({
      count: 10_000,
      atLeast: true,
    })
    const first = await runtime.searchInstances({ businessKey: "ORD-1" }, { limit: 1 })
    expect(first.items.map((item) => item.id)).toEqual(["200"])
    expect(first.next).toBe("1:c1")
  })

  test("list variable names, an instance and incidents only for keys that can exist, asking nothing", async () => {
    const { camunda, runtime } = runtimeWith([TOPOLOGY])

    expect(await runtime.listVariableNames(DefinitionId("order:1"))).toEqual([])
    expect(await runtime.getInstanceDetail(InstanceId("x"))).toBeUndefined()
    expect(await runtime.searchIncidents({ instanceId: InstanceId("x") }, { limit: 10 })).toEqual({
      items: [],
    })
    expect(await runtime.getIncidentDetails(IncidentId("x"))).toBeUndefined()
    expect(routesOf(camunda)).toEqual(["GET /topology"])
  })

  test("read no instance and no incident the cluster does not know", async () => {
    const { runtime } = runtimeWith([
      TOPOLOGY,
      { route: "GET /process-instances/200", answer: MISSING },
      { route: "GET /incidents/500", answer: MISSING },
    ])

    expect(await runtime.getInstanceDetail(InstanceId("200"))).toBeUndefined()
    expect(await runtime.getIncidentDetails(IncidentId("500"))).toBeUndefined()
  })

  test("read an incident's details as its whole error message with the root cause", async () => {
    const { camunda, runtime } = runtimeWith([
      TOPOLOGY,
      {
        route: "GET /incidents/500",
        answer: incident("500", { errorMessage: STACK_TRACE }),
      },
    ])

    expect(await runtime.getIncidentDetails(IncidentId("500"))).toEqual({
      kind: "errorMessage",
      text: STACK_TRACE,
      truncated: false,
      rootCause: "SocketTimeoutException: Read timed out",
      rootCauseLine: 1,
    })
    expect(routesOf(camunda)).toEqual(["GET /topology", "GET /incidents/500"])
  })

  test("names the variables of the newest instances of a version", async () => {
    const { runtime } = runtimeWith([
      TOPOLOGY,
      { route: "POST /process-instances/search", answer: page([instance("200")]) },
      {
        route: "POST /variables/search",
        answer: page([variable("b", "1"), variable("a", "2"), variable("b", "3")]),
      },
    ])

    expect(await runtime.listVariableNames(DefinitionId("100"))).toEqual(["a", "b"])
  })
})
