import { afterEach, describe, expect, it } from "vitest"
import { runWithMcpRequestInfo } from "@miragon/pulse-widget-shell/server"
import { withCallerSignal } from "@miragon/pulse-c7-client"
import {
  clientFor,
  startFakeEngine,
  type FakeEngine,
  type FakeRoute,
} from "../../tools/test-support/fake-engine.js"
import { fetchDefinitionXml } from "./definition-xml.js"

const engines: FakeEngine[] = []
afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

async function engineWith(route: FakeRoute) {
  const engine = await startFakeEngine({}, route)
  engines.push(engine)
  return { engine, client: clientFor(engine), xmlReads: () => engine.requests.length }
}

const xmlOf = (id: string) => ({ body: { id, bpmn20Xml: `<definitions id="${id}"/>` } })
const byPath: FakeRoute = (request) => xmlOf(request.path.split("/")[2] ?? "")

describe("fetchDefinitionXml", () => {
  it("reads a definition's XML once per client and caller, concurrent reads included", async () => {
    const { client, xmlReads } = await engineWith(byPath)
    const [a, b] = await Promise.all([
      fetchDefinitionXml(client, "order:1:d1"),
      fetchDefinitionXml(client, "order:1:d1"),
    ])
    expect(a).toBe('<definitions id="order:1:d1"/>')
    expect(b).toBe(a)
    expect(await fetchDefinitionXml(client, "order:1:d1")).toBe(a)
    expect(xmlReads()).toBe(1)
    await fetchDefinitionXml(client, "order:2:d2")
    expect(xmlReads()).toBe(2)
  })

  // Every tool call and feed reaches its engine through a view bound to the MCP request's signal.
  it("shares one cache across the per-call views of a client", async () => {
    const { client, xmlReads } = await engineWith(byPath)
    const view = () => withCallerSignal(client, new AbortController().signal)
    await fetchDefinitionXml(view(), "order:1:d1")
    await fetchDefinitionXml(view(), "order:1:d1")
    await fetchDefinitionXml(client, "order:1:d1")
    expect(xmlReads()).toBe(1)
  })

  // A shared read runs on the signal of the call that started it; its cancellation is that call's.
  it("does not fail a joining call when the call that started the read is cancelled", async () => {
    const { client, xmlReads } = await engineWith(byPath)
    const cancelled = new AbortController()
    cancelled.abort()
    const started = fetchDefinitionXml(withCallerSignal(client, cancelled.signal), "order:1:d1")
    const joined = fetchDefinitionXml(
      withCallerSignal(client, new AbortController().signal),
      "order:1:d1",
    )
    await expect(started).rejects.toMatchObject({ kind: "cancelled" })
    expect(await joined).toBe('<definitions id="order:1:d1"/>')
    expect(await fetchDefinitionXml(client, "order:1:d1")).toBe('<definitions id="order:1:d1"/>')
    expect(xmlReads()).toBe(1)
  })

  it("fails a joining call that is cancelled itself", async () => {
    const { client } = await engineWith(byPath)
    const first = new AbortController()
    first.abort()
    const second = new AbortController()
    second.abort()
    const started = fetchDefinitionXml(withCallerSignal(client, first.signal), "order:1:d1")
    const joined = fetchDefinitionXml(withCallerSignal(client, second.signal), "order:1:d1")
    await expect(started).rejects.toMatchObject({ kind: "cancelled" })
    await expect(joined).rejects.toMatchObject({ kind: "cancelled" })
  })

  it("keeps each caller's reads apart", async () => {
    const { client, xmlReads } = await engineWith(byPath)
    const as = (authorization: string) =>
      runWithMcpRequestInfo({ authorization }, () => fetchDefinitionXml(client, "order:1:d1"))
    await as("Bearer alice")
    await as("Bearer alice")
    await as("Bearer bob")
    expect(xmlReads()).toBe(2)
  })

  it("keeps nothing across engine clients", async () => {
    const one = await engineWith(byPath)
    const other = await engineWith(byPath)
    await fetchDefinitionXml(one.client, "order:1:d1")
    await fetchDefinitionXml(other.client, "order:1:d1")
    expect(one.xmlReads() + other.xmlReads()).toBe(2)
  })

  it("does not keep a failed read: the next call asks again", async () => {
    let fail = true
    const { client, xmlReads } = await engineWith((request) =>
      fail ? { status: 503, body: { message: "down" } } : byPath(request),
    )
    await expect(fetchDefinitionXml(client, "order:1:d1")).rejects.toThrow()
    fail = false
    expect(await fetchDefinitionXml(client, "order:1:d1")).toBe('<definitions id="order:1:d1"/>')
    expect(xmlReads()).toBe(2)
  })

  it("reads a reply without XML as null, and keeps that too", async () => {
    const { client, xmlReads } = await engineWith({ body: { id: "order:1:d1" } })
    expect(await fetchDefinitionXml(client, "order:1:d1")).toBeNull()
    expect(await fetchDefinitionXml(client, "order:1:d1")).toBeNull()
    expect(xmlReads()).toBe(1)
  })

  it("holds at most 64 diagrams per client, dropping the least recently used", async () => {
    const { client, xmlReads } = await engineWith(byPath)
    for (let version = 1; version <= 65; version++) {
      await fetchDefinitionXml(client, `order:${version}:d`)
    }
    expect(xmlReads()).toBe(65)
    // Version 1 was the least recently used: dropped, read again.
    await fetchDefinitionXml(client, "order:1:d")
    expect(xmlReads()).toBe(66)
    // Version 65 is still there.
    await fetchDefinitionXml(client, "order:65:d")
    expect(xmlReads()).toBe(66)
  })
})
