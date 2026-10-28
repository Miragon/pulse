// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { MoreActions } from "./more-actions.js"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** The host simulation checks the painting under pinned cells at 760 px. */
function renderMenu(onExplain = vi.fn(), onDraft = vi.fn()) {
  render(
    <table>
      <tbody>
        <tr>
          <td data-testid="cell">
            <MoreActions label="More actions for the job at charge">
              <button type="button" role="menuitem" tabIndex={-1} onClick={onExplain}>
                Explain error in chat
              </button>
              <button type="button" role="menuitem" tabIndex={-1} onClick={onDraft}>
                Draft ticket in chat
              </button>
            </MoreActions>
          </td>
        </tr>
      </tbody>
    </table>,
  )
  const trigger = screen.getByRole("button", { name: "More actions for the job at charge" })
  return { trigger, onExplain, onDraft }
}

const items = () => screen.getAllByRole("menuitem")

describe("MoreActions", () => {
  it("is a menu button whose menu lives outside the row", () => {
    const { trigger } = renderMenu()
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu")
    expect(trigger.getAttribute("aria-expanded")).toBe("false")
    expect(screen.queryByRole("menu")).toBeNull()

    fireEvent.click(trigger)

    const menu = screen.getByRole("menu", { name: "More actions for the job at charge" })
    expect(trigger.getAttribute("aria-expanded")).toBe("true")
    expect(trigger.getAttribute("aria-controls")).toBe(menu.id)
    expect(screen.getByTestId("cell").contains(menu)).toBe(false)
    expect(menu.style.position).toBe("fixed")
  })

  it("opens under its button, or over it when the frame has no room below", () => {
    const { trigger } = renderMenu()
    const box = (top: number) =>
      vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
        top,
        bottom: top + 24,
        right: window.innerWidth - 40,
      } as DOMRect)
    const height = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(80)

    box(100)
    fireEvent.click(trigger)
    expect(screen.getByRole("menu").style).toMatchObject({ top: "128px", right: "40px" })
    fireEvent.click(trigger)

    box(window.innerHeight - 30)
    fireEvent.click(trigger)
    expect(screen.getByRole("menu").style.top).toBe(`${window.innerHeight - 30 - 4 - 80}px`)
    expect(height).toHaveBeenCalled()
  })

  it("takes the focus to its first entry; the arrows, Home and End move it", () => {
    const { trigger } = renderMenu()
    fireEvent.click(trigger)
    const [first, second] = items()
    expect(document.activeElement).toBe(first)

    const menu = screen.getByRole("menu")
    fireEvent.keyDown(menu, { key: "ArrowDown" })
    expect(document.activeElement).toBe(second)
    fireEvent.keyDown(menu, { key: "ArrowDown" })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(menu, { key: "ArrowUp" })
    expect(document.activeElement).toBe(second)
    fireEvent.keyDown(menu, { key: "Home" })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(menu, { key: "End" })
    expect(document.activeElement).toBe(second)
    // Any other key leaves the focus where it is.
    fireEvent.keyDown(menu, { key: "a" })
    expect(document.activeElement).toBe(second)
  })

  it("Escape closes it and returns the focus to the button", () => {
    const { trigger } = renderMenu()
    fireEvent.click(trigger)
    fireEvent.keyDown(document.activeElement!, { key: "Escape" })
    expect(screen.queryByRole("menu")).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(trigger.getAttribute("aria-expanded")).toBe("false")
  })

  it("Tab closes it and goes on from the button", () => {
    const { trigger } = renderMenu()
    fireEvent.click(trigger)
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Tab" })
    expect(screen.queryByRole("menu")).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it("an entry runs, then the menu closes and the focus goes back", () => {
    const { trigger, onDraft, onExplain } = renderMenu()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole("menuitem", { name: "Draft ticket in chat" }))
    expect(onDraft).toHaveBeenCalledTimes(1)
    expect(onExplain).not.toHaveBeenCalled()
    expect(screen.queryByRole("menu")).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it("a click on the menu outside an entry keeps it open", () => {
    const { trigger } = renderMenu()
    fireEvent.click(trigger)
    const menu = screen.getByRole("menu")
    fireEvent.pointerDown(menu)
    fireEvent.click(menu)
    expect(screen.getByRole("menu")).toBe(menu)
  })

  it("a click outside, a scroll or a resize closes it; the button toggles it", () => {
    const { trigger } = renderMenu()
    fireEvent.click(trigger)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole("menu")).toBeNull()

    fireEvent.click(trigger)
    act(() => {
      window.dispatchEvent(new Event("scroll"))
    })
    expect(screen.queryByRole("menu")).toBeNull()

    fireEvent.click(trigger)
    act(() => {
      window.dispatchEvent(new Event("resize"))
    })
    expect(screen.queryByRole("menu")).toBeNull()

    fireEvent.click(trigger)
    fireEvent.pointerDown(trigger)
    expect(screen.getByRole("menu")).toBeTruthy()
    fireEvent.click(trigger)
    expect(screen.queryByRole("menu")).toBeNull()
  })
})
