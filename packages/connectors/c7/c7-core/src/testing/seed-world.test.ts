import {
  WORLD_BULK_INSTANCES,
  WORLD_COMMAND_INSTANCES,
  WORLD_DEPLOYMENTS,
  WORLD_INSTANCES,
  WORLD_LOCAL_VARIABLE,
  WORLD_MIGRATION_INSTANCES,
  WORLD_SECOND_TOKEN,
} from "@miragon/pulse-engine-core/testing"
import { describe, expect, it } from "vitest"
import { isEngineId } from "../runtime/engine-ids.js"
import type { C7SeedAnswer, C7SeedEngine, C7SeedRequest } from "./c7-world.js"
import { seedC7CommandWorld, seedC7World } from "./seed-world.js"

const ROOT = "http://engine.test/engine-rest"
const DIAGRAMS = { order: "<order/>", label: "<label/>", dispatch: "<dispatch/>" }
const PLAN = {
  deployments: WORLD_DEPLOYMENTS,
  instances: WORLD_INSTANCES,
  localVariable: WORLD_LOCAL_VARIABLE,
  diagrams: DIAGRAMS,
}
const COMMAND_PLAN = {
  instances: WORLD_COMMAND_INSTANCES,
  secondToken: WORLD_SECOND_TOKEN,
  bulk: WORLD_BULK_INSTANCES,
  migration: WORLD_MIGRATION_INSTANCES,
}
const DEFINITION_IDS = {
  "label@1": "pulse-label:1:d1",
  "order@1": "pulse-order:1:d2",
  "order@2": "pulse-order:2:d3",
  "dispatch@1": "pulse-dispatch:1:d4",
}

interface Incident {
  readonly id: string
  readonly rootCauseIncidentId: string
}

function answer(status: number, body?: unknown): C7SeedAnswer {
  return {
    ok: status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(String(body)),
  }
}

function roots(count: number): Incident[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `root-${index}`,
    rootCauseIncidentId: `root-${index}`,
  }))
}

const PROPAGATED: Incident = { id: "propagated", rootCauseIncidentId: "root-0" }

/** A C7 engine that answers the seed's requests and records them and the waits. */
class SeedEngine implements C7SeedEngine {
  readonly url = ROOT
  readonly sent: { readonly line: string; readonly request: C7SeedRequest | undefined }[] = []
  readonly waits: number[] = []
  private readonly answers = new Map<string, C7SeedAnswer>()

  constructor(private readonly polls: readonly (readonly Incident[])[] = [roots(8)]) {}

  get lines(): string[] {
    return this.sent.map(({ line }) => line)
  }

  answering(line: string, given: C7SeedAnswer): this {
    this.answers.set(line, given)
    return this
  }

  send(url: string, request?: C7SeedRequest): Promise<C7SeedAnswer> {
    const line = `${request?.method ?? "GET"} ${url.slice(ROOT.length)}`
    this.sent.push({ line, request })
    return Promise.resolve(this.answers.get(line) ?? this.answer(line, request?.body ?? ""))
  }

  wait(ms: number): Promise<void> {
    this.waits.push(ms)
    return Promise.resolve()
  }

  private answer(line: string, body: string): C7SeedAnswer {
    if (line === "POST /deployment/create") {
      const alias = /pulse-world-(\S+)/.exec(body)?.[1] as keyof typeof DEFINITION_IDS
      const id = DEFINITION_IDS[alias]
      return answer(200, { deployedProcessDefinitions: { [id]: { id } } })
    }
    if (line.endsWith("/start")) {
      return answer(200, { id: `pi-${(JSON.parse(body) as { businessKey: string }).businessKey}` })
    }
    if (line.startsWith("GET /task?")) return answer(200, [{ id: "task-1" }])
    if (line === "GET /incident") {
      const polled = this.lines.filter((sent) => sent === line).length
      return answer(200, this.polls[Math.min(polled, this.polls.length) - 1])
    }
    return answer(204)
  }
}

async function rejectionOf(attempt: Promise<unknown>): Promise<unknown> {
  return attempt.then(
    () => undefined,
    (error: unknown) => error,
  )
}

const READ_WORLD_LINES = [
  "POST /deployment/create",
  "POST /deployment/create",
  "POST /deployment/create",
  "POST /deployment/create",
  "POST /process-definition/pulse-order%3A1%3Ad2/start",
  "POST /process-definition/pulse-order%3A1%3Ad2/start",
  "POST /process-definition/pulse-order%3A1%3Ad2/start",
  "POST /process-definition/pulse-order%3A2%3Ad3/start",
  "POST /process-definition/pulse-dispatch%3A1%3Ad4/start",
  "GET /task?processInstanceId=pi-ORD-1001",
  "PUT /task/task-1/localVariables/reviewNote",
  "GET /incident",
]

