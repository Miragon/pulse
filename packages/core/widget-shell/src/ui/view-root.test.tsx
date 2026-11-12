// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { createRoot, type Root } from "react-dom/client"
import { useLocale } from "@miragon/pulse-ui"
import { SERVED_FONTS_STYLE_ID } from "./declare-served-fonts.js"
import { AskAiButton } from "./ask-ai-button.js"
import { askAiPrompt } from "./ask-ai-prompt.js"
import { useInlineBudget } from "./inline-budget.js"
import { OpenInCockpitLink } from "./open-in-cockpit-link.js"
import { HostModelContext } from "./view-host.js"
import { ViewRoot } from "./view-root.js"
import { createViewRuntime, type ViewRuntime, type ViewTransport } from "./view-runtime.js"
import type { ViewComponent } from "./views.js"
import { useHostDisplayMode } from "./widget-shell.js"

// The REAL view runtime (the official `App`) over an in-memory SEP-1865 host, so the provider stack
// runs as in the bundle.

interface Message {
  jsonrpc: "2.0"
  id?: string | number
  method?: string
  params?: Record<string, unknown>
}

/** A result, or a function of the args that returns one. */
type FakeTool = unknown

const VIEW_TOOL = "demo_show_rows"
const ROWS = { rows: ["a", "b"] }

const result = (data: unknown) => ({
  content: [{ type: "text", text: "Two rows." }],
  structuredContent: data,
})

function createFakeHost(options: {
  hostContext?: Record<string, unknown>
  hostCapabilities?: Record<string, unknown>
  tools?: Record<string, FakeTool>
}) {
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
        const reply = answer(message)
        queueMicrotask(() => transport.onmessage?.({ jsonrpc: "2.0", id: message.id, ...reply }))
      }
      return Promise.resolve()
    },
  }

  function answer(message: Message): { result: unknown } | { error: unknown } {
    if (message.method === "ui/initialize") {
      return {
        result: {
          protocolVersion: message.params?.protocolVersion,
          hostInfo: { name: "fake-host", version: "1.0.0" },
          hostCapabilities: options.hostCapabilities ?? {
            serverTools: {},
            updateModelContext: { text: {} },
          },
          hostContext: options.hostContext ?? {},
        },
      }
    }
    if (message.method === "tools/call") {
      const name = String(message.params?.name)
      const tool = options.tools?.[name]
      const args = (message.params?.arguments ?? {}) as Record<string, unknown>
      const value: unknown =
        typeof tool === "function" ? (tool as (a: unknown) => unknown)(args) : tool
      if (value) return { result: value }
      return { error: { code: -32602, message: `Tool ${name} not found` } }
    }
    return { result: {} }
  }

  return {
    transport: transport as unknown as ViewTransport,
    methods: () => sent.map((m) => m.method),
    toolCalls: (name?: string) =>
      sent
        .filter((m) => m.method === "tools/call")
        .map((m) => ({ name: m.params?.name, arguments: m.params?.arguments }))
        .filter((call) => name === undefined || call.name === name),
    modelContext: () =>
      sent
        .filter((m) => m.method === "ui/update-model-context")
        .map((m) => JSON.stringify(m.params)),
    notify: (method: string, params: Record<string, unknown>) => {
      transport.onmessage?.({ jsonrpc: "2.0", method, params })
    },
  }
}

/** Everything the stack provides, in one line: locale | display mode | the view's data. */
const ProbeView: ViewComponent<{ rows: string[] }> = ({ data }) => (
  <HostModelContext content="Probe view.">
    <output data-testid="probe">
      {`${useLocale()}|${useHostDisplayMode()}|${data.rows.join(",")}`}
    </output>
  </HostModelContext>
)

type Host = ReturnType<typeof createFakeHost>

let reactRoot: Root | undefined
let runtime: ViewRuntime | undefined

