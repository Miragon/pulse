// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import type { ShellHost } from "./shell-host.js"
import { TestViewHost, type HostAction } from "./test-view-host.js"
import type { ViewCall, ViewPhase } from "./view-call.js"
import { ViewErrorBoundary } from "./view-error-boundary.js"
import { SLOW_HINT_MS, ViewFrame } from "./view-frame.js"
import type { ViewComponent } from "./views.js"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const Rows: ViewComponent<{ rows: string[] }> = ({ data }) => (
  <ul>
    {data.rows.map((row) => (
      <li key={row}>{row}</li>
    ))}
  </ul>
)
const View = Rows as ViewComponent

function renderFrame(
  phase: ViewPhase,
  options: {
    view?: ViewComponent | null
    retry?: () => void
    host?: Partial<ShellHost>
    locale?: string
  } = {},
) {
  const actions: HostAction[] = []
  const lines: string[] = []
  const call: ViewCall = { phase, retry: options.retry ?? vi.fn() }
  const view = options.view === null ? undefined : (options.view ?? View)
  render(
    <TestViewHost
      host={options.host}
      locale={options.locale ?? "en"}
      onHostAction={(action) => actions.push(action)}
      onModelContext={(line) => lines.push(line)}
    >
      <ViewFrame call={call} view={view} />
    </TestViewHost>,
  )
  return { actions, lines }
}

describe("ViewFrame: before the view", () => {
  it("waits with a skeleton and a status line, then says what to do after 8 s", () => {
    vi.useFakeTimers()
    const { lines } = renderFrame({ phase: "waiting" })
    expect(screen.getByRole("status").textContent).toBe("Loading view…")
    act(() => {
      vi.advanceTimersByTime(SLOW_HINT_MS - 1)
    })
    expect(document.querySelector("[data-slot=slow-hint]")).toBeNull()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.getByText(/taking longer than usual/)).toBeTruthy()
    expect(lines).toEqual([])
  })

  it("words an error in the kit's words, the raw text under Details, with Try again", () => {
    const retry = vi.fn()
    const error = new Error("[503 ProcessEngineException] Engine is shutting down (engine prod)")
    const { lines } = renderFrame({ phase: "error", error }, { retry })
    expect(
      screen.getByRole("heading", { name: "Engine prod is unreachable (HTTP 503)" }),
    ).toBeTruthy()
    expect(screen.getByText(/Engine is shutting down/)).toBeTruthy()

    const button = screen.getByRole("button", { name: "Try again" })
    fireEvent.click(button)
    expect(retry).toHaveBeenCalledTimes(1)
    // The frame keeps the focus while the view re-loads.
    const frame = document.activeElement
    expect(frame?.getAttribute("data-slot")).toBe("view-frame")
    // A focus holder, no control: no outline, not even the one forced colours draw for
    // `outline-hidden`, which would frame the whole view.
    expect(frame?.getAttribute("class")?.split(/\s+/)).toEqual(["outline-none"])
    expect(lines.at(-1)).toContain("could not be shown")
  })

  it("shows a refused engine's reason without Try again when the view tool fails on it", () => {
    const error = new Error(
      '[ENGINE_PROFILE_REFUSED] Engine "locked" is configured, but its profile cannot be used: auth.tokenEnv names a variable that is not set. Ask whoever runs this server to fix it.',
    )
    renderFrame({ phase: "error", error })
    expect(
      screen.getByRole("heading", { name: "Engine locked cannot be used: its profile is refused" }),
    ).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull()
  })

  it("falls back to the frame's own title for a reason the kit cannot classify", () => {
    renderFrame({ phase: "error", error: new Error("odd") })
    expect(screen.getByRole("heading", { name: "This view couldn't be loaded" })).toBeTruthy()
  })

  it("notes a cancelled call, in the view's language", () => {
    const { lines } = renderFrame({ phase: "cancelled" }, { locale: "de" })
    expect(screen.getByRole("status").textContent).toBe(
      "Abgebrochen. Frag im Chat noch mal nach dieser Ansicht.",
    )
    expect(lines.at(-1)).toContain("cancelled before it rendered")
  })

  it("says the app can't show a view it has no component for: no retry", () => {
    const { lines } = renderFrame({ phase: "ready", data: {}, reloadedAt: null }, { view: null })
    expect(
      screen.getByText("This app can't show this view. Ask in the chat to open it again."),
    ).toBeTruthy()
    expect(screen.queryByRole("button")).toBeNull()
    expect(lines).toEqual([])
  })
})

