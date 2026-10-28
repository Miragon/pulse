// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { bootstrapView, disposeView } from "mcp-use/react"
import { queryClient, useLocale } from "@miragon/mcp-toolkit-ui"
import { useHostBridge, type WidgetComponent } from "@miragon/mcp-toolkit-ui/app"
import { AppShellProviders } from "./app-shell-providers.js"
import { SHELL_SETTINGS_DATA } from "../shell-settings-contract.js"
import { useHostWidgets } from "./host-widgets.js"
import { LocalizedAppView } from "./localized-app-view.js"
import { useHostDisplayMode } from "./widget-shell.js"

// The REAL mcp-use view runtime over an in-memory SEP-1865 host, so the provider stack runs as in the bundle. (No @testing-library render: bootstrapView owns the React root.)

type ViewTransport = NonNullable<NonNullable<Parameters<typeof bootstrapView>[1]>["transport"]>

interface Message {
  jsonrpc: "2.0"
  id?: string | number
  method?: string
  params?: Record<string, unknown>
}

const PROFILE_FEED = SHELL_SETTINGS_DATA

function profileResult(view: { language?: string }) {
  return {
    content: [{ type: "text", text: JSON.stringify(view) }],
    structuredContent: view,
  }
}

function createFakeHost(options: {
  hostContext: Record<string, unknown>
  hostCapabilities?: Record<string, unknown>
  tools?: Record<string, unknown>
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
          hostContext: options.hostContext,
        },
      }
    }
    if (message.method === "tools/call") {
      const result = options.tools?.[String(message.params?.name)]
      if (result) return { result }
      return { error: { code: -32602, message: `unknown tool ${String(message.params?.name)}` } }
    }
    return { result: {} }
  }

  return {
    transport: transport as unknown as ViewTransport,
    methods: () => sent.map((m) => m.method),
    toolCalls: () =>
      sent
        .filter((m) => m.method === "tools/call")
        .map((m) => ({ name: m.params?.name, arguments: m.params?.arguments })),
    notify: (method: string, params: Record<string, unknown>) =>
      transport.onmessage?.({ jsonrpc: "2.0", method, params }),
  }
}

const DemoWidget: WidgetComponent = () => null

/** Everything the stack provides, in one line: locale | display mode | registry. */
function Probe() {
  // Throws without the host bridge above — part of what is under test.
  useHostBridge()
  const widgets = Object.keys(useHostWidgets()).join(",")
  return <output data-testid="probe">{`${useLocale()}|${useHostDisplayMode()}|${widgets}`}</output>
}

function mount(host: ReturnType<typeof createFakeHost>) {
  bootstrapView(
    {
      default: () => (
        <AppShellProviders widgets={{ "demo:widget": DemoWidget }}>
          <Probe />
        </AppShellProviders>
      ),
    },
    { transport: host.transport },
  )
}

const probe = () => document.querySelector("[data-testid=probe]")?.textContent
const root = document.documentElement

afterEach(async () => {
  await disposeView()
  document.getElementById("root")?.remove()
  // The toolkit's query client is a module singleton on PRODUCTION defaults (retries included); cancelling stops a waiting retry.
  await queryClient.cancelQueries()
  queryClient.clear()
  root.className = ""
  root.lang = ""
  root.removeAttribute("data-theme")
  root.removeAttribute("style")
  vi.unstubAllGlobals()
})

