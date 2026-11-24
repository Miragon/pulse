// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { classesUnder, compiled } from "./bar-css.test-support.js"
import { Panel, PanelGrid } from "./PanelGrid.js"

/** PanelGrid and Panel, a dashboard's rows of sections: one column below 600 px of the grid. */

afterEach(cleanup)

const grid = (container: HTMLElement) =>
  container.querySelector<HTMLElement>("[data-slot='panel-grid']")!

describe("Panel", () => {
  it("is a section named by its h2 title, its hint quiet beside it", () => {
    render(
      <Panel title="Started per day" hint="all versions">
        <p>bars</p>
      </Panel>,
    )
    const panel = screen.getByRole("region", { name: "Started per day" })
    expect(panel.tagName).toBe("SECTION")
    expect(panel.querySelector("h2")?.textContent).toBe("Started per day")
    expect(panel.textContent).toBe("Started per dayall versionsbars")
    expect(panel.hasAttribute("tabindex")).toBe(false)
    expect(panel.hasAttribute("id")).toBe(false)
  })

  it("takes an anchor the page can move the focus to, a level and a control after the hint", () => {
    render(
      <Panel
        id="incidents"
        as="h3"
        title="Incidents"
        hint="all versions"
        trailing={<button type="button">Legend</button>}
      >
        <p>rows</p>
      </Panel>,
    )
    const panel = screen.getByRole("region", { name: "Incidents" })
    expect(panel.id).toBe("incidents")
    expect(panel.getAttribute("tabindex")).toBe("-1")
    expect(panel.querySelector("h3")).toBeTruthy()
    const heading = panel.querySelector("[data-slot='section-heading']")!
    expect(heading.textContent).toBe("Incidentsall versionsLegend")
  })

  it("spans the whole row of its grid when wide", () => {
    render(
      <Panel title="Diagram" wide>
        <p>diagram</p>
      </Panel>,
    )
    expect(screen.getByRole("region").getAttribute("class")).toContain("col-span-full")
  })
})

describe("PanelGrid", () => {
  it("stacks in one column, side by side by its own width: 2 by default", () => {
    const { container } = render(
      <PanelGrid>
        <Panel title="A">a</Panel>
        <Panel title="B">b</Panel>
      </PanelGrid>,
    )
    const outer = grid(container)
    expect(outer.getAttribute("class")).toContain("@container/panels")
    const inner = outer.firstElementChild!
    expect(inner.getAttribute("class")?.split(" ")).toEqual(
      expect.arrayContaining([
        "grid",
        "grid-cols-1",
        "gap-section",
        "@min-[37.5rem]/panels:grid-cols-2",
      ]),
    )
    expect(screen.getAllByRole("region")).toHaveLength(2)
  })

  it("keeps one column with columns 1 and adds a third from 900 px with columns 3", () => {
    const { container } = render(
      <PanelGrid columns={1}>
        <Panel title="A">a</Panel>
      </PanelGrid>,
    )
    expect(grid(container).firstElementChild?.getAttribute("class")).not.toContain("@min-")
    cleanup()
    const three = render(
      <PanelGrid columns={3}>
        <Panel title="A">a</Panel>
      </PanelGrid>,
    )
    expect(grid(three.container).firstElementChild?.getAttribute("class")).toContain(
      "@min-[56.25rem]/panels:grid-cols-3",
    )
  })

  it("compiles its columns to queries on the grid's own width, 600 and 900 px", async () => {
    const { container } = render(
      <PanelGrid columns={3}>
        <Panel title="A" wide>
          a
        </Panel>
      </PanelGrid>,
    )
    const css = await compiled(classesUnder(grid(container)))
    expect(css).toContain("container-type: inline-size")
    expect(css).toContain("container-name: panels")
    expect(css).toMatch(
      /@container panels \(width >= 37\.5rem\) \{ [^{]+\{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/,
    )
    expect(css).toMatch(
      /@container panels \(width >= 56\.25rem\) \{ [^{]+\{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/,
    )
    // Below 600 px: one column that never widens past the grid.
    expect(css).toContain(".grid-cols-1 { grid-template-columns: repeat(1, minmax(0, 1fr)); }")
    expect(css).toContain("grid-column: 1 / -1")
    // The gap is the density's section gap, the panel's inset its gutter.
    expect(css).toContain("gap: var(--section-gap)")
    expect(css).toContain("padding: var(--gutter)")
  })
})