describe("ViewFrame: the view", () => {
  it("renders the data, with no toolbar where nothing belongs in it", () => {
    const { lines } = renderFrame({ phase: "ready", data: { rows: ["a", "b"] }, reloadedAt: null })
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["a", "b"])
    expect(document.querySelector("[data-slot=view-toolbar]")).toBeNull()
    expect(lines).toEqual([])
  })

  it("stamps data the view re-loaded itself and tells the model it can differ", () => {
    const at = Date.UTC(2026, 9, 31, 14, 32)
    const { lines } = renderFrame(
      { phase: "ready", data: { rows: ["a"] }, reloadedAt: at },
      { host: { timeZone: "UTC" } },
    )
    expect(screen.getByText(/^Reloaded at 02:32\sPM$/)).toBeTruthy()
    expect(lines.at(-1)).toContain("2026-10-31T14:32:00.000Z")
  })

  it("offers fullscreen where the host does, with the kit's 28 px chrome button in the bar-high toolbar", () => {
    const { actions } = renderFrame(
      { phase: "ready", data: { rows: [] }, reloadedAt: null },
      { host: { availableDisplayModes: ["inline", "fullscreen"] } },
    )
    const button = screen.getByRole("button", { name: "Fullscreen" })
    expect(button.className).toContain("shadow-1")
    expect(button.className.split(" ")).toContain("size-control")
    expect(button.querySelector("svg")?.getAttribute("width")).toBe("16")
    expect(button.querySelector("svg")?.getAttribute("stroke-width")).toBe("2.5")
    const toolbar = button.closest('[data-slot="view-toolbar"]')!
    expect(toolbar.className.split(" ")).toEqual(expect.arrayContaining(["min-h-bar", "px-gutter"]))
    fireEvent.click(button)
    expect(actions).toEqual([{ type: "requestDisplayMode", mode: "fullscreen" }])
  })

  it("in fullscreen owns the viewport, pads the safe area and offers the way back", () => {
    renderFrame(
      { phase: "ready", data: { rows: [] }, reloadedAt: null },
      {
        host: {
          displayMode: "fullscreen",
          availableDisplayModes: ["inline", "fullscreen"],
          safeArea: { top: 10, right: 0, bottom: 20, left: 0 },
        },
      },
    )
    const main = screen.getByRole("main")
    expect(main.style.minHeight).toBe("100vh")
    expect(main.style.paddingTop).toBe("10px")
    expect(main.style.paddingBottom).toBe("20px")
    expect(screen.getByRole("button", { name: "Exit fullscreen" })).toBeTruthy()
  })

  it("keeps a crashing view inside the frame", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const Broken: ViewComponent = () => {
      throw new Error("view bug")
    }
    renderFrame({ phase: "ready", data: {}, reloadedAt: null }, { view: Broken })
    expect(screen.getByText("This element couldn't be displayed.")).toBeTruthy()
    error.mockRestore()
  })
})

describe("ViewErrorBoundary", () => {
  it("renders the element again on Try again, and resets on a new resetKey", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    let crash = true
    function Flaky() {
      if (crash) throw new Error("once")
      return <p>fine</p>
    }
    function Harness() {
      const [key, setKey] = useState(0)
      return (
        <>
          <button type="button" onClick={() => setKey((k) => k + 1)}>
            next
          </button>
          <ViewErrorBoundary resetKey={key}>
            <Flaky />
          </ViewErrorBoundary>
        </>
      )
    }
    render(
      <TestViewHost locale="en">
        <Harness />
      </TestViewHost>,
    )
    expect(screen.getByText("This element couldn't be displayed.")).toBeTruthy()
    crash = false
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(screen.getByText("fine")).toBeTruthy()

    crash = true
    fireEvent.click(screen.getByRole("button", { name: "next" }))
    expect(screen.getByText("This element couldn't be displayed.")).toBeTruthy()
    crash = false
    fireEvent.click(screen.getByRole("button", { name: "next" }))
    expect(screen.getByText("fine")).toBeTruthy()
    error.mockRestore()
  })
})