describe("AppShellProviders (real mcp-use view runtime)", () => {
  it("wires host bridge → display mode → profile → widget registry, in that order", async () => {
    const host = createFakeHost({
      hostContext: {
        theme: "dark",
        displayMode: "fullscreen",
        availableDisplayModes: ["inline", "fullscreen"],
      },
      tools: { [PROFILE_FEED]: profileResult({ language: "de" }) },
    })
    mount(host)

    await vi.waitFor(() => expect(probe()).toBe("de|fullscreen|demo:widget"))
    expect(host.toolCalls()).toEqual([{ name: PROFILE_FEED, arguments: {} }])
    expect(root.lang).toBe("de")
    expect(root.classList.contains("dark")).toBe(true)
    expect(root.getAttribute("data-theme")).toBe("dark")
    expect(root.style.getPropertyValue("color-scheme")).toBe("dark")
  })

  it("follows the HOST's theme and, for a system profile, its locale — over a light OS and English defaults (#339)", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    )
    const host = createFakeHost({
      hostContext: { theme: "dark", locale: "de-DE" },
      tools: { [PROFILE_FEED]: profileResult({ language: "system" }) },
    })
    mount(host)

    await vi.waitFor(() => expect(probe()).toBe("de|inline|demo:widget"))
    expect(root.lang).toBe("de")
    expect(root.classList.contains("dark")).toBe(true)
    expect(root.getAttribute("data-theme")).toBe("dark")
  })

  it("puts the host's style variables and font on the document, and fills it in fullscreen", async () => {
    const host = createFakeHost({
      hostContext: {
        theme: "light",
        displayMode: "fullscreen",
        availableDisplayModes: ["inline", "fullscreen"],
        styles: {
          variables: { "--font-sans": "HostSans, sans-serif", "--font-mono": "HostMono" },
          css: { fonts: "@font-face { font-family: HostSans; src: local(Arial); }" },
        },
      },
      tools: { [PROFILE_FEED]: profileResult({ language: "en" }) },
    })
    mount(host)

    await vi.waitFor(() => expect(probe()).toBe("en|fullscreen|demo:widget"))
    // The host font fills the fallback slot: Geist first, then the host's font, then system.
    expect(root.style.getPropertyValue("--host-font-sans")).toBe("HostSans, sans-serif")
    expect(root.style.getPropertyValue("--host-font-mono")).toBe("HostMono")
    expect(root.style.getPropertyValue("--font-sans")).toBe("")
    expect(root.style.getPropertyValue("--font-mono")).toBe("")
    expect(document.getElementById("__mcp-host-fonts")?.textContent).toContain("HostSans")
    expect(root.style.height).toBe("100%")
    document.getElementById("__mcp-host-fonts")?.remove()
  })

  it("follows a host display-mode change live", async () => {
    const host = createFakeHost({
      hostContext: { displayMode: "fullscreen", availableDisplayModes: ["inline", "fullscreen"] },
      tools: { [PROFILE_FEED]: profileResult({ language: "en" }) },
    })
    mount(host)
    await vi.waitFor(() => expect(probe()).toBe("en|fullscreen|demo:widget"))

    host.notify("ui/notifications/host-context-changed", { displayMode: "inline" })

    await vi.waitFor(() => expect(probe()).toBe("en|inline|demo:widget"))
  })

  it("still renders, in English and the OS theme, on a host that cannot call server tools", async () => {
    // No `serverTools`: every tool call rejects, and the gate must degrade without waiting out react-query's ~7 s of retries.
    // A dark OS makes the theme fallback observable.
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    )
    const host = createFakeHost({ hostContext: {}, hostCapabilities: {} })
    mount(host)

    // Within 1 s, inside the gate's 1.5 s bound, so the bound is not what released it …
    await vi.waitFor(() => expect(probe()).toBe("en|inline|demo:widget"), { timeout: 1_000 })
    // … while the retries still run: the query is pending after one failure.
    expect(queryClient.getQueryState(["shell:settings", {}])).toMatchObject({
      status: "pending",
      fetchFailureCount: 1,
    })
    expect(host.toolCalls()).toEqual([])
    expect(root.lang).toBe("en")
    expect(root.classList.contains("dark")).toBe(true)
  })
})

/** A module widget with its own heading, as `WidgetHeader` renders it. */
const HeadedWidget: WidgetComponent = () => <h2>Widget heading</h2>
const VIEW_WIDGETS = { "demo:headed": HeadedWidget }

/** A `show_*` / `render-view` result: the server's view title over one widget. */
const VIEW_RESULT = {
  content: [{ type: "text", text: "Rendered the view." }],
  structuredContent: {
    title: "Server view title",
    context: { keys: {}, stepIds: [], stepData: {}, errors: [] },
    layout: { rows: [{ row: [{ widget: "demo:headed" }] }] },
  },
}

/** The chain under test: SEP-1865 toolInfo → ShellHost.toolName → viewTitleMode → the toolbar's title. */
async function viewHeadings(toolName: string | undefined): Promise<(string | null)[]> {
  const host = createFakeHost({
    hostContext: toolName
      ? { toolInfo: { tool: { name: toolName, inputSchema: { type: "object" } } } }
      : {},
    tools: { [PROFILE_FEED]: profileResult({ language: "en" }) },
  })
  bootstrapView(
    {
      default: () => (
        <AppShellProviders widgets={VIEW_WIDGETS}>
          <LocalizedAppView widgets={VIEW_WIDGETS} />
        </AppShellProviders>
      ),
    },
    { transport: host.transport },
  )
  await vi.waitFor(() => expect(host.methods()).toContain("ui/notifications/initialized"))
  host.notify("ui/notifications/tool-input", { arguments: {} })
  host.notify("ui/notifications/tool-result", VIEW_RESULT)
  await vi.waitFor(() => expect(document.body.textContent).toContain("Widget heading"))
  return [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((h) => h.textContent)
}

describe("LocalizedAppView: one title per view (real mcp-use view runtime)", () => {
  it("hides the toolbar title over a module view: the widget's heading is the one title", async () => {
    expect(await viewHeadings("camunda7_show_process_list")).toEqual(["Widget heading"])
  })

  it("keeps the toolbar title over a composed render-view, whose widgets carry none", async () => {
    expect(await viewHeadings("render-view")).toEqual(["Server view title", "Widget heading"])
  })

  it("keeps it where the host does not name the rendering tool", async () => {
    expect(await viewHeadings(undefined)).toEqual(["Server view title", "Widget heading"])
  })
})
