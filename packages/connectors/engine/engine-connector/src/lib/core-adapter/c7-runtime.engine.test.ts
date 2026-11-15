/**
 * The engine contract's conformance kit over the MCP server's SDK wire: c7-core's `C7Runtime` on
 * the connector's engine port (`enginePortFor` over `createEngineConnection`, the client every
 * tool sends through), its failures read by `runtimeErrorOf`, against a real engine of the
 * Camunda 7 REST family in a container (`PULSE_ENGINE_IMAGE`, Operaton 2.1.5 without one; CI runs
 * Operaton and CIB seven), seeded with the kit's world through c7-core's `seedC7World`. The read
 * laws hold here as on the C7 adapter's wire, the unreachable engine at 127.0.0.1:9 included. No
 * law reads a bulk operation, so two cases of this suite do: a batch it starts itself, and an id
 * the engine does not know.
 *
 * `pnpm --fail-if-no-match --filter @miragon/pulse-engine-connector test:engines` (Docker); its
 * own container start, since no package shares a Node test helper with another.
 */

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { GenericContainer, Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { C7Runtime } from "@miragon/pulse-c7-core/runtime"
import { type C7SeedEngine, type C7UnknownIds, seedC7World } from "@miragon/pulse-c7-core/testing"
import {
  BulkOperationId,
  DefinitionId,
  IncidentId,
  InstanceId,
  type ProcessRuntime,
} from "@miragon/pulse-engine-core"
import {
  type ConformanceHarness,
  ConformanceKit,
  type SeededWorld,
  WORLD_DEPLOYMENTS,
  WORLD_INSTANCES,
  WORLD_LOCAL_VARIABLE,
} from "@miragon/pulse-engine-core/testing"
import { createEngineConnection } from "../engine/engine-connection.js"
import { enginePortFor } from "./engine-port.js"
import { runtimeErrorOf } from "./runtime-errors.test-support.js"

const ENGINE_IMAGE = process.env.PULSE_ENGINE_IMAGE ?? "operaton/operaton:2.1.5"
const ENGINE_PORT = 8080
const REST_ROOT = "/engine-rest"
const STARTUP_TIMEOUT_MS = 180_000
const UNREACHABLE_URL = "http://127.0.0.1:9/engine-rest"
/** How long the engine may take to work a batch of one instance off, as the command laws allow. */
const BATCH_RUNS_WITHIN_MS = 90_000

/**
 * The engine keeps its full history (the history level the read laws run at here; the C7
 * adapter's suite runs them at AUDIT too) and runs without its bundled invoice example: that sets
 * the engine's clock back by days while it seeds itself, after the REST API already answers, so
 * the world's timestamps would come from the rewound clock.
 */
const ENGINE_ENVIRONMENT = {
  CAMUNDA_BPM_RUN_EXAMPLE_ENABLED: "false",
  OPERATON_BPM_RUN_EXAMPLE_ENABLED: "false",
  CAMUNDA_BPM_HISTORY_LEVEL: "full",
  OPERATON_BPM_HISTORY_LEVEL: "full",
} as const

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

interface RunningEngine {
  readonly url: string
  stop(): Promise<void>
}

/** The JSON answer of a request the test sends itself, over the REST API without the SDK. */
async function rest(url: string, body?: unknown): Promise<unknown> {
  const response = await fetch(
    url,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  )
  if (!response.ok) {
    throw new Error(`${body === undefined ? "GET" : "POST"} ${url}: HTTP ${response.status}`)
  }
  return response.json()
}

async function startEngine(): Promise<RunningEngine> {
  const container = await new GenericContainer(ENGINE_IMAGE)
    .withEnvironment(ENGINE_ENVIRONMENT)
    .withExposedPorts(ENGINE_PORT)
    .withWaitStrategy(Wait.forHttp(`${REST_ROOT}/version`, ENGINE_PORT).forStatusCode(200))
    .withStartupTimeout(STARTUP_TIMEOUT_MS)
    .start()
  const url = `http://${container.getHost()}:${container.getMappedPort(ENGINE_PORT)}${REST_ROOT}`
  const example = (await rest(`${url}/process-definition/count?key=invoice`)) as { count: number }
  if (example.count > 0) {
    await container.stop()
    throw new Error(
      `${ENGINE_IMAGE} runs its example application: disable it in ENGINE_ENVIRONMENT`,
    )
  }
  return { url, stop: () => container.stop().then(() => undefined) }
}

/** A world diagram, read from c7-core's world/ in the repository. */
function worldDiagram(process: string): string {
  const file = new URL(`../../../../../c7/c7-core/world/${process}.bpmn`, import.meta.url)
  return readFileSync(fileURLToPath(file), "utf8")
}

function branded<Key extends string, Id>(
  ids: Readonly<Record<Key, string>>,
  brand: (id: string) => Id,
): Record<Key, Id> {
  const entries = Object.entries<string>(ids).map(([key, id]) => [key, brand(id)])
  return Object.fromEntries(entries) as Record<Key, Id>
}

function unknownOf(unknown: C7UnknownIds): SeededWorld["unknown"] {
  return {
    definitionId: DefinitionId(unknown.definitionId),
    instanceId: InstanceId(unknown.instanceId),
    incidentId: IncidentId(unknown.incidentId),
    bulkOperationId: BulkOperationId(unknown.bulkOperationId),
  }
}

/** The kit's world, seeded by c7-core over the global fetch, its ids branded. */
async function seedWorld(url: string): Promise<SeededWorld> {
  const engine: C7SeedEngine = { url, send: (target, request) => fetch(target, request), wait }
  const diagrams = Object.fromEntries(
    WORLD_DEPLOYMENTS.map(({ process }) => [process, worldDiagram(process)]),
  )
  const world = await seedC7World(engine, {
    deployments: WORLD_DEPLOYMENTS,
    instances: WORLD_INSTANCES,
    localVariable: WORLD_LOCAL_VARIABLE,
    diagrams,
  })
  return {
    definitionIds: branded(world.definitionIds, DefinitionId),
    instanceIds: branded(world.instanceIds, InstanceId),
    unknown: unknownOf(world.unknown),
  }
}

/** The runtime of the MCP server's SDK wire on the engine at `baseUrl`. */
function runtimeAt(id: string, baseUrl: string): ProcessRuntime {
  const client = createEngineConnection({ id, baseUrl }, { type: "none" })
  return C7Runtime.over(enginePortFor(client), { failureOf: runtimeErrorOf })
}

/**
 * A batch that cancels one instance of order v2 the test starts itself (the world's waiting
 * route), started over the REST API: its id.
 */
async function startCancellation(url: string, world: SeededWorld): Promise<BulkOperationId> {
  const definitionId = world.definitionIds["order@2"]
  const started = (await rest(`${url}/process-definition/${definitionId}/start`, {
    businessKey: "MCP-BULK-1",
    variables: { route: { value: "review", type: "String" } },
  })) as { id: string }
  const batch = (await rest(`${url}/process-instance/delete`, {
    processInstanceIds: [started.id],
    deleteReason: "the MCP SDK wire's bulk case",
    skipCustomListeners: true,
  })) as { id: string; type: string }
  expect(batch.type).toBe("instance-deletion")
  return BulkOperationId(batch.id)
}

/** The seeded engine and the kit's harness over it. */
interface Suite {
  readonly url: string
  readonly harness: ConformanceHarness
}

describe(`c7-core's runtime over the MCP server's SDK wire against ${ENGINE_IMAGE}`, () => {
  let engine: RunningEngine | undefined
  let suite: Suite | undefined

  beforeAll(async () => {
    engine = await startEngine()
    const harness = {
      runtime: runtimeAt("conformance", engine.url),
      unreachableRuntime: runtimeAt("unreachable", UNREACHABLE_URL),
      world: await seedWorld(engine.url),
    }
    suite = { url: engine.url, harness }
  })

  afterAll(async () => {
    await engine?.stop()
  })

  const prepared = (): Suite => {
    if (suite === undefined) throw new Error("the engine did not start")
    return suite
  }

  new ConformanceKit(test).registerRuntimeLaws(() =>
    Promise.resolve().then(() => prepared().harness),
  )

  test("bulk: a batch that cancels one instance reads as such, from the runtime, then the history", async () => {
    const { url, harness } = prepared()
    const { runtime, world } = harness
    const id = await startCancellation(url, world)
    const first = await runtime.getBulkOperation(id)
    expect(first).toMatchObject({ id, kind: "cancelInstances", total: 1 })
    expect(["running", "ended"]).toContain(first?.state)
    expect(await runtime.getBulkFailures(id)).toEqual([])
    const deadline = Date.now() + BATCH_RUNS_WITHIN_MS
    let ended = first
    while (ended?.state !== "ended" && Date.now() < deadline) {
      await wait(500)
      ended = await runtime.getBulkOperation(id)
    }
    expect(ended).toMatchObject({ id, kind: "cancelInstances", state: "ended", total: 1 })
    expect(ended?.endedAt).toEqual(expect.any(String))
    expect(await runtime.getBulkFailures(id)).toEqual([])
  })

  test("bulk: an id the engine does not know reads as none, without failures", async () => {
    const { runtime, world } = prepared().harness
    expect(await runtime.getBulkOperation(world.unknown.bulkOperationId)).toBeUndefined()
    expect(await runtime.getBulkFailures(world.unknown.bulkOperationId)).toEqual([])
  })
})
