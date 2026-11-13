// @vitest-environment happy-dom
import { useRef, useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { LocaleProvider } from "../locale/locale-provider.js"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../primitives/dialog.js"
import { ConditionChip } from "./ConditionChip.js"

/**
 * ConditionChip, the webview's variable chip: a removable and editable condition whose buttons
 * name it, the focus going back where the editing started or, once removed, to the opener.
 */

afterEach(cleanup)

const classes = (el: Element | null | undefined) => (el?.getAttribute("class") ?? "").split(/\s+/)

describe("ConditionChip", () => {
  it("is a 28 px pill on the raised surface up to 240 px, its text cut and whole in its title", () => {
    const { container } = render(<ConditionChip label="amount > 100" onRemove={vi.fn()} />)
    const chip = container.querySelector('[data-slot="condition-chip"]')
    expect(chip?.getAttribute("title")).toBe("amount > 100")
    expect(classes(chip)).toEqual(
      expect.arrayContaining([
        "min-h-control",
        "rounded-pill",
        "bg-raised",
        "border",
        "max-w-60",
        "pl-2.5",
        "pr-0.5",
      ]),
    )
    // Without an editor its text is no button.
    expect(screen.getAllByRole("button")).toHaveLength(1)
  })

  it("names both buttons with the chip's text, a prefix included", () => {
    render(<ConditionChip prefix="At" label="Check order" onEdit={vi.fn()} onRemove={vi.fn()} />)
    const edit = screen.getByRole("button", { name: "Edit filter At Check order" })
    expect(edit.getAttribute("aria-haspopup")).toBe("dialog")
    expect(edit.textContent).toBe("At Check order")
    const remove = screen.getByRole("button", { name: "Remove filter At Check order" })
    expect(classes(remove)).toContain("size-control-xs")
  })

  it("hands its edit button to the editor, whose dialog gives the focus back to it on close", async () => {
    function Editable() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <ConditionChip label="amount > 100" onEdit={() => setOpen(true)} onRemove={vi.fn()} />
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent>
              <DialogTitle>Condition</DialogTitle>
              <DialogDescription>Edit it.</DialogDescription>
            </DialogContent>
          </Dialog>
        </>
      )
    }
    render(<Editable />)
    const edit = screen.getByRole("button", { name: "Edit filter amount > 100" })
    edit.focus()
    fireEvent.click(edit)
    expect(screen.getByRole("dialog")).toBeTruthy()
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
    expect(screen.queryByRole("dialog")).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(edit))
  })

  it("passes the edit button itself to onEdit", () => {
    const onEdit = vi.fn()
    render(<ConditionChip label="x" onEdit={onEdit} onRemove={vi.fn()} />)
    const edit = screen.getByRole("button", { name: "Edit filter x" })
    fireEvent.click(edit)
    expect(onEdit).toHaveBeenCalledWith(edit)
  })

  it("on remove, by click or keyboard, leaves and hands the focus to the opener", () => {
    function Conditions() {
      const opener = useRef<HTMLButtonElement>(null)
      const [shown, setShown] = useState(true)
      return (
        <>
          <button type="button" ref={opener}>
            Filter by variables
          </button>
          {shown && (
            <ConditionChip label="amount > 100" opener={opener} onRemove={() => setShown(false)} />
          )}
        </>
      )
    }
    render(<Conditions />)
    const remove = screen.getByRole("button", { name: "Remove filter amount > 100" })
    remove.focus()
    fireEvent.click(remove)
    expect(screen.queryByRole("button", { name: /amount/ })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Filter by variables" }))
  })

  it("speaks the locale", () => {
    render(
      <LocaleProvider locale="de">
        <ConditionChip label="Betrag > 100" onEdit={vi.fn()} onRemove={vi.fn()} />
      </LocaleProvider>,
    )
    expect(screen.getByRole("button", { name: "Filter Betrag > 100 bearbeiten" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Filter Betrag > 100 entfernen" })).toBeTruthy()
  })
})