describe("seedC7World", () => {
  it("deploys, starts the instances one by one, sets the local variable, then polls the incidents", async () => {
    const engine = new SeedEngine()

    const world = await seedC7World(engine, PLAN)

    expect(engine.lines).toStrictEqual(READ_WORLD_LINES)
    expect(world.definitionIds).toStrictEqual(DEFINITION_IDS)
    expect(world.instanceIds).toStrictEqual({
      "ORD-1001": "pi-ORD-1001",
      "ORD-1002": "pi-ORD-1002",
      "ORD-1003": "pi-ORD-1003",
      "ORD-2001": "pi-ORD-2001",
      "DSP-3001": "pi-DSP-3001",
    })
    expect(engine.waits).toStrictEqual([])
  })

  it("deploys label@1, order@1, order@2 and dispatch@1, each as a multipart body of its diagram", async () => {
    const engine = new SeedEngine()

    await seedC7World(engine, PLAN)

    const deployments = engine.sent.filter(({ line }) => line === "POST /deployment/create")
    expect(deployments.map(({ request }) => request)).toStrictEqual(
      [
        ["label@1", "label"],
        ["order@1", "order"],
        ["order@2", "order"],
        ["dispatch@1", "dispatch"],
      ].map(([alias, process]) => ({
        method: "POST",
        headers: { "Content-Type": "multipart/form-data; boundary=pulse-c7-world" },
        body:
          '--pulse-c7-world\r\nContent-Disposition: form-data; name="deployment-name"\r\n\r\n' +
          `pulse-world-${alias}\r\n--pulse-c7-world\r\n` +
          `Content-Disposition: form-data; name="model"; filename="${process}.bpmn"\r\n` +
          `Content-Type: text/xml\r\n\r\n<${process}/>\r\n--pulse-c7-world--\r\n`,
      })),
    )
  })

  it("starts an instance with its business key and its variables typed for the engine", async () => {
    const engine = new SeedEngine()

    await seedC7World(engine, PLAN)

    expect(engine.sent[5]?.request).toStrictEqual({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        businessKey: "ORD-1002",
        variables: {
          route: { value: "charge", type: "String" },
          amount: { value: 42, type: "Integer" },
          dueAt: { value: "2026-03-15T10:00:00.000+0000", type: "Date" },
          giftNote: { value: null, type: "Null" },
        },
      }),
    })
  })

  it("sets the local variable as a String on the task its instance waits at", async () => {
    const engine = new SeedEngine()

    await seedC7World(engine, PLAN)

    expect(engine.sent[10]?.request).toStrictEqual({
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: '{"value":"Check the delivery address","type":"String"}',
    })
  })

  it("leaves the answer of the local variable unread", async () => {
    const engine = new SeedEngine().answering(
      "PUT /task/task-1/localVariables/reviewNote",
      answer(500, "refused"),
    )

    await expect(seedC7World(engine, PLAN)).resolves.toBeDefined()
  })

  it("polls the open incidents a second apart until two are root incidents", async () => {
    const engine = new SeedEngine([[], [roots(1)[0]!, PROPAGATED], [...roots(2), PROPAGATED]])

    await seedC7World(engine, PLAN)

    expect(engine.lines.slice(READ_WORLD_LINES.length - 1)).toStrictEqual([
      "GET /incident",
      "GET /incident",
      "GET /incident",
    ])
    expect(engine.waits).toStrictEqual([1000, 1000])
  })

  it("fails once it waited two minutes for the incidents", async () => {
    const engine = new SeedEngine([roots(1)])

    expect(await rejectionOf(seedC7World(engine, PLAN))).toStrictEqual(
      new Error("the world has no 2 incidents after 120000 ms"),
    )
    expect(engine.waits).toHaveLength(121)
    expect(engine.lines.filter((line) => line === "GET /incident")).toHaveLength(122)
  })

  it("answers fixed unknown ids that are engine ids", async () => {
    const first = await seedC7World(new SeedEngine(), PLAN)
    const second = await seedC7World(new SeedEngine(), PLAN)

    expect(first.unknown).toStrictEqual({
      definitionId: "pulse-unknown:1:00000000-0000-4000-8000-000000000001",
      instanceId: "00000000-0000-4000-8000-000000000002",
      incidentId: "00000000-0000-4000-8000-000000000003",
      bulkOperationId: "00000000-0000-4000-8000-000000000004",
    })
    expect(second.unknown).toStrictEqual(first.unknown)
    expect(Object.values(first.unknown).every(isEngineId)).toBe(true)
  })

  it("names the request, the status and the engine's text of a refused request", async () => {
    const deploying = new SeedEngine().answering("POST /deployment/create", answer(500, "boom"))
    const polling = new SeedEngine().answering("GET /incident", answer(503, "busy"))

    expect(await rejectionOf(seedC7World(deploying, PLAN))).toStrictEqual(
      new Error(`POST ${ROOT}/deployment/create: HTTP 500 boom`),
    )
    expect(await rejectionOf(seedC7World(polling, PLAN))).toStrictEqual(
      new Error(`GET ${ROOT}/incident: HTTP 503 busy`),
    )
  })

  it.each([{}, { deployedProcessDefinitions: {} }])(
    "fails when a deployment creates no process definition (%o)",
    async (created) => {
      const engine = new SeedEngine().answering("POST /deployment/create", answer(200, created))

      expect(await rejectionOf(seedC7World(engine, PLAN))).toStrictEqual(
        new Error("deploying label@1 created no process definition"),
      )
    },
  )

  it("fails before any request without a deployment or a diagram the world needs", async () => {
    const engine = new SeedEngine()
    const withoutLabel = WORLD_DEPLOYMENTS.filter(({ process }) => process !== "label")
    const withoutLabelDiagram = { order: DIAGRAMS.order, dispatch: DIAGRAMS.dispatch }

    expect(
      await rejectionOf(seedC7World(engine, { ...PLAN, deployments: withoutLabel })),
    ).toStrictEqual(new Error("the world has no deployment label@1"))
    expect(
      await rejectionOf(seedC7World(engine, { ...PLAN, diagrams: withoutLabelDiagram })),
    ).toStrictEqual(new Error("the world has no diagram of label"))
    expect(engine.sent).toStrictEqual([])
  })

  it("fails when the local variable's instance waits at no task", async () => {
    const engine = new SeedEngine().answering(
      "GET /task?processInstanceId=pi-ORD-1001",
      answer(200, []),
    )

    expect(await rejectionOf(seedC7World(engine, PLAN))).toStrictEqual(
      new Error("ORD-1001 waits at no task"),
    )
  })
})

