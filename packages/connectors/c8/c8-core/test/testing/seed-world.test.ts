import { readFileSync } from "node:fs"
import {
  FakeWorld,
  WORLD_DEPLOYMENTS,
  WORLD_INSTANCES,
  WORLD_LOCAL_VARIABLE,
  WORLD_PROCESS,
} from "@miragon/pulse-engine-core/testing"
import { describe, expect, test } from "vitest"
import {
  C8_WORLD,
  type C8SeedAnswer,
  type C8SeedEngine,
  type C8SeedRequest,
} from "../../src/testing/c8-world.js"
import { C8WorldSeed } from "../../src/testing/seed-world.js"

const ROOT = "http://cluster.test/v2"
const DIAGRAMS = { order: "<order/>", label: "<label/>", dispatch: "<dispatch/>" }
const PLAN = {
  deployments: WORLD_DEPLOYMENTS,
  instances: WORLD_INSTANCES,
  localVariable: WORLD_LOCAL_VARIABLE,
  diagrams: DIAGRAMS,
}
const STATISTICS = "POST /process-definitions/statistics/process-instances"
const INCIDENTS = "POST /incidents/search"
const VARIABLES = "POST /variables/search"
const ELEMENTS = "POST /element-instances/search"
const ACTIVATION = "POST /jobs/activation"

const FAKE_WORLD = FakeWorld.seed().state
const ACTIVE = FAKE_WORLD.instances
  .map(({ summary }) => summary)
  .filter(({ state }) => state === "running" || state === "suspended")

function activeOf(process: string) {
  const active = ACTIVE.filter(({ definition }) => definition.bpmnProcessId === process)
  const withIncident = active.filter(({ hasIncident }) => hasIncident).length
  return { withoutIncident: active.length - withIncident, withIncident }
}

const SETTLED = Object.values(WORLD_PROCESS).map((process) => {
  const { withoutIncident, withIncident } = activeOf(process)
  return {
    processDefinitionId: process,
    activeInstancesWithoutIncidentCount: withoutIncident,
    activeInstancesWithIncidentCount: withIncident,
  }
})

function aliasOf(body: string): string | undefined {
  const open = "<!-- "
  const start = body.indexOf(open)
  if (start < 0) return undefined
  const end = body.indexOf(" -->", start + open.length)
  return end < 0 ? undefined : body.slice(start + open.length, end)
}

function answer(status: number, body?: unknown): C8SeedAnswer {
  const text = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body)
  return { ok: status < 300, status, text: () => Promise.resolve(text) }
}

function items(...listed: readonly unknown[]): C8SeedAnswer {
  return answer(200, { items: listed })
}

class SeedCluster implements C8SeedEngine {
  readonly url = ROOT
  readonly sent: { readonly line: string; readonly request: C8SeedRequest }[] = []
  readonly waits: number[] = []
  private readonly queued = new Map<string, C8SeedAnswer[]>()
  private clock = 1_000_000

  constructor(private readonly sendMs = 0) {}

  get lines(): string[] {
    return this.sent.map(({ line }) => line)
  }

  answering(line: string, ...answers: readonly C8SeedAnswer[]): this {
    this.queued.set(line, [...(this.queued.get(line) ?? []), ...answers])
    return this
  }

  bodyOf(line: string, index = 0): unknown {
    const request = this.sent.filter((sent) => sent.line === line)[index]?.request
    return request?.headers["Content-Type"] === "application/json"
      ? JSON.parse(request.body)
      : request?.body
  }

  send(url: string, request: C8SeedRequest): Promise<C8SeedAnswer> {
    const line = `${request.method} ${url.slice(ROOT.length)}`
    this.sent.push({ line, request })
    this.clock += this.sendMs
    return Promise.resolve(this.queued.get(line)?.shift() ?? this.answer(line, request.body))
  }

  wait(ms: number): Promise<void> {
    this.waits.push(ms)
    this.clock += ms
    return Promise.resolve()
  }

  now(): number {
    return this.clock
  }

  private answer(line: string, body: string): C8SeedAnswer {
    if (line === "POST /deployments") {
      const process = /filename="(\w+)\.bpmn"/.exec(body)?.[1]
      const marker = aliasOf(body) ?? `${process}@1`
      return answer(200, {
        deployments: [{ processDefinition: { processDefinitionKey: `key-${marker}` } }],
      })
    }
    if (line === "POST /process-instances") {
      const { businessId } = JSON.parse(body) as { businessId: string }
      return answer(200, { processInstanceKey: `pi-${businessId}` })
    }
    if (line === ACTIVATION) {
      const { type } = JSON.parse(body) as { type: string }
      return answer(200, { jobs: [{ jobKey: `job-${type}` }] })
    }
    return this.settled(line)
  }

