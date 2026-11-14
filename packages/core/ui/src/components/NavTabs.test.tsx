// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { LayoutDashboard, TriangleAlert } from "lucide-react"
import { Icon } from "../kit/icon.js"
import { LocaleProvider } from "../locale/locale-provider.js"
import { NavTab, NavTabs } from "./NavTabs.js"

/**
 * NavTabs, a navigation between views in the kit's line-tab look: a named landmark of links or
 * buttons (Tab, then Enter), the current one `aria-current="page"` with the 2 px bar, a count in
 * the item's name, and items that wrap where they do not fit.
 */

afterEach(cleanup)

const classes = (el: Element | null) => (el?.getAttribute("class") ?? "").split(/\s+/)

function Sections({ onOpen = () => {} }: { onOpen?: (id: string) => void }) {
  return (
    <NavTabs ariaLabel="Cockpit sections">
      <NavTab current icon={<Icon icon={LayoutDashboard} />} onClick={() => onOpen("overview")}>
        Overview
      </NavTab>
      <NavTab icon={<Icon icon={TriangleAlert} />} count={3} onClick={() => onOpen("incidents")}>
        Incidents
      </NavTab>
      <NavTab count={{ atLeast: 2000 }} onClick={() => onOpen("jobs")}>
        Jobs
      </NavTab>
    </NavTabs>
  )
}

describe("NavTabs: a named navigation landmark", () => {
  it("is a nav named by its ariaLabel, its items a list", () => {
    render(<Sections />)
    const nav = screen.getByRole("navigation", { name: "Cockpit sections" })
    expect(nav.getAttribute("data-slot")).toBe("nav-tabs")
    const list = within(nav).getByRole("list")
    expect(within(list).getAllByRole("listitem")).toHaveLength(3)
  })

  it("marks the current item aria-current=page and no other; it is no tab list", () => {
    render(<Sections />)
    const nav = screen.getByRole("navigation", { name: "Cockpit sections" })
    const items = within(nav).getAllByRole("button")
    expect(items.map((item) => item.getAttribute("aria-current"))).toEqual(["page", null, null])
    expect(within(nav).queryByRole("tablist")).toBeNull()
    expect(within(nav).queryByRole("tab")).toBeNull()
  })

  it("names an item by its label and its count, the count's words for a lower bound", () => {
    render(<Sections />)
    expect(screen.getByRole("button", { name: "Overview" })).toBeTruthy()
    expect(screen.getByRole("button", { name: /^Incidents\s*3$/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /^Jobs\s*at least 2,000$/ })).toBeTruthy()
    // The count is the kit's TabCount pill.
    const pill = screen
      .getByRole("button", { name: /^Incidents/ })
      .querySelector('[data-slot="tab-count"]')
    expect(classes(pill)).toEqual(expect.arrayContaining(["rounded-pill", "tabular-nums"]))
  })

  it("words the count in the kit's locale", () => {
    render(
      <LocaleProvider locale="de">
        <NavTabs ariaLabel="Bereiche">
          <NavTab count={1234}>Incidents</NavTab>
        </NavTabs>
      </LocaleProvider>,
    )
    expect(screen.getByRole("button", { name: /^Incidents\s*1\.234$/ })).toBeTruthy()
  })

  it("keeps the icon decorative, out of the item's name", () => {
    render(<Sections />)
    const overview = screen.getByRole("button", { name: "Overview" })
    const slot = overview.querySelector("span[aria-hidden]")
    expect(slot?.getAttribute("aria-hidden")).toBe("true")
    expect(slot?.querySelector("svg.lucide-layout-dashboard")).toBeTruthy()
    expect(classes(slot)).toContain("[&_svg:not([class*='size-'])]:size-4")
  })
})