const ORDER_1 = "POST /process-definition/pulse-order%3A1%3Ad2/start"
const ORDER_2 = "POST /process-definition/pulse-order%3A2%3Ad3/start"

describe("seedC7CommandWorld", () => {
  it("starts the command instances, the second token and the migration sets, waits for their incidents, then the bulk sets", async () => {
    const engine = new SeedEngine([roots(7), roots(8)])

    const world = await seedC7CommandWorld(engine, COMMAND_PLAN, { definitionIds: DEFINITION_IDS })

    expect(engine.lines).toStrictEqual([
      ...Array<string>(8).fill(ORDER_2),
      "POST /process-instance/pi-CMD-TWIN/modification",
      ...Array<string>(8).fill(ORDER_1),
      "GET /incident",
      "GET /incident",
      ...Array<string>(100).fill(ORDER_2),
    ])
    expect(engine.waits).toStrictEqual([1000])
    expect(world.instanceIds).toStrictEqual(
      Object.fromEntries(
        WORLD_COMMAND_INSTANCES.map(({ businessKey }) => [businessKey, `pi-${businessKey}`]),
      ),
    )
    expect(world.migrationInstanceIds).toStrictEqual({
      whole: ["pi-CMD-MIG-1", "pi-CMD-MIG-2", "pi-CMD-MIG-3"],
      partial: ["pi-CMD-MIG-11", "pi-CMD-MIG-12", "pi-CMD-MIG-13"],
      skip: ["pi-CMD-MIG-21"],
      stay: ["pi-CMD-MIG-31"],
    })
    expect(world.bulkInstanceIds).toStrictEqual({
      cancel: Array.from({ length: 50 }, (_, index) => `pi-CMD-BULK-${index + 1}`),
      stop: Array.from({ length: 50 }, (_, index) => `pi-CMD-STOP-${index + 1}`),
    })
    expect(world.definitionIds).toStrictEqual(DEFINITION_IDS)
    expect(world.unknown).toStrictEqual((await seedC7World(new SeedEngine(), PLAN)).unknown)
  })

  it("starts the second token before its element", async () => {
    const engine = new SeedEngine()

    await seedC7CommandWorld(engine, COMMAND_PLAN, { definitionIds: DEFINITION_IDS })

    expect(engine.sent[8]?.request).toStrictEqual({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"instructions":[{"type":"startBeforeActivity","activityId":"Activity_ReviewOrder"}]}',
    })
  })

  it("fails when the engine refuses the second token", async () => {
    const line = "POST /process-instance/pi-CMD-TWIN/modification"
    const engine = new SeedEngine().answering(line, answer(400, "no token"))

    expect(
      await rejectionOf(
        seedC7CommandWorld(engine, COMMAND_PLAN, { definitionIds: DEFINITION_IDS }),
      ),
    ).toStrictEqual(
      new Error(`POST ${ROOT}/process-instance/pi-CMD-TWIN/modification: HTTP 400 no token`),
    )
    expect(engine.lines.at(-1)).toBe(line)
  })
})