function mount(host: Host, view: ViewComponent | null = ProbeView as ViewComponent) {
  runtime = createViewRuntime(
    { displayModes: ["inline", "fullscreen"] },
    { transport: host.transport },
  )
  void runtime.connect()
  const container = document.createElement("div")
  container.id = "root"
  document.body.appendChild(container)
  reactRoot = createRoot(container)
  reactRoot.render(<ViewRoot name={VIEW_TOOL} view={view ?? undefined} runtime={runtime} />)
}

async function connected(host: Host) {
  await vi.waitFor(() => expect(host.methods()).toContain("ui/notifications/initialized"))
}

const probe = () => document.querySelector("[data-testid=probe]")?.textContent
const text = () => document.body.textContent ?? ""
const root = document.documentElement

afterEach(async () => {
  reactRoot?.unmount()
  await runtime?.dispose()
  document.getElementById("root")?.remove()
  document.getElementById("__mcp-host-fonts")?.remove()
  document.getElementById(SERVED_FONTS_STYLE_ID)?.remove()
  delete (globalThis as { __pulseViewConfig?: unknown }).__pulseViewConfig
  root.className = ""
  root.lang = ""
  root.removeAttribute("data-theme")
  root.removeAttribute("style")
  vi.unstubAllGlobals()
})

describe("ViewRoot: the host's own result", () => {
  it("renders the view from its result, through host → client → document → gate, re-running nothing", async () => {
    const host = createFakeHost({
      hostContext: {
        theme: "dark",
        locale: "de-DE",
        displayMode: "fullscreen",
        availableDisplayModes: ["inline", "fullscreen"],
      },
    })
    mount(host)
    await connected(host)
    host.notify("ui/notifications/tool-input", { arguments: { engine: "prod" } })
    host.notify("ui/notifications/tool-result", result(ROWS))

    await vi.waitFor(() => expect(probe()).toBe("de|fullscreen|a,b"))
    // The view's own tool never re-ran, and the gate calls none.
    expect(host.toolCalls()).toEqual([])
    expect(root.lang).toBe("de")
    expect(root.classList.contains("dark")).toBe(true)
    expect(text()).not.toContain("Neu geladen")
    // The toggle follows the host's modes; the view's model context reaches the host.
    expect(document.querySelector("button[aria-label='Vollbild verlassen']")).not.toBeNull()
    await vi.waitFor(() => expect(host.modelContext().join()).toContain("Probe view."))
  })

  it("follows the host's theme, locale, fonts and a display-mode change live", async () => {
    // What a served view document states: the server's public origin.
    ;(globalThis as { __pulseViewConfig?: unknown }).__pulseViewConfig = {
      publicBase: "https://mcp.example.com/",
    }
    const host = createFakeHost({
      hostContext: {
        theme: "dark",
        locale: "de-DE",
        displayMode: "fullscreen",
        availableDisplayModes: ["inline", "fullscreen"],
        styles: {
          variables: { "--font-sans": "HostSans, sans-serif" },
          css: { fonts: "@font-face { font-family: HostSans; src: local(Arial); }" },
        },
      },
    })
    mount(host)
    await connected(host)
    host.notify("ui/notifications/tool-result", result(ROWS))
    await vi.waitFor(() => expect(probe()).toBe("de|fullscreen|a,b"))
    expect(root.style.getPropertyValue("--host-font-sans")).toBe("HostSans, sans-serif")
    expect(document.getElementById("__mcp-host-fonts")?.textContent).toContain("HostSans")
    expect(document.getElementById(SERVED_FONTS_STYLE_ID)?.textContent).toContain(
      "https://mcp.example.com/fonts/geist-5.3.0/",
    )
    expect(root.style.height).toBe("100%")

    host.notify("ui/notifications/host-context-changed", { displayMode: "inline" })
    await vi.waitFor(() => expect(probe()).toBe("de|inline|a,b"))
  })

  it("offers no fullscreen where the host offers none", async () => {
    const host = createFakeHost({})
    mount(host)
    await connected(host)
    host.notify("ui/notifications/tool-result", result(ROWS))
    await vi.waitFor(() => expect(probe()).toBe("en|inline|a,b"))
    expect(document.querySelector("[data-slot=view-toolbar]")).toBeNull()
  })

  it("still renders, in English, on a host that cannot call server tools", async () => {
    const host = createFakeHost({ hostCapabilities: {} })
    mount(host)
    await connected(host)
    host.notify("ui/notifications/tool-result", result(ROWS))
    await vi.waitFor(() => expect(probe()).toBe("en|inline|a,b"), { timeout: 1_000 })
    expect(host.toolCalls()).toEqual([])
  })
})

