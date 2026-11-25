import { afterEach, describe, expect, it, vi } from "vitest"
import { CancelledError, QueryClient, QueryObserver } from "@tanstack/react-query"
import { getFormatTimeZone, setFormatLocale } from "@miragon/pulse-ui"
import { ToolResultError, type ToolResult } from "../../protocol/tool-result.js"
import type { ToolCaller } from "../browser-view-host.js"
import { createTestQueryClient } from "../test-view-host.js"
import { createViewQueryClient } from "../tool-query.js"
import type { ToolCallOptions } from "../view-host.js"
import { PageCallError } from "./page-call-error.js"
import {
  createPageReader,
  markRefreshed,
  PAGE_READ_TTL_MS,
  PAGE_READS,
  readerOf,
  refreshPageReads,
  SECTION_READS,
  wasRefreshed,
} from "./page-reader.js"

/**
 * The calls of a page's reads, without React: one call per connection, tool and arguments, shared
 * while it runs, kept 30 s, never a failure; asked past every cache once the page was refreshed or
 * the call settled before; never retried at this level. Plain Node, as a recorder runs them.
 */

interface Call {
  readonly tool: string
  readonly args: Record<string, unknown>
  readonly options: ToolCallOptions | undefined
}

/** A caller over `answer` (its value is the structured data, a `ToolResult` as it is), recording calls. */
function caller(answer: (tool: string, args: Record<string, unknown>) => unknown = () => ({})) {
  const calls: Call[] = []
  const callTool: ToolCaller = async (tool, args, options) => {
    calls.push({ tool, args, options })
    const value = await answer(tool, args)
    if (typeof value === "object" && value !== null && "isError" in value)
      return value as ToolResult
    return { structuredContent: value }
  }
  return { callTool, calls }
}

const failure = (text: string): ToolResult => ({ isError: true, content: [{ type: "text", text }] })

const NOW = () => new Date("2026-11-25T10:00:00.000Z")

function reader(callTool: ToolCaller, client = createTestQueryClient()) {
  return { client, reader: readerOf(callTool, client, "Europe/Berlin", NOW) }
}

afterEach(() => {
  vi.useRealTimers()
  setFormatLocale(undefined)
})