  private settled(line: string): C8SeedAnswer {
    switch (line) {
      case ELEMENTS:
        return items({ elementInstanceKey: "element-1" })
      case STATISTICS:
        return items(...SETTLED)
      case INCIDENTS:
        return items("first", "second")
      case VARIABLES:
        return items("reviewNote")
      default:
        return answer(204)
    }
  }
}

async function rejectionOf(attempt: Promise<unknown>): Promise<unknown> {
  return attempt.then(
    () => undefined,
    (error: unknown) => error,
  )
}

const SEEDED_LINES = [
  ...Array<string>(4).fill("POST /deployments"),
  ...Array<string>(5).fill("POST /process-instances"),
  ACTIVATION,
  "POST /jobs/job-charge-payment/failure",
  ACTIVATION,
  "POST /jobs/job-render-label/failure",
  ELEMENTS,
  "PUT /element-instances/element-1/variables",
  STATISTICS,
  INCIDENTS,
  VARIABLES,
]

describe("C8WorldSeed.seed", () => {
  test("deploys the world in order, starts its instances, fails its jobs and sets the local variable", async () => {
    const cluster = new SeedCluster()

    const world = await C8WorldSeed.seed(cluster, PLAN)

    expect(cluster.lines).toStrictEqual(SEEDED_LINES)
    expect(cluster.waits).toStrictEqual([])
    expect(world).toStrictEqual({
      definitionIds: {
        "label@1": "key-label@1",
        "order@1": "key-order@1",
        "order@2": "key-order@2",
        "dispatch@1": "key-dispatch@1",
      },
      instanceIds: {
        "ORD-1001": "pi-ORD-1001",
        "ORD-1002": "pi-ORD-1002",
        "ORD-1003": "pi-ORD-1003",
        "ORD-2001": "pi-ORD-2001",
        "DSP-3001": "pi-DSP-3001",
      },
      unknown: {
        definitionId: "9007199254740991",
        instanceId: "9007199254740990",
        incidentId: "9007199254740989",
        bulkOperationId: "9007199254740988",
      },
    })
  })

  test("sends each diagram as a multipart resource, a second version marked by its alias", async () => {
    const cluster = new SeedCluster()

    await C8WorldSeed.seed(cluster, PLAN)

    const [label, order, second] = [0, 1, 2].map((index) =>
      String(cluster.bodyOf("POST /deployments", index)),
    )
    expect(label).toBe(
      [
        "--pulse-c8-world",
        'Content-Disposition: form-data; name="resources"; filename="label.bpmn"',
        "Content-Type: application/xml",
        "",
        "<label/>",
        "--pulse-c8-world--",
        "",
      ].join("\r\n"),
    )
    expect(order).toContain("\r\n<order/>\r\n")
    expect(second).toContain("\r\n<order/>\n<!-- order@2 -->\n\r\n")
    expect(cluster.sent[0]?.request.headers).toStrictEqual({
      "Content-Type": "multipart/form-data; boundary=pulse-c8-world",
    })
  })

  test("starts an instance with its business id and plain variables, a date as its instant", async () => {
    const cluster = new SeedCluster()

    await C8WorldSeed.seed(cluster, PLAN)

    expect(cluster.bodyOf("POST /process-instances", 1)).toStrictEqual({
      processDefinitionKey: "key-order@1",
      businessId: "ORD-1002",
      variables: { route: "charge", amount: 42, dueAt: "2026-03-15T10:00:00.000Z", giftNote: null },
    })
    expect(cluster.bodyOf("POST /process-instances", 4)).toMatchObject({
      processDefinitionKey: "key-dispatch@1",
      businessId: "DSP-3001",
    })
  })

  test("fails every job of a failing type without retries, with the worker's stack trace", async () => {
    const cluster = new SeedCluster()

    await C8WorldSeed.seed(cluster, PLAN)

    expect(cluster.bodyOf(ACTIVATION, 1)).toStrictEqual({
      type: "render-label",
      worker: "pulse-seed",
      timeout: 60_000,
      maxJobsToActivate: 10,
    })
    expect(cluster.bodyOf("POST /jobs/job-charge-payment/failure")).toStrictEqual({
      retries: 0,
      errorMessage: expect.stringContaining(
        "Caused by: java.net.ConnectException: the card gateway is unreachable",
      ) as unknown,
    })
  })

  test("sets the local variable on the element instance of its instance", async () => {
    const cluster = new SeedCluster()

    await C8WorldSeed.seed(cluster, PLAN)

    expect(cluster.bodyOf(ELEMENTS)).toStrictEqual({
      filter: { processInstanceKey: "pi-ORD-1001", elementId: "Activity_ReviewOrder" },
    })
    expect(cluster.bodyOf("PUT /element-instances/element-1/variables")).toStrictEqual({
      variables: { reviewNote: "Check the delivery address" },
      local: true,
    })
    expect(cluster.bodyOf(VARIABLES)).toStrictEqual({
      filter: { processInstanceKey: "pi-ORD-1001", name: "reviewNote" },
    })
  })

  test("polls until a job, the element and the exported world show", async () => {
    const [order, ...others] = SETTLED
    const cluster = new SeedCluster()
      .answering(ACTIVATION, answer(200, { jobs: [] }))
      .answering(ELEMENTS, items())
      .answering(
        STATISTICS,
        items(...others),
        items({ ...order, activeInstancesWithIncidentCount: 0 }, ...others),
      )
      .answering(INCIDENTS, items(), items(), items())
      .answering(VARIABLES, items(), items(), items(), items())

    await C8WorldSeed.seed(cluster, PLAN)

    const count = (sent: string) => cluster.lines.filter((line) => line === sent).length
    expect([ACTIVATION, ELEMENTS, STATISTICS, INCIDENTS, VARIABLES].map(count)).toStrictEqual([
      3, 2, 5, 5, 5,
    ])
    expect(cluster.waits).toStrictEqual(Array<number>(6).fill(250))
  })

  test("gives up on what the cluster does not show within two minutes", async () => {
    const empty = Array.from({ length: 482 }, () => items())
    const cluster = new SeedCluster().answering(ELEMENTS, ...empty)

    const error = await rejectionOf(C8WorldSeed.seed(cluster, PLAN))

    expect(error).toStrictEqual(
      new Error("the cluster did not show the element of the local variable within 120000 ms"),
    )
    expect(cluster.waits).toHaveLength(481)
  })

  test("counts the time its reads take against the two minutes, not only the waits", async () => {
    const empty = Array.from({ length: 482 }, () => items())
    const cluster = new SeedCluster(750).answering(ELEMENTS, ...empty)

    const error = await rejectionOf(C8WorldSeed.seed(cluster, PLAN))

    expect(error).toStrictEqual(
      new Error("the cluster did not show the element of the local variable within 120000 ms"),
    )
    expect(cluster.waits).toHaveLength(120)
  })

  test("fails on an answer that is no success, naming the request and the answer", async () => {
    const cluster = new SeedCluster().answering("POST /process-instances", answer(400, "bad"))

    const error = await rejectionOf(C8WorldSeed.seed(cluster, PLAN))

    expect(error).toStrictEqual(new Error("POST /process-instances: HTTP 400 bad"))
  })

  test("fails on a deployment that created no process definition", async () => {
    for (const deployments of [[], [{}]]) {
      const cluster = new SeedCluster().answering("POST /deployments", answer(200, { deployments }))

      const error = await rejectionOf(C8WorldSeed.seed(cluster, PLAN))

      expect(error).toStrictEqual(new Error("deploying label created no process definition"))
    }
  })

  test("fails on a world without a deployment or a diagram the seed deploys", async () => {
    const withoutLabel = WORLD_DEPLOYMENTS.filter(({ alias }) => alias !== "label@1")
    const withoutLabelDiagram = { order: DIAGRAMS.order, dispatch: DIAGRAMS.dispatch }

    const errors = await Promise.all([
      rejectionOf(C8WorldSeed.seed(new SeedCluster(), { ...PLAN, deployments: withoutLabel })),
      rejectionOf(C8WorldSeed.seed(new SeedCluster(), { ...PLAN, diagrams: withoutLabelDiagram })),
    ])

    expect(errors).toStrictEqual([
      new Error("the world has no deployment label@1"),
      new Error("the world has no diagram of label"),
    ])
  })
})