describe("ViewRoot: the stripped-result recovery", () => {
  it("re-runs the view's own tool ONCE with the call's complete args, then stamps it", async () => {
    const host = createFakeHost({
      tools: { [VIEW_TOOL]: result(ROWS) },
    })
    mount(host)
    await connected(host)
    host.notify("ui/notifications/tool-input-partial", { arguments: { engine: "pr" } })
    host.notify("ui/notifications/tool-input", { arguments: { engine: "prod" } })
    // What claude.ai forwards: the model's text, no structuredContent.
    host.notify("ui/notifications/tool-result", { content: [{ type: "text", text: "Two rows." }] })

    await vi.waitFor(() => expect(probe()).toBe("en|inline|a,b"))
    expect(host.toolCalls(VIEW_TOOL)).toEqual([{ name: VIEW_TOOL, arguments: { engine: "prod" } }])
    expect(text()).toMatch(/Reloaded at \d{1,2}:\d{2}/)
    await vi.waitFor(() =>
      expect(host.modelContext().join()).toContain("re-ran its tool because the host"),
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(host.toolCalls(VIEW_TOOL)).toHaveLength(1)
  })

  it("never re-runs a slow tool: no result arrived, so none is missing", async () => {
    const host = createFakeHost({
      tools: { [VIEW_TOOL]: result(ROWS) },
    })
    mount(host)
    await connected(host)
    host.notify("ui/notifications/tool-input", { arguments: { engine: "prod" } })
    await vi.waitFor(() => expect(text()).toContain("Loading view…"))
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(host.toolCalls(VIEW_TOOL)).toEqual([])

    host.notify("ui/notifications/tool-result", result(ROWS))
    await vi.waitFor(() => expect(probe()).toBe("en|inline|a,b"))
    expect(host.toolCalls(VIEW_TOOL)).toEqual([])
  })

  it("shows a tool's isError as the error state, and Try again runs it exactly once", async () => {
    let answers = 0
    const host = createFakeHost({
      tools: {
        [VIEW_TOOL]: () => {
          answers += 1
          return { isError: true, content: [{ type: "text", text: "[503] down (engine prod)" }] }
        },
      },
    })
    mount(host)
    await connected(host)
    host.notify("ui/notifications/tool-input", { arguments: { engine: "prod" } })
    host.notify("ui/notifications/tool-result", {
      isError: true,
      content: [{ type: "text", text: "[503] down (engine prod)" }],
    })
    await vi.waitFor(() => expect(text()).toContain("Engine prod is unreachable (HTTP 503)"))
    expect(host.toolCalls(VIEW_TOOL)).toEqual([])

    const retry = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Try again",
    )
    retry?.click()
    await vi.waitFor(() => expect(answers).toBe(1))
    await vi.waitFor(() => expect(text()).toContain("Engine prod is unreachable (HTTP 503)"))
    expect(host.toolCalls(VIEW_TOOL)).toEqual([{ name: VIEW_TOOL, arguments: { engine: "prod" } }])
    expect(text()).not.toContain("Reloaded at")
  })

  it("notes a cancelled call and never re-runs it", async () => {
    const host = createFakeHost({
      tools: { [VIEW_TOOL]: result(ROWS) },
    })
    mount(host)
    await connected(host)
    host.notify("ui/notifications/tool-cancelled", { reason: "stopped" })
    await vi.waitFor(() =>
      expect(text()).toContain("Cancelled. Ask in the chat to open this view again."),
    )
    expect(host.toolCalls(VIEW_TOOL)).toEqual([])
  })

  it("says the app can't show a view it has no component for", async () => {
    const host = createFakeHost({})
    mount(host, null)
    await connected(host)
    host.notify("ui/notifications/tool-result", result(ROWS))
    await vi.waitFor(() => expect(text()).toContain("This app can't show this view."))
  })
})

