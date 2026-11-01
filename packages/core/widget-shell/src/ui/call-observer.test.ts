// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest"
import {
  createCallObserver,
  installCallObserver,
  NO_CALL_OBSERVATION,
  reduceCallObservation,
  type CallObservation,
} from "./call-observer.js"

const note = (method: string, params: Record<string, unknown> = {}) => ({
  jsonrpc: "2.0",
  method,
  params,
})

const fold = (...messages: unknown[]): CallObservation =>
  messages.reduce<CallObservation>(reduceCallObservation, NO_CALL_OBSERVATION)

describe("reduceCallObservation", () => {
  it("takes the COMPLETE tool input, never a partial stream", () => {
    expect(
      fold(
        note("ui/notifications/tool-input-partial", { arguments: { engine: "pr" } }),
        note("ui/notifications/tool-input", { arguments: { engine: "prod" } }),
      ),
    ).toEqual({ args: { engine: "prod" }, result: "none", cancelled: false })
    expect(fold(note("ui/notifications/tool-input", {})).args).toEqual({})
  })

  it("tells a stripped result from a structured one and from an error, like mcp-use's latch", () => {
    const result = (params: Record<string, unknown>) =>
      fold(note("ui/notifications/tool-result", params)).result
    expect(result({ content: [{ type: "text", text: "summary" }] })).toBe("stripped")
    expect(result({ structuredContent: { rows: [] } })).toBe("structured")
    // mcp-use latches a null structuredContent as ready: not stripped.
    expect(result({ structuredContent: null })).toBe("structured")
    expect(result({ isError: true, structuredContent: { x: 1 } })).toBe("error")
  })

  it("notes a cancel", () => {
    expect(fold(note("ui/notifications/tool-cancelled", { reason: "stop" })).cancelled).toBe(true)
  })

  it("settles once: after a result or a cancel nothing changes it", () => {
    const settled = fold(
      note("ui/notifications/tool-input", { arguments: { a: 1 } }),
      note("ui/notifications/tool-result", { content: [] }),
    )
    expect(
      fold(
        note("ui/notifications/tool-input", { arguments: { a: 1 } }),
        note("ui/notifications/tool-result", { content: [] }),
        note("ui/notifications/tool-input", { arguments: { a: 2 } }),
        note("ui/notifications/tool-result", { structuredContent: {} }),
        note("ui/notifications/tool-cancelled"),
      ),
    ).toEqual(settled)
    const cancelled = fold(note("ui/notifications/tool-cancelled"))
    expect(reduceCallObservation(cancelled, note("ui/notifications/tool-result", {}))).toBe(
      cancelled,
    )
  })

  it("ignores foreign traffic: non-2.0, responses, other methods, non-objects", () => {
    for (const data of [
      null,
      "ui/notifications/tool-result",
      { jsonrpc: "1.0", method: "ui/notifications/tool-cancelled" },
      { jsonrpc: "2.0", id: 1, result: {} },
      note("ui/notifications/host-context-changed", { theme: "dark" }),
    ]) {
      expect(reduceCallObservation(NO_CALL_OBSERVATION, data)).toBe(NO_CALL_OBSERVATION)
    }
  })
})

describe("createCallObserver", () => {
  function source() {
    const target = new EventTarget()
    const post = (data: unknown, from: unknown = "host") =>
      target.dispatchEvent(Object.assign(new MessageEvent("message", { data }), { from }))
    return { target, post }
  }

  it("publishes each change to its subscribers, through the accept filter only", () => {
    const { target, post } = source()
    const observer = createCallObserver(
      target,
      (event) => (event as MessageEvent & { from: unknown }).from === "host",
    )
    const listener = vi.fn()
    const unsubscribe = observer.subscribe(listener)

    post(note("ui/notifications/tool-result", { content: [] }), "someone else")
    expect(observer.getSnapshot()).toBe(NO_CALL_OBSERVATION)
    post(note("ui/notifications/tool-input", { arguments: { engine: "prod" } }))
    post(note("ui/notifications/tool-result", { content: [] }))
    expect(observer.getSnapshot()).toEqual({
      args: { engine: "prod" },
      result: "stripped",
      cancelled: false,
    })
    expect(listener).toHaveBeenCalledTimes(2)

    // Nothing new: no notification.
    post(note("ui/notifications/tool-result", { structuredContent: {} }))
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  it("stops listening on dispose and keeps the last observation", () => {
    const { target, post } = source()
    const observer = createCallObserver(target, () => true)
    post(note("ui/notifications/tool-cancelled"))
    observer.dispose()
    post(note("ui/notifications/tool-input", { arguments: { a: 1 } }))
    expect(observer.getSnapshot()).toEqual({ args: undefined, result: "none", cancelled: true })
  })
})

describe("installCallObserver", () => {
  it("installs nothing in a top-level window, where no host frames the view", () => {
    expect(window.parent).toBe(window)
    expect(installCallObserver()).toBeNull()
  })

  it("listens to the framing host only, once per document", () => {
    const parent = {}
    const spy = vi.spyOn(window, "parent", "get").mockReturnValue(parent as Window)
    const observer = installCallObserver()
    expect(observer).not.toBeNull()
    expect(installCallObserver()).toBe(observer)

    const post = (source: unknown) =>
      window.dispatchEvent(
        new MessageEvent("message", {
          data: note("ui/notifications/tool-cancelled"),
          source: source as MessageEventSource,
        }),
      )
    post(window)
    expect(observer?.getSnapshot().cancelled).toBe(false)
    post(parent)
    expect(observer?.getSnapshot().cancelled).toBe(true)
    spy.mockRestore()
  })
})