describe("NavTabs: the keyboard", () => {
  it("puts every item in the tab order as a native button, no roving tabindex", () => {
    render(<Sections />)
    const items = within(screen.getByRole("navigation")).getAllByRole("button")
    for (const item of items) {
      expect(item.tagName).toBe("BUTTON")
      // A plain button: Enter and Space open it, and it never submits a form around it.
      expect(item.getAttribute("type")).toBe("button")
      expect(item.hasAttribute("tabindex")).toBe(false)
      expect(item.hasAttribute("disabled")).toBe(false)
      item.focus()
      expect(document.activeElement).toBe(item)
    }
  })

  it("opens an item by its own activation", () => {
    const onOpen = vi.fn()
    render(<Sections onOpen={onOpen} />)
    fireEvent.click(screen.getByRole("button", { name: /^Incidents/ }))
    expect(onOpen).toHaveBeenCalledWith("incidents")
  })

  it("asChild: a link is the item, with the look, aria-current, the icon and the count", () => {
    render(
      <NavTabs ariaLabel="Pages">
        <NavTab asChild current icon={<Icon icon={LayoutDashboard} />} count={2}>
          <a href="#/boards" className="own">
            Boards
          </a>
        </NavTab>
        <NavTab asChild>
          <a href="#/settings">Settings</a>
        </NavTab>
      </NavTabs>,
    )
    const boards = screen.getByRole("link", { name: /^Boards\s*2$/ })
    expect(boards.getAttribute("href")).toBe("#/boards")
    expect(boards.getAttribute("aria-current")).toBe("page")
    expect(boards.getAttribute("data-slot")).toBe("nav-tab")
    expect(boards.hasAttribute("type")).toBe(false)
    expect(classes(boards)).toEqual(expect.arrayContaining(["own", "border-b-2"]))
    expect(boards.querySelector("svg.lucide-layout-dashboard")).toBeTruthy()
    expect(boards.querySelector('[data-slot="tab-count"]')).toBeTruthy()
    const settings = screen.getByRole("link", { name: "Settings" })
    expect(settings.hasAttribute("aria-current")).toBe(false)
    expect(screen.queryAllByRole("button")).toHaveLength(0)
  })
})

describe("NavTabs: the line-tab look", () => {
  it("draws the current item on the hover fill at 600 with a real 2 px bar in --interaction", () => {
    render(<Sections />)
    for (const item of within(screen.getByRole("navigation")).getAllByRole("button")) {
      expect(classes(item)).toEqual(
        expect.arrayContaining([
          "text-dense",
          "text-muted-foreground",
          "hover:bg-accent",
          "hover:text-foreground",
          "border-b-2",
          "border-transparent",
          "aria-[current=page]:bg-accent",
          "aria-[current=page]:border-b-interaction",
          "aria-[current=page]:text-foreground",
          "aria-[current=page]:font-semibold",
        ]),
      )
      // The bar is a border, never a shadow or a pseudo-element, so forced colours keep it.
      expect(classes(item).some((c) => c.startsWith("after:") || c.includes("shadow"))).toBe(false)
    }
  })

  it("focuses inside the item, its outline only while focus is visible", () => {
    render(<Sections />)
    const item = screen.getByRole("button", { name: "Overview" })
    expect(classes(item)).toEqual(
      expect.arrayContaining(["focus-visible:ring-inset", "focus-visible:outline-hidden"]),
    )
    expect(classes(item)).not.toContain("outline-hidden")
  })

  it("is a toolbar high, its items stretched to it; they wrap where they do not fit, never clip", () => {
    render(<Sections />)
    const nav = screen.getByRole("navigation")
    const list = within(nav).getByRole("list")
    expect(classes(list)).toEqual(
      expect.arrayContaining(["min-h-toolbar", "flex", "flex-wrap", "items-stretch", "-mb-px"]),
    )
    for (const el of [nav, list, ...within(list).getAllByRole("listitem")]) {
      expect(classes(el).some((c) => /^overflow-|^truncate$|^line-clamp/.test(c))).toBe(false)
    }
    expect(classes(nav)).toEqual(expect.arrayContaining(["flex", "items-stretch", "min-w-0"]))
  })

  it("takes the caller's classes on the landmark and on an item", () => {
    render(
      <NavTabs ariaLabel="Pages" className="border-b">
        <NavTab className="ms-auto">Help</NavTab>
      </NavTabs>,
    )
    expect(classes(screen.getByRole("navigation"))).toContain("border-b")
    expect(classes(screen.getByRole("button", { name: "Help" }))).toContain("ms-auto")
  })
})
