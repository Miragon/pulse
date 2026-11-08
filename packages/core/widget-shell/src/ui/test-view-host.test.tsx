// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react"
import { useLocale } from "@miragon/pulse-ui"
import { useDisplayModeControl } from "./display-mode-toggle.js"
import { useInlineBudget } from "./inline-budget.js"
import { useShellHost } from "./shell-host.js"
import { createTestQueryClient, TestViewHost, type HostAction } from "./test-view-host.js"
import { HostModelContext, useViewHost } from "./view-host.js"
import { useHostDisplayMode } from "./widget-shell.js"

afterEach(cleanup)

function hostWith(props: Omit<Parameters<typeof TestViewHost>[0], "children"> = {}) {
  const { result } = renderHook(() => useViewHost(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <TestViewHost {...props}>{children}</TestViewHost>
    ),
  })
  return result.current
}

describe("TestViewHost: fake tools", () => {
  it("wraps a plain value as structuredContent plus its JSON text", async () => {
    const host = hostWith({ tools: { a_data: { n: 1 }, b_data: "plain" } })
    expect(await host.callTool("a_data")).toEqual({
      structuredContent: { n: 1 },
      content: [{ type: "text", text: '{"n":1}' }],
    })
    expect(await host.callTool("b_data", {})).toEqual({
      structuredContent: "plain",
      content: [{ type: "text", text: "plain" }],
    })
  })

  it("returns a result-shaped value as it is, an isError one included", async () => {
    const error = { isError: true, content: [{ type: "text", text: "denied" }] }
    const host = hostWith({ tools: { w: error, t: { content: [{ type: "text", text: "{}" }] } } })
    expect(await host.callTool("w")).toBe(error)
    expect(await host.callTool("t")).toEqual({ content: [{ type: "text", text: "{}" }] })
  })

  it("passes the args to a function fake, sync or async; its throw is a transport failure", async () => {
    const seen = vi.fn((args: unknown) => ({ echo: args }))
    const host = hostWith({
      tools: {
        sync: seen,
        async: (args: { id: string }) => Promise.resolve({ id: args.id }),
        broken: () => {
          throw new Error("connection lost")
        },
      },
    })
    expect((await host.callTool("sync", { a: 1 })).structuredContent).toEqual({ echo: { a: 1 } })
    expect((await host.callTool("async", { id: "x" })).structuredContent).toEqual({ id: "x" })
    await expect(host.callTool("broken")).rejects.toThrow("connection lost")
  })

  it("rejects a tool it has no fake for, by name", async () => {
    const host = hostWith({ tools: {} })
    await expect(host.callTool("x_data")).rejects.toThrow(
      '[TestViewHost] no fake for tool "x_data"',
    )
  })
})

describe("TestViewHost: what the widget asked the host", () => {
  it("logs every call, follow-up and link, in order", async () => {
    const actions: HostAction[] = []
    const host = hostWith({ tools: { t: {} }, onHostAction: (a) => actions.push(a) })
    host.sendFollowUp("Explain this.")
    await host.callTool("t", { id: 1 })
    host.openExternal("https://engine.example")
    expect(actions).toEqual([
      { type: "sendFollowUp", prompt: "Explain this." },
      { type: "callTool", name: "t", args: { id: 1 } },
      { type: "openExternal", url: "https://engine.example" },
    ])
  })

  it("reports each mounted model context, the last writer last", async () => {
    const lines: string[] = []
    render(
      <TestViewHost onModelContext={(text) => lines.push(text)}>
        <HostModelContext content="outer">
          <HostModelContext content="inner" />
        </HostModelContext>
      </TestViewHost>,
    )
    await waitFor(() => expect(lines).toHaveLength(2))
    expect(lines.at(-1)).toBe("outer")
    expect(lines).toContain("inner")
  })

  it("provides the host's display mode and logs a fullscreen request", () => {
    const actions: HostAction[] = []
    function Probe() {
      const control = useDisplayModeControl()
      return (
        <button type="button" onClick={() => control.request("fullscreen")}>
          {`${useHostDisplayMode()}|${String(control.canFullscreen)}|${String(useShellHost().connected)}`}
        </button>
      )
    }
    render(
      <TestViewHost
        host={{ availableDisplayModes: ["inline", "fullscreen"] }}
        onHostAction={(a) => actions.push(a)}
      >
        <Probe />
      </TestViewHost>,
    )
    const button = screen.getByRole("button")
    expect(button.textContent).toBe("inline|true|true")
    fireEvent.click(button)
    expect(actions).toEqual([{ type: "requestDisplayMode", mode: "fullscreen" }])
  })

  it("offers no fullscreen where the host offers none, and fullscreen stays switchable", () => {
    function Probe() {
      return <p>{String(useDisplayModeControl().canFullscreen)}</p>
    }
    render(
      <TestViewHost>
        <Probe />
      </TestViewHost>,
    )
    expect(screen.getByText("false")).toBeTruthy()
    cleanup()
    render(
      <TestViewHost host={{ displayMode: "fullscreen" }}>
        <Probe />
      </TestViewHost>,
    )
    expect(screen.getByText("true")).toBeTruthy()
  })

  it("derives the inline budget as production does: capped inline, expanding to fullscreen", () => {
    const actions: HostAction[] = []
    function Probe() {
      const budget = useInlineBudget()
      return (
        <button type="button" onClick={() => budget.expand?.()}>
          {`${String(budget.diagramMaxHeight)}|${String(budget.expand !== null)}`}
        </button>
      )
    }
    render(
      <TestViewHost>
        <Probe />
      </TestViewHost>,
    )
    expect(screen.getByRole("button").textContent).toBe("320|false")
    cleanup()
    render(
      <TestViewHost
        host={{ availableDisplayModes: ["inline", "fullscreen"] }}
        onHostAction={(a) => actions.push(a)}
      >
        <Probe />
      </TestViewHost>,
    )
    fireEvent.click(screen.getByRole("button"))
    expect(actions).toEqual([{ type: "requestDisplayMode", mode: "fullscreen" }])
    cleanup()
    render(
      <TestViewHost host={{ displayMode: "fullscreen" }}>
        <Probe />
      </TestViewHost>,
    )
    expect(screen.getByRole("button").textContent).toBe("null|false")
  })
})

describe("TestViewHost: providers", () => {
  it("wraps a locale only when given, so an outer one wins", () => {
    function Probe() {
      return <p>{useLocale()}</p>
    }
    render(
      <TestViewHost locale="de">
        <Probe />
      </TestViewHost>,
    )
    expect(screen.getByText("de")).toBeTruthy()
  })

  it("takes no host widget map, as the view root does", () => {
    render(
      <TestViewHost
        // @ts-expect-error: no module renders another's widget, so the test host takes no map
        hostWidgets={{ "demo:panel": () => <p>panel</p> }}
      >
        <p>view</p>
      </TestViewHost>,
    )
    expect(document.body.textContent).toBe("view")
  })

  it("uses the client a test passes, retry-free by default", async () => {
    const client = createTestQueryClient()
    expect(client.getDefaultOptions().queries?.retry).toBe(false)
    expect(client.getDefaultOptions().queries?.staleTime).toBe(30_000)
    hostWith({ client })
    await act(() => Promise.resolve())
  })

  it("throws a clear error outside any host", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(() => renderHook(() => useViewHost())).toThrow(
      "[pulse] useViewHost() needs mountViews/mountView or TestViewHost",
    )
    error.mockRestore()
  })
})
