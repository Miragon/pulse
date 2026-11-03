// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { NavigationFocus } from "./navigation-focus.js"

/** #344 N107: a client-side navigation moves focus to the new view and names it. */
afterEach(cleanup)

const frameOf = () => screen.getByText("view body").parentElement as HTMLElement

describe("NavigationFocus", () => {
  it("takes no focus when the view only opened", () => {
    render(
      <NavigationFocus viewKey="overview" label="Overview">
        <p>view body</p>
      </NavigationFocus>,
    )
    expect(document.activeElement).toBe(document.body)
    expect(frameOf().getAttribute("tabindex")).toBe("-1")
  })

  it("moves focus to the view after a navigation and says where you are", () => {
    const { rerender } = render(
      <NavigationFocus viewKey="overview" label="Overview">
        <p>view body</p>
      </NavigationFocus>,
    )
    rerender(
      <NavigationFocus viewKey="incidents" label="Incidents">
        <p>view body</p>
      </NavigationFocus>,
    )
    expect(document.activeElement).toBe(frameOf())
    expect(screen.getByRole("status").textContent).toBe("Incidents")
  })

  it("leaves focus where it is while the same view re-renders", () => {
    const { rerender } = render(
      <NavigationFocus viewKey="overview" label="Overview">
        <button type="button">act</button>
        <p>view body</p>
      </NavigationFocus>,
    )
    screen.getByRole("button", { name: "act" }).focus()
    rerender(
      <NavigationFocus viewKey="overview" label="Overview">
        <button type="button">act</button>
        <p>view body</p>
      </NavigationFocus>,
    )
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "act" }))
  })
})
