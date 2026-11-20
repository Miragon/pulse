// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import { Server, TriangleAlert } from "lucide-react"
import { Icon } from "../kit/icon.js"
import { SideNav, SideNavGroup, SideNavItem, SideNavList } from "./SideNav.js"

/**
 * SideNav, an app's frame in the editors' look: a named navigation landmark of links, grouped and
 * nested, the current place `aria-current="page"` with the 2 px start edge in `--interaction`.
 */

afterEach(cleanup)

const classes = (el: Element | null | undefined) => (el?.getAttribute("class") ?? "").split(/\s+/)

function Navigation() {
  return (
    <SideNav ariaLabel="Pulse">
      <SideNavList>
        <SideNavItem href="/app">Start</SideNavItem>
      </SideNavList>
      <SideNavGroup label="Engines">
        <SideNavGroup label="prod">
          <SideNavList>
            <SideNavItem
              href="/app/engines/prod-a"
              icon={<Icon icon={Server} />}
              nested={
                <SideNavList>
                  <SideNavItem current href="/app/engines/prod-a">
                    Overview
                  </SideNavItem>
                  <SideNavItem href="/app/engines/prod-a/jobs">Jobs</SideNavItem>
                </SideNavList>
              }
            >
              prod-a
            </SideNavItem>
            <SideNavItem href="/app/engines/c8" note="boards only">
              c8
            </SideNavItem>
            <SideNavItem asChild icon={<Icon icon={TriangleAlert} />} note="refused">
              <a href="/app/engines/legacy" data-testid="own-link">
                legacy
              </a>
            </SideNavItem>
          </SideNavList>
        </SideNavGroup>
      </SideNavGroup>
    </SideNav>
  )
}

describe("SideNav: a named navigation landmark of links", () => {
  it("is a nav named by its ariaLabel, its items links of their lists", () => {
    render(<Navigation />)
    const nav = screen.getByRole("navigation", { name: "Pulse" })
    expect(nav.getAttribute("data-slot")).toBe("side-nav")
    const links = within(nav).getAllByRole("link")
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/app",
      "/app/engines/prod-a",
      "/app/engines/prod-a",
      "/app/engines/prod-a/jobs",
      "/app/engines/c8",
      "/app/engines/legacy",
    ])
    for (const link of links) expect(link.closest("li")).toBeTruthy()
  })

  it("names each group by its caption, a group inside a group too", () => {
    render(<Navigation />)
    const engines = screen.getByRole("group", { name: "Engines" })
    expect(within(engines).getByRole("group", { name: "prod" })).toBeTruthy()
    expect(classes(screen.getByText("Engines"))).toEqual(
      expect.arrayContaining(["text-small", "font-semibold", "text-muted-foreground"]),
    )
  })

  it("marks the current item aria-current=page with the fill, 600 and the 2 px left edge", () => {
    render(<Navigation />)
    const current = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page")
    expect(current.map((link) => link.textContent)).toEqual(["Overview"])
    expect(classes(current[0])).toEqual(
      expect.arrayContaining([
        "border-l-2",
        "border-transparent",
        "aria-[current=page]:border-l-interaction",
        "aria-[current=page]:bg-accent",
        "aria-[current=page]:font-semibold",
        "min-h-row",
        "text-dense",
      ]),
    )
  })

  it("indents a nested list's items one step, the border counted in the padding", () => {
    render(<Navigation />)
    const parent = screen.getByRole("link", { name: "prod-a" })
    const nested = screen.getByRole("link", { name: "Overview" })
    expect(classes(parent)).toContain("pl-[calc(var(--gutter)-2px)]")
    expect(classes(nested)).toContain("pl-[calc(var(--gutter)+1.5rem-2px)]")
    // The nested list sits in the parent's list item, after its link.
    expect(nested.closest("ul")?.parentElement).toBe(parent.closest("li"))
  })

  it("puts the note in the item's name after a comma, and takes your link with asChild", () => {
    render(<Navigation />)
    // The test DOM's name joins the inline note with a space a browser leaves out.
    expect(screen.getByRole("link", { name: /^c8 ?, boards only$/ })).toBeTruthy()
    const own = screen.getByTestId("own-link")
    expect(own.getAttribute("data-slot")).toBe("side-nav-item")
    expect(own).toBe(screen.getByRole("link", { name: /^legacy ?, refused$/ }))
    // The icon is decorative.
    expect(own.querySelector("svg")?.closest('[aria-hidden="true"]')).toBeTruthy()
  })
})
