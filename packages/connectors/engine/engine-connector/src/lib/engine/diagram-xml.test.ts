import { afterEach, describe, expect, it, vi } from "vitest"
import { runWithMcpRequestInfo } from "@miragon/pulse-widget-shell/server"
import type { ProcessRuntime } from "@miragon/pulse-engine-core"
import { FakeEngine, FakeWorld } from "@miragon/pulse-engine-core/testing"
import { fetchDefinitionXml } from "../bpmn/definition-xml.js"
import {
  type FakeEngine as FakeC7Engine,
  type FakeRoute,
  registryFor,
  startFakeEngine,
} from "../../tools/test-support/fake-engine.js"
import { diagramXmlOf } from "./diagram-xml.js"
import {
  type ContractRuntime,
  createEngineRegistry,
  resolveEngine,
  resolveRuntimeEngine,
} from "./resolve-engine.js"

const engines: FakeC7Engine[] = []
afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

const xmlOf = (id: string) => ({ body: { id, bpmn20Xml: `<definitions id="${id}"/>` } })
const byPath: FakeRoute = (request) => xmlOf(request.path.split("/")[2] ?? "")

describe("diagramXmlOf on a Camunda 7 engine", () => {
  it("reads through the engine's client with the request and the cache of every Camunda 7 path", async () => {
    const engine = await startFakeEngine({}, byPath)
    engines.push(engine)
    const registry = registryFor(engine)
    const callOf = () => ({ mcpReq: { signal: new AbortController().signal } })
    const resolved = resolveRuntimeEngine("fake", registry, callOf())
    expect(await diagramXmlOf(resolved, "order:1:d1")).toBe('<definitions id="order:1:d1"/>')
    // A tool's own read in another call, through another view of the client, finds it in the cache.
    const { client } = resolveEngine("fake", registry, callOf())
    expect("client" in resolved ? resolved.client : null).not.toBe(client)
    expect(await fetchDefinitionXml(client, "order:1:d1")).toBe('<definitions id="order:1:d1"/>')
    expect(engine.requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "GET /process-definition/order:1:d1/xml",
    ])
  })
})

/** An engine of another dialect over engine-core's fake world, its runtime factory a spy. */
function contractEngine(runtimeOf: () => ProcessRuntime = () => fake()) {
  const runtime = vi.fn<ContractRuntime>(() => runtimeOf())
  const registry = createEngineRegistry(
    [{ id: "c8", baseUrl: "https://c8.example/v2", flavor: "camunda8" }],
    () => {
      throw new Error("no client for another dialect")
    },
    { contractRuntime: () => runtime },
  )
  const resolve = (signal?: AbortSignal) =>
    resolveRuntimeEngine("c8", registry, signal === undefined ? undefined : { mcpReq: { signal } })
  return { runtime, resolve }
}

const fake = () => new FakeEngine(FakeWorld.seed().state)
const { world } = FakeWorld.seed()
const ORDER_1 = world.definitionIds["order@1"]
const ORDER_2 = world.definitionIds["order@2"]

describe("diagramXmlOf on an engine of another dialect", () => {
  it("reads its runtime's getDiagramXml, bound to the caller's signal", async () => {
    const { runtime, resolve } = contractEngine()
    const signal = new AbortController().signal
    const xml = await diagramXmlOf(resolve(signal), ORDER_1)
    expect(xml).toBe(await fake().getDiagramXml(ORDER_1))
    expect(xml).toContain("<bpmn:definitions")
    expect(runtime).toHaveBeenCalledExactlyOnceWith(signal)
  })

  it("keeps each diagram per engine and caller in the one XML cache", async () => {
    const { runtime, resolve } = contractEngine()
    await diagramXmlOf(resolve(), ORDER_1)
    await diagramXmlOf(resolve(), ORDER_1)
    expect(runtime).toHaveBeenCalledOnce()
    await diagramXmlOf(resolve(), ORDER_2)
    expect(runtime).toHaveBeenCalledTimes(2)
    await runWithMcpRequestInfo({ authorization: "Bearer bob" }, () =>
      diagramXmlOf(resolve(), ORDER_1),
    )
    expect(runtime).toHaveBeenCalledTimes(3)
    const other = contractEngine()
    await diagramXmlOf(other.resolve(), ORDER_1)
    expect([runtime.mock.calls.length, other.runtime.mock.calls.length]).toEqual([3, 1])
  })

  it("reads a version the engine does not know as null, and keeps that too", async () => {
    const { runtime, resolve } = contractEngine()
    expect(await diagramXmlOf(resolve(), "unknown:1")).toBeNull()
    expect(await diagramXmlOf(resolve(), "unknown:1")).toBeNull()
    expect(runtime).toHaveBeenCalledOnce()
  })

  it("does not keep a failed read: the next call asks again", async () => {
    let fail = true
    const { runtime, resolve } = contractEngine(() => {
      const runtime = fake()
      if (!fail) return runtime
      return Object.assign(Object.create(runtime) as ProcessRuntime, {
        getDiagramXml: () => Promise.reject(new Error("down")),
      })
    })
    await expect(diagramXmlOf(resolve(), ORDER_1)).rejects.toThrow("down")
    fail = false
    expect(await diagramXmlOf(resolve(), ORDER_1)).toContain("<bpmn:definitions")
    expect(runtime).toHaveBeenCalledTimes(2)
  })
})
