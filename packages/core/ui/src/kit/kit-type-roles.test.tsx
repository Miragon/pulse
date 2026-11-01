// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { LogText } from "./log-text.js"
import { NativeSelect } from "./native-select.js"
import { RowCard } from "./row-card.js"
import { Section } from "./section.js"
import { VersionChip } from "./table.js"

/** `brand-gates.test.ts` scans for off-scale sizes; these pin the role each piece takes. */

afterEach(cleanup)

const classes = (el: Element | null) => (el?.getAttribute("class") ?? "").split(/\s+/)

describe("kit type roles", () => {
  it("a Section heading is the section step (21 px / 600), its summary keyboard-visible", () => {
    render(
      <Section title="Variables" count={3}>
        <p>body</p>
      </Section>,
    )
    const heading = screen.getByRole("heading", { level: 3, name: "Variables" })
    expect(classes(heading)).toContain("text-section")
    expect(classes(heading.closest("summary"))).toContain("focus-visible:ring-focus")
  })

  it("a native select takes the 3:1 input edge, the dense step and the kit's focus ring", () => {
    render(
      <NativeSelect aria-label="select">
        <option>a</option>
      </NativeSelect>,
    )
    const c = classes(screen.getByLabelText("select"))
    expect(c).toContain("border-input")
    expect(c).not.toContain("border-border")
    expect(c).toContain("text-dense")
    expect(c).toContain("focus-visible:ring-focus")
  })

  it("log text, version chips and row-card subtitles are captions (13 px)", () => {
    render(
      <>
        <LogText text="NullPointerException" />
        <VersionChip version={3} />
        <RowCard title="Order" subtitle="v3 · 12 running" />
      </>,
    )
    expect(classes(screen.getByText("NullPointerException"))).toContain("text-small")
    expect(classes(screen.getByText("v3"))).toContain("text-small")
    expect(classes(screen.getByText("v3 · 12 running"))).toContain("text-small")
    expect(classes(screen.getByText("Order"))).toContain("text-dense")
  })
})
