// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { GroupCard } from "./GroupCard.js"

afterEach(cleanup)

/** A card as the incident lists compose it: the toggle, a count, a drill and a menu beside it. */
function renderCard(expanded = false) {
  const onToggle = vi.fn()
  const onOpen = vi.fn()
  const onMenu = vi.fn()
  const view = render(
    <GroupCard
      expanded={expanded}
      onToggle={onToggle}
      as="h3"
      title={<span className="block truncate">Invoice approval</span>}
      summary={(toggle) => (
        <div>
          {toggle}
          <span>3 open incidents</span>
          <button type="button" onClick={onOpen}>
            Open
          </button>
          <button type="button" aria-haspopup="menu" onClick={onMenu}>
            More actions
          </button>
        </div>
      )}
    >
      <p>Approve invoice</p>
    </GroupCard>,
  )
  return { ...view, onToggle, onOpen, onMenu }
}

const toggleOf = () => screen.getByRole("button", { name: "Invoice approval" })

describe("GroupCard: a real toggle, its actions beside it", () => {
  it("toggles through a <button aria-expanded> that holds the chevron and the title alone", () => {
    const { onToggle } = renderCard()
    const toggle = toggleOf()
    expect(toggle.tagName).toBe("BUTTON")
    expect(toggle.getAttribute("type")).toBe("button")
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    // The chevron first, decorative, then the title: nothing interactive inside.
    expect(toggle.firstElementChild?.tagName.toLowerCase()).toBe("svg")
    expect(toggle.firstElementChild?.getAttribute("aria-hidden")).toBe("true")
    expect(toggle.querySelector("button, a, input, [role='button'], [tabindex]")).toBeNull()
    fireEvent.click(toggle)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it("puts the toggle in the heading it is given, so each group is a stop of the outline", () => {
    renderCard()
    expect(screen.getByRole("heading", { level: 3 }).contains(toggleOf())).toBe(true)
  })

  it("turns the chevron down and names its body while expanded", () => {
    renderCard(true)
    const toggle = toggleOf()
    expect(toggle.getAttribute("aria-expanded")).toBe("true")
    expect(toggle.querySelector("svg")?.getAttribute("class")).toContain("rotate-90")
    const body = document.getElementById(toggle.getAttribute("aria-controls") ?? "")
    expect(body?.textContent).toBe("Approve invoice")
  })

  it("keeps no element with a button role that is no button, and nests no control in another", () => {
    const { container } = renderCard()
    expect(container.querySelector("[role='button']")).toBeNull()
    for (const control of container.querySelectorAll("button")) {
      expect(control.parentElement?.closest("button")).toBeNull()
    }
  })

  it("Enter or Space on an inner action does what it says and never toggles the card", () => {
    const { onToggle, onOpen } = renderCard()
    const open = screen.getByRole("button", { name: "Open" })
    for (const key of ["Enter", " "]) {
      // Nothing above the action takes its key: not prevented, so the browser's click follows.
      expect(fireEvent.keyDown(open, { key })).toBe(true)
      expect(fireEvent.keyUp(open, { key })).toBe(true)
    }
    fireEvent.click(open)
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onToggle).not.toHaveBeenCalled()
  })

  it("a click on an action opens it, never the card; a click on the summary around them toggles", () => {
    const { onToggle, onMenu } = renderCard()
    fireEvent.click(screen.getByRole("button", { name: "More actions" }))
    expect(onMenu).toHaveBeenCalledTimes(1)
    expect(onToggle).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText("3 open incidents"))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it("renders the toggle alone without a summary layout", () => {
    const onToggle = vi.fn()
    render(<GroupCard expanded={false} onToggle={onToggle} title="Orders" />)
    fireEvent.click(screen.getByRole("button", { name: "Orders" }))
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("heading")).toBeNull()
  })
})