describe("the C8 world", () => {
  test("waits for the active instances the kit's fake world gives each of its processes", () => {
    const expected = Object.values(WORLD_PROCESS).map((process) => [process, activeOf(process)])

    expect(C8_WORLD.activeByProcess).toStrictEqual(Object.fromEntries(expected))
  })

  test("waits for the open incidents of the kit's fake world", () => {
    expect(C8_WORLD.openIncidents).toBe(FAKE_WORLD.incidents.length)
  })

  test("deploys every deployment of the conformance world once", () => {
    const aliases = WORLD_DEPLOYMENTS.map(({ alias }) => alias)

    expect([...C8_WORLD.deploymentOrder].sort()).toStrictEqual(aliases.sort())
  })
})

describe("the C8 world's diagrams", () => {
  const diagramOf = (process: string) =>
    readFileSync(new URL(`../../world/${process}.bpmn`, import.meta.url), "utf8")

  test("hold each process of the conformance world under its id, and the one the waits run", () => {
    for (const [process, id] of Object.entries({ ...WORLD_PROCESS, waits: "pulse-waits" })) {
      expect(diagramOf(process), process).toContain(`<bpmn:process id="${id}"`)
    }
  })

  test("define the job types the seed fails and the element of the local variable", () => {
    expect(diagramOf("order")).toContain('<zeebe:taskDefinition type="charge-payment"')
    expect(diagramOf("label")).toContain('<zeebe:taskDefinition type="render-label"')
    expect(diagramOf("order")).toContain(`id="${WORLD_LOCAL_VARIABLE.elementId}"`)
  })
})
