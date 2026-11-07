import { ProtocolError, ProtocolErrorCode, ResourceTemplate } from "@modelcontextprotocol/server"
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest"
import { createComposedServer, type ComposedServer } from "./composed-server.js"
import { moduleOf } from "./composed-server.test-support.js"
import type { ModulePlugin } from "./composition.js"
import type { ModuleServer } from "./module-server.js"
import {
  LIST_TIMEOUT_MS,
  recordedResource,
  type RecordedResource,
} from "./resource-registration.js"
import { testServerContext } from "./testing/module-server.js"
import { buildViewResult } from "./view-results.js"
import { showToolBinding } from "./widget-tool-bindings.js"

/**
 * What a module's read, prompt and list callbacks can do to a request. Through the app, since the
 * SDK leaves a request unanswered behind a callback that gives it nothing to answer with: without
 * the guard, these tests run into their timeout.
 */

const SUBJECT = 'Resource "Board" of "acme"'
const VIEW = "ui://views/acme_show_view.html"

let failed: MockInstance<(...data: unknown[]) => void>
let warned: MockInstance<(...data: unknown[]) => void>

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {})
  vi.spyOn(console, "log").mockImplementation(() => {})
  warned = vi.spyOn(console, "warn").mockImplementation(() => {})
  failed = vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const compose = (...plugins: ModulePlugin[]) =>
  createComposedServer({
    info: { name: "callbacks-test", version: "0.0.0" },
    modules: plugins.map(moduleOf),
    bundle: { jsPath: "/nonexistent/mcp-app.js" },
    env: {},
  })

interface Answer {
  result?: Record<string, unknown>
  error?: { code: number; message: string; data?: unknown }
}

async function call(composed: ComposedServer, method: string, params: object = {}) {
  const response = await composed.app.fetch(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        host: "localhost",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  )
  const body = await response.text()
  const json = body.trimStart().startsWith("{")
    ? body
    : body
        .split("\n")
        .find((line) => line.startsWith("data: "))!
        .slice("data: ".length)
  return JSON.parse(json) as Answer
}

/** A module that registers what `register` says, next to a bundle view of its own. */
const acme = (register: (server: ModuleServer) => void): ModulePlugin => ({
  name: "acme",
  register: (server) => {
    server.registerTool(
      "acme_show_view",
      { annotations: { readOnlyHint: true }, ...showToolBinding("acme_show_view", "View") },
      () => buildViewResult({}, "A view."),
    )
    register(server)
  },
})

const answerless: [string, () => unknown][] = [
  ["undefined", () => undefined],
  ["null", () => null],
  ["nothing, asynchronously", async () => {}],
  ["an object without its array", () => ({})],
  ["its field in another shape", () => ({ contents: "x", messages: "x" })],
]

/** Typed as an error to reach the callback: a module may throw anything. */
const rejecting = (reason: Error) => Promise.reject(reason)

const throwers: [string, unknown][] = [
  ["undefined", undefined],
  ["null", null],
  ["an object whose message is no string", { message: { deep: true } }],
]

describe("a read callback", () => {
  const reading = (callback: () => unknown) =>
    compose(
      acme((server) => {
        server.registerResource("Board", "ui://acme/board.html", {}, callback as never)
      }),
    )
  const read = (composed: ComposedServer) =>
    call(composed, "resources/read", { uri: "ui://acme/board.html" })

  it.each(answerless)("that returns %s gets an answer naming the module", async (_, callback) => {
    const { error } = await read(await reading(callback))
    expect(error?.message).toBe(`${SUBJECT} returned no contents array.`)
  })

  it.each(throwers)("that throws %s gets an answer naming the module", async (_, thrown) => {
    const { error } = await read(await reading(() => rejecting(thrown as Error)))
    expect(error).toEqual({ code: -32603, message: `${SUBJECT} failed.` })
    expect(failed).toHaveBeenCalledExactlyOnceWith(`${SUBJECT} failed:`, thrown)
  })

  it("that throws sends its message, no data and no code of its own, and logs its stack", async () => {
    const failure = Object.assign(new TypeError("read failed"), {
      code: 7,
      data: { password: "hunter2" },
    })
    const { error } = await read(await reading(() => Promise.reject(failure)))
    expect(error).toEqual({ code: -32603, message: "read failed" })
    expect(failed).toHaveBeenCalledExactlyOnceWith(`${SUBJECT} failed:`, failure)
  })

  it("keeps a module's deliberate protocol answer, its code and its data", async () => {
    const deliberate = new ProtocolError(ProtocolErrorCode.InvalidParams, "No such board", { b: 7 })
    const { error } = await read(await reading(() => Promise.reject(deliberate)))
    expect(error).toEqual({ code: -32602, message: "No such board", data: { b: 7 } })
    expect(failed).not.toHaveBeenCalled()
  })

  it("that answers reads as ever, and asks nothing of the other modules", async () => {
    const contents = [{ uri: "ui://acme/board.html", text: "<!doctype html>" }]
    const composed = await reading(() => ({ contents }))
    expect((await read(composed)).result).toEqual({ contents })
    const view = await call(composed, "resources/read", { uri: VIEW })
    expect(view.error).toBeUndefined()
  })

  it("of a template answers the same way", async () => {
    const composed = await compose(
      acme((server) => {
        const template = new ResourceTemplate("ui://acme/{id}.html", { list: undefined })
        server.registerResource("Board", template, {}, (() => undefined) as never)
      }),
    )
    const { error } = await call(composed, "resources/read", { uri: "ui://acme/7.html" })
    expect(error?.message).toBe(`${SUBJECT} returned no contents array.`)
  })
})

