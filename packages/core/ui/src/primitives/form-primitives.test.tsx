// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { rules } from "../theme/theme-css.test-support.js"
import { Checkbox } from "./checkbox.js"
import { Label } from "./label.js"
import { Progress } from "./progress.js"
import { Textarea } from "./textarea.js"

/**
 * The form primitives (CI §8 "Eingabefelder", "Checkbox und Radio"): the box, its states and
 * its accessible name and value; the field geometry of the textarea; the progress bar's value in
 * words. Disabled states are `disabled-states.test.tsx`'s.
 */

afterEach(cleanup)

const classes = (el: Element | null | undefined) => (el?.getAttribute("class") ?? "").split(/\s+/)

describe("Checkbox", () => {
  it("is an 18 px box inset like a field: the ground, a 1.5 px --input edge, a 24 px target", () => {
    render(<Checkbox aria-label="Select all" />)
    const box = screen.getByRole("checkbox", { name: "Select all" })
    expect(classes(box)).toEqual(
      expect.arrayContaining([
        "size-[1.125rem]",
        "border-[1.5px]",
        "border-input",
        "bg-background",
        "rounded-[calc(var(--radius-sm)-2px)]",
        // The target reaches 3 px around the box: 24 px (WCAG 2.5.8).
        "relative",
        "before:absolute",
        "before:-inset-[0.1875rem]",
        // Its focus ring sits flush in a table cell.
        "focus-visible:ring-offset-2",
        "in-[td]:focus-visible:ring-offset-0",
      ]),
    )
    expect(box.getAttribute("aria-checked")).toBe("false")
  })

  it("checked: the edge and the check take --interaction, the box keeps its ground (no blue fill, CI §8)", () => {
    const { container } = render(<Checkbox aria-label="Notify me" defaultChecked />)
    const box = screen.getByRole("checkbox", { name: "Notify me" })
    expect(box.getAttribute("aria-checked")).toBe("true")
    expect(box.getAttribute("data-state")).toBe("checked")
    expect(classes(box)).toEqual(
      expect.arrayContaining(["text-interaction", "data-[state=checked]:border-interaction"]),
    )
    expect(classes(box).filter((c) => /bg-(?:interaction|primary)/.test(c))).toEqual([])
    const icons = container.querySelectorAll("svg")
    expect([...icons].map((svg) => svg.getAttribute("class"))).toEqual([
      expect.stringContaining("lucide-check"),
      expect.stringContaining("lucide-minus"),
    ])
    // The check shows; the minus waits for the indeterminate state.
    expect(classes(icons[0])).toContain("group-data-[state=indeterminate]/checkbox:hidden")
    expect(classes(icons[1])).toEqual(
      expect.arrayContaining(["hidden", "group-data-[state=indeterminate]/checkbox:block"]),
    )
    for (const svg of icons) {
      expect(svg.getAttribute("aria-hidden")).toBe("true")
      expect(svg.getAttribute("width")).toBe("16")
      expect(svg.getAttribute("stroke-width")).toBe("2.5")
    }
  })

  it("indeterminate reads as mixed, draws the minus and turns checked on a click", () => {
    const onCheckedChange = vi.fn()
    render(
      <Checkbox
        aria-label="Select all shown instances"
        checked="indeterminate"
        onCheckedChange={onCheckedChange}
      />,
    )
    const box = screen.getByRole("checkbox", { name: "Select all shown instances" })
    expect(box.getAttribute("aria-checked")).toBe("mixed")
    expect(box.getAttribute("data-state")).toBe("indeterminate")
    expect(classes(box)).toContain("data-[state=indeterminate]:border-interaction")
    fireEvent.click(box)
    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })

  it("toggles on a click and on its label, and draws no mark while unchecked", () => {
    function Remember() {
      const [checked, setChecked] = useState(false)
      return (
        <>
          <Checkbox
            id="remember"
            checked={checked}
            onCheckedChange={(c) => setChecked(c === true)}
          />
          <Label htmlFor="remember">Remember the filter</Label>
        </>
      )
    }
    const { container } = render(<Remember />)
    const box = screen.getByRole("checkbox", { name: "Remember the filter" })
    expect(container.querySelector("svg")).toBeNull()
    fireEvent.click(box)
    expect(box.getAttribute("aria-checked")).toBe("true")
    fireEvent.click(screen.getByText("Remember the filter"))
    expect(box.getAttribute("aria-checked")).toBe("false")
  })

  it("an invalid one draws a danger edge; a disabled one does not toggle", () => {
    const onCheckedChange = vi.fn()
    render(
      <>
        <Checkbox aria-label="Accept" aria-invalid />
        <Checkbox aria-label="Locked" disabled onCheckedChange={onCheckedChange} />
      </>,
    )
    // In every state: a checked or mixed box's --interaction edge yields (disabled-states.test.tsx
    // holds the order in the stylesheet).
    expect(classes(screen.getByRole("checkbox", { name: "Accept" }))).toEqual(
      expect.arrayContaining([
        "aria-invalid:border-danger",
        "aria-invalid:data-[state=checked]:border-danger",
        "aria-invalid:data-[state=indeterminate]:border-danger",
      ]),
    )
    const locked = screen.getByRole("checkbox", { name: "Locked" })
    fireEvent.click(locked)
    expect(onCheckedChange).not.toHaveBeenCalled()
    expect(locked.hasAttribute("disabled")).toBe(true)
  })
})

