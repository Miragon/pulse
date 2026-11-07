// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ToolResultError } from "../protocol/tool-result.js"
import { createViewRuntime, type ViewRuntime, type ViewTransport } from "./view-runtime.js"

/**
 * The runtime on its own over an in-memory SEP-1865 host: the rendering call's lifecycle, the
 * capabilities a host must advertise, the display modes and the model context, each the way the
 * official `App` delivers them.
 */

interface Message {
  jsonrpc: "2.0"
  id?: string | number
  method?: string
  params?: Record<string, unknown>
}

interface HostOptions {
  hostCapabilities?: Record<string, unknown>
  hostContext?: Record<string, unknown>
  /** Answers a method with an error instead of `{}`. */
  failing?: string[]
}

function fakeHost({ hostCapabilities = {}, hostContext = {}, failing = [] }: HostOptions = {}) {
  const sent: Message[] = []
  const transport = {
    onmessage: undefined as ((message: Message) => void) | undefined,
    onclose: undefined as (() => void) | undefined,
    onerror: undefined as ((error: Error) => void) | undefined,
    start: () => Promise.resolve(),
    close: () => {
      transport.onclose?.()
      return Promise.resolve()
    },
    send: (message: Message) => {
      sent.push(message)
      if (message.id !== undefined && message.method) {
        const reply =
          message.method === "ui/initialize"
            ? {
                result: {
                  protocolVersion: message.params?.protocolVersion,
                  hostInfo: { name: "fake-host", version: "1.0.0" },
                  hostCapabilities,
                  hostContext,
                },
              }
            : failing.includes(message.method)
              ? { error: { code: -32603, message: `${message.method} failed` } }
              : message.method === "ui/request-display-mode"
                ? { result: { mode: message.params?.mode } }
                : { result: {} }
        queueMicrotask(() => transport.onmessage?.({ jsonrpc: "2.0", id: message.id, ...reply }))
      }
      return Promise.resolve()
    },
  }
  return {
    transport: transport as unknown as ViewTransport,
    sent: (method: string) => sent.filter((m) => m.method === method),
    notify: (method: string, params: Record<string, unknown>) =>
      transport.onmessage?.({ jsonrpc: "2.0", method, params }),
  }
}

const runtimes: ViewRuntime[] = []

