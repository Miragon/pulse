import { afterEach, describe, expect, it, vi } from "vitest"
import { C7Runtime } from "@miragon/pulse-c7-core/runtime"
import { DefinitionId } from "@miragon/pulse-engine-core"
import { FakeEngine as ContractFake, FakeWorld } from "@miragon/pulse-engine-core/testing"
import { flavorsOf } from "@miragon/pulse-profile"
import { isC7Flavor } from "../../engine-provider.js"
import { SERVER_SURFACE } from "../../engine-profiles.js"
import { providerForEntry } from "../../providers/index.js"
import {
  clientFor,
  type FakeEngine,
  type FakeRoutes,
  startFakeEngine,
} from "../../tools/test-support/fake-engine.js"
import { createEngineConnection } from "./engine-connection.js"
import { runtimeOf } from "./engine-runtime.js"
import {
  type ContractRuntime,
  createEngineRegistry,
  resolveRuntimeEngine,
} from "./resolve-engine.js"
import { closedPortUrl } from "./test-support/raw-engine.js"

const engines: FakeEngine[] = []
afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

/** A fake engine answering `routes`, and the runtime of its one engine, `fake`. */
async function runtimeWith(routes: FakeRoutes) {
  const engine = await startFakeEngine(routes)
  engines.push(engine)
  const runtime = runtimeOf({
    client: clientFor(engine),
    provider: providerForEntry({ id: "fake" }),
  })
  return { engine, runtime }
}

const sent = (engine: FakeEngine) => engine.requests.map(({ method, path }) => `${method} ${path}`)

describe("runtimeOf: the engine contract's runtime of an engine the server resolved", () => {
  it("serves every flavor of every dialect the server reads, the Camunda 7 REST API's by C7Runtime", () => {
    expect(SERVER_SURFACE.dialects).toEqual(["c7"])
    const client = createEngineConnection(
      { id: "e", baseUrl: "http://e/engine-rest" },
      { type: "none" },
    )
    for (const dialect of SERVER_SURFACE.dialects) {
      const flavors = flavorsOf(dialect)
      expect(flavors.length, dialect).toBeGreaterThan(0)
      for (const flavor of flavors.filter(isC7Flavor)) {
        const provider = providerForEntry({ id: "e", flavor })
        expect(runtimeOf({ client, provider }), flavor).toBeInstanceOf(C7Runtime)
      }
      expect(
        flavors.filter((flavor) => !isC7Flavor(flavor)),
        dialect,
      ).toEqual([])
    }
  })

  it("gives an engine of another dialect its backend's own runtime, per call, on the call's signal", async () => {
    const runtime = vi.fn<ContractRuntime>(() => new ContractFake(FakeWorld.seed().state))
    const registry = createEngineRegistry(
      [{ id: "c8", baseUrl: "https://c8.example/v2", flavor: "camunda8" }],
      () => {
        throw new Error("no client for another dialect")
      },
      { contractRuntime: () => runtime },
    )
    const signal = new AbortController().signal
    const engine = resolveRuntimeEngine("c8", registry, { mcpReq: { signal } })
    const first = runtimeOf(engine)
    expect(runtimeOf(engine)).not.toBe(first)
    expect(runtime.mock.calls).toEqual([[signal], [signal]])
    expect(await first.listDefinitions()).toEqual(
      await new ContractFake(FakeWorld.seed().state).listDefinitions(),
    )
  })

  it("builds a new runtime per call, over the client that call resolved", async () => {
    const { engine } = await runtimeWith({
      "GET /process-definition/order:1:d/xml": { body: { id: "order:1:d", bpmn20Xml: "<x/>" } },
    })
    const provider = providerForEntry({ id: "fake" })
    const client = clientFor(engine)
    const first = runtimeOf({ client, provider })
    expect(runtimeOf({ client, provider })).not.toBe(first)
    expect(await first.getDiagramXml(DefinitionId("order:1:d"))).toBe("<x/>")
    expect(sent(engine)).toEqual(["GET /process-definition/order:1:d/xml"])
  })

  it("fails a refused read as forbidden, in the words the model reads", async () => {
    const { runtime } = await runtimeWith({
      "GET /process-definition/order:1:d/xml": {
        status: 403,
        body: { type: "AuthorizationException", message: "no READ permission" },
      },
    })
    await expect(runtime.getDiagramXml(DefinitionId("order:1:d"))).rejects.toMatchObject({
      failure: "forbidden",
      message: "[403 AuthorizationException] no READ permission (engine fake)",
    })
  })

  it("reads a version the engine does not know as none", async () => {
    const { runtime } = await runtimeWith({
      "GET /process-definition/order:9:d/xml": {
        status: 404,
        body: { type: "InvalidRequestException", message: "No definition order:9:d" },
      },
    })
    expect(await runtime.getDiagramXml(DefinitionId("order:9:d"))).toBeUndefined()
  })

  it("fails a read of an engine that does not listen as unreachable", async () => {
    const client = createEngineConnection(
      { id: "down", baseUrl: await closedPortUrl() },
      { type: "none" },
    )
    const runtime = runtimeOf({ client, provider: providerForEntry({ id: "down" }) })
    await expect(runtime.getDiagramXml(DefinitionId("order:1:d"))).rejects.toMatchObject({
      failure: "unreachable",
      message: "engine down unreachable (ECONNREFUSED)",
    })
  })
})

describe("describeEngine over the SDK wire: the telemetry, else the REST API's version", () => {
  const VERSION = { "GET /version": { body: { version: "7.24.0" } } }

  it("names the product and version of the engine's telemetry, in one request", async () => {
    const { engine, runtime } = await runtimeWith({
      "GET /telemetry/data": {
        body: { product: { name: "Operaton BPM Runtime", version: "2.1.5", edition: "community" } },
      },
      ...VERSION,
    })
    expect(await runtime.describeEngine()).toEqual({
      product: "Operaton BPM Runtime",
      version: "2.1.5",
    })
    expect(sent(engine)).toEqual(["GET /telemetry/data"])
  })

  it("falls back to /version on the wire's own 404 of /telemetry/data", async () => {
    const { engine, runtime } = await runtimeWith({
      "GET /telemetry/data": {
        status: 404,
        body: { type: "InvalidRequestException", message: "Telemetry is not available" },
      },
      ...VERSION,
    })
    expect(await runtime.describeEngine()).toEqual({
      product: "Camunda 7 REST API",
      version: "7.24.0",
    })
    expect(sent(engine)).toEqual(["GET /telemetry/data", "GET /version"])
  })

  it("does not fall back on a 500: the engine failed, in the words the model reads", async () => {
    const { engine, runtime } = await runtimeWith({
      "GET /telemetry/data": {
        status: 500,
        body: { type: "ProcessEngineException", message: "telemetry broke" },
      },
      ...VERSION,
    })
    await expect(runtime.describeEngine()).rejects.toMatchObject({
      failure: "engineFailure",
      message: "[500 ProcessEngineException] telemetry broke (engine fake)",
    })
    expect(sent(engine)).toEqual(["GET /telemetry/data"])
  })
})
