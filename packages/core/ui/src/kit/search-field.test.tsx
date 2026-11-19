// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { LocaleProvider } from "../locale/locale-provider.js"
import { UI_MESSAGES } from "../locale/ui-messages.js"
import { SearchField } from "./search-field.js"

/**
 * SearchField (the webview's filter search): a field with its search icon inside, a clear
 * button, a debounced `onChange` and the applied text kept in sync, so a reset or a link from
 * outside shows in the field.
 */

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const classes = (el: Element | null | undefined) => (el?.getAttribute("class") ?? "").split(/\s+/)
const box = () => screen.getByRole("searchbox")
const type = (text: string) => fireEvent.change(box(), { target: { value: text } })
const wait = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms)
  })

/** A list that applies what the field asks for, as a view would. */
function Applied({ onApply, delayMs }: { onApply: (text: string) => void; delayMs?: number }) {
  const [applied, setApplied] = useState("")
  return (
    <>
      <SearchField
        value={applied}
        delayMs={delayMs}
        onChange={(text) => {
          onApply(text)
          setApplied(text)
        }}
      />
      <button type="button" onClick={() => setApplied("")}>
        Reset
      </button>
      <button type="button" onClick={() => setApplied("invoice")}>
        Open the invoices
      </button>
      <output>{applied}</output>
    </>
  )
}

