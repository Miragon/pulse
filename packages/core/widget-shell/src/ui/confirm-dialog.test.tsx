// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { LocaleProvider } from "@miragon/mcp-toolkit-ui"
import { useState } from "react"
import { anchoredTop, ConfirmDialog, type ConfirmDialogProps } from "./confirm-dialog.js"
import { DisplayModeProvider } from "./widget-shell.js"

afterEach(cleanup)

function renderDialog(overrides: Partial<ConfirmDialogProps> = {}) {
  const props: ConfirmDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    title: "Cancel this instance?",
    description: "The instance stops for good.",
    target: [
      ["Instance", "5f0ce78e-6b1d-11ef-9c3a-0242ac120002"],
      ["Engine", "prod"],
    ],
    confirmLabel: "Cancel instance",
    keepLabel: "Keep instance",
    destructive: true,
    onConfirm: vi.fn(),
    ...overrides,
  }
  render(<ConfirmDialog {...props} />)
  return props
}

describe("ConfirmDialog (CI §8 dialogs, §9 destructive)", () => {
  it("is an alertdialog over the scrim: md radius, shadow-3, named by its question", () => {
    renderDialog()
    const dialog = screen.getByRole("alertdialog", { name: "Cancel this instance?" })
    expect(dialog.className).toContain("rounded-md")
    expect(dialog.className).toContain("shadow-3")
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy()
    const overlay = document.querySelector('[data-slot="dialog-overlay"]')
    expect(overlay?.className).toContain("bg-scrim")
    expect(overlay?.className).toContain("backdrop-blur-sm")
  })

  it("names its target by label and value, ids in Geist Mono", () => {
    renderDialog()
    const value = screen.getByText("5f0ce78e-6b1d-11ef-9c3a-0242ac120002")
    expect(value.tagName).toBe("DD")
    expect(value.className).toContain("font-mono")
    expect(screen.getByText("Instance").tagName).toBe("DT")
  })

  it("labels both buttons verb + object; the destructive one in the danger role", () => {
    const props = renderDialog()
    const confirm = screen.getByRole("button", { name: "Cancel instance" })
    expect(confirm.getAttribute("data-variant") ?? confirm.className).toContain("destructive")
    fireEvent.click(confirm)
    expect(props.onConfirm).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole("button", { name: "Keep instance" }))
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
  })

  it("a reversible write confirms with the primary button", () => {
    renderDialog({ destructive: false, confirmLabel: "Suspend instance" })
    const confirm = screen.getByRole("button", { name: "Suspend instance" })
    expect(confirm.getAttribute("data-variant") ?? confirm.className).not.toContain("destructive")
  })

  it("waits while the write runs: both buttons disabled, no close, the pending words", () => {
    const props = renderDialog({ pending: true })
    const working = screen.getByRole("button", { name: "Working…" })
    expect(working.hasAttribute("disabled")).toBe(true)
    expect(working.getAttribute("aria-busy")).toBe("true")
    expect(screen.getByRole("button", { name: "Keep instance" }).hasAttribute("disabled")).toBe(
      true,
    )
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull()
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" })
    expect(props.onOpenChange).not.toHaveBeenCalled()
  })

  it("closes on Escape when idle", () => {
    const props = renderDialog()
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" })
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
  })

  it("shows a failed write inside the dialog, in words, the raw text under Details", () => {
    render(
      <LocaleProvider locale="de">
        <ConfirmDialog
          open
          onOpenChange={vi.fn()}
          title="Instanz abbrechen?"
          description="Die Instanz endet endgültig."
          target={[["Instanz", "i-1"]]}
          confirmLabel="Instanz abbrechen"
          keepLabel="Instanz behalten"
          pendingLabel="Wird abgebrochen…"
          error="[503 ProcessEngineException] down (engine prod)"
          onConfirm={vi.fn()}
        />
      </LocaleProvider>,
    )
    const state = screen.getByRole("alert")
    expect(state.getAttribute("data-variant")).toBe("inline")
    expect(state.textContent).toContain("Die Engine prod ist nicht erreichbar (HTTP 503)")
    expect(
      screen.getByText("[503 ProcessEngineException] down (engine prod)").closest("details"),
    ).toBeTruthy()
  })
})

// #344 K45: the dialog opens beside its opener, which is in view.
describe("ConfirmDialog placement", () => {
  it("anchoredTop centres on the opener and stays inside the frame", () => {
    expect(anchoredTop({ top: 900, height: 40 }, 300, 2000)).toBe(770)
    expect(anchoredTop({ top: 1950, height: 40 }, 300, 2000)).toBe(1684)
    expect(anchoredTop({ top: 0, height: 40 }, 300, 2000)).toBe(16)
  })

  function Opener({ mode }: { mode: string }) {
    const [open, setOpen] = useState(false)
    return (
      <DisplayModeProvider mode={mode}>
        <button type="button" onClick={() => setOpen(true)}>
          Cancel instance…
        </button>
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title="Cancel this instance?"
          description="The instance stops for good."
          target={[["Instance", "pi-1"]]}
          confirmLabel="Cancel instance"
          keepLabel="Keep instance"
          onConfirm={vi.fn()}
        />
      </DisplayModeProvider>
    )
  }

  function openFrom(mode: string) {
    render(<Opener mode={mode} />)
    const opener = screen.getByRole("button", { name: "Cancel instance…" })
    opener.getBoundingClientRect = () => ({ top: 1200, height: 40 }) as DOMRect
    opener.focus()
    fireEvent.click(opener)
    return screen.getByRole("alertdialog")
  }

  it("opens beside its opener inline", () => {
    const dialog = openFrom("inline")
    expect(dialog.style.top).toMatch(/px$/)
    expect(Number.parseFloat(dialog.style.top)).toBeGreaterThan(16)
    expect(dialog.style.translate).toBe("-50% 0")
  })

  it("stays centred in fullscreen", () => {
    const dialog = openFrom("fullscreen")
    expect(dialog.style.top).toBe("")
  })
})
