// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { LOG_TEXT_PREVIEW, LogText, TEXT_BLOCK_FRAME } from "./log-text.js"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("LogText: one truncation policy for engine text", () => {
  it("shows a dash for no text", () => {
    for (const text of [null, undefined, ""]) {
      const { container } = render(<LogText text={text} />)
      expect(container.textContent).toBe("—")
      cleanup()
    }
  })

  it("shows short text whole, without a disclosure", () => {
    const { container } = render(<LogText text="NullPointerException" />)
    expect(container.querySelector("details")).toBeNull()
    expect(screen.getByText("NullPointerException").tagName).toBe("P")
  })

  it("cuts long text at the preview and keeps the whole of it in a scrolling disclosure", () => {
    const text = "x".repeat(LOG_TEXT_PREVIEW + 40)
    const { container } = render(<LogText text={text} className="mt-2" />)
    const details = container.querySelector("details")
    expect(details?.getAttribute("class")).toBe("mt-2")
    expect(details?.querySelector("summary")?.textContent).toBe(`${"x".repeat(LOG_TEXT_PREVIEW)}…`)
    const pre = details?.querySelector("pre")
    expect(pre?.textContent).toBe(text)
    for (const c of TEXT_BLOCK_FRAME.split(" ")) expect(pre?.getAttribute("class")).toContain(c)
  })
})

describe("LogText in a table row (`line`): one line at the row height", () => {
  const classes = (el: Element | null | undefined) => (el?.getAttribute("class") ?? "").split(" ")

  it("cuts short text to one line of 10rem at least, the whole of it in its title", () => {
    const text = "Approver lookup failed: no user with role 'finance-approver'"
    const { container } = render(<LogText text={text} line className="ml-1" />)
    const floor = container.firstElementChild
    expect(classes(floor)).toEqual(
      expect.arrayContaining(["grid", "min-w-0", "grid-cols-[minmax(10rem,max-content)]", "ml-1"]),
    )
    const shown = screen.getByText(text)
    expect(shown.parentElement).toBe(floor)
    expect(classes(shown)).toEqual(expect.arrayContaining(["truncate", "min-w-0", "font-mono"]))
    expect(classes(shown)).not.toContain("break-words")
    expect(shown.getAttribute("title")).toBe(text)
    // Whole in its column: nothing to open.
    expect(container.querySelector("details")).toBeNull()
  })

  it("keeps a long text's whole under its disclosure, its one line's title the whole too", () => {
    const text = "y".repeat(LOG_TEXT_PREVIEW + 40)
    const { container } = render(<LogText text={text} line />)
    const details = container.querySelector("details")
    expect(classes(details)).toContain("min-w-0")
    const summary = details?.querySelector("summary")
    expect(classes(summary)).toContain("truncate")
    expect(summary?.getAttribute("title")).toBe(text)
    expect(details?.querySelector("pre")?.textContent).toBe(text)
  })

  it("titles nothing outside a row: the text shows whole there", () => {
    const { container } = render(<LogText text="NullPointerException" />)
    expect(container.querySelector("[title]")).toBeNull()
  })

  /** The line's column: `room` px wide, the text `needs` px; happy-dom lays out nothing. */
  function column(needs: number) {
    const size = { room: 400 }
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(() => needs)
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => size.room)
    return size
  }

  /** A ResizeObserver the test drives: `resize()` reports every observed box as resized. */
  function observedResizes() {
    const observers = new Set<() => void>()
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private readonly report: () => void) {}
        observe() {
          observers.add(this.report)
        }
        disconnect() {
          observers.delete(this.report)
        }
      },
    )
    return () => act(() => observers.forEach((report) => report()))
  }

  function toggle(details: HTMLDetailsElement, open: boolean) {
    details.open = open
    fireEvent(details, new Event("toggle"))
  }

  it("makes a line its column cuts a disclosure that opens on the whole text by keyboard and touch", () => {
    const text = "Card expired after the gateway's second look at the billing address"
    column(520).room = 160
    const { container } = render(<LogText text={text} line />)
    const summary = container.querySelector("summary")
    expect(summary?.textContent).toBe(text)
    expect(summary?.getAttribute("title")).toBe(text)
    expect(classes(summary)).toContain("truncate")
    expect(container.querySelector("details pre")?.textContent).toBe(text)
    expect(container.querySelector("p")).toBeNull()
  })

  it("measures again as its column changes width, and an open one stays open until it closes", () => {
    const resize = observedResizes()
    const size = column(300)
    const text = "Billing address unknown at the issuer"
    const { container } = render(<LogText text={text} line />)
    expect(container.querySelector("details")).toBeNull()

    size.room = 160
    resize()
    const details = container.querySelector("details")!
    expect(details.querySelector("summary")?.textContent).toBe(text)

    act(() => toggle(details, true))
    size.room = 400
    resize()
    expect(container.querySelector("details")).toBe(details)

    act(() => toggle(details, false))
    expect(container.querySelector("details")).toBeNull()
    expect(screen.getByText(text).tagName).toBe("P")
  })

  it("measures again once the fonts have loaded", async () => {
    let loaded: () => void = () => {}
    const ready = new Promise<void>((resolve) => {
      loaded = resolve
    })
    Object.defineProperty(document, "fonts", { value: { ready }, configurable: true })
    try {
      const size = column(240)
      const { container } = render(<LogText text="Currency not supported" line />)
      expect(container.querySelector("details")).toBeNull()
      size.room = 160
      await act(async () => {
        loaded()
        await ready
      })
      expect(container.querySelector("summary")?.textContent).toBe("Currency not supported")
    } finally {
      Reflect.deleteProperty(document, "fonts")
    }
  })

  it("measures once where no ResizeObserver exists", () => {
    vi.stubGlobal("ResizeObserver", undefined)
    column(300).room = 160
    const { container } = render(<LogText text="Security code mismatch" line />)
    expect(container.querySelector("summary")?.textContent).toBe("Security code mismatch")
  })

  it("measures a new text afresh, closed", () => {
    const size = column(300)
    size.room = 160
    const { container, rerender } = render(<LogText text="Gateway timeout at the acquirer" line />)
    act(() => toggle(container.querySelector("details")!, true))
    size.room = 400
    rerender(<LogText text="Gateway timeout" line />)
    expect(container.querySelector("details")).toBeNull()
    expect(screen.getByText("Gateway timeout").tagName).toBe("P")
  })
})
