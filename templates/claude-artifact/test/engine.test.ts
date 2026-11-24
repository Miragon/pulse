import { describe, expect, it } from "vitest"
import { EngineError } from "../src/engine/connector.ts"
import { canonicalArgs, createEngine, resultData, viewerTimeZone } from "../src/engine/engine.ts"
import { fakeConnector } from "./fake.ts"

describe("the engine's calls", () => {
  it("names no engine, so the server reads its default one, unless the page names one", async () => {
    const connector = fakeConnector(() => ({ ok: true }))
    await createEngine(connector).call("engine_activity_counts", { processDefinitionKey: "a" })
    await createEngine(connector, { engineId: "prod-b" }).call("engine_activity_counts", {
      processDefinitionKey: "a",
    })
    expect(connector.calls.map((call) => call.args)).toEqual([
      { processDefinitionKey: "a" },
      { processDefinitionKey: "a", engine: "prod-b" },
    ])
  })

  it("counts the days in the viewer's time zone unless told another", () => {
    const connector = fakeConnector(() => ({}))
    expect(createEngine(connector).timeZone).toBe(viewerTimeZone())
    expect(createEngine(connector, { timeZone: "Europe/Berlin" }).timeZone).toBe("Europe/Berlin")
    expect(viewerTimeZone()).not.toBe("")
  })

  it("keeps an answer by tool and canonical arguments, shares a call in flight, forgets on invalidate", async () => {
    let clock = 0
    const connector = fakeConnector(() => ({ n: 1 }))
    const engine = createEngine(connector, { ttlMs: 1000, clock: () => clock })
    const calls = () => connector.calls.filter((call) => call.name === "engine_process_stats")
    await Promise.all([
      engine.call("engine_process_stats", { a: 1, b: 2 }),
      engine.call("engine_process_stats", { b: 2, a: 1 }),
    ])
    await engine.call("engine_process_stats", { a: 1, b: 2 })
    expect(calls()).toHaveLength(1)
    clock = 1000
    await engine.call("engine_process_stats", { a: 1, b: 2 })
    expect(calls()).toHaveLength(2)
    engine.invalidate()
    await engine.call("engine_process_stats", { a: 1, b: 2 })
    expect(calls()).toHaveLength(3)
  })

  it("asks past the caches under it for every call after invalidate, the viewer's Refresh", async () => {
    const connector = fakeConnector(() => ({ ok: true }))
    const engine = createEngine(connector)
    await engine.call("engine_process_stats", { a: 1 })
    expect(connector.calls.map((call) => call.options)).toEqual([{ refresh: false }])
    engine.invalidate()
    await engine.call("engine_process_stats", { a: 1 })
    await engine.call("engine_activity_counts", { b: 2 })
    expect(connector.calls.slice(1).map((call) => [call.name, call.options])).toEqual([
      ["engine_process_stats", { refresh: true }],
      ["engine_activity_counts", { refresh: true }],
    ])
  })

  it("asks past the caches under it for a call whose last read failed, until it reads", async () => {
    let fail = true
    const connector = fakeConnector(() =>
      fail ? { isError: true, content: [{ type: "text", text: "[503] down" }] } : { ok: true },
    )
    const engine = createEngine(connector, { ttlMs: 0 })
    await expect(engine.call("engine_process_stats")).rejects.toMatchObject({ code: "tool_error" })
    await expect(engine.call("engine_process_stats")).rejects.toMatchObject({ code: "tool_error" })
    fail = false
    await engine.call("engine_process_stats")
    await engine.call("engine_process_stats")
    expect(connector.calls.map((call) => call.options?.refresh)).toEqual([false, true, true, false])
  })

  it("never keeps a failure: the next call reads again", async () => {
    let fail = true
    const connector = fakeConnector(() =>
      fail ? { isError: true, content: [{ type: "text", text: "[503] down" }] } : { ok: true },
    )
    const engine = createEngine(connector)
    await expect(engine.call("engine_process_stats")).rejects.toMatchObject({
      code: "tool_error",
      detail: "[503] down",
    })
    fail = false
    await expect(engine.call("engine_process_stats")).resolves.toEqual({ ok: true })
  })

  it("sorts keys at every depth for the cache key, keeping arrays in order", () => {
    expect(canonicalArgs({ b: [2, 1], a: { d: 1, c: 2 } })).toBe('{"a":{"c":2,"d":1},"b":[2,1]}')
  })

  it("reads structuredContent, else the JSON of the text, and throws an error result's text", () => {
    const tool = "engine_process_stats"
    expect(resultData(tool, { structuredContent: { a: 1 } })).toEqual({ a: 1 })
    expect(resultData(tool, { content: [{ type: "text", text: '{"a":2}' }] })).toEqual({ a: 2 })
    expect(() =>
      resultData(tool, { isError: true, content: [{ type: "text", text: "boom" }] }),
    ).toThrow(EngineError)
    expect(() => resultData(tool, { content: [{ type: "text", text: "not json" }] })).toThrow(
      EngineError,
    )
  })

  it("maps a thrown call to unavailable", async () => {
    const connector = fakeConnector(() => {
      throw new Error("socket closed")
    })
    await expect(createEngine(connector).call("engine_process_stats")).rejects.toMatchObject({
      code: "unavailable",
      tool: "engine_process_stats",
    })
  })
})
