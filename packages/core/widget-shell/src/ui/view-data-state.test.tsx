// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { LocaleProvider } from "@miragon/pulse-ui"
import { SKELETON_DELAY_MS, ViewDataState } from "./view-data-state.js"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

/** Past the skeleton's delay. */
const afterDelay = () =>
  act(() => {
    vi.advanceTimersByTime(SKELETON_DELAY_MS)
  })

const ENGINE_DOWN = new Error("[503 ProcessEngineException] Engine is shutting down (engine prod)")

describe("ViewDataState: the error (U1)", () => {
  it("says what happened and what to do, raw text under Details, Retry always", () => {
    const onRetry = vi.fn()
    render(<ViewDataState loading={false} error={ENGINE_DOWN} onRetry={onRetry} emptyText="e" />)
    const state = screen.getByRole("alert")
    expect(state.getAttribute("data-slot")).toBe("error-state")
    expect(
      screen.getByRole("heading", { name: "Engine prod is unreachable (HTTP 503)" }),
    ).toBeTruthy()
    expect(
      screen.getByText("Check that the engine is running, or pick another engine."),
    ).toBeTruthy()
    // The raw engine text is collapsed under "Details", never the headline.
    const raw = screen.getByText(ENGINE_DOWN.message)
    expect(raw.closest("details")?.hasAttribute("open")).toBe(false)
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it("speaks the active locale and keeps a caller's retry label", () => {
    const props = { loading: false, error: ENGINE_DOWN, emptyText: "e", onRetry: vi.fn() }
    const { rerender } = render(
      <LocaleProvider locale="de">
        <ViewDataState {...props} />
      </LocaleProvider>,
    )
    expect(
      screen.getByRole("heading", { name: "Die Engine prod ist nicht erreichbar (HTTP 503)" }),
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: "Erneut versuchen" })).toBeTruthy()
    rerender(
      <LocaleProvider locale="de">
        <ViewDataState {...props} retryLabel="Nochmal" />
      </LocaleProvider>,
    )
    expect(screen.getByRole("button", { name: "Nochmal" })).toBeTruthy()
  })

  it.each([
    [
      '[ENGINE_PROFILE_REFUSED] Engine "locked" is configured, but its profile cannot be used: auth.tokenEnv names a variable that is not set. Ask whoever runs this server to fix it.',
      "Engine locked cannot be used: its profile is refused",
    ],
    [
      '[ENGINE_READ_ONLY] Engine "ro" is read-only on this server: its profile sets readOnly, so no tool writes to it. Nothing was sent.',
      "Engine ro is read-only on this server",
    ],
  ])("a permanent refusal says why, and offers no Try again: %s", (text, title) => {
    render(
      <ViewDataState loading={false} error={new Error(text)} onRetry={vi.fn()} emptyText="e" />,
    )
    expect(screen.getByRole("heading", { name: title })).toBeTruthy()
    expect(screen.getByText(text).closest("details")).toBeTruthy()
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("heads an unclassified error with the caller's title", () => {
    render(
      <ViewDataState
        loading={false}
        error={new Error("odd")}
        errorTitle="Incidents could not be loaded"
        onRetry={vi.fn()}
        emptyText="e"
      />,
    )
    expect(screen.getByRole("heading", { name: "Incidents could not be loaded" })).toBeTruthy()
  })
})

describe("ViewDataState: loading (U22)", () => {
  it("shows the skeleton under a polite status only screen readers read, after 400 ms", () => {
    vi.useFakeTimers()
    const { container } = render(
      <ViewDataState loading error={null} onRetry={vi.fn()} emptyText="Empty" />,
    )
    const status = screen.getByRole("status")
    expect(status.querySelector(".sr-only")?.textContent).toBe("Loading view…")
    // A quick answer flashes no skeleton (the webview's rule): it shows only after the delay.
    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull()
    act(() => {
      vi.advanceTimersByTime(SKELETON_DELAY_MS - 1)
    })
    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull()
    afterDelay()
    // The default skeleton, hidden from screen readers.
    const skeletons = container.querySelectorAll('[data-slot="skeleton"]')
    expect(skeletons.length).toBeGreaterThan(0)
    expect(skeletons[0].closest('[aria-hidden="true"]')).toBeTruthy()
    expect(screen.queryByText("Empty")).toBeNull()
  })

  it("takes a skeleton shaped like the result and the locale's or caller's words", () => {
    vi.useFakeTimers()
    const { rerender } = render(
      <LocaleProvider locale="de">
        <ViewDataState
          loading
          error={null}
          onRetry={vi.fn()}
          emptyText="Leer"
          skeleton={<div data-testid="kpis" />}
        />
      </LocaleProvider>,
    )
    afterDelay()
    expect(screen.getByTestId("kpis")).toBeTruthy()
    expect(screen.getByRole("status").textContent).toBe("Ansicht wird geladen…")
    rerender(
      <ViewDataState loading error={null} onRetry={vi.fn()} emptyText="e" loadingText="Jobs…" />,
    )
    expect(screen.getByRole("status").textContent).toBe("Jobs…")
  })
})

describe("ViewDataState: no data (U10)", () => {
  it("renders pulse-ui's empty state with the given text", () => {
    const { container } = render(
      <ViewDataState
        loading={false}
        error={null}
        onRetry={vi.fn()}
        emptyText="No incident found"
      />,
    )
    expect(container.querySelector('[data-slot="empty-state"]')?.textContent).toContain(
      "No incident found",
    )
    expect(screen.queryByRole("status")).toBeNull()
  })
})

describe("ViewDataState: the loaded content, refreshed in place", () => {
  it("renders the content it is handed once the load is done, its region busy while a new read runs", () => {
    const props = { loading: false, error: null, onRetry: vi.fn(), emptyText: "Empty" }
    const { container, rerender } = render(
      <ViewDataState {...props}>
        <p>Three instances</p>
      </ViewDataState>,
    )
    const region = container.querySelector('[data-slot="view-data"]')!
    expect(region.textContent).toBe("Three instances")
    expect(region.hasAttribute("aria-busy")).toBe(false)
    rerender(
      <ViewDataState {...props} refreshing>
        <p>Three instances</p>
      </ViewDataState>,
    )
    // The same node, still on screen, busy and silent: nothing blanks, nothing announces.
    expect(container.querySelector('[data-slot="view-data"]')).toBe(region)
    expect(region.getAttribute("aria-busy")).toBe("true")
    expect(screen.queryByRole("status")).toBeNull()
    expect(screen.queryByText("Empty")).toBeNull()
  })

  it("still says the empty text without content, and an error wins over content", () => {
    const { rerender } = render(
      <ViewDataState loading={false} error={null} onRetry={vi.fn()} emptyText="Empty" />,
    )
    expect(screen.getByText("Empty")).toBeTruthy()
    rerender(
      <ViewDataState loading={false} error={ENGINE_DOWN} onRetry={vi.fn()} emptyText="Empty">
        <p>Three instances</p>
      </ViewDataState>,
    )
    expect(screen.getByRole("alert")).toBeTruthy()
    expect(screen.queryByText("Three instances")).toBeNull()
  })

  it("takes null and false content as none: the empty text, never an empty busy region", () => {
    const rows: string[] = []
    for (const content of [null, false, rows.length > 0 && <p>Rows</p>]) {
      const { container, unmount } = render(
        <ViewDataState loading={false} error={null} onRetry={vi.fn()} emptyText="Empty" refreshing>
          {content}
        </ViewDataState>,
      )
      expect(screen.getByText("Empty")).toBeTruthy()
      expect(container.querySelector('[data-slot="view-data"]')).toBeNull()
      unmount()
    }
  })
})