describe("Label", () => {
  it("names its control: 13 px at 600 in the text colour, quiet beside a disabled peer", () => {
    render(
      <>
        <Label htmlFor="note">Note</Label>
        <input id="note" />
      </>,
    )
    const label = screen.getByText("Note")
    expect(label.tagName).toBe("LABEL")
    expect(label.getAttribute("for")).toBe("note")
    expect(label.getAttribute("data-slot")).toBe("label")
    expect(classes(label)).toEqual(
      expect.arrayContaining([
        "text-small",
        "font-semibold",
        "text-foreground",
        "peer-disabled:text-muted-foreground",
        "peer-disabled:cursor-not-allowed",
      ]),
    )
    expect(screen.getByLabelText("Note").tagName).toBe("INPUT")
  })
})

describe("Textarea", () => {
  it("is a field like Input: the ground, the --input edge, the sm radius, three lines at least, resizable in height", () => {
    render(<Textarea aria-label="Value" defaultValue="{}" />)
    const area = screen.getByRole("textbox", { name: "Value" })
    expect(area.tagName).toBe("TEXTAREA")
    expect(area.getAttribute("data-slot")).toBe("textarea")
    expect(classes(area)).toEqual(
      expect.arrayContaining([
        "bg-background",
        "border-input",
        "rounded-sm",
        "px-3",
        "py-1",
        "resize-y",
        "min-h-[calc(3lh+0.5rem+2px)]",
        "focus-visible:outline-hidden",
        "focus-visible:border-focus",
        "focus-visible:ring-[length:calc(var(--focus-width)-1px)]",
        "aria-invalid:border-danger",
      ]),
    )
  })

  it("takes a caller's classes over its own (a mono value, one line)", () => {
    render(<Textarea aria-label="JSON" className="min-h-control font-mono" rows={1} />)
    const area = screen.getByRole("textbox", { name: "JSON" })
    expect(classes(area)).toEqual(expect.arrayContaining(["min-h-control", "font-mono"]))
    expect(classes(area)).not.toContain("min-h-[calc(3lh+0.5rem+2px)]")
    expect(area.getAttribute("rows")).toBe("1")
  })
})