async function connected(options: HostOptions = {}, modes = ["inline", "fullscreen"]) {
  const host = fakeHost(options)
  const runtime = createViewRuntime({ displayModes: modes }, { transport: host.transport })
  runtimes.push(runtime)
  await runtime.connect()
  return { host, runtime }
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

// Not disposed: ext-apps' size observer outlives `close()` and would report into a closed
// transport; a view document never disposes its runtime either.
afterEach(() => {
  runtimes.splice(0)
  delete (window as unknown as { openai?: unknown }).openai
  vi.restoreAllMocks()
})

describe("the rendering call", () => {
  it("takes the input, a partial one first, then the result, and ignores what comes after", async () => {
    const { host, runtime } = await connected()
    host.notify("ui/notifications/tool-input-partial", { arguments: { q: "a" } })
    await vi.waitFor(() => expect(runtime.getTool().toolInput).toEqual({ q: "a" }))
    expect(runtime.getTool().completeArgs).toBeUndefined()
    host.notify("ui/notifications/tool-input", { arguments: { q: "ab" } })
    await vi.waitFor(() => expect(runtime.getTool().completeArgs).toEqual({ q: "ab" }))
    host.notify("ui/notifications/tool-result", { content: [], structuredContent: { rows: 1 } })
    await vi.waitFor(() => expect(runtime.getTool().status).toBe("ready"))
    expect(runtime.getTool().toolOutput).toEqual({ rows: 1 })
    host.notify("ui/notifications/tool-input", { arguments: { q: "late" } })
    host.notify("ui/notifications/tool-input-partial", { arguments: { q: "late" } })
    host.notify("ui/notifications/tool-result", { content: [], isError: true })
    host.notify("ui/notifications/tool-cancelled", {})
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(runtime.getTool()).toMatchObject({ status: "ready", completeArgs: { q: "ab" } })
  })

  it("reads an input without arguments as empty", async () => {
    const { host, runtime } = await connected()
    host.notify("ui/notifications/tool-input", {})
    await vi.waitFor(() => expect(runtime.getTool().completeArgs).toEqual({}))
  })

  it("marks a result without structuredContent as stripped, still pending", async () => {
    const { host, runtime } = await connected()
    host.notify("ui/notifications/tool-result", { content: [{ type: "text", text: "x" }] })
    await vi.waitFor(() => expect(runtime.getTool().stripped).toBe(true))
    expect(runtime.getTool().status).toBe("pending")
  })

  it("turns an isError result into the call's error", async () => {
    const { host, runtime } = await connected()
    host.notify("ui/notifications/tool-result", {
      content: [{ type: "text", text: "engine down" }],
      isError: true,
    })
    await vi.waitFor(() => expect(runtime.getTool().status).toBe("error"))
    expect(runtime.getTool().error).toBeInstanceOf(ToolResultError)
  })

  it.each([
    [{ reason: "user" }, "Tool call was cancelled: user"],
    [{}, "Tool call was cancelled."],
  ])("ends a cancelled call with %j", async (params, message) => {
    const { host, runtime } = await connected()
    host.notify("ui/notifications/tool-cancelled", params)
    await vi.waitFor(() => expect(runtime.getTool().cancelled).toBe(true))
    expect(runtime.getTool().error?.message).toBe(message)
  })
})

describe("the host", () => {
  it("negotiates the display modes both sides offer and follows a changed context", async () => {
    const { host, runtime } = await connected({
      hostContext: { displayMode: "inline", availableDisplayModes: ["inline", "pip"] },
    })
    expect(runtime.getHost()).toMatchObject({ connected: true, availableDisplayModes: ["inline"] })
    const listener = vi.fn()
    runtime.subscribeHost(listener)
    const before = runtime.getHost().availableDisplayModes
    host.notify("ui/notifications/host-context-changed", { displayMode: "pip" })
    await vi.waitFor(() => expect(runtime.getHost().displayMode).toBe("pip"))
    expect(runtime.getHost().availableDisplayModes).toBe(before)
    expect(listener).toHaveBeenCalled()
    await expect(runtime.requestDisplayMode("fullscreen")).rejects.toThrow(
      'Display mode "fullscreen" is not among [inline]',
    )
  })

  it("offers inline only to a host that names no modes", async () => {
    const { runtime } = await connected()
    expect(runtime.getHost().availableDisplayModes).toEqual(["inline"])
    expect(runtime.getHost().displayMode).toBe("inline")
  })

  it("asks for a mode the host offers", async () => {
    const { host, runtime } = await connected({
      hostContext: { availableDisplayModes: ["inline", "fullscreen"] },
    })
    await runtime.requestDisplayMode("fullscreen")
    expect(host.sent("ui/request-display-mode")[0]?.params).toEqual({ mode: "fullscreen" })
  })

  it.each<[keyof ViewRuntime, unknown[], string]>([
    [
      "callTool",
      ["t", {}],
      "Host does not advertise the serverTools capability required to call server tools",
    ],
    [
      "sendFollowUp",
      ["hi"],
      "Host does not advertise the message capability required to send follow-up messages",
    ],
    [
      "openLink",
      ["https://x.example"],
      "Host does not advertise the openLinks capability required to open external links",
    ],
  ])("refuses %s on a host that does not advertise it", async (method, args, message) => {
    const { runtime } = await connected()
    const fn = runtime[method] as (...a: unknown[]) => Promise<unknown>
    await expect(fn(...args)).rejects.toThrow(message)
  })

  it("sends a follow-up as the user's message and opens a link where the host advertises both", async () => {
    const { host, runtime } = await connected({ hostCapabilities: { message: {}, openLinks: {} } })
    await runtime.sendFollowUp("Explain this.")
    await runtime.openLink("https://x.example")
    expect(host.sent("ui/message")[0]?.params).toEqual({
      role: "user",
      content: [{ type: "text", text: "Explain this." }],
    })
    expect(host.sent("ui/open-link")[0]?.params).toEqual({ url: "https://x.example" })
  })

  it("connects once however often it is asked", async () => {
    const host = fakeHost()
    const runtime = createViewRuntime({ displayModes: ["inline"] }, { transport: host.transport })
    runtimes.push(runtime)
    const [a, b] = await Promise.all([runtime.connect(), runtime.connect()])
    expect(a).toBe(b)
    expect(host.sent("ui/initialize")).toHaveLength(1)
  })
})

describe("the model context", () => {
  const contexts = (host: ReturnType<typeof fakeHost>) =>
    host
      .sent("ui/update-model-context")
      .map((m) => (m.params?.structuredContent as { _uiContext: string })._uiContext)

  it("sends the tree as one indented list per change, and nothing for an unchanged tree", async () => {
    const { host, runtime } = await connected({ hostCapabilities: { updateModelContext: {} } })
    runtime.setModelContextNode({ id: "a", parentId: null, content: " View. " })
    runtime.setModelContextNode({ id: "b", parentId: "a", content: "Row 1." })
    await vi.waitFor(() => expect(contexts(host)).toEqual(["- View.\n  - Row 1."]))
    runtime.setModelContextNode({ id: "b", parentId: "a", content: "Row 1." })
    runtime.removeModelContextNode("missing")
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(contexts(host)).toHaveLength(1)
    runtime.removeModelContextNode("b")
    await vi.waitFor(() => expect(contexts(host)).toEqual(["- View.\n  - Row 1.", "- View."]))
  })

  it("warns once on a host that takes no model context, and sends nothing", async () => {
    const { host, runtime } = await connected()
    runtime.setModelContextNode({ id: "a", parentId: null, content: "One." })
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalledOnce())
    runtime.setModelContextNode({ id: "a", parentId: null, content: "Two." })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(console.warn).toHaveBeenCalledOnce()
    expect(host.sent("ui/update-model-context")).toHaveLength(0)
  })

  it("keeps a failed update dirty and retries with the next change", async () => {
    const { host, runtime } = await connected({
      hostCapabilities: { updateModelContext: {} },
      failing: ["ui/update-model-context"],
    })
    runtime.setModelContextNode({ id: "a", parentId: null, content: "One." })
    await vi.waitFor(() =>
      expect(console.warn).toHaveBeenCalledWith(
        "[pulse] updateModelContext failed:",
        expect.anything(),
      ),
    )
    runtime.setModelContextNode({ id: "a", parentId: null, content: "Two." })
    await vi.waitFor(() => expect(host.sent("ui/update-model-context")).toHaveLength(2))
  })

  // ChatGPT's own channel wins where the host exposes it.
  it("hands ChatGPT's widget state the context, keeping what it holds", async () => {
    const setWidgetState = vi.fn()
    ;(window as unknown as { openai: unknown }).openai = {
      widgetState: { privateContent: { open: true } },
      setWidgetState,
    }
    const { host, runtime } = await connected({ hostCapabilities: { updateModelContext: {} } })
    runtime.setModelContextNode({ id: "a", parentId: null, content: "One." })
    await vi.waitFor(() =>
      expect(setWidgetState).toHaveBeenCalledWith({
        privateContent: { open: true },
        modelContent: { _uiContext: "- One." },
      }),
    )
    expect(host.sent("ui/update-model-context")).toHaveLength(0)
  })

  it("sends nothing once disposed", async () => {
    const { host, runtime } = await connected({ hostCapabilities: { updateModelContext: {} } })
    // After the first size report, which the observer sends one frame after connecting.
    await new Promise((resolve) => requestAnimationFrame(resolve))
    await new Promise((resolve) => setTimeout(resolve, 0))
    await runtime.dispose()
    runtime.setModelContextNode({ id: "a", parentId: null, content: "Late." })
    host.notify("ui/notifications/host-context-changed", { displayMode: "fullscreen" })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(host.sent("ui/update-model-context")).toHaveLength(0)
    expect(runtime.getHost().displayMode).toBe("inline")
  })
})