describe("a page's call", () => {
  it("makes one call for the same tool and arguments in any key order, shared while it runs", async () => {
    const { callTool, calls } = caller(() => ({ n: 1 }))
    const { reader: read } = reader(callTool)
    const answers = await Promise.all([
      read.call("engine_process_stats", { a: 1, b: { c: 2, d: 3 } }),
      read.call("engine_process_stats", { b: { d: 3, c: 2 }, a: 1 }),
    ])
    expect(answers).toEqual([{ n: 1 }, { n: 1 }])
    await read.call("engine_process_stats", { a: 1, b: { c: 2, d: 3 } })
    expect(calls).toHaveLength(1)
    await read.call("engine_process_stats", { a: 2, b: { c: 2, d: 3 } })
    await read.call("engine_activity_counts", { a: 1, b: { c: 2, d: 3 } })
    expect(calls.map((call) => [call.tool, call.args.a])).toEqual([
      ["engine_process_stats", 1],
      ["engine_process_stats", 2],
      ["engine_activity_counts", 1],
    ])
  })

  it("keeps an answer 30 s, then asks the server again past the caller's caches", async () => {
    vi.useFakeTimers()
    const { callTool, calls } = caller(() => ({ n: 1 }))
    const { reader: read } = reader(callTool)
    await read.call("engine_process_stats")
    vi.advanceTimersByTime(PAGE_READ_TTL_MS - 1)
    await read.call("engine_process_stats")
    expect(calls).toHaveLength(1)
    vi.advanceTimersByTime(1)
    await read.call("engine_process_stats")
    expect(calls.map((call) => call.options)).toEqual([{ refresh: false }, { refresh: true }])
  })

  it("never keeps a failure: the next call asks again, past the caches, until it reads", async () => {
    let fail = true
    const { callTool, calls } = caller(() => (fail ? failure("[503] down") : { ok: true }))
    const { reader: read } = reader(callTool)
    await expect(read.call("engine_process_stats")).rejects.toThrow("[503] down")
    await expect(read.call("engine_process_stats")).rejects.toBeInstanceOf(ToolResultError)
    fail = false
    await expect(read.call("engine_process_stats")).resolves.toEqual({ ok: true })
    await read.call("engine_process_stats")
    expect(calls.map((call) => call.options?.refresh)).toEqual([false, true, true])
  })

  it("asks past the caches for every call once the page was refreshed, on that client alone", async () => {
    const { callTool, calls } = caller()
    const { client, reader: read } = reader(callTool)
    const other = reader(callTool).reader
    expect(wasRefreshed(client)).toBe(false)
    markRefreshed(client)
    expect(wasRefreshed(client)).toBe(true)
    await read.call("engine_process_stats")
    await other.call("engine_activity_counts")
    expect(calls.map((call) => [call.tool, call.options?.refresh])).toEqual([
      ["engine_process_stats", true],
      ["engine_activity_counts", false],
    ])
  })

  it("keys a call by its connection and hands the caller the one it names", async () => {
    const { callTool, calls } = caller((_tool, args) => ({ args }))
    const { reader: read } = reader(callTool)
    await read.call("crm_accounts", { q: 1 })
    await read.call("crm_accounts", { q: 1 }, { connector: "Acme CRM" })
    await read.call("crm_accounts", { q: 1 }, { connector: "Acme CRM" })
    await read.call("crm_accounts", { q: 1 }, {})
    expect(calls.map((call) => call.options)).toStrictEqual([
      { refresh: false },
      { refresh: false, connector: "Acme CRM" },
    ])
  })

  it("keeps its calls under the page reads' own key root, apart from any query of the page's own", async () => {
    const { client, reader: read } = reader(caller().callTool)
    await read.call("crm_accounts", { q: 1 }, { connector: "Acme CRM" })
    expect(
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey),
    ).toEqual([["pulse-page-reads", "call", "Acme CRM", "crm_accounts", { q: 1 }]])
    expect(SECTION_READS).toEqual(["pulse-page-reads", "section"])
  })

  it("asks as a first read again where its first read was cancelled before it settled", async () => {
    let release: () => void = () => undefined
    const { callTool, calls } = caller(async () => {
      await new Promise<void>((resolve) => (release = resolve))
      return { ok: true }
    })
    const { client, reader: read } = reader(callTool)
    const first = read.call("engine_process_stats").catch((thrown: unknown) => thrown)
    await client.cancelQueries({ queryKey: [PAGE_READS] })
    release()
    expect(await first).toBeInstanceOf(CancelledError)
    const again = read.call("engine_process_stats")
    release()
    await again
    expect(calls.map((call) => call.options?.refresh)).toEqual([false, false])
  })

  it("never retries a call, where the page's client retries its reads (the section retries)", async () => {
    const client = createViewQueryClient()
    const { callTool, calls } = caller(() => failure("[503 ServiceUnavailable] down"))
    const read = readerOf(callTool, client, "UTC", NOW)
    await expect(read.call("engine_process_stats")).rejects.toThrow("down")
    const thrown = vi.fn<ToolCaller>(() => Promise.reject(new Error("socket closed")))
    await expect(readerOf(thrown, client, "UTC", NOW).call("engine_bpmn_xml")).rejects.toThrow(
      "socket closed",
    )
    expect(calls).toHaveLength(1)
    expect(thrown).toHaveBeenCalledTimes(1)
  })

  it("rejects a refusal of the caller as it is", async () => {
    const refusal = new PageCallError("needs_reauth", "[needs_reauth] expired", {
      tool: "engine_process_stats",
      connector: "Pulse",
    })
    const { reader: read } = reader(() => Promise.reject(refusal))
    await expect(read.call("engine_process_stats")).rejects.toBe(refusal)
  })

  it("decodes an answer as the view runtime does: structured data, else its text's JSON, else its text", async () => {
    const { reader: read } = reader(async (tool) => {
      if (tool === "json") return { content: [{ type: "text", text: '{"a":2}' }] }
      if (tool === "text") return { content: [{ type: "text", text: "not json" }] }
      if (tool === "error") return failure("Input validation error: unknown key foo")
      return { structuredContent: { a: 1 }, content: [{ type: "text", text: "ignored" }] }
    })
    expect(await read.call("structured")).toEqual({ a: 1 })
    expect(await read.call("json")).toEqual({ a: 2 })
    expect(await read.call("text")).toBe("not json")
    const error = await read.call("error").catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(ToolResultError)
    expect((error as Error).message).toBe("Input validation error: unknown key foo")
  })

  it("tells the read each answer's asOf, a kept answer's too, and nothing for an answer without one", async () => {
    const { callTool } = caller((tool) =>
      tool === "dated"
        ? { asOf: "2026-11-25T09:59:30.000Z" }
        : tool === "bad"
          ? { asOf: "yesterday" }
          : tool === "number"
            ? { asOf: 5 }
            : tool === "null"
              ? { isError: false, content: [{ type: "text", text: "null" }] }
              : "plain",
    )
    const client = createTestQueryClient()
    const seen: number[] = []
    const read = readerOf(callTool, client, "UTC", NOW, (at) => seen.push(at))
    await read.call("dated")
    await read.call("dated")
    await read.call("bad")
    await read.call("number")
    expect(await read.call("null")).toBeNull()
    await read.call("plain")
    expect(seen).toEqual([
      Date.parse("2026-11-25T09:59:30.000Z"),
      Date.parse("2026-11-25T09:59:30.000Z"),
    ])
    await readerOf(callTool, client, "UTC", NOW).call("dated")
  })

  it("names its zone and clock", () => {
    const read = readerOf(caller().callTool, createTestQueryClient(), "Asia/Tokyo", NOW)
    expect(read.timeZone).toBe("Asia/Tokyo")
    expect(read.now()).toEqual(NOW())
  })
})

