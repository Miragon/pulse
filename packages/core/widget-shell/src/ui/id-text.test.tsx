// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { LocaleProvider, ToastProvider } from "@miragon/mcp-toolkit-ui"
import { copyText, IdCell, IdText, shortId } from "./id-text.js"

const UUID = "5f0ce78e-6b1d-11ef-9c3a-0242ac120002"

const writeText = vi.fn<(text: string) => Promise<void>>()
const execCommand = vi.fn<(command: string) => boolean>()

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined)
  execCommand.mockReset().mockReturnValue(false)
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  })
  Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("shortId", () => {
  it("keeps a short id whole and cuts a long one to its head", () => {
    expect(shortId("LEA-2026-04")).toBe("LEA-2026-04")
    expect(shortId("123456789012")).toBe("123456789012")
    expect(shortId("1234567890123")).toBe("12345678…")
    expect(shortId(UUID)).toBe("5f0ce78e…")
  })
})

describe("IdText (U2, U13)", () => {
  it("shows a long id shortened in Geist Mono, whole for screen readers and in its title", () => {
    render(<IdText value={UUID} />)
    const text = screen.getByTitle(UUID)
    expect(text.className).toContain("font-mono")
    expect(text.querySelector('[aria-hidden="true"]')?.textContent).toBe("5f0ce78e…")
    expect(text.querySelector(".sr-only")?.textContent).toBe(UUID)
  })

  it("shows a short id as it is", () => {
    render(<IdText value="job-1" />)
    expect(screen.getByTitle("job-1").textContent).toBe("job-1")
  })

  it("copies the WHOLE id and confirms it with a toast and a check", async () => {
    render(
      <ToastProvider>
        <IdText value={UUID} />
      </ToastProvider>,
    )
    const button = screen.getByRole("button", { name: "Copy 5f0ce78e…" })
    fireEvent.click(button)
    const toast = await screen.findByText("ID copied")
    expect(writeText).toHaveBeenCalledWith(UUID)
    expect(toast.closest('[data-slot="toast"]')?.getAttribute("data-tone")).toBe("success")
    expect(button.querySelector("svg")?.getAttribute("class")).toContain("lucide-check")
  })

  it("says so in the active locale when the frame may not copy", async () => {
    writeText.mockRejectedValue(new Error("denied"))
    render(
      <LocaleProvider locale="de">
        <ToastProvider>
          <IdText value={UUID} />
        </ToastProvider>
      </LocaleProvider>,
    )
    fireEvent.click(screen.getByRole("button", { name: "5f0ce78e… kopieren" }))
    const toast = await screen.findByText("Die ID ließ sich nicht kopieren")
    expect(toast.closest('[data-slot="toast"]')?.getAttribute("data-tone")).toBe("danger")
    expect(screen.getByText("Die ganze ID ist jetzt markiert. Kopier sie selbst.")).toBeTruthy()
  })

  it("leaves the WHOLE id selected in a field after a failed copy, so copying by hand works", async () => {
    writeText.mockRejectedValue(new Error("denied"))
    render(
      <ToastProvider>
        <IdText value={UUID} />
      </ToastProvider>,
    )
    const button = screen.getByRole("button", { name: "Copy 5f0ce78e…" })
    fireEvent.click(button)
    const field = await screen.findByRole<HTMLInputElement>("textbox", { name: "Full ID" })
    // Not the shortened "5f0ce78e…": the field holds the id itself, selected.
    expect(field.value).toBe(UUID)
    expect(field.readOnly).toBe(true)
    await waitFor(() => expect(document.activeElement).toBe(field))
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, UUID.length])
    expect(screen.queryByTitle(UUID)).toBeNull()

    // Escape folds it back and returns to the button; leaving it does too.
    fireEvent.keyDown(field, { key: "Escape" })
    expect(screen.queryByRole("textbox")).toBeNull()
    expect(document.activeElement).toBe(button)
    fireEvent.click(button)
    fireEvent.blur(await screen.findByRole("textbox", { name: "Full ID" }))
    expect(screen.queryByRole("textbox")).toBeNull()
    expect(screen.getByTitle(UUID)).toBeTruthy()
  })

  it("turns the check back into the copy icon after a moment", async () => {
    vi.useFakeTimers()
    render(<IdText value={UUID} />)
    const button = screen.getByRole("button")
    await act(async () => {
      fireEvent.click(button)
      await Promise.resolve()
    })
    expect(button.querySelector("svg")?.getAttribute("class")).toContain("lucide-check")
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(button.querySelector("svg")?.getAttribute("class")).toContain("lucide-copy")
  })
})

describe("copyText", () => {
  it("falls back to the selection copy without the Clipboard API", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined })
    execCommand.mockReturnValue(true)
    expect(await copyText("x")).toBe(true)
    expect(execCommand).toHaveBeenCalledWith("copy")
    expect(document.querySelector("textarea")).toBeNull()
  })

  it("reports failure when neither path works", async () => {
    writeText.mockRejectedValue(new Error("denied"))
    execCommand.mockImplementation(() => {
      throw new Error("unsupported")
    })
    expect(await copyText("x")).toBe(false)
  })
})

describe("IdCell", () => {
  it("is a table cell holding the id", async () => {
    render(
      <table>
        <tbody>
          <tr>
            <IdCell value={UUID} align="right" />
          </tr>
        </tbody>
      </table>,
    )
    const cell = screen.getByRole("cell")
    expect(cell.className).toContain("text-right")
    expect(cell.className).toContain("whitespace-nowrap")
    await waitFor(() => expect(cell.querySelector("button")).toBeTruthy())
  })
})