describe("Progress", () => {
  it("is a progressbar with its name, its share and its value in words", () => {
    render(
      <Progress
        aria-label="Progress of the bulk operation"
        value={3}
        max={12}
        valueText="3 of 12 done"
      />,
    )
    const bar = screen.getByRole("progressbar", { name: "Progress of the bulk operation" })
    expect(bar.getAttribute("aria-valuemin")).toBe("0")
    expect(bar.getAttribute("aria-valuemax")).toBe("12")
    expect(bar.getAttribute("aria-valuenow")).toBe("3")
    expect(bar.getAttribute("aria-valuetext")).toBe("3 of 12 done")
    expect(bar.getAttribute("data-state")).toBe("loading")
    expect(classes(bar)).toEqual(
      expect.arrayContaining(["bg-muted", "h-1", "w-full", "overflow-hidden", "rounded-pill"]),
    )
    const fill = bar.querySelector('[data-slot="progress-indicator"]') as HTMLElement
    expect(classes(fill)).toEqual(expect.arrayContaining(["bg-interaction", "w-full"]))
    expect(fill.style.transform).toBe("translateX(-75%)")
  })

  it("is named by another element too, and complete at its max", () => {
    render(
      <>
        <span id="archive">Archive</span>
        <Progress aria-labelledby="archive" value={5} max={5} valueText="All 5 archived" />
      </>,
    )
    const bar = screen.getByRole("progressbar", { name: "Archive" })
    expect(bar.getAttribute("data-state")).toBe("complete")
    const fill = bar.querySelector('[data-slot="progress-indicator"]') as HTMLElement
    expect(fill.style.transform).toBe("translateX(-0%)")
  })

  it("counts to 100 when max is left out", () => {
    render(<Progress aria-label="Done" value={50} valueText="50 percent" />)
    const bar = screen.getByRole("progressbar", { name: "Done" })
    expect(bar.getAttribute("aria-valuemax")).toBe("100")
    expect(bar.getAttribute("aria-valuenow")).toBe("50")
    expect(bar.getAttribute("data-state")).toBe("loading")
    const fill = bar.querySelector('[data-slot="progress-indicator"]') as HTMLElement
    expect(fill.style.transform).toBe("translateX(-50%)")
  })

  it("clamps a value outside 0 to max, and takes 1 for a max that is no amount", () => {
    const { rerender } = render(<Progress aria-label="Done" value={14} max={12} valueText="all" />)
    const bar = () => screen.getByRole("progressbar", { name: "Done" })
    expect(bar().getAttribute("aria-valuenow")).toBe("12")
    rerender(<Progress aria-label="Done" value={-2} max={12} valueText="none" />)
    expect(bar().getAttribute("aria-valuenow")).toBe("0")
    rerender(<Progress aria-label="Done" value={0} max={0} valueText="nothing to do" />)
    expect(bar().getAttribute("aria-valuemax")).toBe("1")
    expect(bar().getAttribute("aria-valuenow")).toBe("0")
  })

  it("without a value it runs, keeps its words, and stands still as a dashed line under reduced motion", () => {
    render(<Progress aria-label="Loading the list" valueText="Loading…" />)
    const bar = screen.getByRole("progressbar", { name: "Loading the list" })
    expect(bar.hasAttribute("aria-valuenow")).toBe(false)
    expect(bar.getAttribute("aria-valuetext")).toBe("Loading…")
    expect(bar.getAttribute("data-state")).toBe("indeterminate")
    const fill = bar.querySelector('[data-slot="progress-indicator"]') as HTMLElement
    expect(fill.style.transform).toBe("")
    expect(classes(fill)).toEqual(
      expect.arrayContaining([
        "animate-progress-indeterminate",
        "w-2/5",
        "motion-reduce:animate-none",
        "motion-reduce:w-full",
        "motion-reduce:bg-transparent",
        "motion-reduce:border-t-4",
        "motion-reduce:border-dashed",
        "motion-reduce:border-interaction",
      ]),
    )
  })

  it("an unknown amount (NaN) runs like a missing one", () => {
    render(<Progress aria-label="Counting" value={Number.NaN} valueText="Counting…" />)
    expect(screen.getByRole("progressbar", { name: "Counting" }).getAttribute("data-state")).toBe(
      "indeterminate",
    )
  })

  it("theme.css runs the segment across the track and keeps the bar under forced colours", () => {
    const css = rules.replace(/\s+/g, " ")
    expect(css).toContain(
      "--animate-progress-indeterminate: progress-indeterminate 1.5s var(--ease) infinite;",
    )
    expect(css).toMatch(
      /@keyframes progress-indeterminate \{ from \{ transform: translateX\(-100%\); \} to \{ transform: translateX\(250%\); \} \}/,
    )
    const forced = css.slice(css.indexOf("@media (forced-colors: active)"))
    expect(forced).toContain('[data-slot="progress"] { outline: 1px solid CanvasText; }')
    expect(forced).toContain(
      '@media (prefers-reduced-motion: reduce) { [data-slot="progress-indicator"][data-state="indeterminate"] { background-color: Canvas; } }',
    )
  })
})