describe("createPageReader", () => {
  it("counts days in the zone the formatters render in and reads now, unless told", async () => {
    const read = createPageReader(caller().callTool)
    expect(read.timeZone).toBe(getFormatTimeZone())
    setFormatLocale({ language: "de", locale: "de", timeZone: "Asia/Tokyo" })
    expect(createPageReader(caller().callTool).timeZone).toBe("Asia/Tokyo")
    const before = Date.now()
    expect(read.now().getTime()).toBeGreaterThanOrEqual(before)
    const given = createPageReader(caller().callTool, { timeZone: "Europe/Berlin", now: NOW })
    expect([given.timeZone, given.now()]).toEqual(["Europe/Berlin", NOW()])
  })

  it("keeps its answers in a client of its own that holds no timer, or in the one given", async () => {
    vi.useFakeTimers()
    const { callTool, calls } = caller(() => ({ ok: true }))
    const read = createPageReader(callTool)
    await read.call("engine_process_stats", { a: 1 })
    await read.call("engine_process_stats", { a: 1 })
    expect(calls).toHaveLength(1)
    // In Node a client keeps its queries for good: no garbage collection timer keeps a recorder alive.
    expect(vi.getTimerCount()).toBe(0)
    const client = new QueryClient()
    await createPageReader(callTool, { client }).call("engine_process_stats", { a: 1 })
    expect(client.getQueryCache().findAll({ queryKey: [PAGE_READS, "call"] })).toHaveLength(1)
  })
})

describe("the page's Refresh", () => {
  /** A section's read in the cache, failed with `error` or holding data; mounted when `observed`. */
  async function section(client: QueryClient, name: string, outcome: unknown, observed = false) {
    const queryKey = [...SECTION_READS, name]
    const queryFn = vi.fn(() =>
      outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome),
    )
    const observer = new QueryObserver(client, { queryKey, queryFn, retry: false })
    const unsubscribe = observed ? observer.subscribe(() => undefined) : () => undefined
    await client.fetchQuery({ queryKey, queryFn, retry: false }).catch(() => undefined)
    queryFn.mockClear()
    return { queryKey, queryFn, unsubscribe }
  }

  const refused = new PageCallError("not_connected", "no connector", { connector: "Pulse" })

  it("asks fresh from now on, resets the sections a refusal of a connection failed and reads the mounted ones again", async () => {
    const client = createTestQueryClient()
    const gated = await section(client, "gated", refused)
    const shown = await section(client, "shown", { data: 1, at: 0 }, true)
    const failed = await section(client, "failed", new PageCallError("not_allowed", "no"))
    const call = [PAGE_READS, "call", null, "engine_process_stats", {}]
    await client.fetchQuery({ queryKey: call, queryFn: () => ({ n: 1 }), staleTime: 30_000 })

    await refreshPageReads(client)

    expect(wasRefreshed(client)).toBe(true)
    expect(client.getQueryState(gated.queryKey)?.status).toBe("pending")
    expect(client.getQueryState(failed.queryKey)?.status).toBe("error")
    expect(shown.queryFn).toHaveBeenCalledTimes(1)
    expect(gated.queryFn).not.toHaveBeenCalled()
    expect(client.getQueryState(call)?.isInvalidated).toBe(true)
    shown.unsubscribe()
  })

  it("cancels a read that runs, so none joins a call sent before it", async () => {
    const client = createTestQueryClient()
    let release: (value: unknown) => void = () => undefined
    const queryKey = [PAGE_READS, "call", null, "slow", {}]
    const first = client
      .fetchQuery({ queryKey, queryFn: () => new Promise((resolve) => (release = resolve)) })
      .catch((thrown: unknown) => thrown)
    await refreshPageReads(client)
    release({ late: true })
    expect(await first).toBeInstanceOf(CancelledError)
    expect(client.getQueryState(queryKey)?.fetchStatus).toBe("idle")
    expect(client.getQueryState(queryKey)?.data).toBeUndefined()
  })

  it("leaves what is no page read alone, and a call's refusal to the next call", async () => {
    const client = createTestQueryClient()
    await client.fetchQuery({ queryKey: ["other"], queryFn: () => 1, staleTime: 30_000 })
    await client
      .fetchQuery({ queryKey: ["own"], queryFn: () => Promise.reject(refused) })
      .catch(() => undefined)
    const call = [PAGE_READS, "call", null, "engine_process_stats", {}]
    await client
      .fetchQuery({ queryKey: call, queryFn: () => Promise.reject(refused) })
      .catch(() => undefined)
    let release: (value: number) => void = () => undefined
    const running = client.fetchQuery({
      queryKey: ["running"],
      queryFn: () => new Promise<number>((resolve) => (release = resolve)),
    })

    await refreshPageReads(client)
    release(2)

    expect(await running).toBe(2)
    expect(client.getQueryState(["other"])?.isInvalidated).toBe(false)
    expect(client.getQueryState(["own"])?.error).toBe(refused)
    expect(client.getQueryState(call)?.error).toBe(refused)
  })
})
