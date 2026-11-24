import { describe, expect, it } from "vitest"
import { EngineError } from "../src/engine/connector.ts"
import { canonicalArgs, createEngine, pickEngine, resultData } from "../src/engine/engine.ts"
import { fakeConnector, ONE_ENGINE, pageOf } from "./fake.ts"

describe("the engine's calls", () => {
  it("adds the engine every call reads, resolved once from engine_list_engines", async () => {
    const connector = fakeConnector((name) =>
      name === "engine_list_engines" ? ONE_ENGINE : { ok: true },
    )
    const engine = createEngine(connector)
    await engine.call("engine_status", { processDefinitionKeyIn: ["a"] })
    await engine.call("engine_list_tasks", { processDefinitionKey: "a" })
    expect(connector.calls.map((call) => call.name)).toEqual([
      "engine_list_engines",
      "engine_status",
      "engine_list_tasks",
    ])
    expect(connector.calls[1].args).toEqual({ processDefinitionKeyIn: ["a"], engine: "prod-a" })
  })

  it("takes the default engine, else the only one, and names the choice it cannot make", () => {
    expect(pickEngine({ engines: [{ id: "a" }, { id: "b" }], defaultEngineId: "b" })).toBe("b")
    expect(pickEngine({ engines: [{ id: "a" }] })).toBe("a")
    expect(() => pickEngine({ engines: [{ id: "a" }, { id: "b" }] })).toThrow(/2 engines/)
  })

  it("keeps an answer by tool and canonical arguments, shares a call in flight, forgets on invalidate", async () => {
    let clock = 0
    const connector = fakeConnector((name) =>
      name === "engine_list_engines" ? ONE_ENGINE : { n: 1 },
    )
    const engine = createEngine(connector, { ttlMs: 1000, clock: () => clock })
    await Promise.all([
      engine.call("engine_status", { a: 1, b: 2 }),
      engine.call("engine_status", { b: 2, a: 1 }),
    ])
    await engine.call("engine_status", { a: 1, b: 2 })
    expect(connector.calls.filter((call) => call.name === "engine_status")).toHaveLength(1)
    clock = 1000
    await engine.call("engine_status", { a: 1, b: 2 })
    expect(connector.calls.filter((call) => call.name === "engine_status")).toHaveLength(2)
    engine.invalidate()
    await engine.call("engine_status", { a: 1, b: 2 })
    expect(connector.calls.filter((call) => call.name === "engine_list_engines")).toHaveLength(2)
  })

  it("asks past the caches under it for every call after invalidate, the viewer's Refresh", async () => {
    const connector = fakeConnector((name) =>
      name === "engine_list_engines" ? ONE_ENGINE : { ok: true },
    )
    const engine = createEngine(connector)
    await engine.call("engine_status", { a: 1 })
    expect(connector.calls.map((call) => call.options)).toEqual([
      { refresh: false },
      { refresh: false },
    ])
    engine.invalidate()
    await engine.call("engine_status", { a: 1 })
    await engine.call("engine_list_tasks", { b: 2 })
    expect(connector.calls.slice(2).map((call) => [call.name, call.options])).toEqual([
      ["engine_list_engines", { refresh: true }],
      ["engine_status", { refresh: true }],
      ["engine_list_tasks", { refresh: true }],
    ])
  })

  it("asks past the caches under it for a call whose last read failed, until it reads", async () => {
    let fail = true
    const connector = fakeConnector(() =>
      fail ? { isError: true, content: [{ type: "text", text: "[503] down" }] } : { ok: true },
    )
    const engine = createEngine(connector, { engineId: "prod-a", ttlMs: 0 })
    await expect(engine.call("engine_status")).rejects.toMatchObject({ code: "tool_error" })
    await expect(engine.call("engine_status")).rejects.toMatchObject({ code: "tool_error" })
    fail = false
    await engine.call("engine_status")
    await engine.call("engine_status")
    expect(connector.calls.map((call) => call.options?.refresh)).toEqual([false, true, true, false])
  })

  it("never keeps a failure: the next call reads again", async () => {
    let fail = true
    const connector = fakeConnector((name) => {
      if (name === "engine_list_engines") return ONE_ENGINE
      if (fail) return { isError: true, content: [{ type: "text", text: "[503] down" }] }
      return { ok: true }
    })
    const engine = createEngine(connector)
    await expect(engine.call("engine_status")).rejects.toMatchObject({
      code: "tool_error",
      detail: "[503] down",
    })
    fail = false
    await expect(engine.call("engine_status")).resolves.toEqual({ ok: true })
  })

  it("sorts keys at every depth for the cache key, keeping arrays in order", () => {
    expect(canonicalArgs({ b: [2, 1], a: { d: 1, c: 2 } })).toBe('{"a":{"c":2,"d":1},"b":[2,1]}')
  })

  it("reads structuredContent, else the JSON of the text, and throws an error result's text", () => {
    expect(resultData("engine_status", { structuredContent: { a: 1 } })).toEqual({ a: 1 })
    expect(resultData("engine_status", { content: [{ type: "text", text: '{"a":2}' }] })).toEqual({
      a: 2,
    })
    expect(() =>
      resultData("engine_status", { isError: true, content: [{ type: "text", text: "boom" }] }),
    ).toThrow(EngineError)
    expect(() =>
      resultData("engine_status", { content: [{ type: "text", text: "not json" }] }),
    ).toThrow(EngineError)
  })

  it("maps a thrown call to unavailable", async () => {
    const connector = fakeConnector(() => {
      throw new Error("socket closed")
    })
    const engine = createEngine(connector, { engineId: "prod-a" })
    await expect(engine.call("engine_status")).rejects.toMatchObject({
      code: "unavailable",
      tool: "engine_status",
    })
  })
})