/** A view that asks the host for everything a widget may: a hand-off, a link, more room. */
const ActionsView: ViewComponent = () => {
  const { expand } = useInlineBudget()
  const prompt = askAiPrompt({
    intent: "Explain this.",
    locale: "en",
  })
  return (
    <div>
      <AskAiButton prompt={prompt} label="Explain in chat" />
      <OpenInCockpitLink url="https://engine.example/cockpit" vendor="CIB seven" />
      <button type="button" onClick={() => expand?.()}>
        more
      </button>
    </div>
  )
}

const button = (name: string) =>
  [...document.querySelectorAll<HTMLElement>("button, a")].find(
    (el) => el.textContent === name || el.getAttribute("aria-label") === name,
  )

describe("ViewRoot: what a widget asks the host", () => {
  const capabilities = {
    serverTools: {},
    message: { text: {} },
    openLinks: {},
    updateModelContext: { text: {} },
  }

  it("posts a hand-off as a message, opens a link and asks for fullscreen", async () => {
    const host = createFakeHost({
      hostCapabilities: capabilities,
      hostContext: { availableDisplayModes: ["inline", "fullscreen"] },
    })
    mount(host, ActionsView)
    await connected(host)
    host.notify("ui/notifications/tool-result", result(ROWS))
    await vi.waitFor(() => expect(button("Explain in chat")).toBeDefined())

    button("Explain in chat")?.click()
    button("Open in CIB seven")?.click()
    button("more")?.click()
    button("Fullscreen")?.click()
    await vi.waitFor(() => {
      expect(host.methods()).toContain("ui/message")
      expect(host.methods()).toContain("ui/open-link")
      expect(host.methods().filter((m) => m === "ui/request-display-mode")).toHaveLength(2)
    })
  })

  it("never throws where the host lacks a capability: it warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const host = createFakeHost({})
    mount(host, ActionsView)
    await connected(host)
    host.notify("ui/notifications/tool-result", result(ROWS))
    await vi.waitFor(() => expect(button("Explain in chat")).toBeDefined())

    button("Explain in chat")?.click()
    button("Open in CIB seven")?.click()
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(2))
    expect(host.methods()).not.toContain("ui/message")
    warn.mockRestore()
  })

  it("a recovery that brings no view data is an error; its retry stamps the re-loaded figures", async () => {
    let answer: unknown = result(["not", "a", "view"])
    const host = createFakeHost({
      tools: { [VIEW_TOOL]: () => answer },
    })
    mount(host)
    await connected(host)
    host.notify("ui/notifications/tool-input", { arguments: {} })
    host.notify("ui/notifications/tool-result", { content: [{ type: "text", text: "Two rows." }] })
    await vi.waitFor(() => expect(text()).toContain("This view couldn't be loaded"))
    expect(host.toolCalls(VIEW_TOOL)).toHaveLength(1)

    answer = result(ROWS)
    button("Try again")?.click()
    await vi.waitFor(() => expect(probe()).toBe("en|inline|a,b"))
    // The chat had the stripped result's figures, so the re-run is stamped.
    expect(text()).toMatch(/Reloaded at/)
    expect(host.toolCalls(VIEW_TOOL)).toHaveLength(2)
  })
})