describe("SearchField", () => {
  it("is a 200 px field of the control height with a 16 px search icon inside, named by the catalogue", () => {
    const { container } = render(<SearchField value="" onChange={() => {}} />)
    const input = box()
    expect(input.getAttribute("type")).toBe("search")
    expect(input.getAttribute("aria-label")).toBe(UI_MESSAGES.en.searchField.label)
    expect(input.getAttribute("placeholder")).toBe(UI_MESSAGES.en.searchField.placeholder)
    const field = container.querySelector('[data-slot="search-field"]')
    expect(classes(field)).toEqual(
      expect.arrayContaining([
        "min-h-control",
        "w-50",
        "max-w-full",
        "shrink-0",
        "@max-[73.75rem]:shrink",
        "@max-[73.75rem]:min-w-30",
        "rounded-sm",
        "border-input",
        "bg-background",
        "has-[input:focus-visible]:border-focus",
        "has-[input:focus-visible]:ring-[length:calc(var(--focus-width)-1px)]",
      ]),
    )
    const icon = field?.querySelector("svg")
    expect(icon?.getAttribute("class")).toContain("lucide-search")
    expect(icon?.getAttribute("width")).toBe("16")
    expect(icon?.getAttribute("aria-hidden")).toBe("true")
    // No clear button while it is empty.
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("speaks German under a German locale and takes a caller's name and placeholder", () => {
    const { rerender } = render(
      <LocaleProvider locale="de">
        <SearchField value="" onChange={() => {}} />
      </LocaleProvider>,
    )
    expect(box().getAttribute("aria-label")).toBe("Suchen")
    expect(box().getAttribute("placeholder")).toBe("Suchen…")
    rerender(
      <LocaleProvider locale="de">
        <SearchField value="" onChange={() => {}} aria-label="Prozesse suchen" placeholder="Name" />
      </LocaleProvider>,
    )
    expect(box().getAttribute("aria-label")).toBe("Prozesse suchen")
    expect(box().getAttribute("placeholder")).toBe("Name")
  })

  it("applies the trimmed text once typing pauses, never on every keystroke", () => {
    vi.useFakeTimers()
    const onApply = vi.fn()
    render(<Applied onApply={onApply} />)
    type("inv")
    wait(200)
    type("invoice ")
    wait(299)
    expect(onApply).not.toHaveBeenCalled()
    wait(1)
    expect(onApply).toHaveBeenCalledExactlyOnceWith("invoice")
    // The view applied it; what was typed stays as typed, the blank included.
    expect((box() as HTMLInputElement).value).toBe("invoice ")
    expect(screen.getByRole("status").textContent).toBe("invoice")
  })

  it("waits as long as delayMs says and asks for the same text only once", () => {
    vi.useFakeTimers()
    const onApply = vi.fn()
    render(<Applied onApply={onApply} delayMs={400} />)
    type("job")
    wait(399)
    expect(onApply).not.toHaveBeenCalled()
    wait(1)
    expect(onApply).toHaveBeenCalledExactlyOnceWith("job")
    type("job  ")
    wait(400)
    expect(onApply).toHaveBeenCalledOnce()
  })

  it("applies at once on Enter", () => {
    vi.useFakeTimers()
    const onApply = vi.fn()
    render(<Applied onApply={onApply} />)
    type("order")
    fireEvent.keyDown(box(), { key: "Enter" })
    expect(onApply).toHaveBeenCalledExactlyOnceWith("order")
    wait(300)
    expect(onApply).toHaveBeenCalledOnce()
  })

  it("clears with its button: applies the empty search at once and hands focus back to the input", () => {
    const onApply = vi.fn()
    render(<SearchField value="invoice" onChange={onApply} />)
    const clear = screen.getByRole("button", { name: UI_MESSAGES.en.searchField.clear })
    expect(classes(clear)).toEqual(
      expect.arrayContaining(["size-control-xs", "focus-visible:ring-offset-0"]),
    )
    fireEvent.click(clear)
    expect(onApply).toHaveBeenCalledExactlyOnceWith("")
    expect((box() as HTMLInputElement).value).toBe("")
    expect(document.activeElement).toBe(box())
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("clears on Escape while it holds text, and leaves Escape alone when empty", () => {
    const onApply = vi.fn()
    render(<SearchField value="invoice" onChange={onApply} />)
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
    act(() => {
      box().dispatchEvent(escape)
    })
    expect(escape.defaultPrevented).toBe(true)
    expect(onApply).toHaveBeenCalledExactlyOnceWith("")
    const again = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
    act(() => {
      box().dispatchEvent(again)
    })
    expect(again.defaultPrevented).toBe(false)
    expect(onApply).toHaveBeenCalledOnce()
  })

  it("follows the applied search when it changes from outside, dropping what was typed meanwhile", () => {
    vi.useFakeTimers()
    const onApply = vi.fn()
    render(<Applied onApply={onApply} />)
    type("payment")
    fireEvent.click(screen.getByRole("button", { name: "Open the invoices" }))
    expect((box() as HTMLInputElement).value).toBe("invoice")
    wait(300)
    expect(onApply).not.toHaveBeenCalled()
    type("invoice x")
    wait(300)
    expect(onApply).toHaveBeenCalledExactlyOnceWith("invoice x")
    fireEvent.click(screen.getByRole("button", { name: "Reset" }))
    expect((box() as HTMLInputElement).value).toBe("")
  })

  it("keeps the timer when a parent hands a new onChange on every render", () => {
    vi.useFakeTimers()
    const calls: string[] = []
    function Parent() {
      const [renders, setRenders] = useState(0)
      return (
        <>
          <SearchField value="" onChange={(text) => calls.push(`${renders}:${text}`)} />
          <button type="button" onClick={() => setRenders((n) => n + 1)}>
            Rerender
          </button>
        </>
      )
    }
    render(<Parent />)
    type("abc")
    wait(200)
    fireEvent.click(screen.getByRole("button", { name: "Rerender" }))
    wait(100)
    // The latest onChange, after the first pause.
    expect(calls).toEqual(["1:abc"])
  })

  it("passes a caller's keydown on first and skips its own when the caller prevented it", () => {
    const onApply = vi.fn()
    const onKeyDown = vi.fn((event: { key: string; preventDefault: () => void }) => {
      if (event.key === "Enter") event.preventDefault()
    })
    render(<SearchField value="" onChange={onApply} onKeyDown={onKeyDown} />)
    type("x")
    fireEvent.keyDown(box(), { key: "Enter" })
    expect(onKeyDown).toHaveBeenCalledOnce()
    expect(onApply).not.toHaveBeenCalled()
  })

  it("shows an invalid entry and a disabled field on its box; a disabled one offers no clear button", () => {
    const { container, rerender } = render(
      <SearchField value="x" onChange={() => {}} aria-invalid className="w-full" />,
    )
    const field = () => container.querySelector('[data-slot="search-field"]')
    expect(classes(field())).toEqual(
      expect.arrayContaining(["border-danger", "ring-danger", "ring-1", "w-full"]),
    )
    expect(classes(field())).not.toContain("w-50")
    rerender(<SearchField value="x" onChange={() => {}} disabled />)
    expect(classes(field())).toEqual(
      expect.arrayContaining(["bg-accent", "text-muted-foreground", "cursor-not-allowed"]),
    )
    expect(classes(field())).not.toContain("border-danger")
    expect((box() as HTMLInputElement).disabled).toBe(true)
    expect(screen.queryByRole("button")).toBeNull()
  })
})