describe("a prompt callback", () => {
  const PROMPT = 'Prompt "plan" of "acme"'
  const prompting = (callback: () => unknown) =>
    compose(
      acme((server) => {
        server.registerPrompt("plan", {}, callback as never)
      }),
    )
  const get = (composed: ComposedServer) => call(composed, "prompts/get", { name: "plan" })

  it.each(answerless)("that returns %s gets an answer naming the module", async (_, callback) => {
    const { error } = await get(await prompting(callback))
    expect(error?.message).toBe(`${PROMPT} returned no messages array.`)
  })

  it.each(throwers)("that throws %s gets an answer naming the module", async (_, thrown) => {
    const { error } = await get(await prompting(() => rejecting(thrown as Error)))
    expect(error).toEqual({ code: -32603, message: `${PROMPT} failed.` })
  })

  it("that answers gets its messages through, with its arguments", async () => {
    const messages = [{ role: "user", content: { type: "text", text: "Plan." } }]
    const composed = await prompting(() => ({ messages }))
    expect((await get(composed)).result).toEqual({ messages })
  })
})

describe("a template's list callback", () => {
  const OTHER = "ui://other/o.html"
  const listing = (list: () => unknown) =>
    compose(
      acme((server) => {
        const template = new ResourceTemplate("ui://acme/{id}.html", { list: list as never })
        server.registerResource("Board", template, {}, () => ({ contents: [] }))
      }),
      {
        name: "other",
        register: (server) => {
          server.registerResource("Other", OTHER, {}, () => ({ contents: [] }))
        },
      },
    )
  const urisOf = async (composed: ComposedServer) => {
    const { result } = await call(composed, "resources/list")
    return (result?.resources as { uri: string }[]).map(({ uri }) => uri)
  }

  it("that throws costs its own entries, never the other modules' or its secret", async () => {
    const failure = new Error("db password=hunter2 at 10.0.0.1")
    const composed = await listing(() => Promise.reject(failure))
    const answer = await call(composed, "resources/list")
    expect(JSON.stringify(answer)).not.toContain("hunter2")
    expect(await urisOf(composed)).toEqual([VIEW, OTHER])
    expect(failed).toHaveBeenCalledWith(
      `${SUBJECT}: resources/list goes without its entries, its list callback failed:`,
      failure,
    )
  })

  it.each([
    ["undefined", () => undefined],
    ["a thrown undefined", () => rejecting(undefined as unknown as Error)],
    ["no array", () => ({ resources: "x" })],
  ])("that gives %s costs its own entries", async (_, list) => {
    expect(await urisOf(await listing(list))).toEqual([VIEW, OTHER])
    expect(failed).toHaveBeenCalledOnce()
  })

  it("lists what it names, and nothing under the boot's prefix", async () => {
    const composed = await listing(() => ({
      resources: [
        { uri: "ui://acme/1.html", name: "One" },
        { uri: VIEW, name: "A spoof of the bundle's view" },
      ],
    }))
    expect(await urisOf(composed)).toEqual([VIEW, OTHER, "ui://acme/1.html"])
    expect(warned).toHaveBeenCalledWith(
      `${SUBJECT}: its list callback names ui://views/, the boot's.`,
    )
    const { result } = await call(composed, "resources/list")
    const names = (result?.resources as { name: string }[]).map(({ name }) => name)
    expect(names).not.toContain("A spoof of the bundle's view")
  })

  it("keeps a template without one out of the listing, and its completion", async () => {
    const composed = await compose(
      acme((server) => {
        const template = new ResourceTemplate("ui://acme/{id}.html", {
          list: undefined,
          complete: { id: () => ["1", "2"] },
        })
        server.registerResource("Board", template, {}, () => ({ contents: [] }))
      }),
    )
    expect(await urisOf(composed)).toEqual([VIEW])
    const { result } = await call(composed, "completion/complete", {
      ref: { type: "ref/resource", uri: "ui://acme/{id}.html" },
      argument: { name: "id", value: "" },
    })
    expect(result?.completion).toEqual({ values: ["1", "2"], total: 2, hasMore: false })
  })
})

const recordedOf = (template: ResourceTemplate | undefined, callback: unknown): RecordedResource =>
  recordedResource(
    { name: "Board", owner: "acme", uri: "ui://acme/board.html", config: {} },
    template,
    callback,
  )

describe("a list callback that hangs", () => {
  it("gets up to its time, and then costs its own entries", async () => {
    vi.useFakeTimers()
    const template = new ResourceTemplate("ui://acme/{id}.html", {
      list: () => new Promise(() => {}),
    })
    const list = recordedOf(template, () => ({ contents: [] })).template!.listCallback!
    let listed: unknown
    void Promise.resolve(list(testServerContext())).then((result) => (listed = result))
    await vi.advanceTimersByTimeAsync(LIST_TIMEOUT_MS - 1)
    expect(listed).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    expect(listed).toEqual({ resources: [] })
    expect(failed).toHaveBeenCalledExactlyOnceWith(
      `${SUBJECT}: resources/list goes without its entries, its list callback gave no answer within ${LIST_TIMEOUT_MS} ms.`,
    )
  })

  it("leaves no timer behind one that answers", async () => {
    vi.useFakeTimers()
    const template = new ResourceTemplate("ui://acme/{id}.html", {
      list: () => ({ resources: [] }),
    })
    const list = recordedOf(template, () => ({ contents: [] })).template!.listCallback!
    await list(testServerContext())
    expect(vi.getTimerCount()).toBe(0)
  })
})