describe("counts and pages", () => {
  it("counts with maxResults 1 (never 0) and reads totalCount, null when the server gives none", async () => {
    const connector = fakeConnector((_, args) =>
      args.withIncidents ? { items: [] } : { items: [{}], totalCount: 42, hasMore: true },
    )
    const engine = createEngine(connector, { engineId: "prod-a" })
    expect(await engine.count("engine_list_process_instances", { processDefinitionKey: "a" })).toBe(
      42,
    )
    expect(await engine.count("engine_list_process_instances", { withIncidents: true })).toBeNull()
    expect(connector.calls.every((call) => call.args.maxResults === 1)).toBe(true)
  })

  it("pages by 100 with nextOffset while the server has more", async () => {
    const rows = idRows(250)
    const connector = fakeConnector((_, args) => pageOf(rows, args))
    const engine = createEngine(connector, { engineId: "prod-a" })
    const paged = await engine.page<{ id: string; i: number }>("engine_list_tasks", {
      processDefinitionKey: "a",
    })
    expect(paged).toMatchObject({ total: 250, complete: true, cut: null })
    expect(paged.items.map((row) => row.i)).toEqual(rows.map((row) => row.i))
    expect(connector.calls.map((call) => [call.args.firstResult, call.args.maxResults])).toEqual([
      [0, 100],
      [100, 100],
      [200, 100],
    ])
  })

  it("stops at the cap: the engine's count stays the total, the rows are marked cut", async () => {
    const rows = idRows(1500)
    const connector = fakeConnector((_, args) => pageOf(rows, args))
    const engine = createEngine(connector, { engineId: "prod-a" })
    const paged = await engine.page("engine_list_tasks", {}, { cap: 1000 })
    expect(paged.items).toHaveLength(1000)
    expect(paged).toMatchObject({ total: 1500, complete: false, cut: "cap" })
    expect(connector.calls).toHaveLength(10)
  })

  it("gives a lower bound where the cap cuts and the server counts nothing", async () => {
    const rows = idRows(300)
    const connector = fakeConnector((_, args) => {
      const { totalCount: _total, ...page } = pageOf(rows, args)
      return page
    })
    const engine = createEngine(connector, { engineId: "prod-a" })
    expect(await engine.page("engine_list_tasks", {}, { cap: 200 })).toMatchObject({
      total: { atLeast: 200 },
      complete: false,
      cut: "cap",
    })
    expect(await engine.page("engine_list_tasks", { other: 1 })).toMatchObject({
      total: 300,
      complete: true,
      cut: null,
    })
  })

  it("keeps each row once by its id when rows come and go between pages, and marks the read cut", async () => {
    // Offset paging by id over a list that changes: after the first page a row arrives that sorts
    // first (the engine's ids are time-low first, so a new one sorts anywhere) and one goes.
    const rows = idRows(250)
    let served = 0
    const connector = fakeConnector((_, args) => {
      const page = pageOf(rows, args)
      served += 1
      if (served === 1) {
        rows.unshift({ id: "0000-new", i: -1 })
        rows.splice(150, 1)
      }
      return page
    })
    const engine = createEngine(connector, { engineId: "prod-a" })
    const paged = await engine.page<{ id: string; i: number }>("engine_list_tasks", {})
    const ids = paged.items.map((row) => row.id)
    // Row 99 came twice (page 1, and page 2 after the newcomer pushed it on); it is kept once.
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.filter((id) => id === rows[100].id)).toHaveLength(1)
    // The newcomer was missed, so the rows read are no complete list: a lower bound, said so.
    expect(ids).not.toContain("0000-new")
    expect(paged).toMatchObject({ total: 250, complete: false, cut: "changed" })
  })

  it("marks a read cut when a row went between pages, though the distinct rows match the count", async () => {
    // A row below the offset goes: every later row moves up one, so the first row of page 2 is
    // skipped. The distinct rows then equal the new count; the pages' counts disagree.
    const rows = idRows(150)
    let served = 0
    const connector = fakeConnector((_, args) => {
      const page = pageOf(rows, args)
      served += 1
      if (served === 1) rows.splice(5, 1)
      return page
    })
    const engine = createEngine(connector, { engineId: "prod-a" })
    const paged = await engine.page<{ id: string; i: number }>("engine_list_tasks", {})
    expect(paged.items).toHaveLength(149)
    expect(paged.items.map((row) => row.i)).not.toContain(100)
    expect(paged).toMatchObject({ total: 149, complete: false, cut: "changed" })
  })

  it("stays within the cap when the server's offset never moves", async () => {
    const rows = idRows(300)
    const connector = fakeConnector(() => ({ ...pageOf(rows, {}), nextOffset: 0 }))
    const engine = createEngine(connector, { engineId: "prod-a" })
    const paged = await engine.page("engine_list_tasks", {}, { cap: 500 })
    expect(connector.calls).toHaveLength(1)
    expect(paged.items).toHaveLength(20)
    expect(paged.complete).toBe(false)
  })
})

/** `n` rows with ids in the engine's order (`sortBy` an id, ascending). */
function idRows(n: number): { id: string; i: number }[] {
  return Array.from({ length: n }, (_, i) => ({ id: String(i).padStart(4, "0"), i }))
}
