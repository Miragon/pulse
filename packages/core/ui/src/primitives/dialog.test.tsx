// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { LocaleProvider } from "../locale/locale-provider.js"
import { Button } from "./button.js"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog.js"
import { Input } from "./input.js"

/**
 * The dialog's geometry (CI §8, D9's compact look): at most 560 px over the guide's scrim, its
 * spacing carried by its three parts, the close button a 32 px ghost icon button in the header's
 * corner. widget-shell's ConfirmDialog composes the same parts.
 */

afterEach(cleanup)

const classes = (el: Element | null | undefined) => (el?.getAttribute("class") ?? "").split(/\s+/)

describe("Dialog geometry (CI §8)", () => {
  function dialog(showCloseButton = true) {
    return render(
      <LocaleProvider locale="en">
        <Dialog open>
          <DialogContent showCloseButton={showCloseButton}>
            <DialogHeader>
              <DialogTitle>Rename</DialogTitle>
              <DialogDescription>Give it a new name.</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <Input aria-label="Name" />
            </DialogBody>
            <DialogFooter>
              <Button variant="outline" size="lg">
                Keep name
              </Button>
              <Button size="lg">Rename</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </LocaleProvider>,
    )
  }
  const slot = (name: string) => document.querySelector(`[data-slot="${name}"]`)

  it("is at most 560 px wide, closes with a 32 px ghost icon button, over the guide's scrim blurred and greyed", () => {
    dialog()
    expect(classes(screen.getByRole("dialog"))).toContain("max-w-[min(560px,calc(100%-2rem))]")
    const close = screen.getByRole("button", { name: "Close" })
    expect(close.getAttribute("data-slot")).toBe("dialog-close")
    expect(classes(close)).toEqual(
      expect.arrayContaining(["size-8", "hover:bg-accent", "border-transparent", "rounded-button"]),
    )
    const overlay = document.querySelector('[data-slot="dialog-overlay"]')
    expect(classes(overlay)).toEqual(
      expect.arrayContaining(["bg-scrim", "backdrop-blur-[3px]", "backdrop-grayscale"]),
    )
    expect(classes(overlay)).not.toContain("backdrop-blur-sm")
  })

  it("its parts carry the spacing: no padding or gap on the box, the close button in the header's corner", () => {
    dialog()
    const box = classes(screen.getByRole("dialog"))
    expect(box.filter((c) => /^(?:p[xytrbl]?|gap)-/.test(c))).toEqual([])
    // 16 px in from the top and the right: the header's own top and right padding.
    expect(classes(screen.getByRole("button", { name: "Close" }))).toEqual(
      expect.arrayContaining(["absolute", "top-4", "right-4"]),
    )
  })

  it("the header: 16 px above, 24 px left, 8 px below, the title on the section step; it keeps the close button's corner clear", () => {
    dialog()
    expect(classes(slot("dialog-header"))).toEqual(
      expect.arrayContaining(["pt-4", "pb-2", "pl-6", "pr-14", "text-left"]),
    )
    expect(classes(screen.getByRole("heading", { name: "Rename" }))).toContain("text-section")
    cleanup()
    // Without the close button, 16 px on the right.
    dialog(false)
    expect(classes(slot("dialog-header"))).toEqual(expect.arrayContaining(["pt-4", "pr-4"]))
    expect(classes(slot("dialog-header"))).not.toContain("pr-14")
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull()
  })

  it("the body: 24 px on the sides and below, prose on the body step", () => {
    dialog()
    const body = slot("dialog-body")
    expect(classes(body)).toEqual(expect.arrayContaining(["px-6", "pb-6", "text-body"]))
    expect(body?.contains(screen.getByLabelText("Name"))).toBe(true)
  })

  it("the footer: a rule above, 24 px on the sides, 16 px above and below, secondary before primary", () => {
    dialog()
    const footer = slot("dialog-footer")
    expect(classes(footer)).toEqual(expect.arrayContaining(["border-t", "px-6", "py-4", "gap-2"]))
    expect([...(footer?.querySelectorAll("button") ?? [])].map((b) => b.textContent)).toEqual([
      "Keep name",
      "Rename",
    ])
  })
})
