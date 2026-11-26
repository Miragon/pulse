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
      const { container } = render(<LogText kind="code" text={text} />)
      expect(container.textContent).toBe("—")
      cleanup()
    }
  })

  it("shows short text whole, without a disclosure", () => {
    const { container } = render(<LogText kind="code" text="NullPointerException" />)
    expect(container.querySelector("details")).toBeNull()
    expect(screen.getByText("NullPointerException").tagName).toBe("P")
  })

  it("cuts long text at the preview and keeps the whole of it in a scrolling disclosure", () => {
    const text = "x".repeat(LOG_TEXT_PREVIEW + 40)
    const { container } = render(<LogText kind="code" text={text} className="mt-2" />)
    const details = container.querySelector("details")
    expect(details?.getAttribute("class")).toBe("mt-2")
    expect(details?.querySelector("summary")?.textContent).toBe(`${"x".repeat(LOG_TEXT_PREVIEW)}…`)
    const pre = details?.querySelector("pre")
    expect(pre?.textContent).toBe(text)
    for (const c of TEXT_BLOCK_FRAME.split(" ")) expect(pre?.getAttribute("class")).toContain(c)
    // A long unbroken token breaks anywhere, so the whole never scrolls sideways.
    expect(pre?.getAttribute("class")?.split(" ")).toEqual(
      expect.arrayContaining(["whitespace-pre-wrap", "wrap-anywhere"]),
    )
    expect(pre?.getAttribute("class")).not.toContain("contain")
  })
})

describe("LogText's kinds: a message is words, code is a machine's", () => {
  const classes = (el: Element | null | undefined) => (el?.getAttribute("class") ?? "").split(" ")

  it("sets a message in the sans and the foreground, code in mono and quiet", () => {
    render(
      <>
        <LogText kind="message" text="Blacklist provider unreachable" />
        <LogText kind="code" text="java.lang.IllegalStateException" />
      </>,
    )
    const message = classes(screen.getByText("Blacklist provider unreachable"))
    expect(message).toEqual(expect.arrayContaining(["text-foreground", "text-small"]))
    expect(message).not.toContain("font-mono")
    expect(message).not.toContain("text-muted-foreground")
    expect(classes(screen.getByText("java.lang.IllegalStateException"))).toEqual(
      expect.arrayContaining(["font-mono", "text-muted-foreground", "text-small"]),
    )
  })

  it("sets a detail page's own message on the body step", () => {
    render(<LogText kind="message" size="body" text="Blacklist provider unreachable" />)
    const message = classes(screen.getByText("Blacklist provider unreachable"))
    expect(message).toEqual(expect.arrayContaining(["text-body", "text-foreground"]))
    expect(message).not.toContain("text-small")
  })

  it("keeps a message quiet in a table row, still in the sans", () => {
    render(<LogText kind="message" line text="Card expired" />)
    const line = classes(screen.getByText("Card expired"))
    expect(line).toEqual(
      expect.arrayContaining(["text-muted-foreground", "text-small", "truncate"]),
    )
    expect(line).not.toContain("font-mono")
  })

  it("opens a long message on its whole words, long code on its lines in mono", () => {
    const words = "w ".repeat(LOG_TEXT_PREVIEW)
    const { container } = render(
      <>
        <LogText kind="message" text={words} />
        <LogText kind="code" text={"c".repeat(LOG_TEXT_PREVIEW + 1)} />
      </>,
    )
    const [message, code] = [...container.querySelectorAll("details")]
    expect(classes(message?.querySelector("summary"))).toContain("text-foreground")
    expect(classes(message?.querySelector("pre"))).not.toContain("font-mono")
    expect(classes(code?.querySelector("summary"))).toContain("font-mono")
    expect(classes(code?.querySelector("pre"))).toContain("font-mono")
  })
})

describe("LogText in a table row (`line`): one line at the row height", () => {
  const classes = (el: Element | null | undefined) => (el?.getAttribute("class") ?? "").split(" ")

  it("cuts short text to one line of 10rem at least, the whole of it in its title", () => {
    const text = "Approver lookup failed: no user with role 'finance-approver'"
    const { container } = render(<LogText kind="code" text={text} line className="ml-1" />)
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
    const { container } = render(<LogText kind="code" text={text} line />)
    const details = container.querySelector("details")
    expect(classes(details)).toContain("min-w-0")
    const summary = details?.querySelector("summary")
    expect(classes(summary)).toContain("truncate")
    expect(summary?.getAttribute("title")).toBe(text)
    expect(details?.querySelector("pre")?.textContent).toBe(text)
    // Open, the whole wraps in the line's width and never widens the column.
    expect(classes(details?.querySelector("pre"))).toEqual(
      expect.arrayContaining(["wrap-anywhere", "[contain:inline-size]"]),
    )
  })

  it("titles nothing outside a row: the text shows whole there", () => {
    const { container } = render(<LogText kind="code" text="NullPointerException" />)
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
    const { container } = render(<LogText kind="code" text={text} line />)
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
    const { container } = render(<LogText kind="code" text={text} line />)
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
      const { container } = render(<LogText kind="code" text="Currency not supported" line />)
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
    const { container } = render(<LogText kind="code" text="Security code mismatch" line />)
    expect(container.querySelector("summary")?.textContent).toBe("Security code mismatch")
  })

  it("measures a new text afresh, closed", () => {
    const size = column(300)
    size.room = 160
    const { container, rerender } = render(
      <LogText kind="code" text="Gateway timeout at the acquirer" line />,
    )
    act(() => toggle(container.querySelector("details")!, true))
    size.room = 400
    rerender(<LogText kind="code" text="Gateway timeout" line />)
    expect(container.querySelector("details")).toBeNull()
    expect(screen.getByText("Gateway timeout").tagName).toBe("P")
  })
})
