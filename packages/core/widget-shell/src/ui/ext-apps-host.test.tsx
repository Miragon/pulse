// @vitest-environment happy-dom
import { act, useEffect } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ExtAppsViewHost, useViewCall } from "./ext-apps-host.js"
import { useShellHost } from "./shell-host.js"
import { HostModelContext, useViewHost } from "./view-host.js"
import type { ViewRuntime } from "./view-runtime.js"

/**
 * The adapter over a stand-in runtime: what it hands the host-agnostic contexts (the height
 * budget, the links, the model-context tree) and what it does with a failed host call.
 */

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type HostState = ReturnType<ViewRuntime["getHost"]>

function fakeRuntime(host: Partial<HostState> = {}) {
  const state: HostState = {
    hostContext: undefined,
    connected: true,
    displayMode: "inline",
    availableDisplayModes: ["inline"],
    ...host,
  }
  return {
    connect: vi.fn(),
    subscribeTool: () => () => {},
    getTool: vi.fn(),
    subscribeHost: () => () => {},
    getHost: () => state,
    callTool: vi.fn(() => Promise.resolve({ content: [] })),
    sendFollowUp: vi.fn(() => Promise.reject(new Error("no message capability"))),
    openLink: vi.fn(() => Promise.reject(new Error("no openLinks capability"))),
    requestDisplayMode: vi.fn(() => Promise.reject(new Error("not offered"))),
    setModelContextNode: vi.fn<ViewRuntime["setModelContextNode"]>(),
    removeModelContextNode: vi.fn<ViewRuntime["removeModelContextNode"]>(),
    dispose: vi.fn(),
  } satisfies ViewRuntime
}

let reactRoot: Root | undefined
const seen: { shell?: ReturnType<typeof useShellHost>; host?: ReturnType<typeof useViewHost> } = {}

function Probe() {
  const shell = useShellHost()
  const host = useViewHost()
  useEffect(() => {
    seen.shell = shell
    seen.host = host
  })
  return null
}

async function render(runtime: ViewRuntime, children: React.ReactNode = <Probe />) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  reactRoot = createRoot(container)
  await act(async () => {
    reactRoot!.render(<ExtAppsViewHost runtime={runtime}>{children}</ExtAppsViewHost>)
  })
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(async () => {
  await act(async () => reactRoot?.unmount())
  reactRoot = undefined
  delete seen.shell
  delete seen.host
  document.body.innerHTML = ""
  vi.restoreAllMocks()
})

describe("ExtAppsViewHost", () => {
  it.each<[string, Record<string, unknown> | undefined, number | undefined]>([
    ["a fixed height", { height: 320, maxHeight: 900 }, 320],
    ["a maximum height", { maxHeight: 640 }, 640],
    ["no height", { width: 400 }, undefined],
    ["no dimensions", undefined, undefined],
  ])("budgets the view's height from %s", async (_case, containerDimensions, maxHeight) => {
    await render(fakeRuntime({ hostContext: containerDimensions ? { containerDimensions } : {} }))
    expect(seen.shell?.maxHeight).toBe(maxHeight)
    expect(seen.shell?.safeArea).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
  })

  it("opens a link through the host, and warns when the host refuses it", async () => {
    const runtime = fakeRuntime()
    await render(runtime)
    seen.host?.openExternal("https://x.example")
    expect(runtime.openLink).toHaveBeenCalledWith("https://x.example")
    await vi.waitFor(() =>
      expect(console.warn).toHaveBeenCalledWith("[pulse] openExternal failed:", expect.any(Error)),
    )
  })

  // The bundle opened straight in a browser has no host to ask.
  it("opens a link the browser's way before the host connected", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null)
    const runtime = fakeRuntime({ connected: false })
    await render(runtime)
    seen.host?.openExternal("https://x.example")
    expect(open).toHaveBeenCalledWith("https://x.example", "_blank", "noopener,noreferrer")
    expect(runtime.openLink).not.toHaveBeenCalled()
  })

  it("warns when a follow-up or a display mode fails, and passes tool calls through", async () => {
    const runtime = fakeRuntime()
    await render(runtime)
    seen.host?.sendFollowUp("Explain.")
    await seen.host?.callTool("demo_data")
    expect(runtime.callTool).toHaveBeenCalledWith("demo_data", {})
    await vi.waitFor(() =>
      expect(console.warn).toHaveBeenCalledWith("[pulse] sendFollowUp failed:", expect.any(Error)),
    )
  })

  it("builds the model-context tree: a blank node hands its children to its parent", async () => {
    const runtime = fakeRuntime()
    await render(
      runtime,
      <HostModelContext content="View.">
        <HostModelContext content="  ">
          <HostModelContext content="Row." />
        </HostModelContext>
      </HostModelContext>,
    )
    const nodes = runtime.setModelContextNode.mock.calls.map(([node]) => node)
    const view = nodes.find((node) => node.content === "View.")
    const row = nodes.find((node) => node.content === "Row.")
    expect(view?.parentId).toBeNull()
    expect(row?.parentId).toBe(view?.id)
    expect(nodes.some((node) => node.content.trim() === "")).toBe(false)
    expect(runtime.removeModelContextNode).toHaveBeenCalled()
    await act(async () => reactRoot?.unmount())
    reactRoot = undefined
    const removed = runtime.removeModelContextNode.mock.calls.map(([id]) => id)
    expect(removed).toEqual(expect.arrayContaining([view?.id, row?.id]))
  })

  it("is the only way to the runtime: a view call outside it says so", () => {
    function Outside() {
      useViewCall("demo_show_x")
      return null
    }
    expect(() => renderToString(<Outside />)).toThrow(
      "[pulse] the view runtime is mounted by mountViews/mountView",
    )
  })
})
