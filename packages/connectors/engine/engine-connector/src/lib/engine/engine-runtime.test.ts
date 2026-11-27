import { afterEach, describe, expect, it, vi } from "vitest"
import { C7Runtime } from "@miragon/pulse-c7-core/runtime"
import { C8Runtime } from "@miragon/pulse-c8-core"
import { DefinitionId } from "@miragon/pulse-engine-core"
import { FakeEngine as ContractFake, FakeWorld } from "@miragon/pulse-engine-core/testing"
import { type Flavor, FLAVORS } from "@miragon/pulse-profile"
import { providerForEntry } from "../../providers/index.js"
import {
  clientFor,
  type FakeEngine,
  type FakeRoutes,
  startFakeEngine,
} from "../../tools/test-support/fake-engine.js"
import { createC8Connection } from "./c8-connection.js"
import { createEngineConnection } from "./engine-connection.js"
import { c8RuntimeOf, contractRuntimeOf, runtimeOf } from "./engine-runtime.js"
import {
  type ContractRuntime,
  createEngineRegistry,
  resolveRuntimeEngine,
} from "./resolve-engine.js"
import { c8Platform, CLUSTER, hang, json, problem } from "./test-support/c8-platform.js"
import { closedPortUrl, startRawEngine } from "./test-support/raw-engine.js"

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
  it("serves every flavor of the format, of either dialect: C7Runtime, else C8Runtime", () => {
    const client = createEngineConnection(
      { id: "e", baseUrl: "http://e/engine-rest" },
      { type: "none" },
    )
    for (const flavor of Object.keys(FLAVORS) as Flavor[]) {
      const entry = { id: "e", baseUrl: "https://e.example/v2", flavor }
      const runtime =
        FLAVORS[flavor] === "c7"
          ? runtimeOf({ client, provider: providerForEntry(entry) })
          : contractRuntimeOf(entry)()
      expect(runtime, flavor).toBeInstanceOf(FLAVORS[flavor] === "c7" ? C7Runtime : C8Runtime)
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

  it("reads a version's diagram once per engine and caller, through the one XML cache, across calls", async () => {
    const { engine } = await runtimeWith({
      "GET /process-definition/order:1:d/xml": {
        body: { id: "order:1:d", bpmn20Xml: '<callActivity id="Call" calledElement="label" />' },
      },
      "GET /process-definition": { body: [] },
      "GET /process-definition/gone:1:d/xml": {
        status: 404,
        body: { type: "InvalidRequestException", message: "No definition gone:1:d" },
      },
    })
    const provider = providerForEntry({ id: "fake" })
    const client = clientFor(engine)
    const first = runtimeOf({ client, provider })
    expect(await first.getDiagramXml(DefinitionId("order:1:d"))).toContain("Call")
    expect(
      await runtimeOf({ client, provider }).getCalledProcesses(DefinitionId("order:1:d")),
    ).toStrictEqual([{ elementId: "Call", bpmnProcessId: "label" }])
    // A version the engine does not know reads as none, and is asked for again.
    expect(await first.getDiagramXml(DefinitionId("gone:1:d"))).toBeUndefined()
    expect(await first.getDiagramXml(DefinitionId("gone:1:d"))).toBeUndefined()
    expect(sent(engine).filter((request) => request.endsWith("/xml"))).toEqual([
      "GET /process-definition/order:1:d/xml",
      "GET /process-definition/gone:1:d/xml",
      "GET /process-definition/gone:1:d/xml",
    ])
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

describe("c8RuntimeOf: the runtime of a Camunda 8 engine, per call", () => {
  const TOPOLOGY = { gatewayVersion: "8.10.9", brokers: [] }

  function c8(answers: Parameters<typeof c8Platform>[0]) {
    const platform = c8Platform(answers)
    const connection = createC8Connection(
      { id: "c8", baseUrl: CLUSTER },
      { type: "none" },
      {},
      platform,
    )
    return { platform, runtime: c8RuntimeOf(connection) }
  }

  it("is C8Runtime over the connection's transport, a new one per call", async () => {
    const { platform, runtime } = c8({ "GET /v2/topology": () => json(TOPOLOGY) })
    const first = runtime()
    expect(first).toBeInstanceOf(C8Runtime)
    expect(runtime()).not.toBe(first)
    expect(await first.describeEngine()).toEqual({ product: "Camunda 8", version: "8.10.9" })
    expect(platform.sent.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "GET /v2/topology",
    ])
  })

  it("fails in the server's Camunda 8 words", async () => {
    const { runtime } = c8({ "GET /v2/topology": () => problem(500, "INTERNAL", "boom") })
    await expect(runtime().describeEngine()).rejects.toMatchObject({
      failure: "engineFailure",
      message: "[500 INTERNAL] boom (engine c8)",
    })
  })

  it("aborts the reads of a call with that call's signal", async () => {
    const { runtime } = c8({ "GET /v2/topology": hang })
    const leaving = new AbortController()
    const read = runtime(leaving.signal).describeEngine()
    leaving.abort()
    await expect(read).rejects.toMatchObject({
      failure: "unreachable",
      message: "request to engine c8 was cancelled by the caller",
    })
  })
})

describe("contractRuntimeOf: a configured Camunda 8 engine's runtime, built at boot", () => {
  const entry = { id: "c8", baseUrl: CLUSTER, flavor: "camunda8" as const }

  it("signs in as its profile says, with nothing when it says nothing, and sends nothing yet", () => {
    for (const auth of [
      undefined,
      { type: "basic" as const, username: "demo", password: "demo" },
      {
        type: "clientCredentials" as const,
        tokenEndpoint: "https://login.example.com/token",
        clientId: "pulse",
        clientSecret: "s3cret",
      },
    ]) {
      expect(contractRuntimeOf({ ...entry, auth }, { timeoutMs: 5_000 })()).toBeInstanceOf(
        C8Runtime,
      )
    }
  })

  it("ends a read at the profile's deadline, else at the server's", async () => {
    // A cluster that takes each request and never answers; any other path it answers at once.
    const cluster = await startRawEngine({ "GET /topology": () => undefined })
    try {
      const own = contractRuntimeOf(
        { ...entry, baseUrl: cluster.baseUrl, timeoutMs: 40 },
        { timeoutMs: 2_000 },
      )
      await expect(own().describeEngine()).rejects.toMatchObject({
        failure: "unreachable",
        message: "engine c8 did not respond within 40 ms (timeout)",
      })
      const servers = contractRuntimeOf({ ...entry, baseUrl: cluster.baseUrl }, { timeoutMs: 30 })
      await expect(servers().describeEngine()).rejects.toMatchObject({
        message: "engine c8 did not respond within 30 ms (timeout)",
      })
    } finally {
      await cluster.close()
    }
  })

  it.each(["bearer", "passthrough"] as const)(
    "refuses %s, which the profiles never let through to a Camunda 8 engine",
    (type) => {
      expect(() => contractRuntimeOf({ ...entry, auth: { type, token: "t" } })).toThrow(
        `Engine "c8" is a Camunda 8 engine, which the server never signs in to with ${type}`,
      )
    },
  )
})
