// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { LocaleProvider } from "../locale/locale-provider.js"
import { COPIED_MS, CopyableId } from "./CopyableId.js"

/**
 * CopyableId, the webview's id text: a short id with a copy button whose copy is the host's
 * (`onCopy`), a check for 1.5 s and a polite note once it is done.
 */

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const ID = "7f0c1d2e-3b4a-5c6d-7e8f-9a0b1c2d3e4f"
const classes = (el: Element | null | undefined) => (el?.getAttribute("class") ?? "").split(/\s+/)

describe("CopyableId", () => {
  it("shows the id short in monospace, the whole id in its title and read out", () => {
    const { container } = render(<CopyableId id={ID} label="instance ID" onCopy={vi.fn()} />)
    const code = container.querySelector("code")!
    expect(code.getAttribute("title")).toBe(ID)
    expect(classes(code)).toEqual(expect.arrayContaining(["font-mono", "truncate", "text-dense"]))
    expect(code.querySelector('[aria-hidden="true"]')?.textContent).toBe("7f0c1d2e…")
    expect(code.querySelector(".sr-only")?.textContent).toBe(ID)
    const { container: full } = render(
      <CopyableId id="job-42" label="job ID" display="full" onCopy={vi.fn()} />,
    )
    expect(full.querySelector("code")?.textContent).toBe("job-42")
  })

  it("copies through the host by click and keyboard, confirms with a check and a polite note for 1.5 s", async () => {
    vi.useFakeTimers()
    const onCopy = vi.fn()
    const outside = vi.fn()
    render(
      // A row around it does not open on the copy.
      <div onClick={outside}>
        <CopyableId id={ID} label="instance ID" onCopy={onCopy} />
      </div>,
    )
    const button = screen.getByRole("button", { name: "Copy instance ID" })
    expect(classes(button)).toContain("size-control-xs")
    button.focus()
    await act(async () => {
      fireEvent.click(button)
    })
    expect(onCopy).toHaveBeenCalledWith(ID)
    expect(outside).not.toHaveBeenCalled()
    expect(button.getAttribute("aria-label")).toBe("Copied instance ID")
    const note = document.querySelector('[aria-live="polite"]')
    expect(note?.textContent).toBe("Copied")
    expect(document.activeElement).toBe(button)
    act(() => {
      vi.advanceTimersByTime(COPIED_MS)
    })
    expect(button.getAttribute("aria-label")).toBe("Copy instance ID")
    expect(note?.textContent).toBe("")
  })

  it("shows no check when the host says the copy failed", async () => {
    render(<CopyableId id={ID} label="instance ID" onCopy={() => Promise.resolve(false)} />)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy instance ID" }))
    })
    expect(screen.getByRole("button", { name: "Copy instance ID" })).toBeTruthy()
  })

  it("takes a copy that throws or rejects as failed: no check, no unhandled rejection", async () => {
    const unhandled = vi.fn()
    process.on("unhandledRejection", unhandled)
    try {
      for (const onCopy of [
        () => Promise.reject(new Error("clipboard refused")),
        () => {
          throw new Error("clipboard refused")
        },
      ]) {
        const { unmount } = render(<CopyableId id={ID} label="instance ID" onCopy={onCopy} />)
        await act(async () => {
          fireEvent.click(screen.getByRole("button", { name: "Copy instance ID" }))
        })
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(screen.getByRole("button", { name: "Copy instance ID" })).toBeTruthy()
        expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe("")
        unmount()
      }
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off("unhandledRejection", unhandled)
    }
  })

  it("keeps the button in the tab order, transparent until hover or focus where a pointer hovers; always shown in facts and a view's bar", () => {
    render(<CopyableId id={ID} label="instance ID" onCopy={vi.fn()} />)
    const button = screen.getByRole("button")
    const c = classes(button)
    expect(button.tabIndex).toBe(0)
    expect(c).toEqual(
      expect.arrayContaining([
        "[@media(hover:hover)]:opacity-0",
        "group-hover/copyable:opacity-100",
        "group-focus-within/copyable:opacity-100",
        "focus-visible:opacity-100",
        "[[data-slot=facts]_&]:opacity-100",
        "[[data-slot=view-bar]_&]:opacity-100",
      ]),
    )
    expect(c.filter((x) => /(^|:)(invisible|hidden)$/.test(x))).toEqual([])
    // The focus ring sits inside: a cell at the region's edge would cut an outset one.
    expect(c).toEqual(
      expect.arrayContaining(["focus-visible:ring-inset", "focus-visible:ring-offset-0"]),
    )
  })

  it("speaks the locale", () => {
    render(
      <LocaleProvider locale="de">
        <CopyableId id={ID} label="Instanz-ID" onCopy={vi.fn()} />
      </LocaleProvider>,
    )
    expect(screen.getByRole("button", { name: "Instanz-ID kopieren" })).toBeTruthy()
  })
})
