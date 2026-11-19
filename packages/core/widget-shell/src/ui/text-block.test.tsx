// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { FOCUS_RING, LocaleProvider, TEXT_BLOCK_FRAME, ToastProvider } from "@miragon/pulse-ui"
import { TextBlock } from "./text-block.js"
import { TestViewHost } from "./test-view-host.js"

const TRACE = "java.lang.IllegalStateException: Blacklist provider unreachable\n\tat Worker.run"

const writeText = vi.fn<(text: string) => Promise<void>>()
const execCommand = vi.fn<(command: string) => boolean>()

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined)
  execCommand.mockReset().mockReturnValue(false)
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
  Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand })
})

afterEach(() => {
  cleanup()
  window.getSelection()?.removeAllRanges()
})

const classes = (el: Element | null | undefined) => (el?.getAttribute("class") ?? "").split(" ")

function renderBlock(locale = "en") {
  return render(
    <LocaleProvider locale={locale}>
      <ToastProvider>
        <TextBlock
          text={TRACE}
          label="Stacktrace"
          copyLabel={locale === "de" ? "Stacktrace kopieren" : "Copy stacktrace"}
        />
      </ToastProvider>
    </LocaleProvider>,
  )
}

describe("TextBlock: engine text to read with the keyboard and to copy whole", () => {
  it("is a named region that takes focus, in the frame, with the kit's focus ring", () => {
    renderBlock()
    const block = screen.getByRole("region", { name: "Stacktrace" })
    expect(block.tagName).toBe("PRE")
    expect(block.textContent).toBe(TRACE)
    expect(block.tabIndex).toBe(0)
    for (const c of [...TEXT_BLOCK_FRAME.split(" "), ...FOCUS_RING.split(" "), "font-mono"]) {
      expect(classes(block)).toContain(c)
    }
  })

  it("wraps its lines and drops the height cap under 40rem of its own width", () => {
    const { container } = renderBlock()
    const root = container.querySelector("[data-slot='text-block']")
    expect(classes(root)).toContain("@container/text-block")
    expect(classes(screen.getByRole("region"))).toEqual(
      expect.arrayContaining([
        "@max-[40rem]/text-block:max-h-none",
        "@max-[40rem]/text-block:whitespace-pre-wrap",
      ]),
    )
  })

  it("copies the whole text and says what it copied, with a check on its button", async () => {
    renderBlock()
    const button = screen.getByRole("button", { name: "Copy stacktrace" })
    expect(button.getAttribute("title")).toBe("Copy stacktrace")
    fireEvent.click(button)
    const toast = await screen.findByText("Stacktrace copied")
    expect(writeText).toHaveBeenCalledWith(TRACE)
    expect(toast.closest('[data-slot="toast"]')?.getAttribute("data-tone")).toBe("success")
    expect(button.querySelector("svg")?.getAttribute("class")).toContain("lucide-check")
  })

  it("speaks German on a German host", async () => {
    renderBlock("de")
    fireEvent.click(screen.getByRole("button", { name: "Stacktrace kopieren" }))
    expect(await screen.findByText("Stacktrace kopiert")).toBeTruthy()
  })

  it("says a failed copy and selects the text, so the reader copies it by hand", async () => {
    writeText.mockRejectedValue(new Error("denied"))
    renderBlock()
    fireEvent.click(screen.getByRole("button", { name: "Copy stacktrace" }))
    expect(await screen.findByText("Stacktrace not copied")).toBeTruthy()
    expect(screen.getByText("The text is now selected. Copy it yourself.")).toBeTruthy()
    const block = screen.getByRole("region", { name: "Stacktrace" })
    expect(document.activeElement).toBe(block)
    expect(window.getSelection()?.toString()).toBe(TRACE)
  })

  it("offers its copy on a page that writes nothing: copying is no write", () => {
    render(
      <TestViewHost writes={false} followUp="none">
        <TextBlock text={TRACE} label="Stacktrace" copyLabel="Copy stacktrace" />
      </TestViewHost>,
    )
    expect(screen.getByRole("button", { name: "Copy stacktrace" })).toBeTruthy()
  })
})
